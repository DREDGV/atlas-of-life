import { state, normalizeTags } from '../state.js';
import { saveState } from '../storage.js';
import { appendOperation } from './operations.js';
import {
  addInboxLines,
  convertInboxItemToTask,
  removeInboxItem,
  restoreInboxItem,
} from '../features/inbox/model.js';

const TASK_STATUSES = new Set(['backlog', 'today', 'doing', 'done']);

function finish(options){
  if (options.persist !== false) saveState();
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

export function captureInbox(text, options = {}){
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

export function deleteInbox(id, options = {}){
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

export function undoDeleteInbox(removal, options = {}){
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

export function convertInboxToTask(id, options = {}){
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

export function createTask(input, options = {}){
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

export function updateTask(taskId, patch, options = {}){
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

export function moveTask(taskId, destination = {}, options = {}){
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

export function deleteTask(taskId, options = {}){
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

export function createProject(input, options = {}){
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

export function promoteTaskToProject(taskId, options = {}){
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
