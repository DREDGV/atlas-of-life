import {
  INBOX_SYNC_PROTOCOL,
  acknowledgeInboxOperations,
  buildInboxPushBatch,
  collectPendingInboxCaptures,
  mergeRemoteInboxRecords,
  normalizeSyncedInboxItem,
} from '../js/sync/inbox-protocol.js';

function assert(condition, message){
  if (!condition) throw new Error(message);
}

function makeItem(overrides = {}){
  return {
    id: 'inbox-phone-1',
    text: 'Записать идею на ходу',
    rawText: 'Записать идею на ходу',
    inputType: 'text',
    source: 'mobile-capture',
    status: 'new',
    userHint: 'thought',
    deviceId: 'phone-1',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

const pendingCapture = {
  id: 'op-phone-1',
  deviceId: 'phone-1',
  timestamp: 1000,
  type: 'inbox.capture',
  entityType: 'inbox',
  entityId: 'inbox-phone-1',
  payload: makeItem(),
  syncStatus: 'pending',
};

const log = [
  { ...pendingCapture },
  { ...pendingCapture, id: 'op-synced', syncStatus: 'synced' },
  { ...pendingCapture, id: 'op-task', type: 'task.create' },
  { ...pendingCapture, id: 'op-invalid', payload: { id: 'broken', text: '' } },
];

const pending = collectPendingInboxCaptures(log);
assert(pending.length === 1, 'Only valid pending Inbox captures must be selected');
assert(pending[0].operationId === 'op-phone-1', 'Pending operation ID must be preserved');

const batch = buildInboxPushBatch(log, { deviceId: 'phone-1' });
assert(batch.protocol === INBOX_SYNC_PROTOCOL, 'Push batch must declare its protocol version');
assert(batch.deviceId === 'phone-1', 'Push batch must identify the sending device');
assert(batch.operations.length === 1, 'Push batch must not include unrelated operations');

const acknowledged = acknowledgeInboxOperations(log, ['op-phone-1', 'op-task', 'missing']);
assert(acknowledged === 1, 'Only an accepted pending Inbox capture may be acknowledged');
assert(log[0].syncStatus === 'synced', 'Acknowledged Inbox operation must become synced');
assert(log[2].syncStatus === 'pending', 'Unrelated operations must not be modified');

const normalized = normalizeSyncedInboxItem({
  id: 'inbox-2',
  rawText: 'Текст без нормализованных полей',
  createdAt: 2000,
});
assert(normalized.text === 'Текст без нормализованных полей', 'rawText must safely populate text');
assert(normalized.source === 'mobile-capture', 'Unknown source must default to mobile capture');
assert(normalized.status === 'new', 'Unknown status must default to new');

const inbox = [makeItem()];
const remoteItem = makeItem({
  id: 'inbox-phone-2',
  text: 'Вторая запись',
  rawText: 'Вторая запись',
  createdAt: 2000,
  updatedAt: 2000,
});
const merge = mergeRemoteInboxRecords(inbox, [
  { sequence: '41', item: makeItem() },
  { sequence: '42', item: remoteItem },
  { sequence: '43', item: makeItem({ text: 'Конфликт', rawText: 'Конфликт' }) },
  { sequence: '44', item: { id: 'invalid', text: '' } },
], { cursor: '40' });

assert(merge.added.length === 1, 'One new remote Inbox item must be appended');
assert(merge.duplicateIds.length === 1, 'An identical item must be treated as a duplicate');
assert(merge.conflicts.length === 1, 'A divergent item with the same ID must be reported as a conflict');
assert(merge.nextCursor === '44', 'Cursor must advance to the highest observed server sequence');
assert(inbox.length === 2, 'Conflict and duplicate records must not overwrite local Inbox data');
assert(inbox[0].text === 'Записать идею на ходу', 'Existing local item must remain unchanged');

const repeated = mergeRemoteInboxRecords(inbox, [
  { sequence: '45', item: remoteItem },
], { cursor: merge.nextCursor });
assert(repeated.added.length === 0, 'Repeated pull must be idempotent');
assert(repeated.duplicateIds.length === 1, 'Repeated pull must report the existing item');
assert(inbox.length === 2, 'Repeated pull must not create duplicates');

console.log('Inbox sync protocol test passed.');
