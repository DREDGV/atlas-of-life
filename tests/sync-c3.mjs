// Stage C3 — Conflicts & Recovery regression tests.
//
// Covers: Inbox delete/restore sync (W2), deleted-race and base-version
// conflict classification, user resolution (keep local / accept remote / keep
// both / keep deleted / restore+apply), durable resolution state across
// reload, and Domain/Project rename re-emitting result projections (W3).
import { state } from '../js/state.js';
import {
  applyRemoteInboxDelete,
  applyRemoteInboxRestore,
  captureInbox,
  deleteInbox,
  routeInboxToTask,
  undoDeleteInbox,
  updateDomain,
  updateInbox,
  updateProject,
  updateTask,
  resolveConflict,
} from '../js/core/commands.js';
import { applyIncomingOperation } from '../js/sync/apply.js';
import { createSyncEngine } from '../js/sync/engine.js';
import { createHttpTransport, claimPairingCode } from '../js/sync/http-transport.js';
import { listOutbox, getPendingOps, clearOutbox } from '../js/sync/outbox.js';
import { listConflicts, listUnresolvedConflicts } from '../js/sync/quarantine.js';
import { resetSyncDeviceForTest } from '../js/sync/device.js';
import { createSyncServer } from '../server/sync-server.js';
import { loadState } from '../js/storage.js';
import { existsSync, rmSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeStore(seed = {}){
  const map = new Map(Object.entries(seed));
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    get(k) { return map.has(k) ? map.get(k) : null; },
    set(k, v) { map.set(k, String(v)); },
  };
}

function resetState(){
  state.domains = [{ id: 'd1', title: 'Дача' }, { id: 'd2', title: 'Дом' }];
  state.projects = [{ id: 'p1', domainId: 'd1', title: 'Сад' }];
  state.tasks = [];
  state.inbox = [];
  state.operationLog = [];
  state.taskProjections = [];
  state.activeDomain = 'd1';
  state.settings = { layoutMode: 'auto' };
  state.maxEdges = 300;
}

function switchClient(store, deviceId){
  globalThis.localStorage = store;
  store.setItem('atlas-device-id', deviceId);
  resetSyncDeviceForTest();
  resetState();
  try { loadState(); } catch (_) {}
}

function outboxOpsOfType(type){
  return listOutbox().filter(entry => entry.operation.type === type);
}

// --- Test 1 (W2): delete and restore are syncable ----------------------------
{
  const store = makeStore();
  switchClient(store, 'device-c3-a');
  const created = captureInbox('Удалю это', { deviceId: 'device-c3-a' });
  const id = created[0].id;

  const removal = deleteInbox(id, { deviceId: 'device-c3-a' });
  assert(removal?.item?.id === id, 'Test 1a: item removed locally');
  assert(outboxOpsOfType('inbox.delete').length === 1, 'Test 1b: inbox.delete enqueued');

  undoDeleteInbox(removal, { deviceId: 'device-c3-a' });
  assert(state.inbox.some(item => item.id === id), 'Test 1c: item restored locally');
  assert(outboxOpsOfType('inbox.restore').length === 1, 'Test 1d: inbox.restore enqueued');

  // Remote apply is idempotent both ways
  const store2 = makeStore();
  switchClient(store2, 'device-c3-b');
  applyIncomingOperation({ id: 'op-del', deviceId: 'remote', timestamp: 1, type: 'inbox.delete', entityType: 'inbox', entityId: id, payload: { item: created[0], index: 0 } });
  assert(state.inbox.length === 0, 'Test 1e: remote delete removes the record');
  applyIncomingOperation({ id: 'op-del2', deviceId: 'remote', timestamp: 2, type: 'inbox.delete', entityType: 'inbox', entityId: id, payload: { item: created[0], index: 0 } });
  assert(state.inbox.length === 0, 'Test 1f: remote delete is idempotent');

  applyIncomingOperation({ id: 'op-rest', deviceId: 'remote', timestamp: 3, type: 'inbox.restore', entityType: 'inbox', entityId: id, payload: { item: created[0], index: 0 } });
  assert(state.inbox.length === 1 && state.inbox[0].rawText === 'Удалю это', 'Test 1g: remote restore brings the record back');
  applyIncomingOperation({ id: 'op-rest2', deviceId: 'remote', timestamp: 4, type: 'inbox.restore', entityType: 'inbox', entityId: id, payload: { item: created[0], index: 0 } });
  assert(state.inbox.length === 1, 'Test 1h: remote restore is idempotent (no duplicate)');
  assert(listOutbox().length === 0, 'Test 1i: remote apply produces no outbound ops (no echo)');
  console.log('✓ Test 1: delete/restore syncable + idempotent remote apply');
}

