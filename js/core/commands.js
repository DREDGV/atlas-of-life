import { state, normalizeTags } from '../state.js';
import { saveState } from '../storage.js';
import { appendOperation } from './operations.js';
import { enqueueSyncOperation } from '../sync/outbox.js';
import { syncCapabilities } from '../sync/capabilities.js';
import {
  addInboxLines,
  convertInboxItemToTask,
  removeInboxItem,
  restoreInboxItem,
  updateInboxItem,
} from '../features/inbox/model.js';

// Explicit per-app capability (js/sync/capabilities.js): Studio validates
// routed result references against its Task model; Capture is projection-only.
// Never inferred from state.tasks.length.
function hasTaskModel(){
  return syncCapabilities.hasTaskModel === true;
}

const TASK_STATUSES = new Set(['backlog', 'today', 'doing', 'done']);
const COMMAND_ARRAY_KEYS = [
  'domains',
  'projects',
  'tasks',
  'inbox',
  'operationLog',
  'taskProjections',
  'inboxTombstones',
];

function finish(options){
  if (options.persist !== false) saveState();
}

// Enqueue a syncable operation after the command persisted successfully. An
// outbox persistence failure must not fail the already-saved local change, but
// it must be observable (console), never silently swallowed as success.
function enqueueOutbound(operation){
  try {
    enqueueSyncOperation(operation);
  } catch (error) {
    console.warn('sync outbox enqueue failed', error?.message || error);
  }
}

// ---------------------------------------------------------------------------
// Sync v1 C2 — Task Result Bridge.
//
// A routed Task exists in full only on the desktop. Remote devices get a
// read-only display projection (`state.taskProjections`) via dedicated
// operations: `task.result.upsert` / `task.result.remove`. Derived data with
// a single writer (the desktop that routed the item) — no conflict machinery,
// no Task CRUD replication, no competing truth about the Task.
// ---------------------------------------------------------------------------

function buildTaskResultProjection(task){
  if (!task || !task.id) return null;
  let project = null;
  let domain = null;
  if (task.projectId) {
    project = state.projects.find(entry => entry.id === task.projectId) || null;
    if (project) domain = state.domains.find(entry => entry.id === project.domainId) || null;
  }
  if (!domain && task.domainId) {
    domain = state.domains.find(entry => entry.id === task.domainId) || null;
  }
  return {
    id: String(task.id),
    title: String(task.title || '').slice(0, 200),
    sourceInboxId: task.sourceInboxId ? String(task.sourceInboxId) : null,
    domainId: task.domainId ? String(task.domainId) : (domain?.id ? String(domain.id) : null),
    domainTitle: domain?.title ?? null,
    projectId: task.projectId ? String(task.projectId) : null,
    projectTitle: project?.title ?? null,
    priority: Number(task.priority) || 2,
    due: task.due ?? null,
    status: TASK_STATUSES.has(task.status) ? task.status : 'backlog',
    updatedAt: Number(task.updatedAt) || Date.now(),
  };
}

function enqueueTaskResultOperation(type, task, options){
  const operation = appendOperation({
    type,
    entityType: 'task',
    entityId: task.id,
    payload: type === 'task.result.upsert'
      ? { projection: buildTaskResultProjection(task) }
      : { id: task.id, sourceInboxId: task.sourceInboxId || null },
  }, { timestamp: options.now ?? Date.now(), deviceId: options.deviceId });
  enqueueOutbound(operation);
  return operation;
}

function cloneCommandValue(value){
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value);
    } catch (_) {}
  }
  return JSON.parse(JSON.stringify(value));
}

