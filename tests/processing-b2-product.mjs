// Stage B2 product pass — focused regression for critical data invariants:
// processed Thought/Note → restore to review, batch routing without dupes,
// sourceInboxId/resultRef correctness, batch failure leaves the queue intact,
// domainHintId patch validation, Capture hint reset on leaving Capture.
import { readFileSync } from 'node:fs';
import { state } from '../js/state.js';
import {
  captureInbox,
  routeInboxToTask,
  updateInbox,
} from '../js/core/commands.js';
import { getInboxItems } from '../js/features/inbox/model.js';

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
  state.domains = [
    { id: 'd1', title: 'Дача' },
    { id: 'd2', title: 'Дом' },
  ];
  state.projects = [
    { id: 'p1', domainId: 'd1', title: 'Сад' },
    { id: 'p2', domainId: 'd1', title: 'Огород' },
  ];
  state.tasks = [];
  state.inbox = [];
  state.operationLog = [];
  state.activeDomain = 'd1';
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

// Test 1: processed Thought/Note and discarded restore to review cleanly
resetState();
const t1 = captureInbox('Мысль для разбора', opts({ itemType: 'thought', userHint: 'thought', domainHintId: 'd1' }));
updateInbox(t1[0].id, { status: 'processed' }, { ...opts(), now: 1100 });
assert(state.inbox[0].status === 'processed', 'Test 1a: thought processed');
const restored1 = updateInbox(t1[0].id, { status: 'reviewed' }, { ...opts(), now: 1200 });
assert(restored1?.item.status === 'reviewed', 'Test 1b: processed thought restores to review');
assert(state.inbox[0].itemType === 'thought', 'Test 1c: itemType preserved');
assert(state.inbox[0].rawText === 'Мысль для разбора', 'Test 1d: rawText preserved');
assert(state.inbox[0].userHint === 'thought' && state.inbox[0].domainHintId === 'd1', 'Test 1e: provenance preserved');

const t1b = captureInbox('Запись на отброс', opts({ itemType: 'note', now: 1300, idFactory: () => 'inbox-disc' }));
updateInbox(t1b[0].id, { status: 'discarded' }, { ...opts(), now: 1400 });
assert(state.inbox[1].status === 'discarded', 'Test 1f: discarded set');
updateInbox(t1b[0].id, { status: 'reviewed' }, { ...opts(), now: 1500 });
assert(state.inbox[1].status === 'reviewed' && state.inbox[1].itemType === 'note', 'Test 1g: discarded restores to review with type kept');
console.log('✓ Test 1: processed/discarded restore to review');

// Test 2: batch routing without duplicates, correct links
resetState();
const b1 = captureInbox('Задача А', opts({ itemType: 'task' }));
const b2 = captureInbox('Задача Б', opts({ itemType: 'task', now: 1001, idFactory: () => 'inbox-b' }));
const b3 = captureInbox('Задача В', opts({ itemType: 'task', now: 1002, idFactory: () => 'inbox-c' }));
const ids = [b1[0].id, b2[0].id, b3[0].id];

let created = 0;
for (const id of ids) {
  routeInboxToTask(id, { projectId: 'p1', priority: 2, now: 2000 + created });
  created += 1;
}
assert(created === 3, 'Test 2a: all three routed');
const routedTasks = state.tasks.filter(task => task.sourceInboxId);
assert(routedTasks.length === 3, 'Test 2b: exactly three routed tasks, no duplicates');
assert(routedTasks.every(task => task.sourceInboxId && state.inbox.some(i => i.id === task.sourceInboxId && i.resultRef?.id === task.id)), 'Test 2c: sourceInboxId ↔ resultRef per record');
assert(state.inbox.length === 3, 'Test 2d: inbox items are not destroyed');
assert(state.inbox.every(i => i.status === 'processed' && i.rawText), 'Test 2e: processed with rawText intact');

