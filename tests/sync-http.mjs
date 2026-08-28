// Stage C1 — end-to-end over a REAL HTTP transport (no local relay).
//
// Two independent clients (separate localStorage, separate deviceId) talk to a
// live instance of server/sync-server.js through js/sync/http-transport.js
// and the unmodified C0 engine. Proves the Phone ↔ Remote ↔ Desktop loop:
// capture → push → pull+apply → process → push → pull+apply, plus offline
// durability, retry after server restart, idempotency and revocation.
import { state } from '../js/state.js';
import { captureInbox, updateInbox } from '../js/core/commands.js';
import { loadState } from '../js/storage.js';
import { createSyncEngine } from '../js/sync/engine.js';
import { createHttpTransport, claimPairingCode } from '../js/sync/http-transport.js';
import { getPendingOps, listOutbox, enqueueSyncOperation } from '../js/sync/outbox.js';
import { resetSyncDeviceForTest } from '../js/sync/device.js';
import { createSyncServer } from '../server/sync-server.js';
import { existsSync, rmSync } from 'node:fs';

const DB_PATH = new URL('./fixtures/.sync-http-test.sqlite', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1');

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
  state.domains = [{ id: 'd1', title: 'Дача' }];
  state.projects = [{ id: 'p1', domainId: 'd1', title: 'Сад' }];
  state.tasks = [];
  state.inbox = [];
  state.operationLog = [];
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

const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
let server = createSyncServer({ token: ADMIN_TOKEN, dbPath: DB_PATH });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;

function makeTransport(store){
  return createHttpTransport({
    endpoint,
    getToken: () => store.getItem('atlas-sync-token'),
  });
}

async function pair(store, deviceId, deviceName){
  const codes = await fetch(`${endpoint}/v1/pair/codes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: '{}',
  }).then(r => r.json());
  const claimed = await claimPairingCode(endpoint, {
    code: codes.code,
    deviceId,
    deviceName,
  });
  store.setItem('atlas-sync-token', claimed.token);
  return claimed.token;
}

const storeA = makeStore();
const storeB = makeStore();
const tokenA = await pair(storeA, 'device-e2e-a', 'Phone A');
const tokenB = await pair(storeB, 'device-e2e-b', 'Desktop B');
assert(tokenA && tokenB, 'setup: both clients paired');

// --- Test 1: full Phone → Remote → Desktop round trip ----------------------
{
  switchClient(storeA, 'device-e2e-a');
  storeA.setItem('atlas-sync-token', tokenA);
  const engineA = createSyncEngine({ transport: makeTransport(storeA), storage: storeA });

  const created = captureInbox('Купить удобрение для сливы', { deviceId: 'device-e2e-a', userHint: 'task', domainHintId: 'd1' });
  const inboxId = created[0].id;
  assert(getPendingOps().length === 1, 'Test 1a: A outbox has the capture op');

  const a1 = await engineA.sync();
  assert(a1.pushed === 1 && getPendingOps().length === 0, 'Test 1b: A pushed and acked the capture op');

  // B (desktop) pulls and applies it
  switchClient(storeB, 'device-e2e-b');
  storeB.setItem('atlas-sync-token', tokenB);
  const engineB = createSyncEngine({ transport: makeTransport(storeB), storage: storeB });
  const b1 = await engineB.sync();
  assert(b1.pulled === 1, 'Test 1c: B pulled the capture op');
  assert(state.inbox.length === 1 && state.inbox[0].id === inboxId, 'Test 1d: B applied the item once');
  assert(state.inbox[0].rawText === 'Купить удобрение для сливы' && state.inbox[0].domainHintId === 'd1', 'Test 1e: rawText + hints survived the wire');

  // B processes it → result goes back to the remote
  updateInbox(inboxId, { status: 'processed', itemType: 'task' }, { deviceId: 'device-e2e-b' });
  const b2 = await engineB.sync();
  assert(b2.pushed === 1, 'Test 1f: B pushed the update op');

  // A pulls the new state
  switchClient(storeA, 'device-e2e-a');
  storeA.setItem('atlas-sync-token', tokenA);
  const engineA2 = createSyncEngine({ transport: makeTransport(storeA), storage: storeA });
  const a2 = await engineA2.sync();
  assert(a2.pulled === 1, 'Test 1g: A pulled the update op');
  assert(state.inbox[0].status === 'processed' && state.inbox[0].itemType === 'task', 'Test 1h: A sees the processed result');

  // Idempotent re-sync: no duplicates, cursor stable
  const cursorBefore = engineA2.getStatus().cursor;
  await engineA2.sync();
  assert(engineA2.getStatus().cursor === cursorBefore, 'Test 1i: cursor stable after re-sync');
  assert(state.inbox.length === 1, 'Test 1j: no duplicates after re-sync');
  console.log('✓ Test 1: Phone → Remote → Desktop → Remote → Phone round trip');
}

// --- Test 2: offline-first — server down, capture, retry after restart -----
{
  switchClient(storeA, 'device-e2e-a');
  storeA.setItem('atlas-sync-token', tokenA);
  const engineA = createSyncEngine({ transport: makeTransport(storeA), storage: storeA });

  captureInbox('Офлайн-запись не потеряется', { deviceId: 'device-e2e-a' });
  assert(getPendingOps().length === 1, 'Test 2a: capture stored locally while "offline"');

  const PORT = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const failed = await engineA.sync();
  assert(failed.failed === 1 && getPendingOps().length === 1, 'Test 2b: sync failure keeps the op durable in the outbox');
  assert(engineA.getStatus().lastError, 'Test 2c: lastError visible in status');

  // The server "restarts": a fresh process instance, same port, same file DB.
  server = createSyncServer({ token: ADMIN_TOKEN, dbPath: DB_PATH });
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  const retried = await engineA.sync();
  assert(retried.pushed === 1 && getPendingOps().length === 0, 'Test 2d: retry after server restart delivers the op');
  console.log('✓ Test 2: offline-first + retry after server restart');
}

// --- Test 3: revocation — token rejected, authFailed surfaced --------------
{
  switchClient(storeB, 'device-e2e-b');
  storeB.setItem('atlas-sync-token', tokenB);
  const transportB = makeTransport(storeB);
  const engineB = createSyncEngine({ transport: transportB, storage: storeB });

  // Revoke B's device credential server-side (simulates revoke from the UI)
  const revoked = await fetch(`${endpoint}/v1/devices/revoke-self`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert(revoked.status === 200, 'Test 3a: device revoked');

  captureInbox('Запись после отзыва', { deviceId: 'device-e2e-b' });
  const result = await engineB.sync();
  assert(result.failed === 1, 'Test 3b: push fails after revocation');
  assert(engineB.getStatus().authFailed === true, 'Test 3c: authFailed surfaced for the UI (re-pair needed)');
  assert(getPendingOps().length === 1, 'Test 3d: op remains durable, not lost');

  // Re-pairing (same deviceId) issues a fresh token that works again
  const codes = await fetch(`${endpoint}/v1/pair/codes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: '{}',
  }).then(r => r.json());
  const rePair = await claimPairingCode(endpoint, { code: codes.code, deviceId: 'device-e2e-b', deviceName: 'Desktop B' });
  storeB.setItem('atlas-sync-token', rePair.token);
  const engineB2 = createSyncEngine({ transport: makeTransport(storeB), storage: storeB });
  const again = await engineB2.sync();
  assert(again.pushed === 1, 'Test 3e: re-paired device delivers the pending op');
  assert(engineB2.getStatus().authFailed === false, 'Test 3f: authFailed cleared after re-pair');
  console.log('✓ Test 3: revocation + re-pair recovery');
}

