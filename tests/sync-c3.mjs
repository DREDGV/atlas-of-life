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
  state.inboxTombstones = [];
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
  applyIncomingOperation({ id: 'op-del', deviceId: 'remote', timestamp: 1, type: 'inbox.delete', entityType: 'inbox', entityId: id, baseVersion: created[0].updatedAt, payload: { item: created[0], index: 0 } });
  assert(state.inbox.length === 0, 'Test 1e: remote delete removes the record');
  applyIncomingOperation({ id: 'op-del2', deviceId: 'remote', timestamp: 2, type: 'inbox.delete', entityType: 'inbox', entityId: id, baseVersion: created[0].updatedAt, payload: { item: created[0], index: 0 } });
  assert(state.inbox.length === 0, 'Test 1f: remote delete is idempotent');

  applyIncomingOperation({ id: 'op-rest', deviceId: 'remote', timestamp: 3, type: 'inbox.restore', entityType: 'inbox', entityId: id, baseVersion: created[0].updatedAt, payload: { item: created[0], index: 0 } });
  assert(state.inbox.length === 1 && state.inbox[0].rawText === 'Удалю это', 'Test 1g: remote restore brings the record back');
  applyIncomingOperation({ id: 'op-rest2', deviceId: 'remote', timestamp: 4, type: 'inbox.restore', entityType: 'inbox', entityId: id, baseVersion: created[0].updatedAt, payload: { item: created[0], index: 0 } });
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
  assert(outboxOpsOfType('inbox.restore').length === 1, 'Test 3c: the restoration is enqueued (converges with other devices)');
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

