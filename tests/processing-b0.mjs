// Stage B0 — Processing Center Foundation regression tests.
// Focused coverage: edit/rawText preservation, itemType normalization on
// read + strict validation on write, old Inbox compatibility, processing
// status, atomic rollback on save failure, the operation log for
// edit/type/status commands, and a light UI→itemType wiring check.
import { readFileSync } from 'node:fs';
import { state } from '../js/state.js';
import { getInboxItems, normalizeItemType } from '../js/features/inbox/model.js';
import {
  captureInbox,
  updateInbox,
} from '../js/core/commands.js';
import { loadState } from '../js/storage.js';
import adapter from '../js/storageAdapter.js';

const memory = new Map();
globalThis.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resetState() {
  state.domains = [];
  state.projects = [];
  state.tasks = [];
  state.inbox = [];
  state.operationLog = [];
  state.activeDomain = null;
  state.maxEdges = 300;
  state.showLinks = true;
  state.showAging = true;
  state.showGlow = true;
  state.view = 'map';
  state.settings = { layoutMode: 'auto' };
  memory.clear();
}

const opts = (extra = {}) => ({
  persist: false,
  now: 1000,
  deviceId: 'device-test',
  idFactory: index => `inbox-${index}`,
  ...extra,
});

// Test 1: edit changes text and preserves rawText
resetState();
const t1 = captureInbox('Оригинальный текст', opts());
const edited = updateInbox(t1[0].id, { text: 'Отредактированный текст' }, { ...opts(), now: 1100 });
assert(edited?.item.text === 'Отредактированный текст', 'Test 1: text should be editable');
assert(edited.item.rawText === 'Оригинальный текст', 'Test 1: rawText must stay the original');
assert(edited.before.text === 'Оригинальный текст', 'Test 1: before snapshot should hold the previous text');
assert(edited.item.updatedAt === 1100, 'Test 1: updatedAt should bump on edit');
console.log('✓ Test 1: edit saves text and preserves rawText');

// Test 2: rawText is immutable through the command
resetState();
const t2 = captureInbox('Неприкосновенный оригинал', opts());
let rawTextError = null;
try {
  updateInbox(t2[0].id, { rawText: 'попытка перезаписи' }, opts());
} catch (error) {
  rawTextError = error;
}
assert(rawTextError?.message.includes('rawText'), 'Test 2: rawText patch must be refused');
assert(state.inbox[0].rawText === 'Неприкосновенный оригинал', 'Test 2: rawText must survive the attempt');
assert(state.operationLog.length === 1, 'Test 2: refused edit must not add an operation');
console.log('✓ Test 2: rawText is immutable through the command');

// Test 3: itemType normalization on capture
resetState();
const typed = captureInbox('Задача из Capture', opts({ itemType: 'task' }));
assert(typed[0].itemType === 'task', 'Test 3a: valid itemType should be kept');
const bogus = captureInbox('Неизвестный тип', opts({ itemType: 'event', now: 1001, idFactory: () => 'bogus' }));
assert(bogus[0].itemType === null, 'Test 3b: unknown itemType should normalize to null');
const unset = captureInbox('Без типа', opts({ now: 1002, idFactory: () => 'unset' }));
assert(unset[0].itemType === null, 'Test 3c: absent itemType should default to null');
assert(normalizeItemType('thought') === 'thought', 'Test 3d: normalizeItemType keeps valid values');
assert(normalizeItemType('meeting') === null, 'Test 3e: normalizeItemType nulls unknown values');
console.log('✓ Test 3: itemType normalization');

// Test 4: itemType update is strict on write
resetState();
const t4 = captureInbox('Сначала мысль', opts());
updateInbox(t4[0].id, { itemType: 'thought' }, { ...opts(), now: 1200 });
assert(state.inbox[0].itemType === 'thought', 'Test 4a: valid type should be assigned');
updateInbox(t4[0].id, { itemType: 'task' }, { ...opts(), now: 1300 });
assert(state.inbox[0].itemType === 'task', 'Test 4b: switching to another valid type should work');
updateInbox(t4[0].id, { itemType: null }, { ...opts(), now: 1400 });
assert(state.inbox[0].itemType === null, 'Test 4c: explicit null should clear the type');
const opsBeforeInvalidType = state.operationLog.length;
let invalidTypeError = null;
try {
  updateInbox(t4[0].id, { itemType: 'wishlist' }, { ...opts(), now: 1500 });
} catch (error) {
  invalidTypeError = error;
}
assert(invalidTypeError?.message.includes('Unknown itemType'), 'Test 4d: invalid type must throw');
assert(state.inbox[0].itemType === null, 'Test 4e: existing type must survive the rejected update');
assert(state.operationLog.length === opsBeforeInvalidType, 'Test 4f: rejected update must not grow the journal');
console.log('✓ Test 4: itemType write validation is strict');

