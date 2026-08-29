// Stage C2 — Task Result Bridge regression tests.
//
// Covers: emission of task.result.upsert/remove alongside routing and Task
// mutations, projection content (titles resolved from Domains/Projects),
// remote apply (upsert/remove, stale-delivery guard, no echo, idempotency),
// invalid payload safety, and the live HTTP round trip — a routed result on
// the desktop becomes a readable projection on a second device and follows
// updates/deletes without any Task CRUD replication.
import { state } from '../js/state.js';
import { loadState } from '../js/storage.js';
import {
  applyRemoteTaskResultRemove,
  applyRemoteTaskResultUpsert,
  captureInbox,
  deleteTask,
  moveTask,
  revertInboxRoute,
  routeInboxToTask,
  updateInbox,
  updateTask,
} from '../js/core/commands.js';
import { applyIncomingOperation } from '../js/sync/apply.js';
import { createSyncEngine } from '../js/sync/engine.js';
import { createHttpTransport, claimPairingCode } from '../js/sync/http-transport.js';
import { getPendingOps, listOutbox } from '../js/sync/outbox.js';
import { resetSyncDeviceForTest } from '../js/sync/device.js';
import { createSyncServer } from '../server/sync-server.js';
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
  // Restore this client's persisted Atlas state (it may have synced before).
  try { loadState(); } catch (_) {}
}

function outboxOpsOfType(type){
  return listOutbox().filter(entry => entry.operation.type === type);
}

// --- Test 1: routing emits both operations with a full projection ----------
{
  const store = makeStore();
  switchClient(store, 'device-c2-a');
  const created = captureInbox('Купить удобрение для сливы', { deviceId: 'device-c2-a', userHint: 'task' });
  const inboxId = created[0].id;
  updateInbox(inboxId, { itemType: 'task' }, { deviceId: 'device-c2-a' });

  const routed = routeInboxToTask(inboxId, { deviceId: 'device-c2-a', projectId: 'p1', priority: 3, due: { date: '2026-08-24', time: null } });
  assert(routed?.task?.id, 'Test 1a: routing created a task');

  const upserts = outboxOpsOfType('task.result.upsert');
  const routes = outboxOpsOfType('inbox.route_to_task');
  assert(routes.length === 1 && upserts.length === 1, 'Test 1b: route + projection upsert both enqueued');

  const projection = upserts[0].operation.payload.projection;
  assert(projection.id === routed.task.id, 'Test 1c: projection carries the task id');
  assert(projection.title === 'Купить удобрение для сливы', 'Test 1d: projection carries the title');
  assert(projection.projectId === 'p1' && projection.projectTitle === 'Сад', 'Test 1e: project title resolved');
  assert(projection.domainId === 'd1' && projection.domainTitle === 'Дача', 'Test 1f: domain title resolved through the project');
  assert(projection.priority === 3 && projection.due?.date === '2026-08-24', 'Test 1g: priority + structured due preserved');
  assert(projection.status === 'backlog' && projection.sourceInboxId === inboxId, 'Test 1h: status + sourceInboxId preserved');
  console.log('✓ Test 1: route emits inbox.route_to_task + task.result.upsert');
}

