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
//
// Offline-first (C1): a failed pull never blocks the push of local
// operations, and a failed push never blocks local work — the outbox stays
// durable and delivery resumes when the network is back.
import { getSyncDeviceId } from './device.js';
import {
  getPendingOps,
  listOutbox,
  updateOutboxEntry,
  markAcked,
  MAX_ATTEMPTS,
} from './outbox.js';
import { applyIncomingOperation } from './apply.js';
import { recordConflict, listConflicts, listUnresolvedConflicts, resolveConflictEntry } from './quarantine.js';
import { resolveConflict } from '../core/commands.js';

const CURSOR_KEY = 'atlas-sync-cursor-v1';
const LAST_SYNC_KEY = 'atlas-sync-last-sync-at';

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
  let lastSyncAt = Number(store.get(LAST_SYNC_KEY)) || null;
  let lastError = null;
  let authFailed = false;
  // Conflict count reflects UNRESOLVED quarantine entries (C3): resolved ones
  // no longer demand attention.
  const unresolvedCount = () => listUnresolvedConflicts().length;
  let conflicts = unresolvedCount();

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

  // W1 recovery: `failed` marks "gave up after MAX_ATTEMPTS", but every push
  // failure in this design is transient (network / server outage) — there is
  // no per-op permanent rejection from the remote. Once a sync cycle proves
  // the network works again, failed entries must become deliverable again;
  // otherwise a short outage permanently stalls the outbox and the
  // offline → retry → online promise breaks.
  function promoteFailed(){
    let promoted = 0;
    for (const entry of listOutbox()) {
      if (entry.syncStatus === 'failed') {
        updateOutboxEntry(entry.operation.id, { syncStatus: 'retryable', attempts: 0, lastError: null });
        promoted += 1;
      }
    }
    return promoted;
  }

  function findOutboxEntry(id){
    return listOutbox().find(entry => entry.operation?.id === id) || null;
  }

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
      // P1 review fix: per-op server rejections are TERMINAL. Unlike transient
      // network failures they must never retry — a malformed operation would
      // otherwise loop forever between retryable → failed → promoteFailed.
      // Mark BEFORE recoverSent so the rejected entries are not resurrected.
      const serverConflicts = result?.conflicts || [];
      for (const conflict of serverConflicts) {
        const operationId = conflict?.operationId;
        if (!operationId) continue;
        updateOutboxEntry(operationId, {
          syncStatus: 'rejected',
          attempts: (findOutboxEntry(operationId)?.attempts || 0) + 1,
          lastError: `server rejected: ${conflict?.reason || 'invalid_operation'}`,
        });
      }
      recoverSent();
      return { pushed: pending.length, acked: ackedIds.length, rejected: serverConflicts.length };
    } catch (error) {
      const message = error?.message || String(error);
      lastError = message;
      if (error?.code === 'unauthorized') authFailed = true;
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
          recordConflict({
            operation,
            serverSequence,
            reason: result.reason || 'conflict',
            status: 'conflict',
            conflictStatus: result.conflictStatus || 'base_version',
          });
        } else if (result.unsupported) {
          recordConflict({
            operation,
            serverSequence,
            reason: `unsupported type: ${operation.type}`,
            status: 'unsupported',
            conflictStatus: 'unsupported',
          });
        }
      } catch (error) {
        // Permanently invalid operation: quarantine durably, then move past it.
        recordConflict({
          operation,
          serverSequence,
          reason: error?.message || String(error),
          status: 'invalid',
          conflictStatus: 'invalid',
        });
        lastError = `apply failed (${operation.type}): ${error?.message || error}`;
      }
      // Cursor advances only after apply OR durable quarantine.
      cursor = Math.max(cursor, serverSequence);
      saveCursor();
    }
    return { pulled: operations.length, newCursor: cursor };
  }

  // Full cycle: apply remote first, then deliver local. Idempotent and safe to
  // call repeatedly (dedupe by operationId + cursor).
  //
  // C1 offline-first: a pull failure is recorded but never blocks the push —
  // local operations must still reach the remote when the network allows it.
  async function sync(){
    let pulled = 0;
    let pullFailed = false;
    try {
      const result = await pull();
      pulled = result.pulled;
      if (result.newCursor != null) cursor = result.newCursor;
      authFailed = false;
    } catch (error) {
      pullFailed = true;
      lastError = error?.message || String(error);
      if (error?.code === 'unauthorized') authFailed = true;
    }
    const pushed = await pushOutbox();
    // W1: the network just proved itself — re-promote any previously failed
    // entries and deliver them in the same cycle (bounded: stop at the first
    // failing pass). This restores catch-up after a long offline window.
    let pushResult = pushed;
    if (!(pushed.failed > 0) && promoteFailed() > 0) {
      pushResult = await pushOutbox();
    }
    // The cycle counts as a successful sync only if at least one direction
    // actually worked — otherwise "последняя синхронизация" would lie.
    if (!pullFailed && !(pushResult.failed > 0)) {
      lastSyncAt = Date.now();
      store.set(LAST_SYNC_KEY, String(lastSyncAt));
    }
    return {
      pulled,
      pushed: pushResult.pushed,
      acked: pushResult.acked || 0,
      rejected: pushResult.rejected || 0,
      failed: pushResult.failed || 0,
      cursor,
    };
  }

  function getStatus(){
    const outbox = listOutbox();
    const rejectedEntries = outbox.filter(entry => entry.syncStatus === 'rejected');
    return {
      deviceId: getSyncDeviceId(),
      pending: getPendingOps().length,
      failed: outbox.filter(entry => entry.syncStatus === 'failed').length,
      rejected: rejectedEntries.length,
      // Server-side reasons only (no operation payloads, no secrets).
      rejectedReasons: rejectedEntries.slice(-5).map(entry => entry.lastError || 'server rejected'),
      cursor,
      lastSyncAt,
      lastError,
      authFailed,
      conflicts: unresolvedCount(),
    };
  }

  function getConflicts(){
    return listConflicts();
  }

  // C3: the user resolved a quarantined conflict — apply the chosen action to
  // local state (Core command) and durably mark the entry resolved.
  function resolveConflictEntryUser(conflict, action){
    const op = conflict?.operation;
    if (!op) throw new Error('resolveConflict: conflict missing operation');
    resolveConflict(conflict, action, { deviceId: getSyncDeviceId() });
    const resolved = resolveConflictEntry(op.id, action);
    if (!resolved) throw new Error('resolveConflict: quarantine entry not found');
    conflicts = unresolvedCount();
    return resolved;
  }

  return { sync, pull, pushOutbox, recoverSent, getStatus, getConflicts, resolveConflict: resolveConflictEntryUser, get cursor(){ return cursor; } };
}
