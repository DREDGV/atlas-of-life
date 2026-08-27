// Stage C4 — Product Closure regression tests.
//
// Covers: device management (server list/rename/revoke + client renameSelf),
// diagnostics export (no secrets), and initial bootstrap — a brand-new client
// with an empty store replays the whole operation stream from zero
// (captures, updates, routes, deletes, restores, projections) and converges
// to the same state as the other devices without any manual JSON import.
import { state } from '../js/state.js';
import {
  captureInbox,
  deleteInbox,
  routeInboxToTask,
  undoDeleteInbox,
  updateInbox,
} from '../js/core/commands.js';
import { createSyncEngine } from '../js/sync/engine.js';
import { createSyncRuntime } from '../js/sync/runtime.js';
import { createHttpTransport, claimPairingCode } from '../js/sync/http-transport.js';
import { resetSyncDeviceForTest } from '../js/sync/device.js';
import { getSyncConfig } from '../js/sync/config.js';
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

const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
const DB_PATH = new URL('./fixtures/.sync-c4-test.sqlite', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1');
if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });

const server = createSyncServer({ token: ADMIN_TOKEN, dbPath: DB_PATH });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;

async function pair(store, deviceId, deviceName){
  const codes = await fetch(`${endpoint}/v1/pair/codes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: '{}',
  }).then(r => r.json());
  const claimed = await claimPairingCode(endpoint, { code: codes.code, deviceId, deviceName });
  store.setItem('atlas-sync-token', claimed.token);
  return claimed.token;
}

const makeTransport = store => createHttpTransport({
  endpoint,
  getToken: () => store.getItem('atlas-sync-token'),
});

const storeA = makeStore();
const storeB = makeStore();
await pair(storeA, 'device-c4-a', 'Телефон');
await pair(storeB, 'device-c4-b', 'ПК');

// --- Test 1: device management on the server --------------------------------
{
  const tokenA = storeA.getItem('atlas-sync-token');
  const transportA = createHttpTransport({ endpoint, getToken: () => tokenA });

  const devices = await transportA.listDevices();
  assert(devices.length === 2, 'Test 1a: both paired devices listed');
  assert(devices.some(d => d.deviceId === 'device-c4-a' && d.deviceName === 'Телефон'), 'Test 1b: device name present');
  assert(devices.some(d => d.deviceId === 'device-c4-b'), 'Test 1c: other device visible in the same sync-space');
  assert(devices.every(d => typeof d.lastSeenAt === 'number' && typeof d.deviceName === 'string'), 'Test 1d: metadata complete');

  const renamed = await transportA.renameSelf('Телефон пользователя');
  assert(renamed.deviceName === 'Телефон пользователя', 'Test 1e: rename-self returns the new name');
  const after = await transportA.listDevices();
  assert(after.find(d => d.deviceId === 'device-c4-a').deviceName === 'Телефон пользователя', 'Test 1f: renamed device in the list');

  // Admin revokes device B → it disappears from the list and its token dies
  const revoked = await fetch(`${endpoint}/v1/devices/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'device-c4-b' }),
  });
  assert(revoked.status === 200 && (await revoked.json()).revoked === true, 'Test 1g: admin revoked device B');
  const afterRevoke = await transportA.listDevices();
  assert(afterRevoke.length === 1 && afterRevoke[0].deviceId === 'device-c4-a', 'Test 1h: revoked device removed from the list');

  // A device cannot revoke others (admin-only)
  const forbidden = await fetch(`${endpoint}/v1/devices/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${storeA.getItem('atlas-sync-token')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'device-c4-a' }),
  });
  assert(forbidden.status === 403, 'Test 1i: device cannot revoke others');
  console.log('✓ Test 1: device management (list / rename / admin revoke)');
}

// --- Test 2: bootstrap — a fresh client replays the whole stream --------------
{
  // Re-pair B (revoked above) so it can push again.
  await pair(storeB, 'device-c4-b', 'ПК');
  switchClient(storeA, 'device-c4-a');
  const engineA = createSyncEngine({ transport: makeTransport(storeA), storage: storeA });

  // A builds a meaningful history: capture, route, delete, restore, second capture.
  const created = captureInbox('Первая запись', { deviceId: 'device-c4-a' });
  updateInbox(created[0].id, { itemType: 'task' }, { deviceId: 'device-c4-a' });
  const routed = routeInboxToTask(created[0].id, { deviceId: 'device-c4-a', projectId: 'p1', priority: 3 }); // → processed + resultRef
  const removal = deleteInbox(created[0].id, { deviceId: 'device-c4-a' });
  undoDeleteInbox(removal, { deviceId: 'device-c4-a' });
  const second = captureInbox('Вторая запись', { deviceId: 'device-c4-a' });
  await engineA.sync();

  // A brand-new client C: empty store, pairs, syncs once — must reconstruct
  // everything (capture + update + route + delete + restore + second capture)
  // with the correct final state.
  const storeC = makeStore();
  await pair(storeC, 'device-c4-c', 'Новый планшет');
  switchClient(storeC, 'device-c4-c');
  const engineC = createSyncEngine({ transport: makeTransport(storeC), storage: storeC });
  const c1 = await engineC.sync();
  assert(c1.pulled >= 6, 'Test 2a: fresh client replayed the full stream');

  assert(state.inbox.length === 2, 'Test 2b: both records present (delete was undone)');
  const first = state.inbox.find(item => item.id === created[0].id);
  assert(first && first.status === 'processed' && first.resultRef?.id === routed.task.id, 'Test 2c: routed record reconstructed with resultRef');
  assert(state.tasks.length === 0, 'Test 2d: no Task copy (projection model)');
  assert(state.taskProjections.length === 1, 'Test 2e: the routed result projection arrived');
  assert(state.taskProjections[0].title === 'Первая запись' && state.taskProjections[0].projectTitle === 'Сад', 'Test 2f: projection is human-readable');
  assert(state.inbox.some(item => item.id === second[0].id), 'Test 2g: the second capture arrived');

  // Re-sync is a no-op (no duplicates).
  const cursorBefore = engineC.getStatus().cursor;
  await engineC.sync();
  assert(engineC.getStatus().cursor === cursorBefore && state.inbox.length === 2, 'Test 2h: bootstrap is idempotent');
  console.log('✓ Test 2: fresh device bootstraps the whole stream from zero');
}

// --- Test 3: diagnostics never contain secrets --------------------------------
{
  const store = makeStore();
  store.setItem('atlas-device-id', 'device-c4-diag');
  store.setItem('atlas-sync-config-v1', JSON.stringify({
    endpoint: 'https://atlas.example.test',
    token: 'a'.repeat(48),
    deviceName: 'Диагностика',
    pairedAt: Date.now(),
    protocol: 'atlas-sync-v1',
  }));
  globalThis.localStorage = store;
  resetSyncDeviceForTest();
  const runtime = createSyncRuntime({});
  const diagnostics = runtime.getDiagnostics();
  assert(diagnostics.deviceId === 'device-c4-diag', 'Test 3a: deviceId present');
  assert(diagnostics.endpoint === 'https://atlas.example.test', 'Test 3b: endpoint present');
  assert(diagnostics.appVersion, 'Test 3c: app version present');
  assert(typeof diagnostics.pending === 'number' && typeof diagnostics.conflicts === 'number', 'Test 3d: status counters present');
  const serialized = JSON.stringify(diagnostics);
  assert(!serialized.includes('token') && !serialized.includes('a'.repeat(48)), 'Test 3e: no secrets in diagnostics');
  console.log('✓ Test 3: diagnostics export has no secrets');
}

// --- Test 4: renameSelf updates the persisted config ---------------------------
{
  const store = makeStore();
  const token = await pair(store, 'device-c4-rename', 'Старое имя');
  store.setItem('atlas-sync-config-v1', JSON.stringify({
    endpoint,
    token,
    deviceName: 'Старое имя',
    pairedAt: Date.now(),
    protocol: 'atlas-sync-v1',
  }));
  globalThis.localStorage = store;
  resetSyncDeviceForTest();
  const runtime = createSyncRuntime({});
  const renamed = await runtime.renameSelf('Новое имя');
  assert(renamed.deviceName === 'Новое имя', 'Test 4a: server renamed');
  assert(getSyncConfig().deviceName === 'Новое имя', 'Test 4b: local config updated');
  assert(getSyncConfig().token === store.getItem('atlas-sync-token'), 'Test 4c: token untouched by rename');
  console.log('✓ Test 4: renameSelf persists locally without touching the token');
}

await new Promise(resolve => server.close(resolve));
if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
console.log('\n✅ All Stage C4 sync tests passed.');