// --- Test 2: Task mutations follow the routed result ------------------------
{
  const store = makeStore();
  switchClient(store, 'device-c2-b');
  const created = captureInbox('Запись про полив', { deviceId: 'device-c2-b' });
  const inboxId = created[0].id;
  updateInbox(inboxId, { itemType: 'task' }, { deviceId: 'device-c2-b' });
  const routed = routeInboxToTask(inboxId, { deviceId: 'device-c2-b', domainId: 'd2', priority: 2 });

  // updateTask on the routed task emits a fresh upsert with the new values
  updateTask(routed.task.id, { title: 'Настроить полив', priority: 4 }, { deviceId: 'device-c2-b' });
  let upserts = outboxOpsOfType('task.result.upsert');
  assert(upserts.length === 2, 'Test 2a: updateTask emitted a second upsert');
  const updated = upserts[1].operation.payload.projection;
  assert(updated.title === 'Настроить полив' && updated.priority === 4, 'Test 2b: updated projection has the new values');
  assert(updated.domainTitle === 'Дом', 'Test 2c: domain title survives the update');

  // moveTask on the routed task emits a placement upsert
  moveTask(routed.task.id, { projectId: 'p1' }, { deviceId: 'device-c2-b' });
  upserts = outboxOpsOfType('task.result.upsert');
  assert(upserts.length === 3, 'Test 2d: moveTask emitted a third upsert');
  assert(upserts[2].operation.payload.projection.projectTitle === 'Сад', 'Test 2e: moved projection resolves the project title');

  // deleteTask emits a remove
  deleteTask(routed.task.id, { deviceId: 'device-c2-b' });
  const removes = outboxOpsOfType('task.result.remove');
  assert(removes.length === 1 && removes[0].operation.payload.id === routed.task.id, 'Test 2f: deleteTask emitted task.result.remove');

  // updateTask on a NON-routed task emits nothing extra
  const plain = state.tasks.length; // tasks currently empty (deleted); create one via route-less path
  switchClient(makeStore(), 'device-c2-b');
  const free = {
    id: 'task-free', projectId: null, domainId: 'd1', title: 'Свободная задача',
    tags: [], status: 'backlog', estimateMin: null, priority: 2, due: null,
    createdAt: 1, updatedAt: 1,
  };
  state.tasks.push(free);
  const beforeCount = listOutbox().length;
  updateTask('task-free', { title: 'Переименована' }, { deviceId: 'device-c2-b' });
  assert(listOutbox().length === beforeCount, 'Test 2g: non-routed task update emits no projection op');
  console.log('✓ Test 2: update/move/delete follow the routed result');
}

// --- Test 3: revert removes the projection ----------------------------------
{
  const store = makeStore();
  switchClient(store, 'device-c2-c');
  const created = captureInbox('Вернуть в разбор', { deviceId: 'device-c2-c' });
  updateInbox(created[0].id, { itemType: 'task' }, { deviceId: 'device-c2-c' });
  const routed = routeInboxToTask(created[0].id, { deviceId: 'device-c2-c', domainId: 'd1' });

  const reverted = revertInboxRoute(created[0].id, { deviceId: 'device-c2-c' });
  assert(reverted && !reverted.refused, 'Test 3a: unmodified task reverted');
  assert(reverted.task?.id === routed.task.id, 'Test 3b: task removed by revert');
  const removes = outboxOpsOfType('task.result.remove');
  assert(removes.length === 1 && removes[0].operation.payload.id === routed.task.id, 'Test 3c: revert emitted task.result.remove');

  // A modified task is never deleted: no remove op must be emitted
  switchClient(makeStore(), 'device-c2-c');
  const created2 = captureInbox('Задача с правкой', { deviceId: 'device-c2-c' });
  updateInbox(created2[0].id, { itemType: 'task' }, { deviceId: 'device-c2-c' });
  const routed2 = routeInboxToTask(created2[0].id, { deviceId: 'device-c2-c', domainId: 'd1' });
  updateTask(routed2.task.id, { title: 'Отредактирована' }, { deviceId: 'device-c2-c', now: routed2.task.createdAt + 1000 });
  const refused = revertInboxRoute(created2[0].id, { deviceId: 'device-c2-c' });
  assert(refused.refused === true && refused.task === null, 'Test 3d: modified task revert refused');
  assert(outboxOpsOfType('task.result.remove').length === 0, 'Test 3e: refused revert emits no remove op');
  console.log('✓ Test 3: revert removes the projection; refused revert emits nothing');
}