// Test 5: old Inbox records without itemType/status read normally
resetState();
state.inbox = [
  { id: 'legacy-1', text: 'Старая запись', createdAt: 100 },
  { id: 'legacy-2', text: 'Ещё старше', createdAt: 50, userHint: 'task' },
];
const legacy = getInboxItems();
assert(legacy[0].itemType === null, 'Test 5a: legacy record itemType should normalize to null');
assert(legacy[0].status === 'new', 'Test 5b: legacy record status should default to new');
assert(legacy[1].itemType === null, 'Test 5c: legacy record with userHint still has no itemType');
assert(legacy[1].userHint === 'task', 'Test 5d: legacy userHint hint must survive');
console.log('✓ Test 5: old Inbox compatibility (no migration needed)');

// Test 5e: full loadState round-trip of an old-style export
resetState();
const legacyJson = JSON.stringify({
  schema: 4,
  domains: [{ id: 'd1', title: 'Дом' }],
  projects: [],
  tasks: [],
  inbox: [{ id: 'old', text: 'Запись до B0', createdAt: 42 }],
  operationLog: [],
  settings: { layoutMode: 'auto' },
});
memory.set(adapter.key, legacyJson);
assert(loadState(), 'Test 5e: loadState should accept old-style state');
const restored = getInboxItems();
assert(restored[0].itemType === null, 'Test 5e: loaded itemType should normalize to null');
assert(restored[0].status === 'new', 'Test 5e: loaded status should default to new');
console.log('✓ Test 5e: old export loads with default itemType/status');

// Test 6: processing status transitions and validation
resetState();
const t6 = captureInbox('Запись для разбора', opts());
updateInbox(t6[0].id, { status: 'reviewed' }, { ...opts(), now: 1500 });
assert(state.inbox[0].status === 'reviewed', 'Test 6a: status should update to reviewed');
updateInbox(t6[0].id, { status: 'processed' }, { ...opts(), now: 1600 });
assert(state.inbox[0].status === 'processed', 'Test 6b: status should update to processed');
updateInbox(t6[0].id, { status: 'discarded' }, { ...opts(), now: 1700 });
assert(state.inbox[0].status === 'discarded', 'Test 6c: status should update to discarded');
let statusError = null;
try {
  updateInbox(t6[0].id, { status: 'done' }, { ...opts(), now: 1800 });
} catch (error) {
  statusError = error;
}
assert(statusError?.message.includes('Unknown inbox status'), 'Test 6d: unknown status must throw');
assert(state.inbox[0].status === 'discarded', 'Test 6e: failed status update must not apply');
console.log('✓ Test 6: processing status transitions');

// Test 7: no-op updates do not grow the journal
resetState();
const t7 = captureInbox('Без изменений', opts());
const opsBefore = state.operationLog.length;
const noop = updateInbox(t7[0].id, { status: 'new' }, { ...opts(), now: 1900 });
assert(noop?.operation === null, 'Test 7a: no-op update must not create an operation');
assert(state.operationLog.length === opsBefore, 'Test 7b: no-op update must not grow the journal');
const noopType = updateInbox(t7[0].id, { itemType: null }, { ...opts(), now: 1950 });
assert(noopType?.operation === null, 'Test 7c: no-op itemType update must not create an operation');
assert(state.operationLog.length === opsBefore, 'Test 7d: journal length must stay stable');
console.log('✓ Test 7: no-op updates journaled only on real change');