// --- Test 8 (review): invariant protections -----------------------------------
{
  // 8a: a conflict restore must never fabricate rawText from editable text.
  const store = makeStore();
  switchClient(store, 'device-c3-inv');
  applyIncomingOperation({ id: 'op-inv-cap', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-inv', payload: { id: 'inbox-inv', rawText: 'Оригинал', text: 'Оригинал', status: 'new', createdAt: 100 } });
  deleteInbox('inbox-inv', { deviceId: 'device-c3-inv', now: 200 });
  const conflictNoRaw = {
    operation: {
      id: 'op-inv-upd', deviceId: 'remote', timestamp: 3, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-inv',
      baseVersion: 100,
      payload: { after: { id: 'inbox-inv', text: 'Изменённый текст', status: 'processed', updatedAt: 300 } }, // NO rawText
    },
    serverSequence: 5,
    status: 'conflict',
    conflictStatus: 'deleted_race',
    resolution: 'pending',
  };
  let threw = null;
  try {
    resolveConflict(conflictNoRaw, 'restore_apply', { deviceId: 'device-c3-inv' });
  } catch (error) { threw = error; }
  assert(threw !== null, 'Test 8a: restore without rawText must throw (no fabrication)');
  assert(state.inbox.length === 0, 'Test 8b: nothing was restored');
  console.log('✓ Test 8a/8b: rawText is never fabricated on conflict restore');

  // 8c: deleting a routed Inbox locally is blocked (resultRef link first).
  switchClient(makeStore(), 'device-c3-inv2');
  const created = captureInbox('Задача с результатом', { deviceId: 'device-c3-inv2' });
  updateInbox(created[0].id, { itemType: 'task' }, { deviceId: 'device-c3-inv2' });
  routeInboxToTask(created[0].id, { deviceId: 'device-c3-inv2', domainId: 'd1' });
  let deleteThrew = null;
  try {
    deleteInbox(created[0].id, { deviceId: 'device-c3-inv2' });
  } catch (error) { deleteThrew = error; }
  assert(deleteThrew !== null, 'Test 8c: routed Inbox cannot be deleted locally (revert first)');
  assert(state.inbox.some(item => item.id === created[0].id), 'Test 8d: the routed record survived');
  console.log('✓ Test 8c/8d: routed Inbox deletion is blocked locally');

  // 8e: remote delete of a routed Inbox is a classified conflict, not a silent remove.
  const result = applyIncomingOperation({
    id: 'op-inv-del', deviceId: 'remote', timestamp: 4, type: 'inbox.delete', entityType: 'inbox', entityId: created[0].id,
    baseVersion: state.inbox.find(item => item.id === created[0].id).updatedAt,
    payload: { item: state.inbox.find(item => item.id === created[0].id), index: 0 },
  });
  assert(result.conflict === true && result.conflictStatus === 'linked_result_delete', 'Test 8e: remote delete of routed Inbox classified as linked_result_delete');
  assert(state.inbox.some(item => item.id === created[0].id), 'Test 8f: the routed record was not removed');
  console.log('✓ Test 8e/8f: remote delete of a routed Inbox is refused with a classification');

  // 8g: force-apply of a route must verify the linked Task exists and points back.
  switchClient(makeStore(), 'device-c3-inv3');
  const created3 = captureInbox('Роут без задачи', { deviceId: 'device-c3-inv3' });
  const conflictRoute = {
    operation: {
      id: 'op-inv-route', deviceId: 'remote', timestamp: 2, type: 'inbox.route_to_task', entityType: 'task', entityId: 'task-missing',
      payload: { inboxAfter: { id: created3[0].id, text: 'Роут без задачи', rawText: 'Роут без задачи', status: 'processed', resultRef: { type: 'task', id: 'task-missing' }, updatedAt: 300 } },
    },
    serverSequence: 6,
    status: 'conflict',
    conflictStatus: 'deleted_race',
    resolution: 'pending',
  };
  state.tasks.push({ id: 'task-other', title: 'Другая', sourceInboxId: 'inbox-zzz' }); // a task model exists, but NOT the referenced one
  let routeThrew = null;
  try {
    resolveConflict(conflictRoute, 'restore_apply', { deviceId: 'device-c3-inv3' });
  } catch (error) { routeThrew = error; }
  assert(routeThrew !== null, 'Test 8g: route force-apply refuses a missing/unlinked Task when the task model exists');
  console.log('✓ Test 8g: route force-apply verifies the linked Task');
}

// --- Test 9 (review): delete ↔ restore race with tombstones -------------------
{
  // 9a/9b: local delete creates a tombstone; undo removes it.
  const store = makeStore();
  switchClient(store, 'device-c3-race');
  const created = captureInbox('Гонка удаления', { deviceId: 'device-c3-race', now: 100 });
  const id = created[0].id;
  const removal = deleteInbox(id, { deviceId: 'device-c3-race', now: 200 });
  assert(Array.isArray(state.inboxTombstones) && state.inboxTombstones.length === 1, 'Test 9a: local delete created a tombstone');
  assert(state.inboxTombstones[0].id === id && state.inboxTombstones[0].baseVersion === 100, 'Test 9b: tombstone carries id + baseVersion');
  undoDeleteInbox(removal, { deviceId: 'device-c3-race', now: 300 });
  assert(state.inboxTombstones.length === 0, 'Test 9c: undo removed the tombstone');
  console.log('✓ Test 9a–9c: tombstone lifecycle on local delete/undo');

  // 9d: remote delete with a mismatched baseVersion → delete_restore_race,
  //     the record survives (no server-order last-write-wins).
  const store2 = makeStore();
  switchClient(store2, 'device-c3-race2');
  applyIncomingOperation({ id: 'op-race-cap', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-race1', payload: { id: 'inbox-race1', rawText: 'Версия 2', status: 'new', createdAt: 100 } });
  state.inbox[0].updatedAt = 500; // this device moved the record forward
  const raceDelete = applyIncomingOperation({
    id: 'op-race-del', deviceId: 'remote', timestamp: 2, type: 'inbox.delete', entityType: 'inbox', entityId: 'inbox-race1',
    baseVersion: 100, // the other device deleted based on an OLDER version
    payload: { item: { id: 'inbox-race1', updatedAt: 100 }, index: 0 },
  });
  assert(raceDelete.conflict === true && raceDelete.conflictStatus === 'delete_restore_race', 'Test 9d: mismatched delete is a classified race');
  assert(state.inbox.some(item => item.id === 'inbox-race1'), 'Test 9e: record survives the raced delete');
  console.log('✓ Test 9d/9e: delete vs newer local version → delete_restore_race');

  // 9f: resolving that race — keep_local leaves the record; accept_delete removes it.
  const conflictDelete = {
    operation: {
      id: 'op-race-del', deviceId: 'remote', timestamp: 2, type: 'inbox.delete', entityType: 'inbox', entityId: 'inbox-race1',
      baseVersion: 100, payload: { item: { id: 'inbox-race1', updatedAt: 100 }, index: 0 },
    },
    serverSequence: 3, status: 'conflict', conflictStatus: 'delete_restore_race', resolution: 'pending',
  };
  resolveConflict(conflictDelete, 'keep_local', { deviceId: 'device-c3-race2' });
  assert(state.inbox.some(item => item.id === 'inbox-race1'), 'Test 9f: keep_local keeps the record');
  resolveConflict(conflictDelete, 'accept_delete', { deviceId: 'device-c3-race2' });
  assert(!state.inbox.some(item => item.id === 'inbox-race1'), 'Test 9g: accept_delete removes the record');
  assert(state.inboxTombstones.some(t => t.id === 'inbox-race1'), 'Test 9h: accept_delete records the tombstone');
  console.log('✓ Test 9f–9h: delete-race resolution (keep_local / accept_delete)');

  // 9i: remote restore with a tombstone but a mismatched version → race.
  const store3 = makeStore();
  switchClient(store3, 'device-c3-race3');
  applyIncomingOperation({ id: 'op-race3-cap', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-race2', payload: { id: 'inbox-race2', rawText: 'Запись', status: 'new', createdAt: 100 } });
  deleteInbox('inbox-race2', { deviceId: 'device-c3-race3', now: 200 }); // tombstone baseVersion 100
  const raceRestore = applyIncomingOperation({
    id: 'op-race3-rest', deviceId: 'remote', timestamp: 3, type: 'inbox.restore', entityType: 'inbox', entityId: 'inbox-race2',
    baseVersion: 999, // the other side restored a much newer version
    payload: { item: { id: 'inbox-race2', text: 'Запись', rawText: 'Запись', updatedAt: 999 }, index: 0 },
  });
  assert(raceRestore.conflict === true && raceRestore.conflictStatus === 'delete_restore_race', 'Test 9i: mismatched restore is a classified race');
  assert(!state.inbox.some(item => item.id === 'inbox-race2'), 'Test 9j: record stays deleted until resolved');

  // 9k: restore_apply on that race restores the record and clears the tombstone.
  const conflictRestore = {
    operation: {
      id: 'op-race3-rest', deviceId: 'remote', timestamp: 3, type: 'inbox.restore', entityType: 'inbox', entityId: 'inbox-race2',
      baseVersion: 999, payload: { item: { id: 'inbox-race2', text: 'Запись', rawText: 'Запись', updatedAt: 999 }, index: 0 },
    },
    serverSequence: 4, status: 'conflict', conflictStatus: 'delete_restore_race', resolution: 'pending',
  };
  resolveConflict(conflictRestore, 'restore_apply', { deviceId: 'device-c3-race3' });
  assert(state.inbox.some(item => item.id === 'inbox-race2'), 'Test 9k: restore_apply restored the record');
  assert(!state.inboxTombstones.some(t => t.id === 'inbox-race2'), 'Test 9l: tombstone cleared after restore');
  console.log('✓ Test 9i–9l: restore-race resolution (keep_deleted / restore_apply)');
}

// --- Test 10 (review): malformed remote inbox.restore → throw + full rollback --
{
  const store = makeStore();
  switchClient(store, 'device-c3-mal');
  applyIncomingOperation({ id: 'op-mal-cap', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-mal', payload: { id: 'inbox-mal', rawText: 'Целая запись', text: 'Целая запись', status: 'new', createdAt: 100 } });
  deleteInbox('inbox-mal', { deviceId: 'device-c3-mal', now: 150 }); // tombstone exists too
  undoDeleteInbox(state.inboxTombstones.find(t => t.id === 'inbox-mal').removal, { deviceId: 'device-c3-mal', now: 160 }); // and is cleared again
  applyIncomingOperation({ id: 'op-mal-upd', deviceId: 'remote', timestamp: 3, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-mal', baseVersion: 100, payload: { after: { id: 'inbox-mal', status: 'reviewed', updatedAt: 170 } } }); // journal noise

  const snapshotAll = () => JSON.stringify({
    inbox: state.inbox,
    tombstones: state.inboxTombstones,
    operationLog: state.operationLog,
    persisted: store.getItem('atlas_v2_data'),
  });
  const before = snapshotAll();

  const cases = [
    { name: 'missing id', item: { text: 'x', rawText: 'y' } },
    { name: 'missing text', item: { id: 'inbox-mal2', rawText: 'y' } },
    { name: 'missing rawText', item: { id: 'inbox-mal2', text: 'x' } },
    { name: 'non-string rawText', item: { id: 'inbox-mal2', text: 'x', rawText: 42 } },
  ];
  for (const c of cases) {
    let threw = null;
    try {
      applyIncomingOperation({
        id: `op-mal-${c.name.replace(/\s/g, '-')}`, deviceId: 'remote', timestamp: 2,
        type: 'inbox.restore', entityType: 'inbox', entityId: c.item.id || 'none', baseVersion: 100,
        payload: { item: c.item, index: 0 },
      });
    } catch (error) { threw = error; }
    assert(threw !== null, `Test 10a: malformed restore (${c.name}) throws`);
    assert(snapshotAll() === before, `Test 10b: full rollback (${c.name}) — inbox, tombstones, operationLog and persisted storage unchanged`);
  }
  assert(state.inbox.length === 1, 'Test 10c: nothing was half-applied');
  console.log('✓ Test 10: malformed remote restore — atomic rollback across all state and persisted storage');
}

// --- Test 11 (review): route validation driven by explicit capability ----------
{
  const store = makeStore();
  switchClient(store, 'device-c3-cap');
  applyIncomingOperation({ id: 'op-cap-cap', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-cap', payload: { id: 'inbox-cap', rawText: 'Роут', text: 'Роут', status: 'new', createdAt: 100 } });

  const makeRouteConflict = (resultRefId, sourceInboxId) => ({
    operation: {
      id: 'op-cap-route', deviceId: 'remote', timestamp: 2, type: 'inbox.route_to_task', entityType: 'task', entityId: resultRefId,
      payload: { inboxAfter: { id: sourceInboxId, text: 'Роут', rawText: 'Роут', status: 'processed', resultRef: { type: 'task', id: resultRefId }, updatedAt: 300 } },
    },
    serverSequence: 2, status: 'conflict', conflictStatus: 'deleted_race', resolution: 'pending',
  });

  const { syncCapabilities } = await import('../js/sync/capabilities.js');
  syncCapabilities.hasTaskModel = true; // Studio-like

  // a) empty Studio (no tasks at all) must still validate → throw
  state.tasks = [];
  let threw = null;
  try { resolveConflict(makeRouteConflict('task-missing-empty', 'inbox-cap'), 'restore_apply', { deviceId: 'device-c3-cap' }); } catch (error) { threw = error; }
  assert(threw !== null, 'Test 11a: empty Studio (tasks=[]) still validates the routed Task');

  // b) missing Task with a non-empty model → throw
  state.tasks = [{ id: 'task-other', title: 'Другая', sourceInboxId: 'inbox-zzz' }];
  threw = null;
  try { resolveConflict(makeRouteConflict('task-missing', 'inbox-cap'), 'restore_apply', { deviceId: 'device-c3-cap' }); } catch (error) { threw = error; }
  assert(threw !== null, 'Test 11b: missing Task → throw');

  // c) wrong sourceInboxId → throw
  state.tasks = [{ id: 'task-l', title: 'Связанная', sourceInboxId: 'inbox-other' }];
  threw = null;
  try { resolveConflict(makeRouteConflict('task-l', 'inbox-cap'), 'restore_apply', { deviceId: 'device-c3-cap' }); } catch (error) { threw = error; }
  assert(threw !== null, 'Test 11c: wrong sourceInboxId → throw');

  // d) correct link → applies
  state.tasks = [{ id: 'task-l', title: 'Связанная', sourceInboxId: 'inbox-cap' }];
  const ok = resolveConflict(makeRouteConflict('task-l', 'inbox-cap'), 'restore_apply', { deviceId: 'device-c3-cap' });
  assert(ok && state.inbox[0].resultRef?.id === 'task-l', 'Test 11d: correctly linked route applies');

  // e) Capture projection-only mode: no validation, projection reference accepted
  switchClient(makeStore(), 'device-c3-cap2');
  applyIncomingOperation({ id: 'op-cap2-cap', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-cap2', payload: { id: 'inbox-cap2', rawText: 'Проекция', text: 'Проекция', status: 'new', createdAt: 100 } });
  syncCapabilities.hasTaskModel = false; // Capture-like
  const cap = resolveConflict(makeRouteConflict('task-proj', 'inbox-cap2'), 'restore_apply', { deviceId: 'device-c3-cap2' });
  assert(cap && state.inbox[0].resultRef?.id === 'task-proj', 'Test 11e: Capture accepts the C2 projection reference');
  assert(state.tasks.length === 0, 'Test 11f: Capture still holds no Task model');

  syncCapabilities.hasTaskModel = true; // restore default for later tests
  console.log('✓ Test 11: route validation uses explicit capability (Studio validates, Capture projection-only)');
}

// --- Test 12 (review): schema migration, restore envelope, third-device race --
{
  // 12a: schema 4 data (no tombstones) migrates to inboxTombstones = []
  const store = makeStore();
  store.setItem('atlas_v2_data', JSON.stringify({
    schema: 4,
    domains: [{ id: 'd1', title: 'Дача' }],
    projects: [], tasks: [], inbox: [], operationLog: [],
    settings: { layoutMode: 'auto' },
  }));
  switchClient(store, 'device-c3-mig');
  assert(Array.isArray(state.inboxTombstones) && state.inboxTombstones.length === 0, 'Test 12a: schema 4 data migrates inboxTombstones to []');
  console.log('✓ Test 12a: schema migration (4 → 5, inboxTombstones)');

  // 12b: restore_apply emits inbox.restore carrying the tombstone baseVersion
  const store2 = makeStore();
  switchClient(store2, 'device-c3-env');
  const created = captureInbox('Запись для restore', { deviceId: 'device-c3-env', now: 100 });
  const id = created[0].id;
  deleteInbox(id, { deviceId: 'device-c3-env', now: 200 }); // tombstone baseVersion 100
  const conflict = {
    operation: {
      id: 'op-env-upd', deviceId: 'remote', timestamp: 3, type: 'inbox.update', entityType: 'inbox', entityId: id,
      baseVersion: 100,
      payload: { after: { id, text: 'Запись для restore', rawText: 'Запись для restore', status: 'processed', updatedAt: 300, createdAt: 100 } },
    },
    serverSequence: 4, status: 'conflict', conflictStatus: 'deleted_race', resolution: 'pending',
  };
  resolveConflict(conflict, 'restore_apply', { deviceId: 'device-c3-env' });
  const restoreOps = outboxOpsOfType('inbox.restore');
  assert(restoreOps.length === 1, 'Test 12b: restore_apply emitted an inbox.restore');
  assert(restoreOps[0].operation.baseVersion === 100, `Test 12c: restore envelope carries the tombstone baseVersion (got ${restoreOps[0].operation.baseVersion})`);
  console.log('✓ Test 12b/12c: emitted restore envelope carries tombstone baseVersion');

  // 12d: third-device tombstone race over live HTTP
  {
    const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
    const DB_PATH = new URL('./fixtures/.sync-c3-test3.sqlite', import.meta.url).pathname
      .replace(/^\/([A-Za-z]:)/, '$1');
    if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
    const server = createSyncServer({ token: ADMIN_TOKEN, dbPath: DB_PATH });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const pair3 = async (st, deviceId, name) => {
      const codes = await fetch(`${endpoint}/v1/pair/codes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
        body: '{}',
      }).then(r => r.json());
      const claimed = await claimPairingCode(endpoint, { code: codes.code, deviceId, deviceName: name });
      st.setItem('atlas-sync-token', claimed.token);
      return claimed.token;
    };
    const tr = st => createHttpTransport({ endpoint, getToken: () => st.getItem('atlas-sync-token') });

    const storeA = makeStore(); const storeB = makeStore(); const storeC = makeStore();
    await pair3(storeA, 'dev-3-a', 'A'); await pair3(storeB, 'dev-3-b', 'B'); await pair3(storeC, 'dev-3-c', 'C');

    // A: capture + delete based on v1 → server holds capture, delete
    switchClient(storeA, 'dev-3-a');
    const ea = createSyncEngine({ transport: tr(storeA), storage: storeA });
    const cap = captureInbox('Третье устройство', { deviceId: 'dev-3-a', now: 100 });
    await ea.sync();
    deleteInbox(cap[0].id, { deviceId: 'dev-3-a', now: 200 });
    await ea.sync();

    // C (third device): replays capture + delete → tombstone v1
    switchClient(storeC, 'dev-3-c');
    const ec = createSyncEngine({ transport: tr(storeC), storage: storeC });
    await ec.sync();
    assert(state.inbox.length === 0, 'Test 12d: C applied the delete');
    assert(state.inboxTombstones.some(t => t.id === cap[0].id && t.baseVersion === 100), 'Test 12e: C holds the tombstone (v1)');

    // B: restores a NEWER version (v2) — the restore op carries baseVersion 999.
    // The transport derives the batch deviceId from the CURRENT localStorage,
    // so B must be the active client while pushing.
    switchClient(storeB, 'dev-3-b');
    const transportB = tr(storeB);
    await transportB.pushOperations([{
      schema: 1, id: 'op-3b-rest-12345', deviceId: 'dev-3-b', sequence: 1, timestamp: 900,
      type: 'inbox.restore', entityType: 'inbox', entityId: cap[0].id, baseVersion: 999,
      payload: { item: { ...cap[0], updatedAt: 999, status: 'reviewed' }, index: 0 },
    }]);

    // C: the raced restore → delete_restore_race, record stays deleted
    switchClient(storeC, 'dev-3-c');
    await ec.sync();
    assert(ec.getStatus().conflicts === 1, 'Test 12f: C quarantined the raced restore (tombstone v1 vs restore v2)');
    assert(state.inbox.length === 0, 'Test 12g: C stays deleted until resolved');
    const conflict = ec.getConflicts().find(c => c.conflictStatus === 'delete_restore_race');
    assert(conflict && conflict.operation.type === 'inbox.restore', 'Test 12h: the race is on inbox.restore');

    ec.resolveConflict(conflict, 'restore_apply');
    assert(state.inbox.some(item => item.id === cap[0].id), 'Test 12i: C restored the record after resolution');
    assert(state.inboxTombstones.length === 0, 'Test 12j: C tombstone cleared');
    await ec.sync();
    assert(ec.getStatus().conflicts === 0 && ec.getStatus().pending === 0, 'Test 12k: C converged cleanly');

    await new Promise(resolve => server.close(resolve));
    if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
    console.log('✓ Test 12d–12k: third-device tombstone race + restore_apply convergence');
  }
}

// --- Test 13 (review): version-less delete/restore are refused (Core + HTTP) ---
{
  // Core: live item — a delete without baseVersion must NOT mutate anything.
  const store = makeStore();
  switchClient(store, 'device-c3-nov');
  applyIncomingOperation({ id: 'op-nov-cap', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-nov', payload: { id: 'inbox-nov', rawText: 'Живая', text: 'Живая', status: 'new', createdAt: 100 } });
  const before = JSON.stringify({ inbox: state.inbox, tombstones: state.inboxTombstones });
  let threw = null;
  try {
    applyIncomingOperation({ id: 'op-nov-del', deviceId: 'remote', timestamp: 2, type: 'inbox.delete', entityType: 'inbox', entityId: 'inbox-nov', payload: { item: state.inbox[0], index: 0 } }); // NO baseVersion
  } catch (error) { threw = error; }
  assert(threw !== null, 'Test 13a: version-less inbox.delete is refused');
  assert(JSON.stringify({ inbox: state.inbox, tombstones: state.inboxTombstones }) === before, 'Test 13b: item survives, no tombstone created');

  // Core: tombstone — a version-less restore must not resurrect anything.
  deleteInbox('inbox-nov', { deviceId: 'device-c3-nov', now: 200 }); // tombstone (v100)
  assert(state.inboxTombstones.length === 1, 'Test 13c: tombstone in place');
  threw = null;
  try {
    applyIncomingOperation({ id: 'op-nov-rest', deviceId: 'remote', timestamp: 3, type: 'inbox.restore', entityType: 'inbox', entityId: 'inbox-nov', payload: { item: { id: 'inbox-nov', text: 'Живая', rawText: 'Живая', updatedAt: 100 }, index: 0 } }); // NO baseVersion
  } catch (error) { threw = error; }
  assert(threw !== null, 'Test 13d: version-less inbox.restore is refused');
  assert(state.inbox.length === 0 && state.inboxTombstones.length === 1, 'Test 13e: record stays deleted, tombstone untouched');
  console.log('✓ Test 13a–13e: version-less delete/restore refused before any mutation');

  // HTTP: the server rejects version-less delete/restore per-op.
  {
    const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
    const DB_PATH = new URL('./fixtures/.sync-c3-nov.sqlite', import.meta.url).pathname
      .replace(/^\/([A-Za-z]:)/, '$1');
    if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
    const server = createSyncServer({ token: ADMIN_TOKEN, dbPath: DB_PATH });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const token = await claimPairingCode(endpoint, {
      code: (await fetch(`${endpoint}/v1/pair/codes`, {
        method: 'POST', headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' }, body: '{}',
      }).then(r => r.json())).code,
      deviceId: 'dev-nov', deviceName: 'Nov',
    });
    for (const type of ['inbox.delete', 'inbox.restore']) {
      const op = {
        schema: 1, id: `op-nov-${type}-123456`, deviceId: 'dev-nov', sequence: 1, timestamp: Date.now(),
        type, entityType: 'inbox', entityId: 'inbox-nov',
        payload: type === 'inbox.delete'
          ? { item: { id: 'inbox-nov', updatedAt: 100 }, index: 0 }
          : { item: { id: 'inbox-nov', text: 'Живая', rawText: 'Живая', updatedAt: 100 }, index: 0 },
      };
      const push = await fetch(`${endpoint}/v1/ops/push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocol: 'atlas-sync-v1', deviceId: 'dev-nov', operations: [op] }),
      });
      const body = await push.json();
      assert(body.ackedIds.length === 0 && body.conflicts.some(c => c.reason === 'invalid_operation'),
        `Test 13f: server rejects version-less ${type} (got ${JSON.stringify(body)})`);
    }
    await new Promise(resolve => server.close(resolve));
    if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
    console.log('✓ Test 13f: server rejects version-less delete/restore');
  }
}

// --- Test 14 (review): immediate migration persists the full new shape ---------
{
  const store = makeStore();
  store.setItem('atlas_v2_data', JSON.stringify({
    schema: 4,
    domains: [{ id: 'd1', title: 'Дача' }],
    projects: [], tasks: [], inbox: [], operationLog: [],
    settings: { layoutMode: 'auto' },
  }));
  switchClient(store, 'device-c3-mig2'); // loadState runs the 4→5 migration + immediate save
  const persisted = JSON.parse(store.getItem('atlas_v2_data'));
  assert(persisted.schema === 5, 'Test 14a: persisted schema bumped to 5');
  assert(Array.isArray(persisted.inboxTombstones) && persisted.inboxTombstones.length === 0, 'Test 14b: persisted inboxTombstones present as []');
  assert(Array.isArray(persisted.taskProjections) && persisted.taskProjections.length === 0, 'Test 14c: persisted taskProjections present as []');
  assert(state.inboxTombstones.length === 0, 'Test 14d: in-memory tombstones initialized');
  console.log('✓ Test 14: schema 4→5 migration persists the full new shape immediately');
}

// --- Test 15 (review): normal remote route policy (capability-driven) ----------
{
  const { syncCapabilities } = await import('../js/sync/capabilities.js');
  const routeOp = (resultRefId, sourceInboxId) => ({
    id: `op-nr-${Math.random().toString(36).slice(2, 10)}`, deviceId: 'remote', timestamp: 2,
    type: 'inbox.route_to_task', entityType: 'task', entityId: resultRefId,
    payload: { inboxAfter: { id: sourceInboxId, text: 'Роут', rawText: 'Роут', status: 'processed', resultRef: { type: 'task', id: resultRefId }, updatedAt: 300 } },
  });

  // Studio (hasTaskModel=true):
  const store = makeStore();
  switchClient(store, 'device-c3-nr');
  applyIncomingOperation({ id: 'op-nr-cap', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-nr', payload: { id: 'inbox-nr', rawText: 'Роут', text: 'Роут', status: 'new', createdAt: 100 } });
  syncCapabilities.hasTaskModel = true;

  // 15a: resolvable Task with correct link → applies
  state.tasks = [{ id: 'task-nr', title: 'Связанная', sourceInboxId: 'inbox-nr' }];
  let r = applyIncomingOperation(routeOp('task-nr', 'inbox-nr'));
  assert(r.applied === true && state.inbox[0].resultRef?.id === 'task-nr', 'Test 15a: Studio applies a correctly linked remote route');

  // 15b: resolvable Task with WRONG sourceInboxId → refused (quarantined), state unchanged
  const before = JSON.stringify(state.inbox[0].resultRef);
  r = applyIncomingOperation(routeOp('task-nr', 'inbox-nr'));
  assert(r.applied === true && JSON.stringify(state.inbox[0].resultRef) === before, 'Test 15b: duplicate route is idempotent (no change)');
  state.tasks[0].sourceInboxId = 'inbox-other';
  let threw = null;
  try {
    applyIncomingOperation({ ...routeOp('task-nr', 'inbox-nr'), id: 'op-nr-wrong-12345' });
  } catch (error) { threw = error; }
  assert(threw !== null && JSON.stringify(state.inbox[0].resultRef) === before, 'Test 15c: Studio refuses a route whose Task points elsewhere');

  // 15d: absent Task → accepted as projection reference (Tasks are not synced)
  state.tasks = [];
  r = applyIncomingOperation({ ...routeOp('task-absent-12345', 'inbox-nr'), id: 'op-nr-absent-123456' });
  assert(r.applied === true && state.inbox[0].resultRef?.id === 'task-absent-12345', 'Test 15d: Studio accepts an absent Task as projection reference');

  // Capture (hasTaskModel=false): always a projection reference, no Task lookups
  switchClient(makeStore(), 'device-c3-nr2');
  applyIncomingOperation({ id: 'op-nr2-cap', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-nr2', payload: { id: 'inbox-nr2', rawText: 'Проекция', text: 'Проекция', status: 'new', createdAt: 100 } });
  state.tasks = [{ id: 'task-proj', title: 'Другая', sourceInboxId: 'inbox-zzz' }];
  syncCapabilities.hasTaskModel = false;
  r = applyIncomingOperation({ ...routeOp('task-proj', 'inbox-nr2'), id: 'op-nr2-route-12345' });
  assert(r.applied === true && state.inbox[0].resultRef?.id === 'task-proj', 'Test 15e: Capture accepts only the C2 projection reference');

  syncCapabilities.hasTaskModel = true; // restore default for later tests
  console.log('✓ Test 15: normal remote route policy (Studio validate-when-resolvable, Capture projection-only)');
}

console.log('\n✅ All Stage C3 sync tests passed.');