// Re-routing an already routed item must throw — the duplicate guard.
let dupError = null;
try {
  routeInboxToTask(b1[0].id, { projectId: 'p1', now: 2100 });
} catch (error) {
  dupError = error;
}
assert(dupError?.message.includes('already has'), 'Test 2f: re-routing is blocked');
assert(state.tasks.filter(task => task.sourceInboxId).length === 3, 'Test 2g: still three tasks after the attempt');
console.log('✓ Test 2: batch routing without duplicates');

// Test 3: batch failure stops and does not corrupt the remaining queue
resetState();
const c1 = captureInbox('Успех 1', opts({ itemType: 'task' }));
const c2 = captureInbox('Успех 2', opts({ itemType: 'task', now: 1001, idFactory: () => 'inbox-c2' }));
const c3 = captureInbox('Сбойная', opts({ itemType: 'task', now: 1002, idFactory: () => 'inbox-c3' }));
const batch = [c1[0].id, c2[0].id, c3[0].id];

let done = 0;
let failure = null;
for (const id of batch) {
  try {
    routeInboxToTask(id, { projectId: done === 1 ? 'p-missing' : 'p1', now: 3000 + done });
    done += 1;
  } catch (error) {
    failure = error;
    break;
  }
}
assert(done === 1, 'Test 3a: first record succeeded, second failed and stopped the batch');
assert(failure?.message.includes('Unknown target project'), 'Test 3b: failure is the destination validation');
const routedNow = state.tasks.filter(task => task.sourceInboxId);
assert(routedNow.length === 1, 'Test 3c: only the successful record has a task');
const inboxState = state.inbox.map(i => ({ id: i.id, status: i.status, resultRef: i.resultRef ?? null }));
assert(inboxState.find(i => i.id === c1[0].id)?.status === 'processed' && inboxState.find(i => i.id === c1[0].id)?.resultRef, 'Test 3d: first record processed with link');
assert(inboxState.find(i => i.id === c2[0].id)?.status === 'new' && inboxState.find(i => i.id === c2[0].id)?.resultRef === null, 'Test 3e: failed record untouched');
assert(inboxState.find(i => i.id === c3[0].id)?.status === 'new', 'Test 3f: remaining queue untouched');
console.log('✓ Test 3: batch failure stops without corrupting the queue');

// Test 4: domainHintId patch validation
resetState();
const d1 = captureInbox('Запись с доменом', opts());
updateInbox(d1[0].id, { domainHintId: 'd2' }, { ...opts(), now: 4000 });
assert(state.inbox[0].domainHintId === 'd2', 'Test 4a: valid domain hint assigned');
updateInbox(d1[0].id, { domainHintId: null }, { ...opts(), now: 4100 });
assert(state.inbox[0].domainHintId === null, 'Test 4b: hint cleared with null');
let badHint = null;
try {
  updateInbox(d1[0].id, { domainHintId: 'd-missing' }, { ...opts(), now: 4200 });
} catch (error) {
  badHint = error;
}
assert(badHint?.message.includes('Unknown domain hint'), 'Test 4c: unknown domain hint rejected');
assert(state.inbox[0].domainHintId === null, 'Test 4d: rejected patch left the record unchanged');
console.log('✓ Test 4: domainHintId patch validation');

// Test 5: Quick Capture hints do not leak into a new capture session
const viewSource = readFileSync(new URL('../js/features/inbox/view.js', import.meta.url), 'utf-8');
assert(
  viewSource.includes('function resetCaptureHints()'),
  'Test 5a: a dedicated hint-reset helper exists'
);
const resetCalls = (viewSource.match(/resetCaptureHints\(\)/g) || []).length;
assert(resetCalls >= 3, `Test 5b: reset is wired in save, leave-to-list and overlay-close paths (got ${resetCalls})`);
assert(
  viewSource.includes("if (currentDialogView === 'capture') resetCaptureHints();"),
  'Test 5c: closing the overlay from Capture clears the hints'
);
console.log('✓ Test 5: Capture hints reset when leaving without saving');

console.log('\n✅ All Stage B2 product-pass tests passed.');
