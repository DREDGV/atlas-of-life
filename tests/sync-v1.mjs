// Stage C0 — Sync v1 Foundation regression tests.
// Covers: operation creation, durable outbox survives reload, stable deviceId,
// sequence monotonicity, duplicate applies once, retry/relay dedupe, cursor
// no-regress, remote apply of Inbox create/processed/discarded/resultRef,
// rawText preservation, invalid op safety, baseVersion conflict, and the full
// two-client Inbox vertical slice over a dev relay.
import { state } from '../js/state.js';
import {
  captureInbox,
  updateInbox,
} from '../js/core/commands.js';
import { applyIncomingOperation } from '../js/sync/apply.js';
import { createLocalRelay } from '../js/sync/relay.js';
import { createSyncEngine } from '../js/sync/engine.js';
import {
  enqueueSyncOperation,
  listOutbox,
  getPendingOps,
  markAcked,
  updateOutboxEntry,
} from '../js/sync/outbox.js';
import {
  getSyncDeviceId,
  nextDeviceSequence,
  resetSyncDeviceForTest,
} from '../js/sync/device.js';

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
    raw() { return Object.fromEntries(map); },
  };
}

function resetState(){
  state.domains = [{ id: 'd1', title: 'Дача' }, { id: 'd2', title: 'Дом' }];
  state.projects = [{ id: 'p1', domainId: 'd1', title: 'Сад' }];
  state.tasks = [];
  state.inbox = [];
  state.operationLog = [];
  state.activeDomain = 'd1';
  state.settings = { layoutMode: 'auto' };
  state.maxEdges = 300;
}

function switchClient(store){
  globalThis.localStorage = store;
  resetSyncDeviceForTest();
  resetState();
}

const storeA = makeStore({ 'atlas-device-id': 'device-A' });
const storeB = makeStore({ 'atlas-device-id': 'device-B' });
const relayData = { ops: [], nextSeq: 1 };
const transport = createLocalRelay({
  storage: { get: () => relayData, set: (d) => { relayData.ops = d.ops; relayData.nextSeq = d.nextSeq; } },
});

// Test 1: stable deviceId + monotonic sequence
{
  const store = makeStore({ 'atlas-device-id': 'device-T' });
  switchClient(store);
  const a = getSyncDeviceId();
  const b = getSyncDeviceId();
  assert(a === b && a === 'device-T', 'Test 1a: deviceId stable and persisted');
  const s1 = nextDeviceSequence();
  const s2 = nextDeviceSequence();
  const s3 = nextDeviceSequence();
  assert(s1 === 1 && s2 === 2 && s3 === 3, 'Test 1b: sequence monotonic');
  console.log('✓ Test 1: stable deviceId + monotonic sequence');
}