function isObject(value){
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function restoreObjectInPlace(target, snapshot){
  Object.keys(target).forEach(key => delete target[key]);
  Object.assign(target, cloneCommandValue(snapshot));
}

function captureArrayState(key){
  const arrayRef = state[key];
  return {
    arrayRef,
    entries: arrayRef.map(value => ({
      objectRef: isObject(value) ? value : null,
      snapshot: cloneCommandValue(value),
    })),
  };
}

function captureCommandState(){
  const settingsRef = isObject(state.settings) ? state.settings : null;
  return {
    arrays: Object.fromEntries(
      COMMAND_ARRAY_KEYS.map(key => [key, captureArrayState(key)])
    ),
    settings: {
      objectRef: settingsRef,
      snapshot: cloneCommandValue(state.settings),
    },
    activeDomain: state.activeDomain,
  };
}

function restoreCommandState(checkpoint){
  COMMAND_ARRAY_KEYS.forEach(key => {
    const { arrayRef, entries } = checkpoint.arrays[key];
    const originalEntries = entries.map(entry => {
      if (!entry.objectRef) return cloneCommandValue(entry.snapshot);
      restoreObjectInPlace(entry.objectRef, entry.snapshot);
      return entry.objectRef;
    });
    arrayRef.splice(0, arrayRef.length, ...originalEntries);
    state[key] = arrayRef;
  });
  if (checkpoint.settings.objectRef) {
    restoreObjectInPlace(
      checkpoint.settings.objectRef,
      checkpoint.settings.snapshot
    );
    state.settings = checkpoint.settings.objectRef;
  } else {
    state.settings = cloneCommandValue(checkpoint.settings.snapshot);
  }
  state.activeDomain = checkpoint.activeDomain;
}

function runAtomicCommand(execute){
  const checkpoint = captureCommandState();
  try {
    return execute();
  } catch (error) {
    restoreCommandState(checkpoint);
    throw error;
  }
}

function generateTaskId(){
  if (globalThis.crypto?.randomUUID) return `task-${globalThis.crypto.randomUUID()}`;
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateProjectId(){
  if (globalThis.crypto?.randomUUID) return `project-${globalThis.crypto.randomUUID()}`;
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateDomainId(){
  if (globalThis.crypto?.randomUUID) return `domain-${globalThis.crypto.randomUUID()}`;
  return `domain-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function snapshot(value){
  return JSON.parse(JSON.stringify(value));
}

function normalizeTaskStatus(status){
  const normalized = String(status || 'backlog').trim().toLowerCase();
  if (!TASK_STATUSES.has(normalized)) {
    throw new Error(`Unknown task status: ${status}`);
  }
  return normalized;
}

// Priority is the existing 1..4 scale (1 = low … 4 = critical), matching the
// quick-add parser `p1..p4` and `sizeByImportance`.
function normalizePriority(value){
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 2;
}

// Due is structured: { date: 'YYYY-MM-DD', time: 'HH:MM' | null } | null.
// Never embedded in the task title.
function normalizeDue(value){
  if (!value || typeof value !== 'object') return null;
  const date = typeof value.date === 'string' ? value.date : null;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = typeof value.time === 'string' && /^\d{2}:\d{2}$/.test(value.time)
    ? value.time
    : null;
  return { date, time };
}

function normalizePosition(position){
  if (!position || typeof position !== 'object') return null;
  const x = Number(position.x);
  const y = Number(position.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function applyTaskPlacement(task, destination){
  if (Object.hasOwn(destination, 'projectId')) {
    const projectId = destination.projectId ?? null;
    if (projectId) {
      const targetProject = state.projects.find(project => project.id === projectId);
      if (!targetProject) throw new Error(`Unknown target project: ${projectId}`);
      task.projectId = projectId;
      delete task.domainId;
      delete task.pos;
    } else {
      task.projectId = null;
      task.domainId = destination.domainId ?? null;
    }
  } else if (!task.projectId && Object.hasOwn(destination, 'domainId')) {
    task.domainId = destination.domainId ?? null;
  }

  if (!task.projectId && Object.hasOwn(destination, 'pos')) {
    const position = normalizePosition(destination.pos);
    if (position) task.pos = position;
    else delete task.pos;
  }
}

function captureInboxMutation(text, options){
  const created = addInboxLines(text, options);
  const operations = created.map(item => appendOperation({
    type: 'inbox.capture',
    entityType: 'inbox',
    entityId: item.id,
    payload: item,
  }, { timestamp: options.now, deviceId: options.deviceId }));
  if (created.length) finish(options);
  // Enqueue for sync only after the command persisted successfully.
  operations.forEach(operation => enqueueOutbound(operation));
  return created;
}

export function captureInbox(text, options = {}){
  return runAtomicCommand(() => captureInboxMutation(text, options));
}

function deleteInboxMutation(id, options){
  // Review: a routed Inbox record owns the resultRef ↔ sourceInboxId link.
  // Deleting it locally would break the bidirectional invariant — the user
  // must revert the route first (or delete the result Task separately).
  const existing = state.inbox.find(item => item.id === id);
  if (existing?.resultRef) {
    throw new Error('Routed inbox records cannot be deleted; use "Вернуть в разбор" first');
  }
  const removal = removeInboxItem(id);
  if (!removal) return null;
  if (!Array.isArray(state.inboxTombstones)) state.inboxTombstones = [];
  const tombstoneIndex = state.inboxTombstones.findIndex(t => t.id === id);
  const tombstone = {
    id,
    baseVersion: removal.item.updatedAt || null,
    deletedAt: options.now ?? Date.now(),
    removal,
  };
  if (tombstoneIndex >= 0) state.inboxTombstones[tombstoneIndex] = tombstone;
  else state.inboxTombstones.push(tombstone);
  const operation = appendOperation({
    type: 'inbox.delete',
    entityType: 'inbox',
    entityId: removal.item.id,
    baseVersion: removal.item.updatedAt || null,
    payload: removal,
  }, { timestamp: options.now, deviceId: options.deviceId });
  finish(options);
  enqueueOutbound(operation); // C3: deletions now sync (W2)
  return removal;
}

export function deleteInbox(id, options = {}){
  return runAtomicCommand(() => deleteInboxMutation(id, options));
}

function undoDeleteInboxMutation(removal, options){
  if (!restoreInboxItem(removal)) return false;
  if (Array.isArray(state.inboxTombstones)) {
    state.inboxTombstones = state.inboxTombstones.filter(t => t.id !== removal.item.id);
  }
  const operation = appendOperation({
    type: 'inbox.restore',
    entityType: 'inbox',
    entityId: removal.item.id,
    baseVersion: removal.item.updatedAt || null,
    payload: removal,
  }, { timestamp: options.now, deviceId: options.deviceId });
  finish(options);
  enqueueOutbound(operation); // C3: restores now sync (W2)
  return true;
}

export function undoDeleteInbox(removal, options = {}){
  return runAtomicCommand(() => undoDeleteInboxMutation(removal, options));
}

/**
 * Stage B0 processing edit: text, confirmed type or processing status.
 * One atomic command, one `inbox.update` operation. `rawText` is preserved
 * by the model invariant and never appears in the patch.
 */
function updateInboxMutation(id, patch, options){
  const result = updateInboxItem(id, patch);
  if (!result) return null;
  const { item, changes } = result;

  const comparable = Object.entries(changes).some(([key, value]) =>
    JSON.stringify(item[key] ?? null) !== JSON.stringify(value ?? null)
  );
  if (!comparable) return { item, before: snapshot(item), operation: null };

  const before = snapshot(item);
  Object.assign(item, changes);
  item.updatedAt = options.now ?? Date.now();
  const operation = appendOperation({
    type: 'inbox.update',
    entityType: 'inbox',
    entityId: item.id,
    baseVersion: before.updatedAt || null,
    payload: {
      before,
      after: item,
    },
  }, { timestamp: item.updatedAt, deviceId: options.deviceId });
  finish(options);
  enqueueOutbound(operation);
  return { item, before, operation };
}

export function updateInbox(id, patch, options = {}){
  return runAtomicCommand(() => updateInboxMutation(id, patch, options));
}

/**
 * Stage B1: safe Inbox → Task routing. Creates a Task, marks the source Inbox
 * item `processed`, and links both directions in one atomic operation:
 *   InboxItem.resultRef = { type: 'task', id: task.id }
 *   Task.sourceInboxId   = inboxItem.id
 * The source item and its rawText are never destroyed.
 */
function routeInboxToTaskMutation(id, options){
  const inboxItem = state.inbox.find(item => item.id === id);
  if (!inboxItem) return null;
  // Only Task items route to a Task; Thought/Note/null must never become one,
  // even when the command is called directly.
  if (inboxItem.itemType !== 'task') {
    throw new Error('Only task-type inbox items can be routed to a Task');
  }
  if (inboxItem.resultRef) {
    throw new Error('Inbox item already has a routed result');
  }

  const now = options.now ?? Date.now();
  const task = {
    id: options.taskId || generateTaskId(),
    projectId: null,
    domainId: null,
    title: String(options.title ?? inboxItem.text ?? '').trim() || 'Новая задача',
    tags: normalizeTags(options.tags),
    status: normalizeTaskStatus(options.status),
    estimateMin: options.estimateMin ?? null,
    priority: normalizePriority(options.priority),
    due: normalizeDue(options.due),
    sourceInboxId: inboxItem.id,
    createdAt: now,
    updatedAt: now,
  };

  // Destination uses the existing placement rules: validate domain, then let
  // applyTaskPlacement validate the project and derive the domain from it.
  const destination = {
    projectId: options.projectId ?? null,
    domainId: options.domainId ?? state.activeDomain ?? state.domains[0]?.id ?? null,
  };
  if (Object.hasOwn(destination, 'domainId') && destination.domainId) {
    const domainExists = state.domains.some(domain => domain.id === destination.domainId);
    if (!domainExists) throw new Error(`Unknown target domain: ${destination.domainId}`);
  }
  applyTaskPlacement(task, destination);

  state.tasks.push(task);

  const inboxBefore = snapshot(inboxItem);
  inboxItem.status = 'processed';
  inboxItem.resultRef = { type: 'task', id: task.id };
  inboxItem.updatedAt = now;

  const operation = appendOperation({
    type: 'inbox.route_to_task',
    entityType: 'task',
    entityId: task.id,
    payload: {
      inboxBefore,
      inboxAfter: snapshot(inboxItem),
      task,
    },
  }, { timestamp: now, deviceId: options.deviceId });
  finish(options);
  enqueueOutbound(operation);
  // C2: ship the routed result to remote devices (read-only projection).
  enqueueTaskResultOperation('task.result.upsert', task, options);
  return { inboxItem, task };
}

export function routeInboxToTask(id, options = {}){
  return runAtomicCommand(() => routeInboxToTaskMutation(id, options));
}

/**
 * Reverts a routed result: deletes the linked Task only when it was created by
 * this processing operation AND has not been modified since (updatedAt ===
 * createdAt). A modified Task is never deleted — the caller gets a `refused`
 * result instead. Not a universal Undo — just the one reversible step this
 * flow needs.
 */
function revertInboxRouteMutation(id, options){
  const inboxItem = state.inbox.find(item => item.id === id);
  if (!inboxItem) return null;
  const ref = inboxItem.resultRef;
  if (!ref || ref.type !== 'task') return null;

  const now = options.now ?? Date.now();
  const inboxBefore = snapshot(inboxItem);
  const taskIndex = state.tasks.findIndex(task => task.id === ref.id);

  if (taskIndex >= 0) {
    const task = state.tasks[taskIndex];
    if (task.sourceInboxId !== inboxItem.id) {
      throw new Error('Result task is not linked to this inbox item');
    }
    // A task that was edited, moved or otherwise changed after routing is no
    // longer safe to auto-delete; refuse without touching anything.
    if (task.updatedAt !== task.createdAt) {
      return { inboxItem, task: null, refused: true, reason: 'task-modified' };
    }
  }

  let removedTask = null;
  if (taskIndex >= 0) {
    removedTask = snapshot(state.tasks[taskIndex]);
    state.tasks.splice(taskIndex, 1);
  }

  delete inboxItem.resultRef;
  inboxItem.status = 'reviewed';
  inboxItem.updatedAt = now;

  const operation = appendOperation({
    type: 'inbox.route_revert',
    entityType: 'inbox',
    entityId: inboxItem.id,
    payload: {
      inboxBefore,
      inboxAfter: snapshot(inboxItem),
      task: removedTask,
    },
  }, { timestamp: now, deviceId: options.deviceId });
  finish(options);
  enqueueOutbound(operation);
  // C2: the routed result no longer exists — clear it on remote devices.
  if (taskIndex >= 0) {
    enqueueTaskResultOperation('task.result.remove', { id: ref.id, sourceInboxId: inboxItem.id }, options);
  }
  return { inboxItem, task: removedTask };
}

export function revertInboxRoute(id, options = {}){
  return runAtomicCommand(() => revertInboxRouteMutation(id, options));
}

// ---------------------------------------------------------------------------
// Sync remote apply (C0): Core-atomic, no local operation log entry, and no
// outbound sync operation (no echo loop). Incoming sync operations are applied
// through these commands; rollback on saveState failure is handled by
// runAtomicCommand exactly like any other Core command.
// ---------------------------------------------------------------------------

function applyRemoteInboxCaptureMutation(payload, options){
  if (!payload || typeof payload.rawText !== 'string') {
    throw new Error('remote inbox.capture: payload.rawText missing');
  }
  if (state.inbox.some(item => item.id === payload.id)) return null; // idempotent
  return addInboxLines(payload.rawText, {
    splitLines: false,
    now: payload.createdAt ?? options.now ?? Date.now(),
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

export function applyRemoteInboxCapture(payload, options = {}){
  return runAtomicCommand(() => {
    const created = applyRemoteInboxCaptureMutation(payload, options);
    finish(options);
    return created;
  });
}

function applyRemoteInboxUpdateMutation(id, after, options){
  const item = state.inbox.find(entry => entry.id === id);
  if (!item) throw new Error(`remote inbox.update: unknown inbox item ${id}`);
  const patch = {};
  if (Object.hasOwn(after, 'text')) patch.text = after.text;
  if (Object.hasOwn(after, 'itemType')) patch.itemType = after.itemType;
  if (Object.hasOwn(after, 'status')) patch.status = after.status;
  if (Object.hasOwn(after, 'domainHintId')) patch.domainHintId = after.domainHintId;
  const result = updateInboxItem(id, patch);
  if (result) {
    Object.assign(result.item, result.changes);
    result.item.updatedAt = after.updatedAt ?? options.now ?? Date.now();
  }
  return result;
}

export function applyRemoteInboxUpdate(id, after, options = {}){
  return runAtomicCommand(() => {
    const result = applyRemoteInboxUpdateMutation(id, after, options);
    finish(options);
    return result;
  });
}

// Normal remote route policy (non-conflict path), driven by the explicit
// client capability (js/sync/capabilities.js):
//   - Studio (hasTaskModel=true): the result reference is validated WHEN the
//     referenced Task is resolvable locally — if a Task with that id exists,
//     its sourceInboxId must point back at this Inbox record; a mismatch is
//     refused (the engine quarantines it). An ABSENT Task is still accepted as
//     a projection reference: Tasks are not synced, so a remote route may
//     legitimately arrive before/without its Task.
//   - Capture (hasTaskModel=false): only a C2 projection reference is ever
//     accepted — no Task lookups happen here.
function applyRemoteInboxRouteMutation(payload, options){
  const after = payload?.inboxAfter || {};
  const item = state.inbox.find(entry => entry.id === after.id);
  if (!item) return null;
  if (after.resultRef?.type === 'task' && hasTaskModel()) {
    const linked = state.tasks.find(task => task.id === after.resultRef.id);
    if (linked && linked.sourceInboxId !== item.id) {
      throw new Error('remote route: linked Task mismatch (sourceInboxId)');
    }
  }
  item.status = after.status || 'processed';
  item.resultRef = after.resultRef || null;
  item.updatedAt = after.updatedAt ?? options.now ?? Date.now();
  return item;
}

export function applyRemoteInboxRoute(payload, options = {}){
  return runAtomicCommand(() => {
    const item = applyRemoteInboxRouteMutation(payload, options);
    finish(options);
    return item;
  });
}

function applyRemoteInboxRevertMutation(payload, options){
  const after = payload?.inboxAfter || {};
  const item = state.inbox.find(entry => entry.id === after.id);
  if (!item) return null;
  delete item.resultRef;
  item.status = after.status || 'reviewed';
  item.updatedAt = after.updatedAt ?? options.now ?? Date.now();
  return item;
}

export function applyRemoteInboxRevert(payload, options = {}){
  return runAtomicCommand(() => {
    const item = applyRemoteInboxRevertMutation(payload, options);
    finish(options);
    return item;
  });
}

// C2 remote apply: read-only Task result projections. These are derived
// display data with a single writer — applied unconditionally (idempotency is
// per operationId upstream), guarded only against stale deliveries.

function applyRemoteTaskResultUpsertMutation(payload){
  const projection = payload?.projection;
  if (!projection || !projection.id || typeof projection.title !== 'string') {
    throw new Error('remote task.result.upsert: projection.id/title missing');
  }
  if (!Array.isArray(state.taskProjections)) state.taskProjections = [];
  const incoming = {
    id: String(projection.id),
    title: String(projection.title).slice(0, 200),
    sourceInboxId: projection.sourceInboxId ? String(projection.sourceInboxId) : null,
    domainId: projection.domainId ? String(projection.domainId) : null,
    domainTitle: typeof projection.domainTitle === 'string' ? projection.domainTitle : null,
    projectId: projection.projectId ? String(projection.projectId) : null,
    projectTitle: typeof projection.projectTitle === 'string' ? projection.projectTitle : null,
    priority: Number(projection.priority) || 2,
    due: projection.due && typeof projection.due === 'object' && projection.due.date
      ? { date: String(projection.due.date), time: projection.due.time ? String(projection.due.time) : null }
      : (Number(projection.due) || null),
    status: typeof projection.status === 'string' ? projection.status : 'backlog',
    updatedAt: Number(projection.updatedAt) || Date.now(),
  };
  const index = state.taskProjections.findIndex(entry => entry.id === incoming.id);
  if (index >= 0) {
    const existing = state.taskProjections[index];
    // A stale delivery must never regress a newer projection.
    if (existing.updatedAt > incoming.updatedAt) return existing;
    state.taskProjections[index] = incoming;
    return incoming;
  }
  state.taskProjections.push(incoming);
  return incoming;
}

export function applyRemoteTaskResultUpsert(payload, options = {}){
  return runAtomicCommand(() => {
    const applied = applyRemoteTaskResultUpsertMutation(payload);
    finish(options);
    return applied;
  });
}

function applyRemoteTaskResultRemoveMutation(payload){
  const id = payload?.id;
  if (!id) throw new Error('remote task.result.remove: id missing');
  if (!Array.isArray(state.taskProjections)) state.taskProjections = [];
  const index = state.taskProjections.findIndex(entry => entry.id === id);
  if (index < 0) return null;
  const [removed] = state.taskProjections.splice(index, 1);
  return removed;
}

export function applyRemoteTaskResultRemove(payload, options = {}){
  return runAtomicCommand(() => {
    const removed = applyRemoteTaskResultRemoveMutation(payload);
    finish(options);
    return removed;
  });
}

// ---------------------------------------------------------------------------
// C3 remote apply — Inbox deletion / restoration (W2). Both are idempotent:
// deleting an already-absent record and restoring an already-present one are
// harmless no-ops, which makes replay and re-delivery safe.
// ---------------------------------------------------------------------------

function upsertTombstone(id, baseVersion, removal, now){
  if (!Array.isArray(state.inboxTombstones)) state.inboxTombstones = [];
  const tombstone = { id, baseVersion: baseVersion || null, deletedAt: now ?? Date.now(), removal: removal || null };
  const index = state.inboxTombstones.findIndex(t => t.id === id);
  if (index >= 0) state.inboxTombstones[index] = tombstone;
  else state.inboxTombstones.push(tombstone);
  return tombstone;
}

function removeTombstone(id){
  if (!Array.isArray(state.inboxTombstones)) return;
  state.inboxTombstones = state.inboxTombstones.filter(t => t.id !== id);
}

// Returns { applied: true, removed } | { applied: true, removed: null } |
// { conflict: true, conflictStatus, reason }.
function applyRemoteInboxDeleteMutation(payload, options){
  const id = payload?.item?.id || payload?.id;
  if (!id) throw new Error('remote inbox.delete: item id missing');
  const baseVersion = options?.baseVersion ?? payload?.baseVersion ?? null;
  // Review: a version-less or malformed delete cannot participate in race
  // detection — refuse BEFORE any state/storage mutation (the engine
  // quarantines it). baseVersion is strictly a finite number.
  if (baseVersion === null || typeof baseVersion !== 'number' || !Number.isFinite(baseVersion)) {
    throw new Error('remote inbox.delete: baseVersion (finite number) required');
  }
  if (!Array.isArray(state.inbox)) state.inbox = [];
  const index = state.inbox.findIndex(item => item.id === id);
  if (index < 0) {
    // Record absent here. If a tombstone exists with a DIFFERENT baseVersion,
    // the record was restored after the delete — a real race, not a duplicate.
    const tombstone = state.inboxTombstones?.find(t => t.id === id);
    if (tombstone && baseVersion != null && tombstone.baseVersion !== baseVersion) {
      return {
        conflict: true,
        conflictStatus: 'delete_restore_race',
        reason: 'запись была восстановлена после удаления на другом устройстве',
      };
    }
    return { applied: true, removed: null }; // already gone — idempotent
  }
  const item = state.inbox[index];
  // Review: never silently break the resultRef ↔ sourceInboxId link. A routed
  // record must keep its result reference; the delete is classified instead.
  if (item.resultRef) {
    return {
      conflict: true,
      conflictStatus: 'linked_result_delete',
      reason: 'запись связана с результатом (Task); удаление требует "Вернуть в разбор"',
    };
  }
  // The other device deleted based on an older version than this local record:
  // applying the delete would silently lose the newer local edit.
  if (baseVersion != null && item.updatedAt != null && baseVersion !== item.updatedAt) {
    return {
      conflict: true,
      conflictStatus: 'delete_restore_race',
      reason: 'запись изменена после удаления на другом устройстве',
    };
  }
  const [removed] = state.inbox.splice(index, 1);
  upsertTombstone(id, item.updatedAt || baseVersion, { item: removed, index });
  return { applied: true, removed };
}

export function applyRemoteInboxDelete(payload, options = {}){
  return runAtomicCommand(() => {
    const result = applyRemoteInboxDeleteMutation(payload, options);
    finish(options);
    return result;
  });
}

// Returns { applied: true, restored } | { applied: true, restored: null } |
// { conflict: true, conflictStatus, reason }.
function applyRemoteInboxRestoreMutation(payload, options){
  const removal = payload?.removal || payload;
  const item = removal?.item;
  // Review: the restored snapshot must be a complete Inbox record. id, text
  // and rawText are required STRINGS — an incomplete record must throw BEFORE
  // any state/storage mutation (rawText is the immutable original, never
  // synthesized). runAtomicCommand rolls back on the throw.
  if (!item || typeof item.id !== 'string' || !item.id) {
    throw new Error('remote inbox.restore: item.id (string) missing');
  }
  if (typeof item.text !== 'string' || !item.text) {
    throw new Error('remote inbox.restore: item.text (string) missing');
  }
  if (typeof item.rawText !== 'string' || !item.rawText) {
    throw new Error('remote inbox.restore: item.rawText (string) missing — refusing to fabricate the original');
  }
  const baseVersion = options?.baseVersion ?? payload?.baseVersion ?? null;
  // Review: a version-less or malformed restore cannot participate in race
  // detection — refuse BEFORE any state/storage mutation (the engine
  // quarantines it). baseVersion is strictly a finite number.
  if (baseVersion === null || typeof baseVersion !== 'number' || !Number.isFinite(baseVersion)) {
    throw new Error('remote inbox.restore: baseVersion (finite number) required');
  }
  if (!Array.isArray(state.inbox)) state.inbox = [];
  if (state.inbox.some(entry => entry.id === item.id)) {
    removeTombstone(item.id); // already present — the restore goal is met
    return { applied: true, restored: null };
  }
  const tombstone = state.inboxTombstones?.find(t => t.id === item.id);
  if (tombstone && baseVersion != null && tombstone.baseVersion !== baseVersion) {
    return {
      conflict: true,
      conflictStatus: 'delete_restore_race',
      reason: 'удаление и восстановление не сходятся по версии',
    };
  }
  const index = Math.max(0, Math.min(Number(removal.index) || state.inbox.length, state.inbox.length));
  state.inbox.splice(index, 0, cloneCommandValue(item));
  removeTombstone(item.id);
  return { applied: true, restored: item };
}

export function applyRemoteInboxRestore(payload, options = {}){
  return runAtomicCommand(() => {
    const result = applyRemoteInboxRestoreMutation(payload, options);
    finish(options);
    return result;
  });
}

// ---------------------------------------------------------------------------
// C3 conflict resolution — user-driven, local. The quarantined operation is
// re-applied (or deliberately not) according to the user's choice, and the
// quarantine entry is marked resolved by the engine afterwards.
// ---------------------------------------------------------------------------

function conflictItemId(conflict){
  return conflict?.operation?.entityId ||
    conflict?.operation?.payload?.after?.id ||
    conflict?.operation?.payload?.inboxAfter?.id ||
    null;
}

function makeInboxId(){
  if (globalThis.crypto?.randomUUID) return `inbox-${globalThis.crypto.randomUUID()}`;
  return `inbox-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Rebuild a full inbox item from a remote snapshot (update/route payloads
// carry the complete item at the time of the operation). rawText is the
// immutable original — it must be present in the snapshot; a restore may
// NEVER fabricate it from the editable `text` (review: invariant guard).
function restoreInboxFromSnapshot(after){
  if (!after || !after.id || typeof after.text !== 'string') return null;
  if (typeof after.rawText !== 'string') {
    throw new Error('conflict restore: rawText missing — refusing to fabricate the original');
  }
  return {
    id: String(after.id),
    text: String(after.text),
    rawText: String(after.rawText),
    inputType: after.inputType || 'text',
    source: after.source || 'desktop-capture',
    status: after.status || 'new',
    userHint: after.userHint ?? null,
    itemType: after.itemType ?? null,
    domainHintId: after.domainHintId ?? null,
    deviceId: after.deviceId || null,
    entryPoint: after.entryPoint || 'app',
    resultRef: after.resultRef ?? null,
    createdAt: Number(after.createdAt) || Date.now(),
    updatedAt: Number(after.updatedAt) || Date.now(),
  };
}

// Force-apply the quarantined operation's final state to the local Inbox
// record (used by accept_remote / keep_both / restore_apply resolutions).
function applyRemoteStateForConflict(op, options = {}){
  switch (op.type) {
    case 'inbox.update': {
      const after = op.payload?.after;
      if (!after?.id) throw new Error('conflict update op missing after.id');
      let item = state.inbox.find(entry => entry.id === after.id);
      if (!item) {
        const restored = restoreInboxFromSnapshot(after);
        if (!restored) throw new Error('conflict update: cannot rebuild the record');
        state.inbox.push(restored);
        item = restored;
      }
      if (Object.hasOwn(after, 'text')) item.text = String(after.text).trim();
      if (Object.hasOwn(after, 'itemType')) item.itemType = after.itemType ?? null;
      if (Object.hasOwn(after, 'status')) item.status = after.status;
      if (Object.hasOwn(after, 'domainHintId')) item.domainHintId = after.domainHintId ?? null;
      if (Object.hasOwn(after, 'updatedAt')) item.updatedAt = Number(after.updatedAt) || item.updatedAt;
      return item;
    }
    case 'inbox.route_to_task': {
      const after = op.payload?.inboxAfter;
      if (!after?.id) throw new Error('conflict route op missing inboxAfter.id');
      // Review: force-applying a route must not create a broken resultRef.
      // Validation is driven by an EXPLICIT client capability, never inferred
      // from state.tasks.length (an empty task array does not mean Capture).
      // Studio always validates resultRef.id → Task.sourceInboxId; Capture
      // (hasTaskModel=false) accepts only a C2 projection reference.
      if (after.resultRef?.type === 'task' && hasTaskModel()) {
        const linked = state.tasks.find(task => task.id === after.resultRef.id);
        if (!linked || linked.sourceInboxId !== after.id) {
          throw new Error('conflict route: referenced Task is missing or not linked to this Inbox record');
        }
      }
      let item = state.inbox.find(entry => entry.id === after.id);
      if (!item) {
        const restored = restoreInboxFromSnapshot(after);
        if (!restored) throw new Error('conflict route: cannot rebuild the record');
        state.inbox.push(restored);
        item = restored;
      }
      item.status = after.status || 'processed';
      item.resultRef = after.resultRef || null;
      item.updatedAt = after.updatedAt ?? Date.now();
      return item;
    }
    case 'inbox.route_revert': {
      const after = op.payload?.inboxAfter;
      if (!after?.id) throw new Error('conflict revert op missing inboxAfter.id');
      const item = state.inbox.find(entry => entry.id === after.id);
      if (!item) throw new Error('conflict revert: record unavailable');
      delete item.resultRef;
      item.status = after.status || 'reviewed';
      item.updatedAt = after.updatedAt ?? Date.now();
      return item;
    }
    case 'inbox.delete': {
      // delete_restore_race, user chose "Удалить" (accept_delete).
      const id = op.payload?.item?.id || op.entityId;
      if (!id) throw new Error('conflict delete op missing id');
      const item = state.inbox.find(entry => entry.id === id);
      if (item && !item.resultRef) {
        const index = state.inbox.findIndex(entry => entry.id === id);
        const [removed] = state.inbox.splice(index, 1);
        upsertTombstone(id, item.updatedAt || op.baseVersion, { item: removed, index }, options.now);
      }
      return item || null;
    }
    case 'inbox.restore': {
      // delete_restore_race, user chose "Восстановить" (restore_apply).
      const removal = op.payload?.removal || op.payload;
      const item = removal?.item;
      if (!item?.id) throw new Error('conflict restore op missing item id');
      if (!state.inbox.some(entry => entry.id === item.id)) {
        const index = Math.max(0, Math.min(Number(removal.index) || state.inbox.length, state.inbox.length));
        state.inbox.splice(index, 0, cloneCommandValue(item));
      }
      removeTombstone(item.id);
      return item;
    }
    default:
      throw new Error(`resolveConflict: unsupported operation ${op.type}`);
  }
}

function resolveConflictMutation(conflict, action, options){
  const op = conflict?.operation;
  if (!op) throw new Error('resolveConflict: conflict missing operation');
  const id = conflictItemId(conflict);

  if (action === 'keep_both') {
    // Keep a copy of the LOCAL version as a new record (it must propagate),
    // then the remote version takes over the original id.
    const local = id ? state.inbox.find(entry => entry.id === id) : null;
    if (local) {
      const copy = { ...cloneCommandValue(local), id: makeInboxId(), updatedAt: options.now ?? Date.now() };
      state.inbox.push(copy);
      const captureOp = appendOperation({
        type: 'inbox.capture',
        entityType: 'inbox',
        entityId: copy.id,
        payload: copy,
      }, { timestamp: options.now ?? Date.now(), deviceId: options.deviceId });
      enqueueOutbound(captureOp);
    }
  }

  // delete/restore races resolve through their own operations:
  if (action === 'accept_delete' && op.type === 'inbox.delete') {
    applyRemoteStateForConflict(op, options);
    return { id, action };
  }

  if (action === 'accept_remote' || action === 'keep_both' || action === 'restore_apply') {
    // restore_apply: capture the local tombstone baseVersion BEFORE applying —
    // applyRemoteStateForConflict removes the tombstone for a restore, and the
    // compensating inbox.restore below must still carry it (the version the
    // delete was based on) so devices with the same tombstone apply it without
    // a new delete_restore_race. This is NOT local-only: for every conflict
    // type (update/route/revert AND raced restore) a compensating inbox.restore
    // is enqueued, tagged with resolvesOperationId so a third device can close
    // its matching quarantine entry once the record is back.
    const tombstoneBase = action === 'restore_apply'
      ? (state.inboxTombstones?.find(t => t.id === id)?.baseVersion ?? null)
      : null;
    const applied = applyRemoteStateForConflict(op, options);
    if (action === 'restore_apply' && applied) {
      const restoreBase = tombstoneBase ?? applied.updatedAt ?? null;
      const restoreOp = appendOperation({
        type: 'inbox.restore',
        entityType: 'inbox',
        entityId: applied.id,
        baseVersion: restoreBase,
        payload: {
          item: cloneCommandValue(applied),
          index: 0,
          // The original quarantined operation this resolution answers —
          // receivers close the matching quarantine entry after applying.
          resolvesOperationId: op.id,
        },
      }, { timestamp: options.now ?? Date.now(), deviceId: options.deviceId });
      enqueueOutbound(restoreOp);
    }
  }
  // 'keep_local' / 'keep_deleted' / 'dismiss': no state change.

  return { id, action };
}

// The user resolved a quarantined conflict. Only the state part lives here;
// the quarantine entry itself is marked resolved by the engine.
export function resolveConflict(conflict, action, options = {}){
  return runAtomicCommand(() => {
    const result = resolveConflictMutation(conflict, action, options);
    finish(options);
    return result;
  });
}

function convertInboxToTaskMutation(id, options){
  const result = convertInboxItemToTask(id, options);
  if (!result) return null;
  appendOperation({
    type: 'inbox.convert_to_task',
    entityType: 'task',
    entityId: result.task.id,
    payload: {
      source: result.removal.item,
      sourceIndex: result.removal.index,
      task: result.task,
    },
  }, { timestamp: options.now, deviceId: options.deviceId });
  finish(options);
  return result;
}

export function convertInboxToTask(id, options = {}){
  return runAtomicCommand(() => convertInboxToTaskMutation(id, options));
}

function createTaskMutation(input, options){
  const now = options.now ?? Date.now();
  const projectId = input.projectId ?? null;
  const task = {
    id: input.id || options.taskId || generateTaskId(),
    projectId,
    domainId: projectId ? undefined : (input.domainId ?? state.activeDomain ?? state.domains[0]?.id ?? null),
    title: String(input.title || '').trim() || 'Новая задача',
    tags: normalizeTags(input.tags),
    status: normalizeTaskStatus(input.status),
    estimateMin: input.estimateMin ?? null,
    priority: input.priority || 2,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
  state.tasks.push(task);
  appendOperation({
    type: 'task.create',
    entityType: 'task',
    entityId: task.id,
    payload: task,
  }, { timestamp: now, deviceId: options.deviceId });
  finish(options);
  return task;
}

export function createTask(input, options = {}){
  return runAtomicCommand(() => createTaskMutation(input, options));
}

function updateTaskMutation(taskId, patch, options){
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) return null;

  const changes = {};
  if (Object.hasOwn(patch, 'title')) {
    const title = String(patch.title || '').trim();
    if (!title) throw new Error('Task title cannot be empty');
    changes.title = title;
  }
  if (Object.hasOwn(patch, 'tags')) changes.tags = normalizeTags(patch.tags);
  if (Object.hasOwn(patch, 'status')) changes.status = normalizeTaskStatus(patch.status);
  if (Object.hasOwn(patch, 'estimateMin')) changes.estimateMin = patch.estimateMin ?? null;
  if (Object.hasOwn(patch, 'priority')) changes.priority = patch.priority || 2;
  if (Object.hasOwn(patch, 'projectId')) changes.projectId = patch.projectId ?? null;
  if (Object.hasOwn(patch, 'domainId')) changes.domainId = patch.domainId ?? null;

  const comparable = Object.entries(changes).some(([key, value]) =>
    JSON.stringify(task[key] ?? null) !== JSON.stringify(value ?? null)
  );
  if (!comparable) return { task, before: snapshot(task), operation: null };

  const before = snapshot(task);
  Object.assign(task, changes);
  if (Object.hasOwn(changes, 'projectId') && changes.projectId) {
    delete task.domainId;
  }
  task.updatedAt = options.now ?? Date.now();
  const operation = appendOperation({
    type: 'task.update',
    entityType: 'task',
    entityId: task.id,
    baseVersion: before.updatedAt || null,
    payload: {
      before,
      after: task,
    },
  }, { timestamp: task.updatedAt, deviceId: options.deviceId });
  finish(options);
  // C2: keep the remote result projection in sync with the routed Task.
  if (task.sourceInboxId) {
    enqueueTaskResultOperation('task.result.upsert', task, options);
  }
  return { task, before, operation };
}

export function updateTask(taskId, patch, options = {}){
  return runAtomicCommand(() => updateTaskMutation(taskId, patch, options));
}

function moveTaskMutation(taskId, destination, options){
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) return null;

  if (Object.hasOwn(destination, 'domainId') && destination.domainId) {
    const domainExists = state.domains.some(domain => domain.id === destination.domainId);
    if (!domainExists) throw new Error(`Unknown target domain: ${destination.domainId}`);
  }

  const before = snapshot(task);
  applyTaskPlacement(task, destination);
  const placementChanged =
    (before.projectId ?? null) !== (task.projectId ?? null) ||
    (before.domainId ?? null) !== (task.domainId ?? null) ||
    JSON.stringify(before.pos ?? null) !== JSON.stringify(task.pos ?? null);
  if (!placementChanged) return { task, before, operation: null };

  task.updatedAt = options.now ?? Date.now();
  const operation = appendOperation({
    type: options.operationType || 'task.move',
    entityType: 'task',
    entityId: task.id,
    baseVersion: before.updatedAt || null,
    payload: {
      before,
      after: task,
      reason: options.reason || null,
      sourceOperationId: options.sourceOperationId || null,
    },
  }, { timestamp: task.updatedAt, deviceId: options.deviceId });
  finish(options);
  // C2: moved routed Task — its display placement changed on remote devices.
  if (task.sourceInboxId) {
    enqueueTaskResultOperation('task.result.upsert', task, options);
  }
  return { task, before, operation };
}

export function moveTask(taskId, destination = {}, options = {}){
  return runAtomicCommand(() => moveTaskMutation(taskId, destination, options));
}

export function undoTaskMove(moveResult, options = {}){
  const operation = moveResult?.operation || moveResult;
  const before = moveResult?.before || operation?.payload?.before;
  const taskId = moveResult?.task?.id || operation?.entityId || before?.id;
  if (!taskId || !before) return null;
  return moveTask(taskId, {
    projectId: before.projectId ?? null,
    domainId: before.domainId ?? null,
    pos: before.pos ?? null,
  }, {
    ...options,
    operationType: 'task.move.undo',
    reason: options.reason || 'undo',
    sourceOperationId: operation?.id || null,
  });
}

function deleteTaskMutation(taskId, options){
  const index = state.tasks.findIndex(item => item.id === taskId);
  if (index < 0) return null;
  const [task] = state.tasks.splice(index, 1);
  const operation = appendOperation({
    type: 'task.delete',
    entityType: 'task',
    entityId: task.id,
    baseVersion: task.updatedAt || null,
    payload: { task, index },
  }, { timestamp: options.now, deviceId: options.deviceId });
  finish(options);
  // C2: the routed result is gone — remote devices show the defined fallback.
  if (task.sourceInboxId) {
    enqueueTaskResultOperation('task.result.remove', task, options);
  }
  return { task, index, operation };
}

export function deleteTask(taskId, options = {}){
  return runAtomicCommand(() => deleteTaskMutation(taskId, options));
}

function createProjectMutation(input, options){
  const now = options.now ?? Date.now();
  const project = {
    id: input.id || options.projectId || generateProjectId(),
    domainId: input.domainId ?? state.activeDomain ?? state.domains[0]?.id ?? null,
    title: String(input.title || '').trim() || 'Новый проект',
    tags: normalizeTags(input.tags),
    priority: input.priority || 2,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
  state.projects.push(project);
  appendOperation({
    type: 'project.create',
    entityType: 'project',
    entityId: project.id,
    payload: project,
  }, { timestamp: now, deviceId: options.deviceId });
  finish(options);
  return project;
}

export function createProject(input, options = {}){
  return runAtomicCommand(() => createProjectMutation(input, options));
}

function createDomainMutation(input, options){
  const now = options.now ?? Date.now();
  const title = String(input?.title ?? '').trim();
  if (!title) throw new Error('Domain title cannot be empty');
  const domain = {
    id: input?.id || options.domainId || generateDomainId(),
    title,
    color: input?.color ?? null,
    createdAt: now,
    updatedAt: now,
  };
  state.domains.push(domain);
  appendOperation({
    type: 'domain.create',
    entityType: 'domain',
    entityId: domain.id,
    payload: domain,
  }, { timestamp: now, deviceId: options.deviceId });
  finish(options);
  return domain;
}

export function createDomain(input, options = {}){
  return runAtomicCommand(() => createDomainMutation(input, options));
}

// ---------------------------------------------------------------------------
// C3 (W3): Domain/Project updates. Renames must refresh the C2 result
// projections on remote devices — the phone caches domainTitle/projectTitle
// inside the projection, so a rename without a re-emit would show a stale
// name forever. Only routed Tasks (sourceInboxId) get a re-emit; tasks from
// outside the Inbox flow are out of scope.
// ---------------------------------------------------------------------------

function routedTasksInDomain(domainId){
  return state.tasks.filter(task => {
    if (!task?.sourceInboxId) return false;
    if (task.domainId === domainId) return true;
    if (task.projectId) {
      const project = state.projects.find(entry => entry.id === task.projectId);
      return project?.domainId === domainId;
    }
    return false;
  });
}

function updateDomainMutation(domainId, patch, options){
  const domain = state.domains.find(item => item.id === domainId);
  if (!domain) return null;
  const changes = {};
  if (Object.hasOwn(patch, 'title')) {
    const title = String(patch.title ?? '').trim();
    if (!title) throw new Error('Domain title cannot be empty');
    if (state.domains.some(d => d.id !== domainId && d.title.toLowerCase() === title.toLowerCase())) {
      throw new Error('Такой домен уже есть');
    }
    changes.title = title;
  }
  if (Object.hasOwn(patch, 'color')) changes.color = String(patch.color ?? '').trim();
  const comparable = Object.entries(changes).some(([key, value]) =>
    JSON.stringify(domain[key] ?? null) !== JSON.stringify(value ?? null)
  );
  if (!comparable) return { domain, before: snapshot(domain), operation: null };

  const before = snapshot(domain);
  Object.assign(domain, changes);
  domain.updatedAt = options.now ?? Date.now();
  const operation = appendOperation({
    type: 'domain.update',
    entityType: 'domain',
    entityId: domain.id,
    payload: { before, after: domain },
  }, { timestamp: domain.updatedAt, deviceId: options.deviceId });
  finish(options);
  // W3: routed result projections carry the domain title — refresh them.
  routedTasksInDomain(domain.id).forEach(task => {
    enqueueTaskResultOperation('task.result.upsert', task, options);
  });
  return { domain, before, operation };
}

export function updateDomain(domainId, patch, options = {}){
  return runAtomicCommand(() => updateDomainMutation(domainId, patch, options));
}

function updateProjectMutation(projectId, patch, options){
  const project = state.projects.find(item => item.id === projectId);
  if (!project) return null;
  const changes = {};
  if (Object.hasOwn(patch, 'title')) {
    const title = String(patch.title ?? '').trim();
    if (!title) throw new Error('Project title cannot be empty');
    changes.title = title;
  }
  if (Object.hasOwn(patch, 'priority')) changes.priority = patch.priority || 2;
  const comparable = Object.entries(changes).some(([key, value]) =>
    JSON.stringify(project[key] ?? null) !== JSON.stringify(value ?? null)
  );
  if (!comparable) return { project, before: snapshot(project), operation: null };

  const before = snapshot(project);
  Object.assign(project, changes);
  project.updatedAt = options.now ?? Date.now();
  const operation = appendOperation({
    type: 'project.update',
    entityType: 'project',
    entityId: project.id,
    payload: { before, after: project },
  }, { timestamp: project.updatedAt, deviceId: options.deviceId });
  finish(options);
  // W3: routed result projections carry the project title — refresh them.
  state.tasks
    .filter(task => task?.sourceInboxId && task.projectId === projectId)
    .forEach(task => {
      enqueueTaskResultOperation('task.result.upsert', task, options);
    });
  return { project, before, operation };
}

export function updateProject(projectId, patch, options = {}){
  return runAtomicCommand(() => updateProjectMutation(projectId, patch, options));
}

function promoteTaskToProjectMutation(taskId, options){
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) return null;
  const domainId = task.projectId
    ? state.projects.find(item => item.id === task.projectId)?.domainId
    : task.domainId;
  const resolvedDomainId = options.domainId ?? domainId ?? state.activeDomain ?? state.domains[0]?.id ?? null;
  if (!resolvedDomainId) return null;

  const now = options.now ?? Date.now();
  const before = snapshot(task);
  const project = {
    id: options.projectId || generateProjectId(),
    domainId: resolvedDomainId,
    title: String(options.title ?? task.title).trim() || 'Новый проект',
    tags: normalizeTags(options.tags ?? task.tags),
    priority: options.priority || task.priority || 2,
    createdAt: now,
    updatedAt: now,
  };
  state.projects.push(project);
  task.projectId = project.id;
  delete task.domainId;
  if (state.settings?.layoutMode === 'auto') delete task.pos;
  task.updatedAt = now;

  const operation = appendOperation({
    type: 'task.promote_to_project',
    entityType: 'task',
    entityId: task.id,
    baseVersion: before.updatedAt || null,
    payload: {
      before,
      after: task,
      project,
    },
  }, { timestamp: now, deviceId: options.deviceId });
  finish(options);
  return { task, project, operation };
}

export function promoteTaskToProject(taskId, options = {}){
  return runAtomicCommand(() => promoteTaskToProjectMutation(taskId, options));
}

