// 0.13.0-alpha.2 — Today 2.0 / forward planning and day capacity.
//
// The day plan is a day parameter: the same tasks must read differently
// depending on which day is being viewed, and a plan made for tomorrow must
// arrive as tomorrow's plan without touching the deadline (`due`).
import assert from 'node:assert/strict';
import { state, FOCUS_LIMIT } from '../js/state.js';
import adapter from '../js/storageAdapter.js';
import { loadState, saveState, SCHEMA_VERSION } from '../js/storage.js';
import { createTask, updateTask } from '../js/core/commands.js';
import {
  dayView,
  dayCapacity,
  todayGroups,
  localDay,
  shiftDay,
  stepDay,
  planDayLabel,
  planDayShiftLabel,
  asDay,
} from '../js/features/today/model.js';

// Read-only model tests need no storage; the Core section below resets through
// the same Core commands the application uses.
const memory = new Map();
globalThis.localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key),
};
const resetCore = () => {
  state.domains = [{ id: 'd1', title: 'Дом' }];
  state.projects = [];
  state.tasks = [];
  state.knowledge = [];
  state.inbox = [];
  state.operationLog = [];
  state.pendingSyncOperations = [];
  state.taskProjections = [];
  state.inboxTombstones = [];
  memory.clear();
};

const at = (day, overrides = {}) => ({
  id: overrides.id || `t-${day}-${Math.random().toString(36).slice(2, 7)}`,
  title: 'Задача',
  status: 'today',
  plannedDay: day,
  focus: false,
  ...overrides,
});

// Every day-dependent assertion is anchored to one fixed reference "today", so
// the expectations cannot drift with the machine clock or with a month
// boundary; Core calls receive the same moment as `options.now`.
const REFERENCE_TODAY = new Date(2026, 8, 16, 10, 0, 0);
const REFERENCE_NOW = REFERENCE_TODAY.getTime();
const refDay = (offset = 0) => shiftDay(localDay(REFERENCE_TODAY), offset);

const today = refDay(0);
const tomorrow = refDay(1);
const inThreeDays = refDay(3);
const yesterday = refDay(-1);

// 1. A task planned for a future day is visible from today as "ahead" and
//    becomes that day's plan when the day arrives. The plan is stored as the
//    backlog of that day, so the work status must not decide visibility.
{
  const tasks = [
    at(tomorrow, { id: 'future', title: 'Завтрашняя', status: 'backlog' }),
    at(today, { id: 'today-work', focus: true }),
  ];
  const view = dayView(tasks, today, REFERENCE_TODAY);
  assert.deepEqual(view.ahead.map(t => t.id), ['future'],
    'a plan for a later day is stored as backlog and still has to be visible');
  assert.deepEqual(view.planned.map(t => t.id), [], 'a future plan is not today plan');
  assert.deepEqual(view.leftover, [], 'a future plan is not a leftover');
  assert.deepEqual(view.deadlines, [], 'a future plan is not a deadline signal');
  const nextDay = dayView(tasks, tomorrow, REFERENCE_TODAY);
  assert.deepEqual(nextDay.planned.map(t => t.id), ['future']);
  assert.deepEqual(nextDay.ahead, [], 'nothing is ahead of tomorrow');
  assert.equal(nextDay.isToday, false);
}

// 2. Looking at a future day: nothing is overdue yet, and a task selected for
//    today is not part of that day's plan.
{
  const tasks = [
    at(today, { id: 'selected-today', due: { date: yesterday, time: null } }),
    at(inThreeDays, { id: 'far' }),
  ];
  const view = dayView(tasks, inThreeDays, REFERENCE_TODAY);
  assert.deepEqual(view.planned.map(t => t.id), ['far']);
  assert.equal(view.deadlines.some(t => t.id === 'selected-today'), false,
    'a task already selected for today is not an unplanned deadline');
  assert.deepEqual(dayView(tasks, today, REFERENCE_TODAY).deadlines.map(t => t.id), [],
    'a task already selected for today is not today deadline either');
  assert.equal(view.isFuture, true);
  assert.equal(dayView(tasks, yesterday, REFERENCE_TODAY).isPast, true);
}

