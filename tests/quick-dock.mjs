import { state } from '../js/state.js';
import {
  captureInbox,
  createDomain,
  createTask,
  deleteDomain,
  mergeDomain,
  updateDomain,
} from '../js/core/commands.js';
import { parseQuick, parseWhenRU, resolveQuickDraft } from '../js/parser.js';
import { clearOutbox, listOutbox } from '../js/sync/outbox.js';

function assert(condition, message){
  if (!condition) throw new Error(message);
}

const localData = new Map();
globalThis.localStorage = {
  getItem: key => localData.has(key) ? localData.get(key) : null,
  setItem: (key, value) => localData.set(key, String(value)),
  removeItem: key => localData.delete(key),
};

function outboxOps(type){
  return listOutbox().filter(entry => entry.operation?.type === type);
}

const now = new Date(2026, 7, 23, 9, 5, 0, 0);
const parsed = parseQuick(
  'Купить семена #дача #покупки @"Сад и огород" !сегодня 10:00 ~1ч p3',
  { now }
);
assert(parsed.title === 'Купить семена', 'Parser must keep only the task title');
assert(parsed.tags.join(',') === 'дача,покупки', 'Parser must support multiple tags');
assert(parsed.projectQuery === 'Сад и огород', 'Parser must support quoted project names');
assert(parsed.due?.date === '2026-08-23' && parsed.due?.time === '10:00', 'Parser must return structured due');
assert(parsed.estimateMin === 60, 'Parser must convert hours to minutes');
assert(parsed.priority === 3, 'Parser must parse priority');
assert(parsed.errors.length === 0, 'Valid direct task must not have parser errors');

const tomorrow = parseWhenRU('завтра 7:30', { now });
assert(tomorrow.due?.date === '2026-08-24' && tomorrow.due?.time === '07:30', 'Relative Russian date must be deterministic');
const inThirtyMinutes = parseWhenRU('через 30м', { now });
assert(inThirtyMinutes.due?.date === '2026-08-23' && inThirtyMinutes.due?.time === '09:35', 'Relative minutes must work with Cyrillic units');
assert(parseWhenRU('сегодня 25:99', { now }).error, 'Invalid time must return an error');
assert(parseQuick('Проверить !', { now }).errors.some(error => error.includes('После !')), 'Empty due token must be rejected');
assert(parseQuick('Проверить @', { now }).errors.some(error => error.includes('После @')), 'Empty project token must be rejected');
const literalPunctuation = parseQuick('Написать user@example.com и отметить важно!сейчас', { now });
assert(literalPunctuation.title === 'Написать user@example.com и отметить важно!сейчас', 'Email and inline punctuation must stay in the title');
assert(!literalPunctuation.projectQuery && !literalPunctuation.due, 'Inline @ and ! must not become commands');
assert(parseQuick('Проверить !сегодня !завтра', { now }).errors.some(error => error.includes('одно время')), 'Multiple due commands must be rejected');
assert(parseQuick('Проверить ~30м ~1ч', { now }).errors.some(error => error.includes('одну оценку')), 'Multiple estimates must be rejected');
assert(parseQuick('Проверить p2 p4', { now }).errors.some(error => error.includes('один приоритет')), 'Multiple priorities must be rejected');
assert(parseQuick('Проверить ~0м', { now }).errors.some(error => error.includes('больше нуля')), 'Zero estimate must be rejected');
assert(parseQuick('Проверить p5', { now }).errors.some(error => error.includes('p1–p4')), 'Out-of-range priority must be rejected');

const domains = [{ id: 'd1', title: 'Дом' }, { id: 'd2', title: 'Дача' }];
const projects = [
  { id: 'p1', domainId: 'd1', title: 'План' },
  { id: 'p2', domainId: 'd2', title: 'План' },
  { id: 'p3', domainId: 'd2', title: 'Сад и огород' },
];
const resolved = resolveQuickDraft(parsed, { projects, domains, activeDomainId: 'd1' });
assert(resolved.projectId === 'p3' && resolved.domainId === 'd2', 'Resolver must bind an exact project and derive its domain');
assert(resolved.status === 'today', '!today must set Today status');

