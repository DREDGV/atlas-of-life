// js/sync/engine.js — client sync engine.
//
// Ties the durable outbox, the transport and the Core sync-apply layer together:
//
//   pull  → apply incoming ops through Core (idempotent, cursor-ordered)
//   push  → deliver pending outbox ops, acknowledge, mark acked
//
// Recovery semantics:
//   - `sent` entries that were never acknowledged (crash/reload between send
//     and ack, or a partial ack) become `retryable` again — replay is safe
//     because apply is idempotent by operationId;
//   - incoming operations that cannot be applied (conflict / invalid /
//     unsupported) are durably quarantined BEFORE the cursor advances, so a
//     single bad operation never blocks the stream and never loops forever.
import { getSyncDeviceId } from './device.js';
import {
  getPendingOps,
  listOutbox,
  updateOutboxEntry,
  markAcked,
  MAX_ATTEMPTS,
} from './outbox.js';
import { applyIncomingOperation } from './apply.js';
import { recordConflict, listConflicts } from './quarantine.js';

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

  // Deterministic recovery: any unacked `sent` entry from a previous run (or a
  // partial ack) becomes eligible for retry. Idempotency makes replay safe.
  function recoverSent(){
    let recovered = 0;
    for (const entry of listOutbox()) {
      if (entry.syncStatus === 'sent') {
        updateOutboxEntry(entry.operation.id, { syncStatus: 'retryable' });
        recovered += 1;
      }
    }
    return recovered;
  }
  recoverSent();

  async function pushOutbox(){
    const pending = getPendingOps();
    if (pending.length === 0) return { pushed: 0 };

    // Mark as sent while in flight (awaiting ack).
    pending.forEach(entry => updateOutboxEntry(entry.operation.id, { syncStatus: 'sent' }));

    try {
      const result = await transport.pushOperations(pending.map(entry => entry.operation));
      // A partial ack is NOT a success for the whole batch: only acked ids are
      // removed; every entry still `sent` after this becomes retryable.
      const ackedIds = result?.ackedIds || [];
      ackedIds.forEach(id => markAcked(id));
      recoverSent();
      lastError = null;
      return { pushed: pending.length, acked: ackedIds.length };
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
        if (result.conflict) {
          recordConflict({ operation, serverSequence, reason: 'baseVersion mismatch', status: 'conflict' });
          conflicts += 1;
        } else if (result.unsupported) {
          recordConflict({ operation, serverSequence, reason: `unsupported type: ${operation.type}`, status: 'unsupported' });
          conflicts += 1;
        }
      } catch (error) {
        // Permanently invalid operation: quarantine durably, then move past it.
        recordConflict({ operation, serverSequence, reason: error?.message || String(error), status: 'invalid' });
        conflicts += 1;
        lastError = `apply failed (${operation.type}): ${error?.message || error}`;
      }
      // Cursor advances only after apply OR durable quarantine.
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

  function getConflicts(){
    return listConflicts();
  }

  return { sync, pull, pushOutbox, recoverSent, getStatus, getConflicts, get cursor(){ return cursor; } };
}
