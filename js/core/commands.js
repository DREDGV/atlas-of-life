import { state, normalizeTags } from '../state.js';
import { saveState } from '../storage.js';
import { appendOperation } from './operations.js';
import {
  addInboxLines,
  convertInboxItemToTask,
  removeInboxItem,
  restoreInboxItem,
  updateInboxItem,
} from '../features/inbox/model.js';

const TASK_STATUSES = new Set(['backlog', 'today', 'doing', 'done']);
const COMMAND_ARRAY_KEYS = [
  'domains',
  'projects',
  'tasks',
  'inbox',
  'operationLog',
];

function finish(options){
  if (options.persist !== false) saveState();
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
  created.forEach(item => {
    appendOperation({
      type: 'inbox.capture',
      entityType: 'inbox',
      entityId: item.id,
      payload: item,
    }, { timestamp: options.now, deviceId: options.deviceId });
  });
  if (created.length) finish(options);
  return created;
}

export function captureInbox(text, options = {}){
  return runAtomicCommand(() => captureInboxMutation(text, options));
}

function deleteInboxMutation(id, options){
  const removal = removeInboxItem(id);
  if (!removal) return null;
  appendOperation({
    type: 'inbox.delete',
    entityType: 'inbox',
    entityId: removal.item.id,
    baseVersion: removal.item.updatedAt || null,
    payload: removal,
  }, { timestamp: options.now, deviceId: options.deviceId });
  finish(options);
  return removal;
}

export function deleteInbox(id, options = {}){
  return runAtomicCommand(() => deleteInboxMutation(id, options));
}

function undoDeleteInboxMutation(removal, options){
  if (!restoreInboxItem(removal)) return false;
  appendOperation({
    type: 'inbox.restore',
    entityType: 'inbox',
    entityId: removal.item.id,
    payload: removal,
  }, { timestamp: options.now, deviceId: options.deviceId });
  finish(options);
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
    status: options.status || 'backlog',
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

  appendOperation({
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

  appendOperation({
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
  return { inboxItem, task: removedTask };
}

export function revertInboxRoute(id, options = {}){
  return runAtomicCommand(() => revertInboxRouteMutation(id, options));
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
