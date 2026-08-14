export const INBOX_SYNC_PROTOCOL = 1;
export const DEFAULT_PUSH_LIMIT = 100;
export const MAX_PUSH_LIMIT = 200;

const VALID_INPUT_TYPES = new Set(['text', 'voice']);
const VALID_USER_HINTS = new Set(['task', 'thought', 'note']);
const VALID_STATUSES = new Set(['new', 'reviewed', 'processed', 'discarded']);
const VALID_SOURCES = new Set(['desktop-capture', 'mobile-capture']);

function boundedString(value, maxLength){
  const text = String(value ?? '').trim();
  return text && text.length <= maxLength ? text : null;
}

function safeTimestamp(value, fallback){
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function normalizeLimit(value){
  const requested = Number(value) || DEFAULT_PUSH_LIMIT;
  return Math.max(1, Math.min(MAX_PUSH_LIMIT, Math.floor(requested)));
}

function normalizeCursor(value){
  const cursor = String(value ?? '0');
  return /^\d+$/.test(cursor) ? cursor : '0';
}

function laterCursor(left, right){
  const a = normalizeCursor(left);
  const b = normalizeCursor(right);
  try {
    return BigInt(b) > BigInt(a) ? b : a;
  } catch (_) {
    return a;
  }
}

export function normalizeSyncedInboxItem(value){
  if (!value || typeof value !== 'object') return null;
  const id = boundedString(value.id, 160);
  const text = boundedString(value.text ?? value.rawText, 100000);
  if (!id || !text) return null;

  const createdAt = safeTimestamp(value.createdAt, Date.now());
  const updatedAt = safeTimestamp(value.updatedAt, createdAt);
  const inputType = VALID_INPUT_TYPES.has(value.inputType) ? value.inputType : 'text';
  const source = VALID_SOURCES.has(value.source) ? value.source : 'mobile-capture';
  const status = VALID_STATUSES.has(value.status) ? value.status : 'new';
  const userHint = VALID_USER_HINTS.has(value.userHint) ? value.userHint : null;
  const deviceId = boundedString(value.deviceId, 160);

  return {
    id,
    text,
    rawText: boundedString(value.rawText, 100000) || text,
    inputType,
    source,
    status,
    userHint,
    deviceId,
    createdAt,
    updatedAt,
  };
}

export function collectPendingInboxCaptures(operationLog, options = {}){
  if (!Array.isArray(operationLog)) return [];
  const limit = normalizeLimit(options.limit);
  const pending = [];

  for (const operation of operationLog) {
    if (pending.length >= limit) break;
    if (!operation || operation.type !== 'inbox.capture') continue;
    if (operation.syncStatus !== 'pending') continue;

    const operationId = boundedString(operation.id, 160);
    const deviceId = boundedString(operation.deviceId, 160);
    const item = normalizeSyncedInboxItem(operation.payload);
    if (!operationId || !deviceId || !item) continue;
    if (operation.entityId && String(operation.entityId) !== item.id) continue;

    pending.push({
      operationId,
      deviceId,
      timestamp: safeTimestamp(operation.timestamp, item.createdAt),
      item,
    });
  }

  return pending;
}

export function buildInboxPushBatch(operationLog, options = {}){
  const operations = collectPendingInboxCaptures(operationLog, options);
  const requestedDeviceId = boundedString(options.deviceId, 160);
  const deviceId = requestedDeviceId || operations[0]?.deviceId || null;
  if (!deviceId) throw new Error('A device ID is required for Inbox sync');

  return {
    protocol: INBOX_SYNC_PROTOCOL,
    deviceId,
    operations,
  };
}

export function acknowledgeInboxOperations(operationLog, acknowledgedIds){
  if (!Array.isArray(operationLog) || !Array.isArray(acknowledgedIds)) return 0;
  const accepted = new Set(
    acknowledgedIds
      .map(id => boundedString(id, 160))
      .filter(Boolean)
  );
  let changed = 0;

  operationLog.forEach(operation => {
    if (!accepted.has(operation?.id)) return;
    if (operation.type !== 'inbox.capture' || operation.syncStatus !== 'pending') return;
    operation.syncStatus = 'synced';
    changed += 1;
  });

  return changed;
}

function comparableItem(item){
  return JSON.stringify({
    id: item.id,
    text: item.text,
    rawText: item.rawText,
    inputType: item.inputType,
    source: item.source,
    status: item.status,
    userHint: item.userHint,
    deviceId: item.deviceId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

export function mergeRemoteInboxRecords(inbox, records, options = {}){
  if (!Array.isArray(inbox)) throw new Error('Inbox must be an array');
  const sourceRecords = Array.isArray(records) ? records : [];
  const known = new Map(inbox.map(item => [String(item?.id ?? ''), item]));
  const added = [];
  const duplicateIds = [];
  const conflicts = [];
  let nextCursor = normalizeCursor(options.cursor);

  for (const record of sourceRecords) {
    if (!record || typeof record !== 'object') continue;
    const sequence = normalizeCursor(record.sequence);
    if (sequence === '0') continue;
    nextCursor = laterCursor(nextCursor, sequence);

    const item = normalizeSyncedInboxItem(record.item);
    if (!item) continue;
    const existing = known.get(item.id);
    if (existing) {
      const normalizedExisting = normalizeSyncedInboxItem(existing);
      if (normalizedExisting && comparableItem(normalizedExisting) === comparableItem(item)) {
        duplicateIds.push(item.id);
      } else {
        conflicts.push({ id: item.id, sequence });
      }
      continue;
    }

    inbox.push(item);
    known.set(item.id, item);
    added.push(item);
  }

  return {
    added,
    duplicateIds,
    conflicts,
    nextCursor,
  };
}