// 3. Focus is a today-only decision: the same task is only part of that day's
//    plan when a future day is viewed, and a day in the past reports leftovers.
{
  const tasks = [
    at(today, { id: 'focus-today', focus: true }),
    at(tomorrow, { id: 'focus-tomorrow', focus: true }),
  ];
  assert.deepEqual(dayView(tasks, today, REFERENCE_TODAY).focus.map(t => t.id), ['focus-today']);
  assert.deepEqual(dayView(tasks, tomorrow, REFERENCE_TODAY).focus, [],
    'a day that has not arrived holds no focus');
  assert.deepEqual(dayView(tasks, tomorrow, REFERENCE_TODAY).planned.map(t => t.id), ['focus-tomorrow'],
    'the task is still planned for that day — as a plan, not as focus');
  assert.deepEqual(dayView(tasks, refDay(2), REFERENCE_TODAY).leftover.map(t => t.id).sort(),
    ['focus-today', 'focus-tomorrow']);
}

// 4. Leftovers are computed for the day being viewed, not only for today, and
//    the plan decides — not the work status.
{
  const tasks = [at(yesterday, { id: 'stale' })];
  assert.deepEqual(dayView(tasks, today, REFERENCE_TODAY).leftover.map(t => t.id), ['stale']);
  assert.deepEqual(dayView(tasks, tomorrow, REFERENCE_TODAY).leftover.map(t => t.id), ['stale']);
  assert.deepEqual(dayView(tasks, yesterday, REFERENCE_TODAY).planned.map(t => t.id), ['stale']);
  assert.deepEqual(dayView(tasks, yesterday, REFERENCE_TODAY).leftover, [],
    'a view of its own day has no leftovers');
  const backlogOverdue = [at(yesterday, { id: 'backlog-stale', status: 'backlog' })];
  assert.deepEqual(dayView(backlogOverdue, today, REFERENCE_TODAY).leftover.map(t => t.id), ['backlog-stale'],
    'an unfinished plan from an earlier day is a leftover whatever its work status');
  const finished = [at(yesterday, { id: 'done-stale', status: 'done', completedAt: REFERENCE_NOW })];
  assert.deepEqual(dayView(finished, today, REFERENCE_TODAY).leftover, [],
    'a finished task is never a leftover');
}

// 5. Capacity counts only what is planned for that day, so a task planned for
//    tomorrow never inflates today.
{
  const tasks = [
    at(today, { id: 'a', estimateMin: 30 }),
    at(today, { id: 'b', estimateMin: 45, focus: true }),
    at(today, { id: 'c' }),
    at(tomorrow, { id: 'd', estimateMin: 120 }),
    at(today, { id: 'done', status: 'done', estimateMin: 90, completedAt: REFERENCE_NOW }),
  ];
  const capacity = dayCapacity(tasks, today);
  assert.equal(capacity.minutes, 75, 'only sized planned work counts');
  assert.equal(capacity.unestimated, 1, 'an unsized task is counted, never guessed');
  assert.equal(capacity.count, 3);
  assert.equal(dayCapacity(tasks, tomorrow).minutes, 120);
  assert.equal(dayCapacity(tasks, refDay(2)).minutes, 0);
}

// 6. Capacity refuses junk instead of inventing minutes.
{
  const tasks = [
    at(today, { id: 'junk', estimateMin: 'много' }),
    at(today, { id: 'zero', estimateMin: 0 }),
    at(today, { id: 'negative', estimateMin: -30 }),
  ];
  const capacity = dayCapacity(tasks, today);
  assert.equal(capacity.minutes, 0);
  assert.equal(capacity.unestimated, 3);
  assert.equal(dayCapacity(null, today).minutes, 0, 'no tasks is not a crash');
}

