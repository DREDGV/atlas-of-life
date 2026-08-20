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
import {
  applyRemoteInboxCapture,
  applyRemoteInboxRevert,
  applyRemoteInboxRoute,
  applyRemoteInboxUpdate,
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
  if (!item) throw new Error(`inbox.update: unknown inbox item ${id}`);

  // baseVersion conflict: if the local item moved past the version this update
  // was based on, refuse instead of clobbering (silent last-write-wins).
  if (
    operation.baseVersion != null &&
    item.updatedAt != null &&
    Number(operation.baseVersion) !== Number(item.updatedAt)
  ) {
    return { conflict: true };
  }

  applyRemoteInboxUpdate(id, after, {});
  return { conflict: false };
}

function applyInboxRoute(payload){
  applyRemoteInboxRoute(payload, {});
}

function applyInboxRevert(payload){
  applyRemoteInboxRevert(payload, {});
}

// applyIncomingOperation returns { applied, deduped?, conflict?, unsupported? }.
// It never corrupts state: invalid payloads throw before any mutation, and the
// engine decides how to quarantine a failed operation.
export function applyIncomingOperation(operation){
  if (!operation?.id) throw new Error('operation missing id');
  if (isApplied(operation.id)) return { applied: false, deduped: true };

  let conflict = false;
  switch (operation.type) {
    case 'inbox.capture':
      applyInboxCapture(operation.payload);
      break;
    case 'inbox.update': {
      const result = applyInboxUpdate(operation);
      if (result.conflict) return { applied: false, conflict: true };
      break;
    }
    case 'inbox.route_to_task':
      applyInboxRoute(operation.payload);
      break;
    case 'inbox.route_revert':
      applyInboxRevert(operation.payload);
      break;
    default:
      return { applied: false, unsupported: true };
  }

  markApplied(operation.id);
  return { applied: true };
}