// --- Test 4 (W1): failed outbox entries recover once the network is back -----
// A long outage exhausts MAX_ATTEMPTS → entries become `failed`. They must NOT
// stay stuck forever: the first successful sync cycle re-promotes and
// delivers them (offline → retry → online promise).
{
  switchClient(storeA, 'device-e2e-a');
  storeA.setItem('atlas-sync-token', tokenA);
  captureInbox('Запись из долгого офлайна', { deviceId: 'device-e2e-a' });
  assert(getPendingOps().length === 1, 'Test 4a: capture queued');

  // A transport that is always down: every attempt fails and increments the
  // counter until the entry reaches `failed`.
  const deadTransport = {
    pushOperations: async () => { throw Object.assign(new Error('network down'), { code: 'network' }); },
    pullOperations: async () => { throw Object.assign(new Error('network down'), { code: 'network' }); },
    acknowledge: async () => {},
  };
  const engine = createSyncEngine({ transport: deadTransport, storage: storeA });
  for (let i = 0; i < 5; i += 1) {
    const result = await engine.sync();
    assert(result.failed === 1, `Test 4b: attempt ${i + 1} fails`);
  }
  assert(engine.getStatus().failed === 1, 'Test 4c: entry exhausted MAX_ATTEMPTS and is failed');
  assert(getPendingOps().length === 0, 'Test 4d: failed entries are not pending');

  // Network returns: the real transport (live server) — the same engine
  // delivers the previously failed op in one cycle.
  const liveEngine = createSyncEngine({ transport: makeTransport(storeA), storage: storeA });
  const recovered = await liveEngine.sync();
  assert(recovered.pushed === 1 && getPendingOps().length === 0, 'Test 4e: failed entry re-promoted and delivered');
  assert(liveEngine.getStatus().failed === 0, 'Test 4f: no failed entries remain');
  console.log('✓ Test 4: failed outbox entries recover after the network returns');
}