// 7. Day arithmetic crosses month and year boundaries, and stepDay mirrors it.
{
  const monthEnd = localDay(new Date(2026, 0, 31, 12, 0, 0));
  assert.equal(shiftDay(monthEnd, 1), '2026-02-01');
  assert.equal(shiftDay(monthEnd, -31), '2025-12-31');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29', 'leap year survives the shift');
  assert.equal(stepDay(today, 1), tomorrow);
  assert.equal(stepDay(tomorrow, -1), today);
}

// 8. Day wording: one place decides how a plan day reads.
{
  assert.equal(planDayLabel(today, today), 'Сегодня');
  assert.equal(planDayLabel(tomorrow, today), 'Завтра');
  assert.equal(planDayLabel(yesterday, today), 'Вчера');
  assert.equal(planDayShiftLabel(today, today), 'сегодня');
  assert.equal(planDayShiftLabel(tomorrow, today), 'завтра');
  assert.equal(planDayShiftLabel(yesterday, today), 'вчера');
  assert.equal(planDayShiftLabel(inThreeDays, today).startsWith('через '), true);
}

// 9. asDay accepts what callers actually have: a day key or a Date.
{
  assert.equal(asDay(tomorrow), tomorrow);
  assert.equal(asDay(new Date(2026, 8, 6, 23, 30)), '2026-09-06');
  assert.equal(asDay('не дата', today), today, 'garbage falls back to the caller day');
  assert.equal(asDay(tomorrow, today), tomorrow);
}

// 10. The legacy `todayGroups` entry point still answers for today.
{
  const tasks = [at(today, { id: 'legacy', focus: true }), at(yesterday, { id: 'legacy-leftover' })];
  const groups = todayGroups(tasks, REFERENCE_TODAY);
  assert.deepEqual(groups.focus.map(t => t.id), ['legacy']);
  assert.deepEqual(groups.leftover.map(t => t.id), ['legacy-leftover']);
}

// 11. Core: planning a task for a later day is a plan, not "today".
//     The reference moment is passed to every command, so the day boundaries
//     cannot depend on when this runs.
{
  const now = REFERENCE_NOW;
  const at2026 = (offset) => shiftDay('2026-09-16', offset);
  const limit = FOCUS_LIMIT;
  resetCore();

  // A task created with a day of its own waits in the backlog of that day.
  const planned = createTask({ id: 'fwd', title: 'Завтра', domainId: 'd1', plannedDay: at2026(1) }, { now });
  assert.equal(planned.plannedDay, at2026(1));
  assert.equal(planned.status, 'backlog', 'a task planned for a later day is not today work');

  // Moving it inside the plan derives the work state from the day.
  updateTask('fwd', { plannedDay: at2026(0) }, { now });
  assert.equal(planned.status, 'today', 'a task planned for today is today work');
  updateTask('fwd', { plannedDay: at2026(-1) }, { now });
  assert.equal(planned.status, 'today', 'a task carried over from yesterday stays work until it is finished');
  updateTask('fwd', { plannedDay: at2026(1) }, { now });
  assert.equal(planned.status, 'backlog', 'moving the plan forward returns the task to the backlog');

  // Focus never travels to another day.
  updateTask('fwd', { plannedDay: at2026(0), focus: true }, { now });
  assert.equal(planned.focus, true, 'focus is allowed on today plan');
  updateTask('fwd', { plannedDay: at2026(1) }, { now });
  assert.equal(planned.focus, false, 'a plan moved to another day loses its focus');
  assert.throws(() => updateTask('fwd', { focus: true }, { now }), /сегодня/,
    'a task planned for a later day cannot be focused');
  updateTask('fwd', { plannedDay: at2026(0) }, { now });
  assert.equal(planned.status, 'today');
  assert.equal(planned.focus, false, 'the flag does not come back by itself');

  // The plan cap still holds for today, and only for today.
  for (const id of ['f1', 'f2', 'f3']) {
    createTask({ id, title: id, domainId: 'd1', status: 'today' }, { now });
    updateTask(id, { focus: true }, { now });
  }
  assert.throws(() => updateTask('fwd', { focus: true }, { now }), /Фокус/,
    `at most ${limit} tasks hold the day focus`);
  updateTask('f1', { focus: false }, { now });
  updateTask('fwd', { focus: true }, { now });
  assert.equal(planned.focus, true);

  // Due stays a deadline: planning never writes it in either direction.
  const dueTask = createTask({ id: 'due-fwd', title: 'Срок', domainId: 'd1', due: { date: at2026(3), time: null } }, { now });
  const dueBefore = JSON.stringify(dueTask.due);
  updateTask('due-fwd', { plannedDay: at2026(1) }, { now });
  assert.equal(JSON.stringify(dueTask.due), dueBefore, 'planning must not move the deadline');
  assert.equal(dueTask.status, 'backlog');
  updateTask('due-fwd', { plannedDay: at2026(0) }, { now });
  assert.equal(JSON.stringify(dueTask.due), dueBefore, 'selecting for today must not move the deadline either');
}