// --- Test 4: remote apply — upsert, stale guard, remove, no echo ------------
{
  const store = makeStore();
  switchClient(store, 'device-c2-d');
  const upsertOp = {
    id: 'op-c2-upsert', deviceId: 'remote', timestamp: 1,
    type: 'task.result.upsert', entityType: 'task', entityId: 'task-1',
    payload: { projection: {
      id: 'task-1', title: 'Купить удобрение', sourceInboxId: 'inbox-1',
      domainId: 'd1', domainTitle: 'Дача', projectId: 'p1', projectTitle: 'Сад',
      priority: 3, due: 1800000000000, status: 'backlog', updatedAt: 1000,
    } },
  };
  const r1 = applyIncomingOperation(upsertOp);
  assert(r1.applied === true, 'Test 4a: upsert applied');
  assert(state.taskProjections.length === 1 && state.taskProjections[0].title === 'Купить удобрение', 'Test 4b: projection stored');
  assert(listOutbox().length === 0, 'Test 4c: remote apply produces no outbound op (no echo)');

  const r2 = applyIncomingOperation(upsertOp);
  assert(r2.deduped === true, 'Test 4d: duplicate upsert deduped');

  // Newer upsert wins; a stale delivery must NOT regress it
  applyIncomingOperation({
    id: 'op-c2-upsert-2', deviceId: 'remote', timestamp: 2,
    type: 'task.result.upsert', entityType: 'task', entityId: 'task-1',
    payload: { projection: { id: 'task-1', title: 'Купить удобрение (новое)', sourceInboxId: 'inbox-1', domainId: 'd1', domainTitle: 'Дача', projectId: 'p1', projectTitle: 'Сад', priority: 2, due: null, status: 'doing', updatedAt: 2000 } },
  });
  assert(state.taskProjections[0].title === 'Купить удобрение (новое)' && state.taskProjections[0].status === 'doing', 'Test 4e: newer projection replaces the old one');

  applyIncomingOperation({
    id: 'op-c2-upsert-3', deviceId: 'remote', timestamp: 3,
    type: 'task.result.upsert', entityType: 'task', entityId: 'task-1',
    payload: { projection: { id: 'task-1', title: 'Старое название', updatedAt: 500 } },
  });
  assert(state.taskProjections[0].title === 'Купить удобрение (новое)', 'Test 4f: stale delivery does not regress the projection');

  // remove deletes the projection
  const r3 = applyIncomingOperation({
    id: 'op-c2-remove', deviceId: 'remote', timestamp: 4,
    type: 'task.result.remove', entityType: 'task', entityId: 'task-1',
    payload: { id: 'task-1', sourceInboxId: 'inbox-1' },
  });
  assert(r3.applied === true, 'Test 4g: remove applied');
  assert(state.taskProjections.length === 0, 'Test 4h: projection removed');

  // removing an unknown id is a harmless no-op
  const r4 = applyIncomingOperation({
    id: 'op-c2-remove-2', deviceId: 'remote', timestamp: 5,
    type: 'task.result.remove', entityType: 'task', entityId: 'task-9',
    payload: { id: 'task-9' },
  });
  assert(r4.applied === true && state.taskProjections.length === 0, 'Test 4i: unknown remove is a no-op');

  // invalid payloads throw before any mutation
  const before = JSON.stringify(state.taskProjections);
  let threw = null;
  try {
    applyIncomingOperation({
      id: 'op-c2-bad', deviceId: 'remote', timestamp: 6,
      type: 'task.result.upsert', entityType: 'task', entityId: 'task-x',
      payload: { projection: { id: 'task-x' } },
    });
  } catch (error) { threw = error; }
  assert(threw !== null && JSON.stringify(state.taskProjections) === before, 'Test 4j: invalid projection rejected without mutation');
  console.log('✓ Test 4: remote apply upsert/remove, stale guard, no echo');
}