// Test 8: operation log records edit/type/status as inbox.update
resetState();
const t8 = captureInbox('Журналируемая запись', opts());
updateInbox(t8[0].id, { text: 'Текст после правки' }, { ...opts(), now: 2000 });
updateInbox(t8[0].id, { itemType: 'task' }, { ...opts(), now: 2100 });
updateInbox(t8[0].id, { status: 'reviewed' }, { ...opts(), now: 2200 });
const ops = state.operationLog.filter(operation => operation.type === 'inbox.update');
assert(ops.length === 3, 'Test 8a: three updates must produce three inbox.update operations');
assert(ops.every(operation => operation.entityType === 'inbox'), 'Test 8b: entityType must be inbox');
assert(ops.every(operation => operation.entityId === t8[0].id), 'Test 8c: entityId must name the record');
assert(ops[0].baseVersion === 1000, 'Test 8d: first update baseVersion should be the capture updatedAt');
assert(ops[0].payload.after.rawText === 'Журналируемая запись', 'Test 8e: edit payload must keep rawText');
assert(ops[0].payload.before.text === 'Журналируемая запись' && ops[0].payload.after.text === 'Текст после правки', 'Test 8f: edit payload must carry before/after text');
assert(ops[1].payload.before.itemType === null && ops[1].payload.after.itemType === 'task', 'Test 8g: type payload must carry before/after');
assert(ops[2].payload.before.status === 'new' && ops[2].payload.after.status === 'reviewed', 'Test 8h: status payload must carry before/after');
console.log('✓ Test 8: operation log for edit/type/status');

// Test 9: atomic rollback when persistence fails
resetState();
state.domains = [{ id: 'd1', title: 'Дом' }];
captureInbox('Запись до сбоя', opts({ persist: true, now: 3000 }));
const jsonBefore = memory.get(adapter.key);
const stateBefore = JSON.stringify(state.inbox[0]);
const opsBeforeFailure = JSON.stringify(state.operationLog);

const originalSetItem = globalThis.localStorage.setItem;
const savedWarn = console.warn;
console.warn = () => {};
globalThis.localStorage.setItem = function (key, value) {
  if (key === adapter.key) {
    const err = new Error('Quota exceeded');
    err.name = 'QuotaExceededError';
    throw err;
  }
  memory.set(key, String(value));
};

let thrownError = null;
try {
  updateInbox('inbox-0', { text: 'Правка со сбоем', itemType: 'note', status: 'processed' }, { persist: true, now: 3100 });
} catch (error) {
  thrownError = error;
}

globalThis.localStorage.setItem = originalSetItem;
console.warn = savedWarn;

assert(thrownError?.name === 'QuotaExceededError', 'Test 9a: storage error must be rethrown');
assert(JSON.stringify(state.inbox[0]) === stateBefore, 'Test 9b: inbox item must be restored on failure');
assert(state.inbox[0].rawText === 'Запись до сбоя', 'Test 9c: rawText must survive rollback');
assert(JSON.stringify(state.operationLog) === opsBeforeFailure, 'Test 9d: operationLog must be restored on failure');
assert(memory.get(adapter.key) === jsonBefore, 'Test 9e: durable JSON must stay byte-identical');
console.log('✓ Test 9: atomic rollback on save failure');

// Test 10: unknown id returns null without side effects
resetState();
captureInbox('Единственная запись', opts());
const opsCount = state.operationLog.length;
const missing = updateInbox('inbox-missing', { text: 'Никуда' }, opts());
assert(missing === null, 'Test 10a: unknown id must return null');
assert(state.operationLog.length === opsCount, 'Test 10b: unknown id must not touch the journal');
console.log('✓ Test 10: unknown id is a safe no-op');

// Test 11: minimal UI → itemType wiring (static source check, no browser framework)
const viewSource = readFileSync(new URL('../js/features/inbox/view.js', import.meta.url), 'utf-8');
assert(
  ['Задача', 'Мысль', 'Заметка', 'Без типа'].every(label => viewSource.includes(label)),
  'Test 11a: type picker labels must exist in the Processing card'
);
assert(
  viewSource.includes('updateInbox(item.id, { itemType: value })'),
  'Test 11b: picker must route through the Core command updateInbox with itemType'
);
assert(
  viewSource.includes('dataset.itemType') && viewSource.includes('inbox-type-button'),
  'Test 11c: picker must render per-type buttons'
);
console.log('✓ Test 11: UI type picker wiring');

console.log('\n✅ All Stage B0 processing tests passed.');
