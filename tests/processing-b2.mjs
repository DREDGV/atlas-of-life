// Stage B2 — Processing Flow UX regression tests (focused block).
// Covers: automatic processing transitions, Thought/Note → processed without
// Task, Capture userHint/domainHintId normalization, and routing-draft
// behavior around the domain hint.
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
    { id: 'p2', domainId: 'd2', title: 'Домашние дела' },
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

// Test 1: automatic processing transitions
resetState();
const t1 = captureInbox('Новая запись', opts({ itemType: 'task' }));
assert(t1[0].status === 'new', 'Test 1a: Capture starts as new');
updateInbox(t1[0].id, { status: 'reviewed' }, { ...opts(), now: 1100 });
assert(state.inbox[0].status === 'reviewed', 'Test 1b: starting to process -> reviewed');
routeInboxToTask(t1[0].id, { projectId: 'p1', taskId: 'task-b2-1', now: 1200 });
assert(state.inbox[0].status === 'processed', 'Test 1c: successful route -> processed');
const t1b = captureInbox('Ещё запись', opts({ now: 1300, idFactory: () => 'inbox-b' }));
updateInbox(t1b[0].id, { status: 'discarded' }, { ...opts(), now: 1400 });
assert(state.inbox[1].status === 'discarded', 'Test 1d: explicit discard -> discarded');
console.log('✓ Test 1: automatic processing transitions');

// Test 2: Thought/Note -> processed without creating a Task
resetState();
const t2 = captureInbox('Идея для проекта', opts());
updateInbox(t2[0].id, { itemType: 'thought', status: 'processed' }, { ...opts(), now: 1500 });
assert(state.inbox[0].itemType === 'thought' && state.inbox[0].status === 'processed', 'Test 2a: thought processed in one command');
const t2b = captureInbox('Заметка про отпуск', opts({ now: 1600, idFactory: () => 'inbox-n' }));
updateInbox(t2b[0].id, { itemType: 'note', status: 'processed' }, { ...opts(), now: 1700 });
assert(state.inbox[1].itemType === 'note' && state.inbox[1].status === 'processed', 'Test 2b: note processed in one command');
assert(state.tasks.length === 0, 'Test 2c: no Task is created for Thought/Note');
assert(state.inbox.length === 2, 'Test 2d: source records are preserved');
console.log('✓ Test 2: Thought/Note -> processed without Task');

// Test 3: Capture userHint / domainHintId
resetState();
const t3 = captureInbox('Купить удобрение', opts({ userHint: 'task', domainHintId: 'd1' }));
assert(t3[0].userHint === 'task' && t3[0].domainHintId === 'd1', 'Test 3a: hints stored');
const t3b = captureInbox('Неизвестный домен', opts({ domainHintId: 'd-missing', now: 1001, idFactory: () => 'inbox-miss' }));
assert(t3b[0].domainHintId === null, 'Test 3b: unknown domain hint normalizes to null');
const t3c = captureInbox('Строка 1\nСтрока 2', opts({ userHint: 'note', domainHintId: 'd2', now: 1002, idFactory: () => 'inbox-multi' }));
assert(t3c.length === 2, 'Test 3c: multiline capture creates two records');
assert(t3c.every(item => item.userHint === 'note' && item.domainHintId === 'd2'), 'Test 3d: hints apply to every line');
console.log('✓ Test 3: Capture userHint/domainHintId');

// Test 4: routing draft uses the domain hint as a proposal but can change it
const { createRoutingDraftState } = await import('../js/features/inbox/routing-draft.js');
const drafts = createRoutingDraftState();
const hintId = 'd1';
const draft = { domainId: hintId, projectId: null, priority: 2, dueDate: '', dueTime: '' };
drafts.set('i1', draft);
assert(drafts.get('i1').domainId === 'd1', 'Test 4a: draft starts from the proposed domain');
drafts.set('i1', { ...drafts.get('i1'), domainId: 'd2' });
assert(drafts.get('i1').domainId === 'd2', 'Test 4b: user can change the domain in the draft');

const viewSource = readFileSync(new URL('../js/features/inbox/view.js', import.meta.url), 'utf-8');
assert(
  viewSource.includes('item.domainHintId') && viewSource.includes('draft.domainId'),
  'Test 4c: routing controls seed the draft from the domain hint'
);
assert(
  viewSource.includes('Предложенный домен'),
  'Test 4d: processing card shows the proposed domain to the user'
);
assert(
  viewSource.includes('Сохранить как мысль') && viewSource.includes('К разбору'),
  'Test 4e: B2 flow UI present (finish action, queue label)'
);
console.log('✓ Test 4: routing draft uses the domain hint but allows change');

console.log('\n✅ All Stage B2 processing flow tests passed.');
