import assert from 'node:assert/strict';
import { buildMapDay } from '../js/features/map/today-suggestions.js';

const now = new Date(2026, 10, 21, 23, 59);
const day = '2026-11-21';
const tomorrow = '2026-11-22';
const task = (id, extra = {}) => ({ id, title: id, status: 'backlog', ...extra });
const at = time => ({ date: day, time });
const atlas = {
  domains: [{ id: 'd', title: 'Дом' }],
  projects: [{ id: 'p', lifecycle: 'active', domainId: 'd', nextActionId: 'next' },
    { id: 'q', lifecycle: 'paused', nextActionId: 'pause' }],
  tasks: [
    task('focus', { plannedDay: day, focus: true, estimateMin: 15 }),
    task('planned', { plannedDay: day, due: at('08:00') }),
    task('late', { due: { date: '2026-11-20' }, projectId: 'q' }),
    task('conflict', { due: at('12:00'), plannedDay: tomorrow }),
    task('a', { due: at('10:00'), priority: 2 }), task('b', { due: at('10:00'), priority: 4 }),
    task('day', { due: at(null) }), task('next', { projectId: 'p' }), task('pause', { projectId: 'q' }),
    task('finished', { status: 'done', due: at('07:00') }), task('future', { plannedDay: tomorrow }),
    task('yesterday', { plannedDay: '2026-11-20' }),
  ],
};
const snapshot = JSON.stringify(atlas);
const model = buildMapDay(atlas, now);
assert.deepEqual(model.suggestions.map(row => row.id), ['late','b','a','conflict','day','next']);
assert.deepEqual(model.capacity, { count: 2, minutes: 15, unestimated: 1 });
assert.deepEqual(model.focus.map(row => row.id), ['focus']);
assert.deepEqual(model.planned.map(row => row.id), ['planned']);
assert.match(model.suggestions.find(row => row.id === 'conflict').reason, /завтра/);
assert.equal(buildMapDay(atlas, new Date(2026,10,22)).planned.length, 2);
assert.deepEqual(buildMapDay({ domains: [], projects: [], tasks: [] }, now).suggestions, []);
assert.equal(JSON.stringify(atlas), snapshot);
console.log('PASS map day: rank, explicit next step, focus, dates, capacity, midnight, no writes');