// --- Test 2: deleted-race — remote update for locally deleted record ----------
{
  const store = makeStore();
  switchClient(store, 'device-c3-c');
  applyIncomingOperation({ id: 'op-cap', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-r1', payload: { id: 'inbox-r1', rawText: 'Гонка', status: 'new', createdAt: 100 } });
  const id = 'inbox-r1';
  deleteInbox(id, { deviceId: 'device-c3-c', now: 200 });

  const result = applyIncomingOperation({
    id: 'op-upd', deviceId: 'remote', timestamp: 3, type: 'inbox.update', entityType: 'inbox', entityId: id,
    baseVersion: 100,
    payload: { after: { id, status: 'processed', updatedAt: 300 } },
  });
  assert(result.conflict === true && result.conflictStatus === 'deleted_race', 'Test 2a: classified as deleted_race (not a crash)');
  assert(!state.inbox.some(item => item.id === id), 'Test 2b: local deletion kept');
  console.log('✓ Test 2: deleted-race classification');
}

// --- Test 3: user resolution of deleted_race ----------------------------------
{
  const store = makeStore();
  switchClient(store, 'device-c3-d');
  const conflict = {
    operation: {
      id: 'op-cf-d', deviceId: 'remote', timestamp: 3, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-r2',
      baseVersion: 100,
      payload: { after: { id: 'inbox-r2', text: 'Гонка', rawText: 'Гонка', status: 'processed', itemType: 'thought', updatedAt: 300, createdAt: 100 } },
    },
    serverSequence: 5,
    status: 'conflict',
    conflictStatus: 'deleted_race',
    resolution: 'pending',
  };

  // restore + apply: the record comes back with the remote state
  resolveConflict(conflict, 'restore_apply', { deviceId: 'device-c3-d' });
  assert(state.inbox.length === 1 && state.inbox[0].status === 'processed', 'Test 3a: restore_apply rebuilt the record with remote state');
  assert(state.inbox[0].id === 'inbox-r2' && state.inbox[0].itemType === 'thought', 'Test 3b: id and type preserved');
  console.log('✓ Test 3: deleted_race resolution — restore_apply');

  // keep_deleted: nothing is restored
  switchClient(makeStore(), 'device-c3-d');
  const conflict2 = {
    operation: {
      id: 'op-cf-d2', deviceId: 'remote', timestamp: 3, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-r3',
      baseVersion: 100,
      payload: { after: { id: 'inbox-r3', text: 'Другая', status: 'processed', updatedAt: 300 } },
    },
    serverSequence: 6,
    status: 'conflict',
    conflictStatus: 'deleted_race',
    resolution: 'pending',
  };
  resolveConflict(conflict2, 'keep_deleted', { deviceId: 'device-c3-d' });
  assert(state.inbox.length === 0, 'Test 3c: keep_deleted leaves the record deleted');
  console.log('✓ Test 3: deleted_race resolution — keep_deleted');
}

// --- Test 4: base_version resolution (accept / keep local / keep both) --------
{
  // accept_remote
  const store = makeStore();
  switchClient(store, 'device-c3-e');
  applyIncomingOperation({ id: 'op-c4a', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-bv', payload: { id: 'inbox-bv', rawText: 'Версия', status: 'new', createdAt: 100 } });
  const conflict = {
    operation: {
      id: 'op-c4b', deviceId: 'remote', timestamp: 2, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-bv',
      baseVersion: 100,
      payload: { after: { id: 'inbox-bv', text: 'Версия', status: 'processed', itemType: 'note', updatedAt: 500 } },
    },
    serverSequence: 2,
    status: 'conflict',
    conflictStatus: 'base_version',
    resolution: 'pending',
  };
  resolveConflict(conflict, 'accept_remote', { deviceId: 'device-c3-e' });
  assert(state.inbox[0].status === 'processed' && state.inbox[0].itemType === 'note', 'Test 4a: accept_remote applies the remote state');

  // keep_local
  switchClient(makeStore(), 'device-c3-e');
  applyIncomingOperation({ id: 'op-c4c', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-bv2', payload: { id: 'inbox-bv2', rawText: 'Локальная', status: 'new', createdAt: 100 } });
  updateInbox('inbox-bv2', { status: 'reviewed' }, { deviceId: 'device-c3-e', now: 300 });
  const conflict2 = {
    operation: {
      id: 'op-c4d', deviceId: 'remote', timestamp: 2, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-bv2',
      baseVersion: 100,
      payload: { after: { id: 'inbox-bv2', text: 'Локальная', status: 'processed', updatedAt: 400 } },
    },
    serverSequence: 2,
    status: 'conflict',
    conflictStatus: 'base_version',
    resolution: 'pending',
  };
  resolveConflict(conflict2, 'keep_local', { deviceId: 'device-c3-e' });
  assert(state.inbox[0].status === 'reviewed', 'Test 4b: keep_local keeps the local state');

  // keep_both: a copy of the local record is created and an inbox.capture is
  // enqueued for it (the copy must propagate), remote state takes the original.
  switchClient(makeStore(), 'device-c3-e');
  applyIncomingOperation({ id: 'op-c4e', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-bv3', payload: { id: 'inbox-bv3', rawText: 'Обе версии', status: 'new', createdAt: 100 } });
  updateInbox('inbox-bv3', { itemType: 'thought' }, { deviceId: 'device-c3-e', now: 300 });
  const conflict3 = {
    operation: {
      id: 'op-c4f', deviceId: 'remote', timestamp: 2, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-bv3',
      baseVersion: 100,
      payload: { after: { id: 'inbox-bv3', text: 'Обе версии', status: 'processed', itemType: 'note', updatedAt: 400 } },
    },
    serverSequence: 2,
    status: 'conflict',
    conflictStatus: 'base_version',
    resolution: 'pending',
  };
  const beforeCount = state.inbox.length;
  resolveConflict(conflict3, 'keep_both', { deviceId: 'device-c3-e' });
  assert(state.inbox.length === beforeCount + 1, 'Test 4c: keep_both created a copy');
  const copy = state.inbox.find(item => item.id !== 'inbox-bv3');
  assert(copy && copy.rawText === 'Обе версии' && copy.itemType === 'thought', 'Test 4d: the copy keeps the local version');
  const original = state.inbox.find(item => item.id === 'inbox-bv3');
  assert(original.status === 'processed' && original.itemType === 'note', 'Test 4e: the original takes the remote state');
  assert(outboxOpsOfType('inbox.capture').length === 1, 'Test 4f: the copy is enqueued for delivery');
  console.log('✓ Test 4: base_version resolution (accept / keep local / keep both)');
}

// --- Test 5: engine resolution lifecycle — durable across reload --------------
{
  const store = makeStore();
  switchClient(store, 'device-c3-f');
  const relay = {
    pushOperations: async () => ({ ackedIds: [] }),
    pullOperations: async () => ({
      operations: [{
        serverSequence: 1,
        operation: {
          id: 'op-cf5', deviceId: 'remote', timestamp: 1, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-cf5',
          baseVersion: 100,
          payload: { after: { id: 'inbox-cf5', text: 'X', status: 'processed', updatedAt: 300 } },
        },
      }],
      newCursor: 1,
    }),
    acknowledge: async () => {},
  };
  const engine = createSyncEngine({ transport: relay, storage: store });
  // capture first so the update hits a record with a different baseVersion
  applyIncomingOperation({ id: 'op-seed', deviceId: 'remote', timestamp: 0, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-cf5', payload: { id: 'inbox-cf5', rawText: 'X', status: 'new', createdAt: 100 } });
  state.inbox[0].updatedAt = 9999; // local moved ahead of the incoming update
  await engine.sync();
  assert(engine.getStatus().conflicts === 1, 'Test 5a: one unresolved conflict');
  assert(listUnresolvedConflicts().length === 1, 'Test 5b: quarantine shows it pending');

  const conflict = engine.getConflicts()[0];
  engine.resolveConflict(conflict, 'keep_local');
  assert(engine.getStatus().conflicts === 0, 'Test 5c: resolved conflicts no longer demand attention');
  assert(listConflicts()[0].resolution === 'resolved' && listConflicts()[0].resolutionAction === 'keep_local', 'Test 5d: resolution recorded durably');

  const engine2 = createSyncEngine({ transport: relay, storage: store });
  assert(engine2.getStatus().conflicts === 0, 'Test 5e: resolution survives reload');
  console.log('✓ Test 5: engine resolution lifecycle (durable, no reload regression)');
}

// --- Test 6 (W3): Domain/Project rename re-emits result projections -----------
{
  const store = makeStore();
  switchClient(store, 'device-c3-g');
  const created = captureInbox('Задача в саду', { deviceId: 'device-c3-g' });
  updateInbox(created[0].id, { itemType: 'task' }, { deviceId: 'device-c3-g' });
  const routed = routeInboxToTask(created[0].id, { deviceId: 'device-c3-g', projectId: 'p1' }); // in «Сад» (d1)
  const routedId = routed.task.id;
  clearOutbox(); // drop the initial route/projection ops — we test only re-emits

  updateDomain('d1', { title: 'Загородный дом' }, { deviceId: 'device-c3-g' });
  const domainUpserts = outboxOpsOfType('task.result.upsert');
  assert(domainUpserts.length === 1, 'Test 6a: domain rename emitted one projection upsert');
  assert(domainUpserts[0].operation.payload.projection.id === routedId, 'Test 6b: it is for the routed task');
  assert(domainUpserts[0].operation.payload.projection.domainTitle === 'Загородный дом', 'Test 6c: the new domain title is in the projection');

  updateProject('p1', { title: 'Сад и огород' }, { deviceId: 'device-c3-g' });
  const projectUpserts = outboxOpsOfType('task.result.upsert');
  assert(projectUpserts.length === 2, 'Test 6d: project rename emitted another upsert');
  assert(projectUpserts[1].operation.payload.projection.projectTitle === 'Сад и огород', 'Test 6e: the new project title is in the projection');

  // tasks outside the Inbox flow never trigger a projection upsert
  const free = { id: 'task-free2', projectId: null, domainId: 'd2', title: 'Свободная', tags: [], status: 'backlog', estimateMin: null, priority: 2, due: null, createdAt: 1, updatedAt: 1 };
  state.tasks.push(free);
  const beforeCount = listOutbox().length;
  updateDomain('d2', { title: 'Дом' }, { deviceId: 'device-c3-g' }); // same title — no comparable change
  assert(listOutbox().length === beforeCount, 'Test 6f: no-op rename emits nothing');
  console.log('✓ Test 6: Domain/Project rename re-emits routed result projections');
}

// --- Test 7: live HTTP — delete/restore round trip between two clients --------
{
  const DB_PATH = new URL('./fixtures/.sync-c3-test.sqlite', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1');
  if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
  const server = createSyncServer({ token: 'test-admin-token-0123456789abcdef', dbPath: DB_PATH });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;

  const pair = async (store, deviceId) => {
    const codes = await fetch(`${endpoint}/v1/pair/codes`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-admin-token-0123456789abcdef', 'Content-Type': 'application/json' },
      body: '{}',
    }).then(r => r.json());
    const claimed = await claimPairingCode(endpoint, { code: codes.code, deviceId, deviceName: 'C3 test' });
    store.setItem('atlas-sync-token', claimed.token);
    return claimed.token;
  };
  const makeTransport = store => createHttpTransport({
    endpoint,
    getToken: () => store.getItem('atlas-sync-token'),
  });

  const storeA = makeStore();
  const storeB = makeStore();
  await pair(storeA, 'device-c3-live-a');
  await pair(storeB, 'device-c3-live-b');

  // A captures → B receives → A deletes → B sees it gone → B restores → A sees it back
  switchClient(storeA, 'device-c3-live-a');
  const engineA = createSyncEngine({ transport: makeTransport(storeA), storage: storeA });
  const created = captureInbox('Удаляемая запись', { deviceId: 'device-c3-live-a' });
  const id = created[0].id;
  await engineA.sync();

  switchClient(storeB, 'device-c3-live-b');
  const engineB = createSyncEngine({ transport: makeTransport(storeB), storage: storeB });
  await engineB.sync();
  assert(state.inbox.some(item => item.id === id), 'Test 7a: B received the capture');

  switchClient(storeA, 'device-c3-live-a');
  const removal = deleteInbox(id, { deviceId: 'device-c3-live-a' });
  await engineA.sync();

  switchClient(storeB, 'device-c3-live-b');
  await engineB.sync();
  assert(!state.inbox.some(item => item.id === id), 'Test 7b: B honored the deletion');

  switchClient(storeB, 'device-c3-live-b');
  undoDeleteInbox(removal, { deviceId: 'device-c3-live-b' });
  await engineB.sync();

  switchClient(storeA, 'device-c3-live-a');
  await engineA.sync();
  assert(state.inbox.some(item => item.id === id), 'Test 7c: A got the restore back');
  assert(state.inbox.filter(item => item.id === id).length === 1, 'Test 7d: no duplicate after restore');
  assert(getPendingOps().length === 0, 'Test 7e: all delivered');

  await new Promise(resolve => server.close(resolve));
  if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
  console.log('✓ Test 7: live HTTP delete/restore round trip');
}

console.log('\n✅ All Stage C3 sync tests passed.');
