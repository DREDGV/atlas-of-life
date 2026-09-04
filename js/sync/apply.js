// js/sync/apply.js — Core sync-apply layer.
//
// Incoming sync operations are applied through Core remote-apply commands
// (js/core/commands.js): atomic, saveState() inside the command, rollback on
// persistence failure, and NO outbound sync operation (no echo loop). This
// module never mutates persisted state or calls saveState() itself.
//
// Invariants preserved: rawText immutable, routed lock, resultRef as a
// reference only (Task itself is not synced in C0), destination validation.
import { state } from '../state.js';
import { resolveConflictEntry } from './quarantine.js';
import {
  applyRemoteInboxCapture,
  applyRemoteInboxDelete,
  applyRemoteInboxRestore,
  applyRemoteInboxRevert,
  applyRemoteInboxRoute,
  applyRemoteInboxUpdate,
  applyRemoteTaskResultRemove,
  applyRemoteTaskResultUpsert,
} from '../core/commands.js';

const APPLIED_KEY = 'atlas-sync-applied-v1';
const APPLIED_LIMIT = 500;

function readApplied(){
  try {
    const raw = globalThis.localStorage?.getItem(APPLIED_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (_) {}
  return [];
}

function writeApplied(list){
  globalThis.localStorage?.setItem(APPLIED_KEY, JSON.stringify(list));
}

export function isApplied(operationId){
  return readApplied().includes(operationId);
}

export function markApplied(operationId){
  const list = readApplied();
  if (list.includes(operationId)) return;
  list.push(operationId);
  if (list.length > APPLIED_LIMIT) list.splice(0, list.length - APPLIED_LIMIT);
  writeApplied(list);
}

function applyInboxCapture(payload){
  if (!payload || typeof payload.rawText !== 'string') {
    throw new Error('inbox.capture: payload.rawText missing');
  }
  const existing = state.inbox.find(item => item.id === payload.id);
  if (existing) return; // already present — idempotent
  const created = applyRemoteInboxCapture(payload, {});
  if (!created || created.length !== 1) {
    throw new Error('remote inbox.capture: failed to create the item');
  }
}

function applyInboxUpdate(operation){
  const after = operation.payload?.after || {};
  const id = after.id || operation.entityId;
  if (!id) throw new Error('inbox.update: id missing');
  const item = state.inbox.find(entry => entry.id === id);
  if (!item) {
    // C3 deleted-race: the record was deleted on this device while the remote
    // still edited it. Not invalid — a real multi-device collision the user
    // can resolve (restore+apply or keep deleted).
    return { conflict: true, conflictStatus: 'deleted_race', reason: 'запись удалена на этом устройстве' };
  }

  // baseVersion conflict: if the local item moved past the version this update
  // was based on, refuse instead of clobbering (silent last-write-wins).
  if (
    operation.baseVersion != null &&
    item.updatedAt != null &&
    Number(operation.baseVersion) !== Number(item.updatedAt)
  ) {
    return { conflict: true, conflictStatus: 'base_version', reason: 'изменена на двух устройствах' };
  }

  applyRemoteInboxUpdate(id, after, {});
  return { conflict: false };
}

function applyInboxRoute(payload){
  const after = payload?.inboxAfter || {};
  if (!state.inbox.some(entry => entry.id === after.id)) {
    return { conflict: true, conflictStatus: 'deleted_race', reason: 'запись удалена на этом устройстве' };
  }
  applyRemoteInboxRoute(payload, {});
  return { conflict: false };
}

function applyInboxRevert(payload){
  const after = payload?.inboxAfter || {};
  if (!state.inbox.some(entry => entry.id === after.id)) {
    return { conflict: true, conflictStatus: 'deleted_race', reason: 'запись удалена на этом устройстве' };
  }
  applyRemoteInboxRevert(payload, {});
  return { conflict: false };
}

// applyIncomingOperation returns { applied, deduped?, conflict?, unsupported? }.
// It never corrupts state: invalid payloads throw before any mutation, and the
// engine decides how to quarantine a failed operation.
export function applyIncomingOperation(operation){
  if (!operation?.id) throw new Error('operation missing id');
  if (isApplied(operation.id)) return { applied: false, deduped: true };

  let conflict = false;
  let conflictStatus = null;
  switch (operation.type) {
    case 'inbox.capture':
      applyInboxCapture(operation.payload);
      break;
    case 'inbox.update': {
      const result = applyInboxUpdate(operation);
      if (result.conflict) return { applied: false, conflict: true, conflictStatus: result.conflictStatus || 'base_version' };
      break;
    }
    case 'inbox.route_to_task': {
      const result = applyInboxRoute(operation.payload);
      if (result.conflict) return { applied: false, conflict: true, conflictStatus: 'deleted_race' };
      break;
    }
    case 'inbox.route_revert': {
      const result = applyInboxRevert(operation.payload);
      if (result.conflict) return { applied: false, conflict: true, conflictStatus: 'deleted_race' };
      break;
    }
    case 'inbox.delete': {
      const result = applyRemoteInboxDelete(operation.payload, { baseVersion: operation.baseVersion });
      if (result?.conflict) {
        return { applied: false, conflict: true, conflictStatus: result.conflictStatus || 'linked_result_delete', reason: result.reason };
      }
      break;
    }
    case 'inbox.restore': {
      const result = applyRemoteInboxRestore(operation.payload, { baseVersion: operation.baseVersion });
      if (result?.conflict) {
        return { applied: false, conflict: true, conflictStatus: result.conflictStatus || 'delete_restore_race', reason: result.reason };
      }
      // A compensating inbox.restore (emitted by restore_apply resolution)
      // carries resolvesOperationId: after the record is back, the matching
      // quarantined operation on this device is resolved too.
      if (operation.payload?.resolvesOperationId) {
        resolveConflictEntry(operation.payload.resolvesOperationId, 'restore_apply');
      }
      break;
    }
    case 'task.result.upsert':
      applyRemoteTaskResultUpsert(operation.payload, {});
      break;
    case 'task.result.remove':
      applyRemoteTaskResultRemove(operation.payload, {});
      break;
    default:
      return { applied: false, unsupported: true };
  }

  markApplied(operation.id);
  return { applied: true };
}
