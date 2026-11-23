import assert from 'node:assert/strict';
import { state } from '../js/state.js';
import adapter from '../js/storageAdapter.js';
import { loadState, prepareState, SCHEMA_VERSION } from '../js/storage.js';
import * as core from '../js/core/commands.js';
import { recordReviewOperation, REVIEW_HISTORY_LIMIT, domainAttention } from '../js/core/review-history.js';
import { buildReview } from '../js/features/map/review-model.js';
import { buildAttention } from '../js/features/map/attention.js';

const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
const now = Date.now();
const earlier = now - 20 * 86400000;
const home = core.createDomain({ title: 'Home' }, { now: earlier });
const health = core.createDomain({ title: 'Health' }, { now: earlier });
const project = core.createProject({ title: 'Repair', domainId: home.id }, { now: earlier });
const task = core.createTask({ title: 'Fix part', projectId: project.id }, { now: earlier });
core.saveDomainAttention(health.id, { intention: 'Move regularly', reviewEveryDays: 7 }, { now: earlier });
assert.equal(buildAttention(state, now).get(`domain:${health.id}`).primary.kind, 'review');
assert.ok(domainAttention(health, now).due);
assert.ok(buildReview(state, 7, now).needs.some(item => item.id === health.id));

core.updateTask(task.id, { status: 'done' }, { now: now - 10000 });
core.updateTask(task.id, { title: 'Fixed part' }, { now: now - 9000 });
core.updateTask(task.id, { status: 'backlog' }, { now: now - 8000 });
let model = buildReview(state, 7, now);
assert.equal(model.done, 1); assert.equal(model.reopened, 1);
assert.equal(model.complete, true);
assert.equal(model.events.find(event => event.kind === 'task.done').title, 'Fix part');
core.moveProject(project.id, health.id, { now: now - 7000 });
assert.equal(buildReview(state, 7, now).distribution.find(row => row.id === home.id).done, 1);
core.saveDomainAttention(health.id, { intention: 'Move regularly', reviewEveryDays: 7 }, { review: true, now: now - 6000 });
assert.equal(domainAttention(health, now).due, false);
assert.equal(buildReview(state, 7, now).done, 1, 'review does not create work evidence');
core.saveDomainAttention(health.id, { intention: 'Move regularly', reviewEveryDays: 0 }, { now: now - 5900 });
core.saveDomainAttention(health.id, { intention: 'Move regularly', reviewEveryDays: 7 }, { now: now - 5800 });
assert.equal(health.attentionSince, now - 5800, 'reactivating a cadence starts a new interval');
core.reviewProject(project.id, { lifecycle: 'paused', pauseReason: 'Waiting', reviewOn: '2020-01-01' }, { now: now - 5000 });
assert.ok(buildReview(state, 7, now).needs.some(item => item.reason === 'Пересмотреть паузу'));

const before = JSON.stringify(state);
const save = adapter.save;
const warn = console.warn; console.warn = () => {};
adapter.save = () => { throw Error('storage failure'); };
assert.throws(() => core.saveDomainAttention(health.id, { intention: 'Lost', reviewEveryDays: 30 }, { review: true }), /storage failure/);
assert.equal(JSON.stringify(state), before, 'domain, history and operation log roll back together');
assert.throws(() => core.updateTask(task.id, { status: 'done' }), /storage failure/);
assert.equal(JSON.stringify(state), before);
adapter.save = save; console.warn = warn;
assert.throws(() => core.saveDomainAttention(health.id, { intention: '', reviewEveryDays: 99 }));
assert.throws(() => core.saveDomainAttention(health.id, { intention: '', reviewEveryDays: 7 }, { expectedUpdatedAt: 1 }));
assert.ok(loadState());
assert.equal(buildReview(state, 7, now).done, 1);
assert.equal(state.domains.find(domain => domain.id === health.id).reviewEveryDays, 7);

const raw = JSON.parse(adapter.load()); raw.schema = 12; delete raw.reviewHistory;
const migrated = prepareState(JSON.stringify(raw));
assert.equal(migrated.schema, SCHEMA_VERSION);
assert.equal(migrated.reviewHistory.events.length, 0, 'no fabricated past from operation log');
assert.equal(buildReview(migrated, 7, Date.now()).complete, false);
raw.schema = 13; raw.reviewHistory = { since: now, events: [{}] };
assert.throws(() => prepareState(JSON.stringify(raw)), /истории/);

const isolated = { domains: [], projects: [], tasks: [], reviewHistory: { since: earlier, events: [] } };
for (let index = 0; index <= REVIEW_HISTORY_LIMIT; index++) {
  recordReviewOperation(isolated, { id: String(index), type: 'domain.create', entityType: 'domain',
    entityId: 'd', timestamp: now + index, payload: { title: 'D' } });
}
assert.equal(isolated.reviewHistory.events.length, REVIEW_HISTORY_LIMIT);
assert.equal(isolated.reviewHistory.since, now + 1);
recordReviewOperation(isolated, { id: 'later', type: 'domain.update', timestamp: now + 100 * 86400000 });
assert.equal(isolated.reviewHistory.events.length, 0);

// Loading must not silently route an unassigned task into the first sphere.
const unassigned = JSON.parse(adapter.load());
unassigned.tasks.push({ id: 'unassigned', title: 'No destination', status: 'backlog' });
adapter.save(JSON.stringify(unassigned)); assert.ok(loadState());
assert.equal(state.tasks.find(item => item.id === 'unassigned').domainId, undefined);
const restoredEvents = state.reviewHistory.events.length;
core.restoreAtlasSnapshot(adapter.load());
assert.equal(state.reviewHistory.events.length, restoredEvents);
assert.equal(buildReview(state).complete, false, 'restored snapshots cannot claim uninterrupted coverage');
console.log('PASS review: evidence, reopen, historical context, rhythm, pause, rollback, reload, migration, retention and unassigned task');
