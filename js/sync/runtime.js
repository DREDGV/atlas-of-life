// js/sync/runtime.js — Sync v1 runtime bootstrap for the apps (Stage C1).
//
// Wires the durable engine + remote HTTP transport + persisted config into
// the live application, with a simple predictable lifecycle:
//
//   - on app start (when configured): one sync shortly after boot;
//   - after local mutations: apps call requestSync() (debounced);
//   - on `online`: immediate sync (offline → retry → online catch-up);
//   - periodic poll (default 30 s) while configured and online;
//   - a manual "Синхронизировать сейчас" is always available in the UI;
//   - sync is fire-and-forget: a failure NEVER blocks local work, it only
//     surfaces in the status (pending / error / revoked).
//
// No realtime magic: pull/push on a timer is the whole design, matching the
// "simple predictable system > magic realtime" product preference.
import { getSyncConfig, saveSyncConfig, clearSyncConfig } from './config.js';
import { createHttpTransport, claimPairingCode } from './http-transport.js';
import { createSyncEngine } from './engine.js';
import { getSyncDeviceId } from './device.js';

const DEFAULT_INTERVAL_MS = 30_000;
const REQUEST_SYNC_DEBOUNCE_MS = 2_500;
const BOOT_SYNC_DELAY_MS = 800;

export function createSyncRuntime(options = {}){
  const intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const storage = options.storage || null;

  let config = getSyncConfig();
  let engine = null;
  let timer = null;
  let started = false;
  let inFlight = false;
  let requestTimer = null;
  let lastCyclePulled = 0;
  const subscribers = new Set();

  function buildEngine(){
    if (!config) return null;
    const transport = createHttpTransport({
      endpoint: config.endpoint,
      getToken: () => getSyncConfig()?.token || null,
    });
    return createSyncEngine({ transport, storage: storage || undefined });
  }

  function refreshEngine(){
    engine = buildEngine();
  }

  function snapshot(){
    const status = engine ? engine.getStatus() : {
      deviceId: getSyncDeviceId(),
      pending: 0,
      failed: 0,
      cursor: 0,
      lastSyncAt: null,
      lastError: null,
      authFailed: false,
      conflicts: 0,
    };
    let online = true;
    try { online = navigator.onLine !== false; } catch (_) {}
    return {
      configured: Boolean(config),
      endpoint: config?.endpoint || null,
      deviceName: config?.deviceName || null,
      deviceId: status.deviceId,
      online,
      syncing: inFlight,
      pending: status.pending,
      failed: status.failed,
      conflicts: status.conflicts,
      lastSyncAt: status.lastSyncAt,
      lastError: status.lastError,
      authFailed: Boolean(status.authFailed),
      cursor: status.cursor,
      // How many operations the LAST completed cycle applied locally — the
      // apps use this to re-render after a remote change (0 = nothing new).
      pulled: lastCyclePulled,
    };
  }

  function notify(){
    const status = snapshot();
    subscribers.forEach(fn => {
      try { fn(status); } catch (_) {}
    });
    onStatus(status);
  }

  function subscribe(fn){
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  async function syncNow(){
    if (!engine) {
      notify();
      return { skipped: 'not_configured' };
    }
    if (inFlight) return { skipped: 'in_flight' };
    inFlight = true;
    notify();
    try {
      const result = await engine.sync();
      lastCyclePulled = Number(result?.pulled) || 0;
      return result;
    } finally {
      inFlight = false;
      notify();
    }
  }

  // Debounced trigger for local mutations: several changes within the window
  // collapse into one sync cycle.
  function requestSync(){
    if (!config) return;
    if (requestTimer) clearTimeout(requestTimer);
    requestTimer = setTimeout(() => {
      requestTimer = null;
      syncNow();
    }, REQUEST_SYNC_DEBOUNCE_MS);
  }

  async function pair({ endpoint, code, deviceName }){
    if (inFlight) await new Promise(resolve => {
      const check = setInterval(() => {
        if (!inFlight) { clearInterval(check); resolve(); }
      }, 100);
    });
    const claimed = await claimPairingCode(endpoint, {
      code,
      deviceId: getSyncDeviceId(),
      deviceName,
    });
    config = saveSyncConfig({
      endpoint,
      token: claimed.token,
      deviceName: claimed.deviceName || deviceName,
    });
    refreshEngine();
    notify();
    await syncNow();
    return claimed;
  }

  async function unpair({ revoke = true } = {}){
    if (revoke && engine) {
      try {
        const transport = createHttpTransport({
          endpoint: config.endpoint,
          getToken: () => config?.token || null,
        });
        await transport.revokeSelf();
      } catch (_) {
        // Best effort: the local token is cleared either way.
      }
    }
    config = null;
    engine = null;
    clearSyncConfig();
    notify();
  }

  function isConfigured(){
    return Boolean(config);
  }

  function getConfig(){
    return config ? { ...config } : null;
  }

  // Create a one-time pairing code for another device using this device's
  // own credential (any paired device may onboard the next one).
  async function createPairingCode(){
    if (!config) throw new Error('Sync is not configured');
    const transport = createHttpTransport({
      endpoint: config.endpoint,
      getToken: () => config.token,
    });
    return transport.createPairingCode();
  }

  const onOnline = () => syncNow();
  const onVisibility = () => {
    if (!document.hidden && config) syncNow();
  };
  const onSyncNowEvent = () => requestSync();

  function start(){
    if (started) return;
    started = true;
    refreshEngine();
    if (config) setTimeout(() => syncNow(), BOOT_SYNC_DELAY_MS);

    timer = setInterval(() => {
      if (config && !inFlight) syncNow();
    }, intervalMs);

    window.addEventListener('online', onOnline);
    window.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('atlas:sync-now', onSyncNowEvent);
  }

  function stop(){
    if (!started) return;
    started = false;
    if (timer) clearInterval(timer);
    timer = null;
    if (requestTimer) clearTimeout(requestTimer);
    requestTimer = null;
    window.removeEventListener('online', onOnline);
    window.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('atlas:sync-now', onSyncNowEvent);
  }

  refreshEngine();
  return {
    start,
    stop,
    syncNow,
    requestSync,
    pair,
    unpair,
    createPairingCode,
    isConfigured,
    getConfig,
    getStatus: snapshot,
    getConflicts: () => (engine ? engine.getConflicts() : []),
    // C3: resolve a quarantined conflict (keep local / accept remote / keep
    // both / keep deleted / dismiss). State change runs through Core; any
    // resulting outbound ops (restore, copy capture) are delivered promptly.
    resolveConflict: (conflict, action) => {
      if (!engine) throw new Error('Sync is not configured');
      const resolved = engine.resolveConflict(conflict, action);
      notify();
      requestSync();
      return resolved;
    },
    subscribe,
  };
}

// Convenience for app code: dispatch a sync trigger without importing the
// runtime instance.
export function requestSyncNow(){
  try {
    window.dispatchEvent(new CustomEvent('atlas:sync-now'));
  } catch (_) {}
}
