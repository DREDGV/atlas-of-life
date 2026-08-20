// js/sync/engine.js — client sync engine.
//
// Ties the durable outbox, the transport and the Core sync-apply layer together:
//
//   pull  → apply incoming ops through Core (idempotent, cursor-ordered)
//   push  → deliver pending outbox ops, acknowledge, mark acked
//
// Cursor advances only after an operation has been applied or resolved
// (conflict/unsupported recorded, never silently clobbered), so a restart
// never re-applies acknowledged operations.
import { getSyncDeviceId } from './device.js';
import { getPendingOps, updateOutboxEntry, markAcked, MAX_ATTEMPTS } from './outbox.js';
import { applyIncomingOperation } from './apply.js';

const CURSOR_KEY = 'atlas-sync-cursor-v1';

export function createSyncEngine({ transport, storage } = {}){
  const store = storage || {
    get(key){
      try { return globalThis.localStorage?.getItem(key); } catch (_) { return null; }
    },
    set(key, value){
      try { globalThis.localStorage?.setItem(key, String(value)); } catch (_) {}
    },
  };

  let cursor = Number(store.get(CURSOR_KEY)) || 0;
  let lastSyncAt = null;
  let lastError = null;
  let conflicts = 0;

  const saveCursor = () => store.set(CURSOR_KEY, cursor);

  async function pushOutbox(){
    const pending = getPendingOps();
    if (pending.length === 0) return { pushed: 0 };

    // Mark as sent while in flight (awaiting ack).
    pending.forEach(entry => updateOutboxEntry(entry.operation.id, { syncStatus: 'sent' }));

    try {
      const result = await transport.pushOperations(pending.map(entry => entry.operation));
      const ackedIds = result?.ackedIds || pending.map(entry => entry.operation.id);
      ackedIds.forEach(id => markAcked(id));
      lastError = null;
      return { pushed: pending.length };
    } catch (error) {
      const message = error?.message || String(error);
      lastError = message;
      pending.forEach(entry => {
        const attempts = (entry.attempts || 0) + 1;
        const syncStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'retryable';
        updateOutboxEntry(entry.operation.id, {
          syncStatus,
          attempts,
          lastError: message,
        });
      });
      return { pushed: 0, failed: pending.length, error: message };
    }
  }

  async function pull(){
    const { operations, newCursor } = await transport.pullOperations(cursor, {
      excludeDeviceId: getSyncDeviceId(),
    });
    for (const { serverSequence, operation } of operations) {
      try {
        const result = applyIncomingOperation(operation);
        if (result.conflict) conflicts += 1;
        if (result.unsupported) lastError = `unsupported op type: ${operation.type}`;
      } catch (error) {
        // A permanently invalid operation must not loop forever: record it,
        // mark it applied so the cursor can move past it, keep state intact.
        lastError = `apply failed (${operation.type}): ${error?.message || error}`;
        const { markApplied } = await import('./apply.js');
        markApplied(operation.id);
      }
      cursor = Math.max(cursor, serverSequence);
      saveCursor();
    }
    if (operations.length > 0) lastSyncAt = Date.now();
    return { pulled: operations.length, newCursor: cursor };
  }

  // Full cycle: apply remote first, then deliver local. Idempotent and safe to
  // call repeatedly (dedupe by operationId + cursor).
  async function sync(){
    const pulled = await pull();
    const pushed = await pushOutbox();
    return { pulled: pulled.pulled, pushed: pushed.pushed, failed: pushed.failed || 0, cursor };
  }

  function getStatus(){
    return {
      deviceId: getSyncDeviceId(),
      pending: getPendingOps().length,
      cursor,
      lastSyncAt,
      lastError,
      conflicts,
    };
  }

  return { sync, pull, pushOutbox, getStatus, get cursor(){ return cursor; } };
}
