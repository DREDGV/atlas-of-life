// js/sync/apply.js — Core sync-apply layer.
//
// Incoming sync operations are applied to persisted state through the same
// model mutations the Core commands use (addInboxLines / updateInboxItem),
// followed by saveState(). No transport/UI code mutates state directly.
//
// Invariants preserved on the receiving side:
//   - rawText immutable (addInboxLines recreates text/rawText from the payload;
//     updateInboxItem refuses rawText patches);
//   - destination validation where applicable (domainHintId re-validated);
//   - resultRef/sourceInboxId integrity: resultRef syncs as a result reference
//     only — the Task itself is not synced in C0.
import { state } from '../state.js';
import { saveState } from '../storage.js';
import { addInboxLines, updateInboxItem } from '../features/inbox/model.js';

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
  try {
    globalThis.localStorage?.setItem(APPLIED_KEY, JSON.stringify(list));
  } catch (_) {}
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
  addInboxLines(payload.rawText, {
    splitLines: false,
    now: payload.createdAt ?? Date.now(),
    idFactory: () => payload.id,
    inputType: payload.inputType,
    source: payload.source,
    status: payload.status,
    userHint: payload.userHint,
    domainHintId: payload.domainHintId,
    itemType: payload.itemType,
    deviceId: payload.deviceId,
    entryPoint: payload.entryPoint,
  });
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

  const patch = {};
  if (Object.hasOwn(after, 'text')) patch.text = after.text;
  if (Object.hasOwn(after, 'itemType')) patch.itemType = after.itemType;
  if (Object.hasOwn(after, 'status')) patch.status = after.status;
  if (Object.hasOwn(after, 'domainHintId')) patch.domainHintId = after.domainHintId;
  const result = updateInboxItem(id, patch);
  if (result) {
    Object.assign(result.item, result.changes);
    result.item.updatedAt = after.updatedAt ?? result.item.updatedAt;
  }
  return { conflict: false };
}

function applyInboxRoute(payload){
  const after = payload?.inboxAfter || {};
  const item = state.inbox.find(entry => entry.id === after.id);
  if (!item) return; // no-op: routed item was never created here
  item.status = after.status || 'processed';
  item.resultRef = after.resultRef || null;
  item.updatedAt = after.updatedAt ?? item.updatedAt;
}

function applyInboxRevert(payload){
  const after = payload?.inboxAfter || {};
  const item = state.inbox.find(entry => entry.id === after.id);
  if (!item) return;
  delete item.resultRef;
  item.status = after.status || 'reviewed';
  item.updatedAt = after.updatedAt ?? item.updatedAt;
}

// applyIncomingOperation returns { applied, deduped?, conflict?, unsupported? }.
// It never corrupts state: invalid payloads throw before any saveState, and the
// caller decides how to record the failure.
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

  saveState();
  markApplied(operation.id);
  return { applied: true };
}