const ambiguous = resolveQuickDraft(parseQuick('Проверить @План', { now }), { projects, domains, activeDomainId: 'd1' });
assert(ambiguous.errors.some(error => error.includes('неоднозначен')), 'Duplicate project titles must be blocked');
const selected = resolveQuickDraft(parseQuick('Проверить @План', { now }), {
  projects, domains, activeDomainId: 'd1', selectedProjectId: 'p2',
});
assert(selected.projectId === 'p2' && selected.errors.length === 0, 'Autocomplete selection must resolve duplicate titles by id');
const staleSelection = resolveQuickDraft(parseQuick('Независимая задача', { now }), {
  projects, domains, activeDomainId: 'd1', selectedProjectId: 'p2',
});
assert(staleSelection.projectId === null && staleSelection.domainId === 'd1', 'Stale autocomplete selection must not override a draft without @project');
const missingContext = resolveQuickDraft(parseQuick('Независимая задача', { now }), { projects, domains });
assert(missingContext.errors.some(error => error.includes('домен-контекст')), 'Independent task must require an active context');
assert(resolveQuickDraft(parseQuick('Независимая задача', { now }), { projects, domains, activeDomainId: 'd1' }).status === 'backlog', 'Direct task without !today must default to backlog');

state.domains = [];
state.projects = [];
state.tasks = [];
state.inbox = [];
state.operationLog = [];
state.activeDomain = null;
const inboxText = '  #тег @проект !сегодня 10:00\nвторая строка  ';
const captured = captureInbox(inboxText, {
  persist: false,
  splitLines: false,
  idFactory: () => 'inbox-literal',
  now: 50,
});
assert(captured.length === 1 && captured[0].rawText === inboxText, 'Inbox-first capture must preserve the complete literal rawText');
assert(captured[0].itemType === null && captured[0].userHint === null, 'Quick Inbox capture must not confirm or hint a classification');
const domain = createDomain({ id: 'd-core', title: 'Core domain', color: '#123456' }, { persist: false, now: 100 });
assert(domain.id === 'd-core' && state.operationLog.at(-1)?.type === 'domain.create', 'Domain creation must use the Core operation log');
const task = createTask({
  id: 't-core', domainId: domain.id, title: 'Task with due', status: 'backlog',
  due: { date: '2026-08-24', time: '07:30' }, priority: 4,
}, { persist: false, now: 200 });
assert(task.due?.date === '2026-08-24' && task.due?.time === '07:30', 'createTask must persist structured due');
assert(task.domainId === domain.id && task.priority === 4, 'createTask must keep validated placement and priority');

const beforeTasks = state.tasks.length;
const beforeOperations = state.operationLog.length;
let destinationError = null;
try {
  createTask({ projectId: 'missing', title: 'Invalid destination' }, { persist: false, now: 300 });
} catch (error) {
  destinationError = error;
}
assert(destinationError?.message.includes('Unknown target project'), 'Unknown project must be rejected');
assert(state.tasks.length === beforeTasks && state.operationLog.length === beforeOperations, 'Failed createTask must roll back state and log');

for (const invalidDue of [
  { date: '2026-02-30', time: '07:30' },
  { date: '2026-08-24', time: '25:00' },
]) {
  let dueError = null;
  try {
    createTask({ domainId: domain.id, title: 'Invalid due', due: invalidDue }, { persist: false, now: 310 });
  } catch (error) {
    dueError = error;
  }
  assert(dueError?.message.includes('Invalid task due'), 'Malformed structured due must be rejected by createTask');
}
assert(state.tasks.length === beforeTasks && state.operationLog.length === beforeOperations, 'Invalid due must not mutate tasks or the operation log');

state.projects.push({ id: 'p-orphan', domainId: 'missing-domain', title: 'Orphan project' });
let orphanError = null;
try {
  createTask({ projectId: 'p-orphan', title: 'Invalid parent domain' }, { persist: false, now: 320 });
} catch (error) {
  orphanError = error;
}
assert(orphanError?.message.includes('Unknown target domain'), 'Project destination must reference an existing parent domain');
assert(state.tasks.length === beforeTasks && state.operationLog.length === beforeOperations, 'Orphan project destination must not mutate state');