// 12. The persisted day plan survives a reload, and the schema still guards it.
{
  const now = REFERENCE_NOW;
  createTask({ id: 'persist-fwd', title: 'После перезагрузки', domainId: 'd1', plannedDay: shiftDay('2026-09-16', 2) }, { now });
  saveState();
  assert.equal(JSON.parse(memory.get(adapter.key)).schema, SCHEMA_VERSION,
    'the day plan is covered by the current schema');
  state.tasks = [];
  assert.equal(loadState(), true);
  const restored = state.tasks.find(task => task.id === 'persist-fwd');
  assert.equal(restored.plannedDay, shiftDay('2026-09-16', 2));
  assert.equal(restored.status, 'backlog');
}

// 13. Legacy schema 9: a task planned for a later day stops pretending to be
//     today work; everyone else keeps the day they already had. The migration
//     runs against the real clock, so its reference day is the real today.
{
  resetCore();
  const migrationDay = localDay();
  memory.set(adapter.key, JSON.stringify({
    schema: 9, domains: [{ id: 'd1', title: 'Дом' }], projects: [], knowledge: [], inbox: [],
    tasks: [
      { id: 'legacy-today', title: 'Сегодня', domainId: 'd1', status: 'today', tags: [], plannedDay: migrationDay, focus: true },
      { id: 'legacy-future', title: 'Будущее', domainId: 'd1', status: 'today', tags: [], plannedDay: shiftDay(migrationDay, 4), focus: true },
      { id: 'legacy-past', title: 'Вчера', domainId: 'd1', status: 'doing', tags: [], plannedDay: shiftDay(migrationDay, -1) },
      { id: 'legacy-backlog', title: 'Бэклог', domainId: 'd1', status: 'backlog', tags: [], plannedDay: null, focus: false },
    ],
  }));
  assert.equal(loadState(), true);
  const find = id => state.tasks.find(task => task.id === id);
  assert.equal(find('legacy-today').status, 'today');
  assert.equal(find('legacy-today').focus, true, 'today focus survives the migration');
  assert.equal(find('legacy-future').status, 'backlog', 'a later plan waits in the backlog of that day');
  assert.equal(find('legacy-future').focus, false, 'focus never travels to another day');
  assert.equal(find('legacy-future').plannedDay, shiftDay(migrationDay, 4), 'the planned day itself is untouched');
  assert.equal(find('legacy-past').status, 'doing', 'an unfinished earlier day stays work — it is a leftover');
  assert.equal(find('legacy-backlog').plannedDay, null);
  assert.equal(JSON.parse(memory.get(adapter.key)).schema, SCHEMA_VERSION);
}

console.log('Forward planning: day parameter, ahead/leftover per day, capacity, day arithmetic and forward-plan Core rules passed.');