// --- Test 5: live HTTP — routed result follows desktop → phone --------------
{
  const DB_PATH = new URL('./fixtures/.sync-c2-test.sqlite', import.meta.url).pathname
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
    const claimed = await claimPairingCode(endpoint, { code: codes.code, deviceId, deviceName: 'C2 test' });
    store.setItem('atlas-sync-token', claimed.token);
    return claimed.token;
  };
  const makeTransport = store => createHttpTransport({
    endpoint,
    getToken: () => store.getItem('atlas-sync-token'),
  });

  const storeA = makeStore();
  const storeB = makeStore();
  await pair(storeA, 'device-c2-a');
  await pair(storeB, 'device-c2-b');

  // Desktop A: capture → route (creates task + projection ops)
  switchClient(storeA, 'device-c2-a');
  storeA.setItem('atlas-sync-token', storeA.getItem('atlas-sync-token'));
  const engineA = createSyncEngine({ transport: makeTransport(storeA), storage: storeA });
  const created = captureInbox('Починить калитку', { deviceId: 'device-c2-a' });
  updateInbox(created[0].id, { itemType: 'task' }, { deviceId: 'device-c2-a' });
  const routed = routeInboxToTask(created[0].id, { deviceId: 'device-c2-a', projectId: 'p1', priority: 1, due: { date: '2026-08-24', time: '10:00' } });
  const a1 = await engineA.sync();
  assert(a1.pushed >= 2, 'Test 5a: desktop pushed route + projection ops');

  // Phone B: pulls everything → inbox routed + readable projection
  switchClient(storeB, 'device-c2-b');
  storeB.setItem('atlas-sync-token', storeB.getItem('atlas-sync-token'));
  const engineB = createSyncEngine({ transport: makeTransport(storeB), storage: storeB });
  const b1 = await engineB.sync();
  assert(b1.pulled >= 2, 'Test 5b: phone pulled route + projection ops');
  assert(state.inbox.length === 1 && state.inbox[0].resultRef?.id === routed.task.id, 'Test 5c: phone inbox routed with resultRef');
  assert(state.taskProjections.length === 1, 'Test 5d: phone has the projection');
  const phoneView = state.taskProjections[0];
  assert(phoneView.title === 'Починить калитку' && phoneView.projectTitle === 'Сад' && phoneView.priority === 1, 'Test 5e: projection is human-readable on the phone');
  assert(state.tasks.length === 0, 'Test 5f: phone has NO task copy (no Task CRUD replication)');

  // Desktop edits the task → phone follows the update
  switchClient(storeA, 'device-c2-a');
  storeA.setItem('atlas-sync-token', storeA.getItem('atlas-sync-token'));
  updateTask(routed.task.id, { title: 'Починить калитку до выходных', status: 'done' }, { deviceId: 'device-c2-a' });
  const engineA2 = createSyncEngine({ transport: makeTransport(storeA), storage: storeA });
  await engineA2.sync();

  switchClient(storeB, 'device-c2-b');
  storeB.setItem('atlas-sync-token', storeB.getItem('atlas-sync-token'));
  const engineB2 = createSyncEngine({ transport: makeTransport(storeB), storage: storeB });
  const b2 = await engineB2.sync();
  assert(b2.pulled >= 1, 'Test 5g: phone pulled the task update');
  assert(state.taskProjections[0].title === 'Починить калитку до выходных' && state.taskProjections[0].status === 'done', 'Test 5h: phone projection follows the update');

  // Desktop deletes the task → phone shows the defined fallback (no projection)
  switchClient(storeA, 'device-c2-a');
  storeA.setItem('atlas-sync-token', storeA.getItem('atlas-sync-token'));
  deleteTask(routed.task.id, { deviceId: 'device-c2-a' });
  const engineA3 = createSyncEngine({ transport: makeTransport(storeA), storage: storeA });
  await engineA3.sync();

  switchClient(storeB, 'device-c2-b');
  storeB.setItem('atlas-sync-token', storeB.getItem('atlas-sync-token'));
  const engineB3 = createSyncEngine({ transport: makeTransport(storeB), storage: storeB });
  await engineB3.sync();
  assert(state.taskProjections.length === 0, 'Test 5i: projection cleared after task deletion');
  assert(state.inbox[0].resultRef?.id === routed.task.id, 'Test 5j: resultRef remains a reference (never a broken mutation)');

  await new Promise(resolve => server.close(resolve));
  if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
  console.log('✓ Test 5: live HTTP — routed result follows desktop → phone');
}

console.log('\n✅ All Stage C2 sync tests passed.');
