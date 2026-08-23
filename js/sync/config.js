// js/sync/config.js — persisted remote sync configuration (Stage C1).
//
// Local to the device (localStorage): the remote endpoint, the device bearer
// token issued during pairing, and the display name of this device.
//
// The token is a secret of THIS device only. It is never committed to the
// repository; it lives in the browser's localStorage of the paired device.
// Nothing here is written to disk by the app code — localStorage is the
// browser's own persistence.
//
// Shape (key `atlas-sync-config-v1`):
//   { endpoint, token, deviceName, pairedAt, protocol: 'atlas-sync-v1' }

const CONFIG_KEY = 'atlas-sync-config-v1';
export const SYNC_PROTOCOL = 'atlas-sync-v1';

// Production endpoints must be HTTPS (PWA requirement, phone). Plain HTTP is
// accepted only for loopback development (a secure context in browsers).
function isAllowedEndpoint(endpoint){
  if (endpoint.startsWith('https://')) return true;
  if (!endpoint.startsWith('http://')) return false;
  try {
    const url = new URL(endpoint);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  } catch (_) {
    return false;
  }
}

export function getSyncConfig(){
  try {
    const raw = globalThis.localStorage?.getItem(CONFIG_KEY);
    if (raw) {
      const config = JSON.parse(raw);
      if (
        config &&
        typeof config.endpoint === 'string' &&
        isAllowedEndpoint(config.endpoint) &&
        typeof config.token === 'string' &&
        config.token.length >= 32
      ) {
        return config;
      }
    }
  } catch (_) {}
  return null;
}

export function saveSyncConfig(config){
  const safe = {
    endpoint: String(config?.endpoint || '').replace(/\/+$/, ''),
    token: String(config?.token || ''),
    deviceName: String(config?.deviceName || 'Atlas device').slice(0, 80),
    pairedAt: Number(config?.pairedAt) || Date.now(),
    protocol: SYNC_PROTOCOL,
  };
  if (!isAllowedEndpoint(safe.endpoint) || safe.token.length < 32) {
    throw new Error('Sync config requires an https endpoint (or http://localhost for development) and a valid device token');
  }
  globalThis.localStorage?.setItem(CONFIG_KEY, JSON.stringify(safe));
  return safe;
}

export function clearSyncConfig(){
  globalThis.localStorage?.removeItem(CONFIG_KEY);
}