// --- Test 5 (P1 review): server-rejected ops are terminal, never retried -----
// The server refuses a malformed operation with a per-op conflict. The client
// must move it to a terminal `rejected` state (visible in status), and later
// successful cycles must NEVER resurrect it — otherwise an invalid operation
// would loop forever between retryable/failed/promoteFailed.
{
  switchClient(storeA, 'device-e2e-a');
  storeA.setItem('atlas-sync-token', tokenA);
  const engine = createSyncEngine({ transport: makeTransport(storeA), storage: storeA });

  // A hand-built envelope the server cannot accept: unknown type → invalid_operation.
  enqueueSyncOperation({
    id: 'op-rejected-1', deviceId: 'device-e2e-a', sequence: 900, timestamp: Date.now(),
    type: 'task.wild', entityType: 'task', entityId: 'task-1',
    payload: { id: 'task-1', title: 'никогда не будет принята' },
  });
  assert(getPendingOps().length === 1, 'Test 5a: malformed op queued');

  const result = await engine.sync();
  assert(result.pushed === 1 && result.acked === 0 && result.rejected === 1, 'Test 5b: attempted once, not acked, marked rejected');
  const status = engine.getStatus();
  assert(status.rejected === 1, `Test 5c: malformed op moved to terminal rejected (got ${status.rejected})`);
  assert(status.pending === 0 && status.failed === 0, 'Test 5d: rejected is neither pending nor failed');
  assert(getPendingOps().length === 0, 'Test 5e: rejected is not pending');

  // Several successful cycles must NOT resurrect the rejected entry.
  captureInbox('Нормальная запись', { deviceId: 'device-e2e-a' });
  const first = await engine.sync();
  assert(first.pushed === 1 && first.rejected === 0, 'Test 5f: the healthy op is delivered');
  for (let i = 0; i < 2; i += 1) {
    const cycle = await engine.sync();
    assert(cycle.pushed === 0 && !cycle.failed, `Test 5g: cycle ${i + 2} is clean (no retries of the rejected op)`);
  }
  const after = engine.getStatus();
  assert(after.rejected === 1, 'Test 5h: rejected entry stays terminal across healthy cycles');
  assert(after.pending === 0 && after.failed === 0, 'Test 5i: rejected never re-enters the delivery pipeline');
  const entry = listOutbox().find(item => item.operation.id === 'op-rejected-1');
  assert(entry && entry.syncStatus === 'rejected' && typeof entry.lastError === 'string', 'Test 5j: server reason surfaced on the entry (no payload required)');
  console.log('✓ Test 5: server-rejected ops are terminal and never retried');
}

await new Promise(resolve => server.close(resolve));
if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
console.log('\n✅ All Stage C1 HTTP end-to-end tests passed.');