const second = createDomain({ id: 'd-second', title: 'Second' }, { persist: false, now: 400 });
const renamed = updateDomain(second.id, { title: 'Second renamed' }, { persist: false, now: 410 });
assert(renamed.domain.title === 'Second renamed' && state.operationLog.at(-1)?.type === 'domain.update', 'Domain update must be journaled');
state.projects.push({ id: 'p-move', domainId: domain.id, title: 'Move me', createdAt: 1, updatedAt: 1 });
state.tasks.push({ id: 't-project', projectId: 'p-move', title: 'Project task', status: 'backlog', tags: [], createdAt: 1, updatedAt: 1 });
state.tasks.push({ id: 't-independent', projectId: null, domainId: domain.id, title: 'Independent task', status: 'backlog', tags: [], createdAt: 1, updatedAt: 1 });
state.inbox.push({ id: 'inbox-routed', rawText: 'Routed', text: 'Routed', itemType: 'task', status: 'processed', resultRef: { type: 'task', id: 't-routed' }, createdAt: 1, updatedAt: 1 });
state.tasks.push({ id: 't-routed', projectId: 'p-move', sourceInboxId: 'inbox-routed', title: 'Routed task', status: 'backlog', tags: [], priority: 2, due: null, createdAt: 1, updatedAt: 1 });
clearOutbox();
const merged = mergeDomain(domain.id, second.id, { persist: false, now: 420 });
assert(merged.movedProjectCount === 1 && merged.movedTaskCount === 4, 'Domain merge must count project and independent tasks');
assert(state.projects.find(item => item.id === 'p-move')?.domainId === second.id, 'Domain merge must move projects');
assert(state.tasks.find(item => item.id === 't-independent')?.domainId === second.id, 'Domain merge must move independent tasks');
assert(state.operationLog.some(entry => entry.type === 'domain.merge' && entry.entityId === domain.id), 'Domain merge must be journaled');
assert(outboxOps('task.result.upsert').some(entry => entry.operation.entityId === 't-routed' && entry.operation.payload.projection.domainId === second.id), 'Domain merge must refresh routed Task projection');

const third = createDomain({ id: 'd-third', title: 'Third' }, { persist: false, now: 430 });
state.tasks.push({ id: 't-third', projectId: null, domainId: third.id, title: 'Third task', status: 'backlog', tags: [], createdAt: 1, updatedAt: 1 });
state.inbox.push({ id: 'inbox-third', rawText: 'Third routed', text: 'Third routed', itemType: 'task', status: 'processed', resultRef: { type: 'task', id: 't-third-routed' }, createdAt: 1, updatedAt: 1 });
state.tasks.push({ id: 't-third-routed', projectId: null, domainId: third.id, sourceInboxId: 'inbox-third', title: 'Third routed task', status: 'backlog', tags: [], priority: 2, due: null, createdAt: 1, updatedAt: 1 });
clearOutbox();
const removed = deleteDomain(third.id, { persist: false, mode: 'move', targetDomainId: second.id, now: 440 });
assert(removed.taskCount === 2 && state.tasks.find(item => item.id === 't-third')?.domainId === second.id, 'Domain delete with move must preserve independent tasks');
assert(state.operationLog.some(entry => entry.type === 'domain.delete' && entry.entityId === third.id), 'Domain delete must be journaled');
assert(outboxOps('task.result.upsert').some(entry => entry.operation.entityId === 't-third-routed' && entry.operation.payload.projection.domainId === second.id), 'Domain delete with move must refresh routed Task projection');

const fourth = createDomain({ id: 'd-fourth', title: 'Fourth' }, { persist: false, now: 450 });
state.inbox.push({ id: 'inbox-fourth', rawText: 'Fourth routed', text: 'Fourth routed', itemType: 'task', status: 'processed', resultRef: { type: 'task', id: 't-fourth-routed' }, createdAt: 1, updatedAt: 1 });
state.tasks.push({ id: 't-fourth-routed', projectId: null, domainId: fourth.id, sourceInboxId: 'inbox-fourth', title: 'Fourth routed task', status: 'backlog', tags: [], priority: 2, due: null, createdAt: 1, updatedAt: 1 });
const domainsBeforeCascade = state.domains.length;
const tasksBeforeCascade = state.tasks.length;
let cascadeError = null;
try {
  deleteDomain(fourth.id, { persist: false, mode: 'cascade', now: 460 });
} catch (error) {
  cascadeError = error;
}
assert(cascadeError?.message.includes('routed Inbox tasks'), 'Domain cascade must refuse to break routed Inbox links');
assert(state.domains.length === domainsBeforeCascade && state.tasks.length === tasksBeforeCascade, 'Refused domain cascade must leave state intact');
assert(state.inbox.find(item => item.id === 'inbox-fourth')?.resultRef?.id === 't-fourth-routed', 'Refused domain cascade must preserve the bidirectional link');

console.log('Quick Dock parser and Core tests passed.');
