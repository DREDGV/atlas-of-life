// Stage B1 — Processing Routing regression tests (focused block).
// Covers: safe Inbox→Task routing, bidirectional source/result links,
// repeat-creation guard, revert, and atomic rollback on save failure.
import { state } from '../js/state.js';
import {
  captureInbox,
  revertInboxRoute,
  routeInboxToTask,
} from '../js/core/commands.js';
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
  state.domains = [
    { id: 'd1', title: 'Дача' },
    { id: 'd2', title: 'Дом' },
  ];
  state.projects = [
    { id: 'p1', domainId: 'd1', title: 'Сад' },
    { id: 'p2', domainId: 'd1', title: 'Огород' },
    { id: 'p3', domainId: 'd2', title: 'Домашние дела' },
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

// Test 1: safe routing creates a Task and links both directions
resetState();
const captured = captureInbox('Купить удобрение для сливы', opts({ itemType: 'task' }));
const item = captured[0];
const result = routeInboxToTask(item.id, {
  projectId: 'p1',
  priority: 3,
  due: { date: '2026-08-22', time: '18:00' },
  taskId: 'task-b1-1',
  now: 1100,
});
assert(result.task.id === 'task-b1-1', 'Test 1a: task created with requested id');
assert(result.task.projectId === 'p1', 'Test 1b: task belongs to the chosen project');
assert(result.task.priority === 3, 'Test 1c: priority stored as the numeric 1..4 scale');
assert(result.task.due.date === '2026-08-22' && result.task.due.time === '18:00', 'Test 1d: due stored structured');
assert(result.task.sourceInboxId === item.id, 'Test 1e: Task.sourceInboxId points back');
assert(state.inbox.length === 1, 'Test 1f: source Inbox item is not destroyed');
assert(state.inbox[0].status === 'processed', 'Test 1g: Inbox status becomes processed');
assert(state.inbox[0].resultRef.type === 'task' && state.inbox[0].resultRef.id === 'task-b1-1', 'Test 1h: Inbox.resultRef links to the task');
assert(state.inbox[0].rawText === 'Купить удобрение для сливы', 'Test 1i: rawText unchanged');
assert(state.operationLog.at(-1).type === 'inbox.route_to_task', 'Test 1j: routing is journaled');
console.log('✓ Test 1: routing creates Task and links both directions');

// Test 2: repeat creation is blocked
let dupError = null;
try {
  routeInboxToTask(item.id, { projectId: 'p1', now: 1200 });
} catch (error) {
  dupError = error;
}
assert(dupError?.message.includes('already has'), 'Test 2a: second routing must throw');
assert(state.tasks.length === 1, 'Test 2b: no second Task is created');
assert(state.operationLog.filter(op => op.type === 'inbox.route_to_task').length === 1, 'Test 2c: only one routing operation');
console.log('✓ Test 2: repeat creation is blocked');

// Test 3: revert removes the linked Task and returns the item to review
const reverted = revertInboxRoute(item.id, { now: 1300 });
assert(reverted?.task?.id === 'task-b1-1', 'Test 3a: revert returns the removed Task');
assert(state.tasks.length === 0, 'Test 3b: linked Task is deleted');
assert(!state.inbox[0].resultRef, 'Test 3c: resultRef is cleared');
assert(state.inbox[0].status === 'reviewed', 'Test 3d: Inbox returns to reviewed');
console.log('✓ Test 3: revert removes linked Task and returns item to review');

// Test 4: revert refuses a Task not linked to this Inbox item
resetState();
const captured2 = captureInbox('Вторая запись', opts({ itemType: 'task' }));
const routed2 = routeInboxToTask(captured2[0].id, {
  projectId: 'p1',
  taskId: 'task-b1-2',
  now: 1400,
});
routed2.task.sourceInboxId = 'inbox-other'; // simulate a tampered link
let mismatch = null;
try {
  revertInboxRoute(captured2[0].id, { now: 1500 });
} catch (error) {
  mismatch = error;
}
assert(mismatch?.message.includes('not linked'), 'Test 4a: mismatched link must throw');
assert(state.tasks.some(task => task.id === 'task-b1-2'), 'Test 4b: Task is preserved');
assert(state.inbox[0].resultRef, 'Test 4c: resultRef is preserved');
console.log('✓ Test 4: revert refuses an unlinked Task');

// Test 5: atomic rollback when persistence fails
resetState();
const captured3 = captureInbox('До сбоя', opts({ itemType: 'task', persist: true, now: 2000 }));
const jsonBefore = memory.get(adapter.key);
const inboxBefore = JSON.stringify(state.inbox);
const tasksBefore = JSON.stringify(state.tasks);
const logBefore = JSON.stringify(state.operationLog);

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

let thrown = null;
try {
  routeInboxToTask(captured3[0].id, {
    projectId: 'p1',
    taskId: 'task-b1-3',
    persist: true,
    now: 2100,
  });
} catch (error) {
  thrown = error;
}

globalThis.localStorage.setItem = originalSetItem;
console.warn = savedWarn;

assert(thrown?.name === 'QuotaExceededError', 'Test 5a: storage error must be rethrown');
assert(JSON.stringify(state.tasks) === tasksBefore, 'Test 5b: no Task after rollback');
assert(JSON.stringify(state.inbox) === inboxBefore, 'Test 5c: Inbox unchanged after rollback');
assert(JSON.stringify(state.operationLog) === logBefore, 'Test 5d: operation log unchanged after rollback');
assert(memory.get(adapter.key) === jsonBefore, 'Test 5e: durable JSON byte-identical after rollback');
console.log('✓ Test 5: atomic rollback on save failure');

// Test 6: domain-only routing, due normalization, priority default
resetState();
const captured4 = captureInbox('Без проекта', opts({ itemType: 'task' }));
const routed4 = routeInboxToTask(captured4[0].id, {
  domainId: 'd2',
  due: { date: '2026-08-22' },
  taskId: 'task-b1-4',
  now: 2200,
});
assert(routed4.task.domainId === 'd2' && routed4.task.projectId === null, 'Test 6a: domain-only routing');
assert(routed4.task.due.time === null, 'Test 6b: due without time keeps time null');
assert(routed4.task.priority === 2, 'Test 6c: priority defaults to 2 (normal)');

resetState();
const captured5 = captureInbox('Некорректный due', opts({ itemType: 'task' }));
const routed5 = routeInboxToTask(captured5[0].id, {
  due: { date: 'not-a-date', time: '25:99' },
  taskId: 'task-b1-5',
  now: 2300,
});
assert(routed5.task.due === null, 'Test 6d: invalid due normalizes to null');
console.log('✓ Test 6: domain routing, due normalization, priority default');

// Test 7: Thought/Note/null must never route to a Task
resetState();
const thought = captureInbox('Просто мысль', opts({ itemType: 'thought' }));
let thoughtErr = null;
try { routeInboxToTask(thought[0].id, { projectId: 'p1' }); } catch (e) { thoughtErr = e; }
assert(thoughtErr?.message.includes('Only task-type'), 'Test 7a: thought cannot route');

const note = captureInbox('Просто заметка', opts({ itemType: 'note', now: 1001, idFactory: () => 'note' }));
let noteErr = null;
try { routeInboxToTask(note[0].id, { projectId: 'p1' }); } catch (e) { noteErr = e; }
assert(noteErr?.message.includes('Only task-type'), 'Test 7b: note cannot route');

const untyped = captureInbox('Без типа', opts({ now: 1002, idFactory: () => 'untyped' }));
let untypedErr = null;
try { routeInboxToTask(untyped[0].id, { projectId: 'p1' }); } catch (e) { untypedErr = e; }
assert(untypedErr?.message.includes('Only task-type'), 'Test 7c: null itemType cannot route');
assert(state.tasks.length === 0, 'Test 7d: no Task created');
console.log('✓ Test 7: Thought/Note/null cannot route to Task');

// Test 8: unknown Project/Domain rejected (no dangling references)
resetState();
const captured8 = captureInbox('Задача с плохим destination', opts({ itemType: 'task' }));
let projErr = null;
try { routeInboxToTask(captured8[0].id, { projectId: 'p-missing' }); } catch (e) { projErr = e; }
assert(projErr?.message.includes('Unknown target project'), 'Test 8a: unknown project rejected');

let domErr = null;
try { routeInboxToTask(captured8[0].id, { domainId: 'd-missing' }); } catch (e) { domErr = e; }
assert(domErr?.message.includes('Unknown target domain'), 'Test 8b: unknown domain rejected');
assert(state.tasks.length === 0, 'Test 8c: no dangling Task created');
console.log('✓ Test 8: unknown Project/Domain rejected');

// Test 9: a modified linked Task is not deleted on revert
resetState();
const captured9 = captureInbox('Задача для правки', opts({ itemType: 'task' }));
const routed9 = routeInboxToTask(captured9[0].id, { projectId: 'p1', taskId: 'task-b1-9', now: 3000 });
routed9.task.updatedAt = 3001; // simulate a later edit (any command bumps updatedAt)
const reverted9 = revertInboxRoute(captured9[0].id, { now: 3100 });
assert(reverted9?.refused === true && reverted9.reason === 'task-modified', 'Test 9a: modified task refused');
assert(state.tasks.some(task => task.id === 'task-b1-9'), 'Test 9b: modified Task preserved');
assert(state.inbox[0].resultRef?.id === 'task-b1-9', 'Test 9c: resultRef preserved');
assert(state.inbox[0].status === 'processed', 'Test 9d: Inbox still processed');
console.log('✓ Test 9: modified linked Task is not deleted on revert');

console.log('\n✅ All Stage B1 routing tests passed.');
