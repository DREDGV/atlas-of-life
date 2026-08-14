import { runInboxSyncCycle } from '../js/sync/inbox-sync.js';

function assert(condition, message){
  if (!condition) throw new Error(message);
}

function makeItem(id, text, timestamp){
  return {
    id,
    text,
    rawText: text,
    inputType: 'text',
    source: 'mobile-capture',
    status: 'new',
    userHint: null,
    deviceId: 'phone-1',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function makePendingOperation(item){
  return {
    id: `op-${item.id}`,
    deviceId: item.deviceId,
    timestamp: item.createdAt,
    type: 'inbox.capture',
    entityType: 'inbox',
    entityId: item.id,
    payload: item,
    syncStatus: 'pending',
  };
}

const localItem = makeItem('local-1', 'Локальная запись', 1000);
const remoteItem = makeItem('remote-1', 'Запись с другого устройства', 2000);
const inbox = [localItem];
const operationLog = [makePendingOperation(localItem)];
let persistedCursor = null;
let pushedBatch = null;

const result = await runInboxSyncCycle({
  inbox,
  operationLog,
  deviceId: 'phone-1',
  cursor: '10',
  transport: {
    async push(batch){
      pushedBatch = batch;
      return { acknowledgedOperationIds: ['op-local-1'] };
    },
    async pull(request){
      assert(request.after === '10', 'Pull must start from the supplied cursor');
      return {
        records: [
          { sequence: '11', item: localItem },
          { sequence: '12', item: remoteItem },
        ],
      };
    },
  },
  async persist({ nextCursor }){
    persistedCursor = nextCursor;
  },
});

assert(pushedBatch.operations.length === 1, 'Cycle must push one pending capture');
assert(operationLog[0].syncStatus === 'synced', 'Acknowledged operation must be marked synced');
assert(result.received === 1, 'Cycle must merge one new remote capture');
assert(result.duplicates.length === 1, 'Own server copy must be deduplicated');
assert(result.nextCursor === '12', 'Cycle must return the latest server cursor');
assert(persistedCursor === '12', 'Changed cycle must persist before reporting success');
assert(inbox.length === 2, 'Cycle must preserve local data and append remote data');

const rollbackInbox = [localItem];
const rollbackOperation = makePendingOperation(localItem);
const rollbackLog = [rollbackOperation];
let failure = null;

try {
  await runInboxSyncCycle({
    inbox: rollbackInbox,
    operationLog: rollbackLog,
    deviceId: 'phone-1',
    cursor: '20',
    transport: {
      async push(){
        return { acknowledgedOperationIds: ['op-local-1'] };
      },
      async pull(){
        return { records: [{ sequence: '21', item: remoteItem }] };
      },
    },
    async persist(){
      throw new Error('simulated local persistence failure');
    },
  });
} catch (error) {
  failure = error;
}

assert(failure?.message === 'simulated local persistence failure', 'Persistence error must propagate');
assert(rollbackLog[0] === rollbackOperation, 'Rollback must preserve operation object identity');
assert(rollbackLog[0].syncStatus === 'pending', 'Rollback must restore pending status');
assert(rollbackInbox.length === 1, 'Rollback must remove pulled items');
assert(rollbackInbox[0] === localItem, 'Rollback must preserve existing Inbox object identity');

const untouchedInbox = [localItem];
const untouchedLog = [makePendingOperation(localItem)];
let transportFailure = null;
try {
  await runInboxSyncCycle({
    inbox: untouchedInbox,
    operationLog: untouchedLog,
    deviceId: 'phone-1',
    transport: {
      async push(){ throw new Error('offline'); },
      async pull(){ return { records: [] }; },
    },
    async persist(){ throw new Error('must not run'); },
  });
} catch (error) {
  transportFailure = error;
}

assert(transportFailure?.message === 'offline', 'Transport error must propagate');
assert(untouchedLog[0].syncStatus === 'pending', 'Transport failure must leave operation pending');
assert(untouchedInbox.length === 1 && untouchedInbox[0] === localItem, 'Transport failure must not change Inbox');

console.log('Inbox sync cycle test passed.');
