import { state } from '../state.js';
import { saveState } from '../storage.js';
import { getDeviceId } from '../core/device.js';
import { loadInboxSyncConfig } from './config.js';
import { createInboxHttpTransport } from './http-transport.js';
import { runInboxSyncCycle } from './inbox-sync.js';

const DEFAULT_INTERVAL_MS = 30000;

function emit(callback, phase, details = {}){
  if (typeof callback === 'function') callback({ phase, ...details });
}

export function createInboxSyncRuntime(options = {}){
  const intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
  const onStatus = options.onStatus;
  const getConfig = options.getConfig || loadInboxSyncConfig;
  const makeTransport = options.makeTransport || createInboxHttpTransport;
  const persistState = options.persist || saveState;
  let timer = null;
  let activeCycle = null;
  let stopped = true;

  async function syncNow(reason = 'manual'){
    if (activeCycle) return activeCycle;
    const config = getConfig();
    if (!config.enabled || !config.endpoint || !config.token) {
      emit(onStatus, 'disabled', { reason });
      return { skipped: 'disabled' };
    }
    if (globalThis.navigator && navigator.onLine === false) {
      emit(onStatus, 'offline', { reason });
      return { skipped: 'offline' };
    }

    activeCycle = (async () => {
      emit(onStatus, 'syncing', { reason });
      try {
        const result = await runInboxSyncCycle({
          inbox: state.inbox,
          operationLog: state.operationLog,
          deviceId: getDeviceId(),
          cursor: state.sync?.endpoint === config.endpoint ? state.sync?.cursor || '0' : '0',
          transport: makeTransport(config),
          async persist({ nextCursor }){
            const previous = state.sync;
            state.sync = { endpoint: config.endpoint, cursor: nextCursor, lastSyncAt: Date.now() };
            try {
              await persistState();
            } catch (error) {
              state.sync = previous;
              throw error;
            }
          },
        });
        const phase = result.pushConflicts.length > 0 ? 'conflict' : 'synced';
        emit(onStatus, phase, { reason, result, at: state.sync?.lastSyncAt });
        return result;
      } catch (error) {
        emit(onStatus, 'error', { reason, error });
        throw error;
      } finally {
        activeCycle = null;
      }
    })();
    return activeCycle;
  }

  function schedule(){
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      syncNow('interval').catch(() => {});
    }, intervalMs);
  }

  function handleOnline(){
    syncNow('online').catch(() => {});
  }

  function handleVisibility(){
    if (document.visibilityState === 'visible') syncNow('visible').catch(() => {});
  }

  function start(){
    if (!stopped) return;
    stopped = false;
    schedule();
    globalThis.addEventListener?.('online', handleOnline);
    globalThis.document?.addEventListener?.('visibilitychange', handleVisibility);
    syncNow('startup').catch(() => {});
  }

  function stop(){
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    globalThis.removeEventListener?.('online', handleOnline);
    globalThis.document?.removeEventListener?.('visibilitychange', handleVisibility);
  }

  return { start, stop, syncNow, isRunning: () => Boolean(activeCycle) };
}
