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

const VALID_INPUT_TYPES = new Set(['text', 'voice']);
const VALID_USER_HINTS = new Set(['task', 'thought', 'note']);
const VALID_STATUSES = new Set(['new', 'reviewed', 'processed', 'discarded']);
const VALID_SOURCES = new Set(['desktop-capture', 'mobile-capture']);

function normalizeInputType(value){
  return VALID_INPUT_TYPES.has(value) ? value : 'text';
}

function normalizeUserHint(value){
  return VALID_USER_HINTS.has(value) ? value : null;
}

function normalizeStatus(value){
  return VALID_STATUSES.has(value) ? value : 'new';
}

function normalizeSource(value){
  return VALID_SOURCES.has(value) ? value : 'desktop-capture';
}

export function addInboxLines(text, options = {}){
  const rawText = String(text || '');
  const splitLines = options.splitLines !== false;
  const lines = splitLines
    ? rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : [rawText.trim()];

  if (lines.length === 0) return [];

  const now = options.now ?? Date.now();
  const idFactory = options.idFactory || ((index) => `${makeId()}-${index}`);
  const inputType = normalizeInputType(options.inputType);
  const source = normalizeSource(options.source);
  const status = normalizeStatus(options.status);
  const userHint = normalizeUserHint(options.userHint);
  const deviceId = options.deviceId || null;

  const created = lines.map((line, index) => ({
    id: idFactory(index),
    text: line,
    rawText: line,
    inputType,
    source,
    status,
    userHint,
    deviceId,
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