// Test 2: operation creation in outbox + survives reload + ack removes
{
  const store = makeStore();
  switchClient(store);
  const op = { id: 'op-o1', deviceId: 'device-T', timestamp: 1000, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-1', payload: { rawText: 'x' } };
  enqueueSyncOperation(op);
  const pending = getPendingOps();
  assert(pending.length === 1, 'Test 2a: enqueued as pending');
  assert(pending[0].operation.id === 'op-o1' && pending[0].operation.sequence === 1, 'Test 2b: entry has operation + sequence');
  assert(pending[0].syncStatus === 'pending' && !('syncStatus' in pending[0].operation), 'Test 2c: delivery state lives on the entry, not the envelope');
  assert(listOutbox().length === 1, 'Test 2d: persists (listOutbox reads durable store)');
  markAcked('op-o1');
  assert(getPendingOps().length === 0 && listOutbox().length === 0, 'Test 2e: ack removes entry');
  console.log('✓ Test 2: outbox create/persist/ack + envelope split');
}

// Test 3: duplicate operation applies exactly once (idempotency)
{
  const store = makeStore();
  switchClient(store);
  const op = { id: 'op-dup', deviceId: 'device-X', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-d', payload: { id: 'inbox-d', rawText: 'Мысль', status: 'new' } };
  const r1 = applyIncomingOperation(op);
  assert(r1.applied === true, 'Test 3a: first apply applies');
  const r2 = applyIncomingOperation(op);
  assert(r2.deduped === true, 'Test 3b: second apply deduped');
  assert(state.inbox.length === 1, 'Test 3c: exactly one inbox item');
  console.log('✓ Test 3: duplicate applies once');
}

// Test 4: remote apply preserves rawText + provenance + hints
{
  const store = makeStore();
  switchClient(store);
  const op = { id: 'op-cap', deviceId: 'device-X', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-cap', payload: { id: 'inbox-cap', rawText: '  Купить удобрение  ', userHint: 'task', domainHintId: 'd1', inputType: 'voice', source: 'mobile-capture', entryPoint: 'share', status: 'new', createdAt: 1234 } };
  applyIncomingOperation(op);
  const item = state.inbox[0];
  assert(item.rawText === '  Купить удобрение  ', 'Test 4a: rawText preserved');
  assert(item.userHint === 'task' && item.domainHintId === 'd1', 'Test 4b: hints preserved');
  assert(item.inputType === 'voice' && item.source === 'mobile-capture' && item.entryPoint === 'share', 'Test 4c: provenance preserved');
  assert(item.id === 'inbox-cap', 'Test 4d: original id preserved');
  console.log('✓ Test 4: rawText/provenance/hints survive remote create');
}

// Test 5: processed / discarded remote apply (inbox.update)
{
  const store = makeStore();
  switchClient(store);
  applyIncomingOperation({ id: 'op-c1', deviceId: 'device-X', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-u', payload: { id: 'inbox-u', rawText: 'Запись', status: 'new', createdAt: 100 } });
  const item = state.inbox[0];
  applyIncomingOperation({ id: 'op-u1', deviceId: 'device-X', timestamp: 2, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-u', baseVersion: item.updatedAt, payload: { after: { id: 'inbox-u', itemType: 'thought', status: 'processed', updatedAt: 200 } } });
  assert(state.inbox[0].status === 'processed' && state.inbox[0].itemType === 'thought', 'Test 5a: processed apply');
  applyIncomingOperation({ id: 'op-u2', deviceId: 'device-X', timestamp: 3, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-u', baseVersion: state.inbox[0].updatedAt, payload: { after: { id: 'inbox-u', status: 'discarded', updatedAt: 300 } } });
  assert(state.inbox[0].status === 'discarded', 'Test 5b: discarded apply');
  console.log('✓ Test 5: processed/discarded remote apply');
}

// Test 6: resultRef survives (route_to_task / route_revert apply)
{
  const store = makeStore();
  switchClient(store);
  applyIncomingOperation({ id: 'op-c2', deviceId: 'device-X', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-r', payload: { id: 'inbox-r', rawText: 'Задача', itemType: 'task', status: 'new', createdAt: 100 } });
  applyIncomingOperation({ id: 'op-r1', deviceId: 'device-X', timestamp: 2, type: 'inbox.route_to_task', entityType: 'inbox', entityId: 'inbox-r', payload: { inboxAfter: { id: 'inbox-r', status: 'processed', resultRef: { type: 'task', id: 'task-9' }, updatedAt: 200 } } });
  assert(state.inbox[0].status === 'processed' && state.inbox[0].resultRef?.id === 'task-9', 'Test 6a: resultRef applied as reference');
  assert(state.tasks.length === 0, 'Test 6b: Task itself not synced in C0');
  applyIncomingOperation({ id: 'op-r2', deviceId: 'device-X', timestamp: 3, type: 'inbox.route_revert', entityType: 'inbox', entityId: 'inbox-r', payload: { inboxAfter: { id: 'inbox-r', status: 'reviewed', updatedAt: 300 } } });
  assert(state.inbox[0].status === 'reviewed' && !state.inbox[0].resultRef, 'Test 6c: revert clears resultRef');
  console.log('✓ Test 6: resultRef survives + revert');
}

// Test 7: update for an unknown record does not corrupt state — C3 classifies
// it as a deleted_race conflict instead of throwing (a real multi-device
// collision: the record was deleted locally while the remote still edited it).
{
  const store = makeStore();
  switchClient(store);
  applyIncomingOperation({ id: 'op-c3', deviceId: 'device-X', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-v', payload: { id: 'inbox-v', rawText: 'Целая запись', status: 'new' } });
  const before = JSON.stringify(state.inbox);
  const result = applyIncomingOperation({ id: 'op-bad', deviceId: 'device-X', timestamp: 2, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-missing', payload: { after: { id: 'inbox-missing', status: 'processed' } } });
  assert(result.conflict === true && result.conflictStatus === 'deleted_race', 'Test 7a: unknown-record update reported as deleted_race conflict');
  assert(JSON.stringify(state.inbox) === before, 'Test 7b: state unchanged');
  console.log('✓ Test 7: deleted-race update does not corrupt state');
}

// Test 8: baseVersion conflict → detect + refuse (no silent last-write-wins)
{
  const store = makeStore();
  switchClient(store);
  applyIncomingOperation({ id: 'op-c4', deviceId: 'device-X', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-cf', payload: { id: 'inbox-cf', rawText: 'Запись', status: 'new', createdAt: 1000 } });
  const item = state.inbox[0];
  item.updatedAt = 5000; // local state moved ahead
  const r = applyIncomingOperation({ id: 'op-cf', deviceId: 'device-X', timestamp: 2, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-cf', baseVersion: 1000, payload: { after: { id: 'inbox-cf', status: 'processed', updatedAt: 2000 } } });
  assert(r.conflict === true, 'Test 8a: conflict detected');
  assert(state.inbox[0].status === 'new', 'Test 8b: local state not clobbered');
  console.log('✓ Test 8: baseVersion conflict refuses silently');
}

// Test 9: full two-client Inbox vertical slice over the dev relay.
// A captures → B applies once and processes → a fresh client C reconstructs
// the full result (capture + update) exactly once. Proves create→op→transport
// →apply→process→op→transport→apply with durable outbox, dedupe and cursor.
{
  const storeC = makeStore({ 'atlas-device-id': 'device-C' });

  // A: create + push
  switchClient(storeA);
  const created = captureInbox('Купить удобрение для сливы', { deviceId: 'device-A', userHint: 'task', domainHintId: 'd1' });
  const inboxId = created[0].id;
  assert(getPendingOps().length === 1, 'Test 9a: A has a pending outbox op');
  const engineA = createSyncEngine({ transport, storage: storeA });
  const a1 = await engineA.sync();
  assert(a1.pushed === 1 && relayData.ops.length === 1, 'Test 9b: A pushed its op to the relay');

  // B: pull + apply once, then process
  switchClient(storeB);
  const engineB = createSyncEngine({ transport, storage: storeB });
  await engineB.sync();
  assert(state.inbox.length === 1 && state.inbox[0].id === inboxId, 'Test 9c: B applied the item once');
  assert(state.inbox[0].rawText === 'Купить удобрение для сливы' && state.inbox[0].domainHintId === 'd1', 'Test 9d: rawText + hints survived on B');
  updateInbox(inboxId, { status: 'processed' }, { deviceId: 'device-B' });
  await engineB.sync();
  assert(relayData.ops.length === 2, 'Test 9e: relay holds capture + update ops');

  // C: a fresh client reconstructs the full result exactly once
  switchClient(storeC);
  const engineC = createSyncEngine({ transport, storage: storeC });
  const c1 = await engineC.sync();
  assert(c1.pulled >= 2, 'Test 9f: C pulled both ops');
  assert(state.inbox.length === 1, 'Test 9g: exactly one item reconstructed');
  const item = state.inbox[0];
  assert(item.id === inboxId && item.status === 'processed', 'Test 9h: C sees the processed result');
  assert(item.rawText === 'Купить удобрение для сливы' && item.domainHintId === 'd1', 'Test 9i: rawText + hints survived replay');

  // Cursor does not regress; re-sync is a no-op (no duplicate)
  const cursorBefore = engineC.getStatus().cursor;
  await engineC.sync();
  assert(engineC.getStatus().cursor === cursorBefore, 'Test 9j: cursor stable, no regress');
  assert(state.inbox.length === 1, 'Test 9k: no duplicate after re-sync');
  console.log('✓ Test 9: Inbox vertical slice (create → process → replay)');
}

// Test 10 (blocker A): outbox is durable — no silent cap, no swallowed writes
{
  const store = makeStore();
  switchClient(store);
  for (let i = 0; i < 5; i += 1) {
    enqueueSyncOperation({ id: `op-a${i}`, deviceId: 'device-X', timestamp: i, type: 'inbox.capture', entityType: 'inbox', entityId: `inbox-a${i}`, payload: { rawText: 'x' } });
  }
  assert(listOutbox().length === 5, 'Test 10a: unacked ops are never dropped for a size cap');
  const originalSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = function (key, value) {
    if (key === 'atlas-sync-outbox-v1') { throw new Error('quota'); }
    return originalSet.call(this, key, value);
  };
  let threw = null;
  try {
    enqueueSyncOperation({ id: 'op-bad', deviceId: 'device-X', timestamp: 9, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-bad', payload: { rawText: 'y' } });
  } catch (error) { threw = error; }
  globalThis.localStorage.setItem = originalSet;
  assert(threw !== null, 'Test 10b: outbox write failure is not swallowed as success');
  assert(listOutbox().length === 5, 'Test 10c: failed enqueue left no half-applied entry');
  console.log('✓ Test 10: outbox durability (no silent loss)');
}

// Test 11 (blocker B): recovery of sent / awaiting_ack + partial ack
{
  const store = makeStore();
  switchClient(store);
  enqueueSyncOperation({ id: 'op-s1', deviceId: 'device-X', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-s1', payload: { rawText: 'x' } });
  // Simulate a crash after send, before ack: the entry is stuck in `sent`.
  updateOutboxEntry('op-s1', { syncStatus: 'sent' });
  assert(getPendingOps().length === 0, 'Test 11a: sent is not eligible while awaiting ack');

  // crash + restart: recovery turns unacked sent back into retryable
  const noAckTransport = {
    pushOperations: async () => ({ ackedIds: [] }),
    pullOperations: async () => ({ operations: [], newCursor: 0 }),
    acknowledge: async () => {},
  };
  const engine2 = createSyncEngine({ transport: noAckTransport, storage: store });
  assert(getPendingOps().length === 1 && getPendingOps()[0].syncStatus === 'retryable', 'Test 11b: crash recovery sent → retryable');

  // A push that returns no ack leaves the op retryable (no permanently stuck sent)
  await engine2.sync();
  assert(getPendingOps().length === 1 && getPendingOps()[0].syncStatus === 'retryable', 'Test 11c: unacked after push stays retryable');

  // partial ack: only acknowledged ops are removed, the rest stay retryable
  enqueueSyncOperation({ id: 'op-s2', deviceId: 'device-X', timestamp: 2, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-s2', payload: { rawText: 'y' } });
  const partialTransport = {
    pushOperations: async (ops) => ({ ackedIds: [ops[0].id] }),
    pullOperations: async () => ({ operations: [], newCursor: 0 }),
    acknowledge: async () => {},
  };
  const engine3 = createSyncEngine({ transport: partialTransport, storage: store });
  await engine3.sync();
  const remaining = listOutbox();
  assert(remaining.length === 1 && remaining[0].operation.id === 'op-s2', 'Test 11d: only the acked op was removed');
  assert(remaining[0].syncStatus === 'retryable', 'Test 11e: unacked partial-batch op is retryable');
  console.log('✓ Test 11: sent recovery + partial ack');
}

// Test 12 (blocker C): conflict/invalid operations are durably quarantined
{
  const store = makeStore({ 'atlas-device-id': 'device-C1' });
  switchClient(store);
  applyIncomingOperation({ id: 'op-seed', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-cq', payload: { id: 'inbox-cq', rawText: 'Запись', status: 'new', createdAt: 1000 } });
  state.inbox[0].updatedAt = 9999; // local moved ahead of the incoming update

  const relay = createLocalRelay({
    storage: {
      get: () => ({
        ops: [{ serverSequence: 1, operation: { id: 'op-conf', deviceId: 'remote', timestamp: 2, type: 'inbox.update', entityType: 'inbox', entityId: 'inbox-cq', baseVersion: 1000, payload: { after: { id: 'inbox-cq', status: 'processed', updatedAt: 2000 } } } }],
        nextSeq: 2,
      }),
      set: () => {},
    },
  });
  const engine = createSyncEngine({ transport: relay, storage: store });
  await engine.sync();
  assert(engine.getStatus().conflicts >= 1, 'Test 12a: conflict counted');
  assert(engine.getStatus().cursor === 1, 'Test 12b: cursor advanced past the conflict');
  assert(state.inbox[0].status === 'new', 'Test 12c: local state not clobbered');
  const conflicts = engine.getConflicts();
  assert(conflicts.length >= 1 && conflicts[0].status === 'conflict', 'Test 12d: conflict durably quarantined');
  const engine2 = createSyncEngine({ transport: relay, storage: store });
  assert(engine2.getConflicts().length >= 1, 'Test 12e: quarantine survives reload');
  console.log('✓ Test 12: durable conflict quarantine');
}

// Test 13 (blocker D): remote apply through Core — no echo, atomic rollback
{
  const store = makeStore();
  switchClient(store);
  applyIncomingOperation({ id: 'op-cr', deviceId: 'remote', timestamp: 1, type: 'inbox.capture', entityType: 'inbox', entityId: 'inbox-dr', payload: { id: 'inbox-dr', rawText: 'Задача', itemType: 'task', status: 'new', createdAt: 100 } });
  assert(listOutbox().length === 0, 'Test 13a: remote create produced no outbound op');
  applyIncomingOperation({ id: 'op-route', deviceId: 'remote', timestamp: 2, type: 'inbox.route_to_task', entityType: 'inbox', entityId: 'inbox-dr', payload: { inboxAfter: { id: 'inbox-dr', status: 'processed', resultRef: { type: 'task', id: 'task-r' }, updatedAt: 200 } } });
  assert(state.inbox[0].resultRef?.id === 'task-r' && state.inbox[0].status === 'processed', 'Test 13b: route applied through Core');
  assert(listOutbox().length === 0, 'Test 13c: route apply did not echo an outbound op');

  const originalSet = globalThis.localStorage.setItem;
  const savedWarn = console.warn;
  console.warn = () => {}; // saveState failure logging must not leak to stderr (CI/PS)
  globalThis.localStorage.setItem = function (key, value) {
    if (key === 'atlas_v2_data') { const e = new Error('Quota'); e.name = 'QuotaExceededError'; throw e; }
    return originalSet.call(this, key, value);
  };
  let threw = null;
  try {
    applyIncomingOperation({ id: 'op-revert', deviceId: 'remote', timestamp: 3, type: 'inbox.route_revert', entityType: 'inbox', entityId: 'inbox-dr', payload: { inboxAfter: { id: 'inbox-dr', status: 'reviewed', updatedAt: 300 } } });
  } catch (error) { threw = error; }
  globalThis.localStorage.setItem = originalSet;
  console.warn = savedWarn;
  assert(threw !== null, 'Test 13d: saveState failure propagates');
  assert(state.inbox[0].resultRef?.id === 'task-r' && state.inbox[0].status === 'processed', 'Test 13e: atomic rollback — revert did not partially apply');
  console.log('✓ Test 13: Core remote apply (no echo, atomic rollback)');
}

// Test 14 (blocker E): envelope normalization in the outbound path
{
  const store = makeStore();
  switchClient(store);
  const created = captureInbox('Тест envelope', { deviceId: 'device-X' });
  assert(created.length === 1, 'Test 14a: op created');
  const pending = getPendingOps();
  assert(pending.length === 1, 'Test 14b: op enqueued');
  const op = pending[0].operation;
  assert(typeof op.sequence === 'number' && op.sequence >= 1, 'Test 14c: sequence is part of the outbound operation');
  assert(!('syncStatus' in op), 'Test 14d: syncStatus is NOT part of the operation envelope');
  assert(pending[0].syncStatus === 'pending', 'Test 14e: delivery state lives on the outbox entry');
  console.log('✓ Test 14: envelope split (sequence in op, delivery state on entry)');
}

console.log('\n✅ All Stage C0 sync tests passed.');
