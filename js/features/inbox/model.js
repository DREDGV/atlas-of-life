import { state } from '../../state.js';

function ensureInbox(){
  if (!Array.isArray(state.inbox)) state.inbox = [];
  return state.inbox;
}

function makeId(prefix = 'inbox'){
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getInboxItems(){
  return ensureInbox()
    .map(item => ({
      ...item,
      entryPoint: normalizeEntryPoint(item.entryPoint),
      itemType: normalizeItemType(item.itemType),
      status: normalizeStatus(item.status),
    }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

const VALID_INPUT_TYPES = new Set(['text', 'voice']);
const VALID_USER_HINTS = new Set(['task', 'thought', 'note']);
// Confirmed processing types (Stage B0): a closed set on purpose. The capture
// hint (`userHint`) stays separate; `itemType` is the confirmed routing type.
const VALID_ITEM_TYPES = new Set(['task', 'thought', 'note']);
// Processing lifecycle shared by Studio and (later) Sync. Reused as-is; no
// parallel status system.
const VALID_STATUSES = new Set(['new', 'reviewed', 'processed', 'discarded']);
const VALID_SOURCES = new Set(['desktop-capture', 'mobile-capture']);
const VALID_ENTRY_POINTS = new Set(['app', 'share', 'shortcut']);

function normalizeInputType(value){
  return VALID_INPUT_TYPES.has(value) ? value : 'text';
}

function normalizeUserHint(value){
  return VALID_USER_HINTS.has(value) ? value : null;
}

export function normalizeItemType(value){
  return VALID_ITEM_TYPES.has(value) ? value : null;
}

function normalizeStatus(value){
  return VALID_STATUSES.has(value) ? value : 'new';
}

function normalizeSource(value){
  return VALID_SOURCES.has(value) ? value : 'desktop-capture';
}

export function normalizeEntryPoint(value){
  return VALID_ENTRY_POINTS.has(value) ? value : 'app';
}

// A Capture-time domain suggestion: a hint, not a final route. Must reference
// an existing Domain; an unknown/missing id normalizes to null.
function normalizeDomainHintId(value){
  if (!value) return null;
  const known = Array.isArray(state.domains) && state.domains.some(domain => domain.id === value);
  return known ? value : null;
}

export function addInboxLines(text, options = {}){
  const rawText = String(text || '');
  const splitLines = options.splitLines !== false;
  const lines = splitLines
    ? rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : rawText.trim() ? [rawText] : [];

  if (lines.length === 0) return [];

  const now = options.now ?? Date.now();
  const idFactory = options.idFactory || ((index) => `${makeId()}-${index}`);
  const inputType = normalizeInputType(options.inputType);
  const source = normalizeSource(options.source);
  const status = normalizeStatus(options.status);
  const userHint = normalizeUserHint(options.userHint);
  // Capture does not confirm a type yet: the hint stays a hint, and the
  // confirmed `itemType` is set later in Processing (default null).
  const itemType = normalizeItemType(options.itemType);
  const domainHintId = normalizeDomainHintId(options.domainHintId);
  const deviceId = options.deviceId || null;
  const entryPoint = normalizeEntryPoint(options.entryPoint);

  const created = lines.map((line, index) => ({
    id: idFactory(index),
    text: line,
    rawText: line,
    inputType,
    source,
    status,
    userHint,
    itemType,
    domainHintId,
    deviceId,
    entryPoint,
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

/**
 * Stage B0 editing mutation. Returns `{ item, changes }` for the caller to
 * apply atomically, or `null` when the id is unknown.
 *
 * Invariants:
 * - `text` is the editable display text; `rawText` stays the original capture
 *   and can never be overwritten through this mutation (explicit guard).
 * - `itemType` normalizes to the closed set `task | thought | note | null`.
 * - `status` must be one of the shared processing states
 *   `new | reviewed | processed | discarded`.
 * - `updatedAt` is owned by the command layer, not by this mutation.
 */
export function updateInboxItem(id, patch = {}){
  if (Object.hasOwn(patch, 'rawText')) {
    throw new Error('rawText is the original capture and cannot be modified');
  }
  const inbox = ensureInbox();
  const item = inbox.find(entry => entry.id === id);
  if (!item) return null;

  // Routed items are locked: their confirmed type and processing status are
  // owned by the routing flow and change only through revertInboxRoute.
  if (
    item.resultRef &&
    (Object.hasOwn(patch, 'itemType') || Object.hasOwn(patch, 'status'))
  ) {
    throw new Error('Routed inbox items are locked; use "Вернуть в разбор" first');
  }

  const changes = {};
  if (Object.hasOwn(patch, 'text')) {
    const text = String(patch.text ?? '').trim();
    if (!text) throw new Error('Inbox text cannot be empty');
    changes.text = text;
  }
  if (Object.hasOwn(patch, 'itemType')) {
    const itemType = patch.itemType;
    // Write path is strict: only the confirmed closed set (or an explicit
    // null) may be assigned. Read-time normalization stays lenient for legacy
    // data, but a typo here must throw instead of silently clearing the type.
    if (itemType !== null && !VALID_ITEM_TYPES.has(itemType)) {
      throw new Error(`Unknown itemType: ${itemType}`);
    }
    changes.itemType = itemType;
  }
  if (Object.hasOwn(patch, 'status')) {
    const status = String(patch.status ?? '').trim();
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`Unknown inbox status: ${patch.status}`);
    }
    changes.status = status;
  }
  if (Object.hasOwn(patch, 'domainHintId')) {
    const domainHintId = patch.domainHintId;
    if (
      domainHintId !== null &&
      (!Array.isArray(state.domains) || !state.domains.some(domain => domain.id === domainHintId))
    ) {
      throw new Error(`Unknown domain hint: ${domainHintId}`);
    }
    changes.domainHintId = domainHintId;
  }
  return { item, changes };
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
