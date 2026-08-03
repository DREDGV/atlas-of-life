import { state } from '../../state.js';

function ensureInbox(){
  if (!Array.isArray(state.inbox)) state.inbox = [];
  return state.inbox;
}

function makeId(prefix = 'inbox'){
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getInboxItems(){
  return [...ensureInbox()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function addInboxLines(text, options = {}){
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const now = options.now ?? Date.now();
  const idFactory = options.idFactory || ((index) => `${makeId()}-${index}`);
  const created = lines.map((line, index) => ({
    id: idFactory(index),
    text: line,
    createdAt: now,
    updatedAt: now,
  }));
  ensureInbox().push(...created);
  return created;
}

export function removeInboxItem(id){
  const inbox = ensureInbox();
  const index = inbox.findIndex(item => item.id === id);
  if (index < 0) return null;
  const [item] = inbox.splice(index, 1);
  return { item, index };
}

export function restoreInboxItem(removal){
  if (!removal?.item) return false;
  const inbox = ensureInbox();
  if (inbox.some(item => item.id === removal.item.id)) return false;
  const index = Math.max(0, Math.min(removal.index ?? inbox.length, inbox.length));
  inbox.splice(index, 0, removal.item);
  return true;
}

export function convertInboxItemToTask(id, options = {}){
  const removal = removeInboxItem(id);
  if (!removal) return null;
  const now = options.now ?? Date.now();
  const domainId = options.domainId ?? state.activeDomain ?? state.domains[0]?.id ?? null;
  const task = {
    id: options.taskId || makeId('task'),
    projectId: null,
    domainId,
    title: removal.item.text,
    tags: [],
    status: options.status || 'backlog',
    estimateMin: null,
    priority: 2,
    createdAt: now,
    updatedAt: now,
  };
  state.tasks.push(task);
  return { task, removal };
}
