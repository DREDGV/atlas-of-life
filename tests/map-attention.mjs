import assert from 'node:assert/strict';
import { buildAttention } from '../js/features/map/attention.js';
const now = new Date(2026, 8, 22, 12).getTime();
const old = now - 31 * 86400000;
const state = {
  domains: [{ id: 'd', title: 'Дом' }, { id: 'empty', title: 'Отдых' }],
  projects: [{ id: 'p', domainId: 'd', title: 'Ремонт' }],
  tasks: [
    { id: 'old', projectId: 'p', status: 'backlog', updatedAt: old },
    { id: 'late', projectId: 'p', domainId: 'empty', status: 'backlog', due: { date: '2026-09-21' }, updatedAt: now },
    { id: 'plan', domainId: 'd', status: 'backlog', plannedDay: '2026-09-21', updatedAt: now },
    { id: 'done', domainId: 'd', status: 'done', updatedAt: old, due: { date: '2026-09-20' } },
    { id: 'unknown', domainId: 'd', status: 'backlog' },
    { id: 'bad', domainId: 'd', status: 'backlog', updatedAt: 'not-a-date' },
    { id: 'future', domainId: 'd', status: 'backlog', updatedAt: now + 10000 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `work${i}`, projectId: 'p', status: 'doing', updatedAt: now })),
  ], knowledge: [{ id: 'k', domainId: 'empty', updatedAt: now }],
};
const before = JSON.stringify(state);
let result = buildAttention(state, now);
const domain = result.get('domain:d');
assert.equal(domain.overdue, 1, 'plan is not a deadline; completed deadlines are excluded');
assert.equal(domain.stale, 1, 'new work must not conceal old tasks; unknown dates excluded');
assert.equal(domain.doing, 4);
assert.deepEqual(domain.signals.map(s => s.kind), ['overdue', 'load', 'stale']);
assert.equal(result.get('domain:empty').open, 0, 'project owns placement, not stale task.domainId');
assert.equal(result.get('domain:empty').primary.kind, 'empty', 'notes are not tasks');
assert.equal(JSON.stringify(state), before, 'model is read-only');
assert.equal(result.get('project:p').stale, 1);
state.tasks.find(t => t.id === 'late').status = 'done';
state.tasks.find(t => t.id === 'old').updatedAt = now;
state.tasks.find(t => t.id === 'work0').status = 'backlog';
result = buildAttention(state, now);
assert.equal(result.get('domain:d').signals.length, 0, 'signals clear when their causes clear');
assert.equal(buildAttention({ domains: [], projects: [], tasks: [] }, now).size, 0);
console.log('PASS map attention: ownership, deadline vs plan, age, workload, empty, pure derivation');
