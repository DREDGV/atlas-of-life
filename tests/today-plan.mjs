// 0.13.0-alpha.1 — Today 2.0 / Day Plan Foundation focused regressions:
// due ≠ plannedDay, rollover, Focus limit, completion/reopen, persistence,
// and the legacy schema-8 migration.
import assert from 'node:assert/strict';
import { state, FOCUS_LIMIT } from '../js/state.js';
import adapter from '../js/storageAdapter.js';
import { loadState, saveState } from '../js/storage.js';
import { createTask, updateTask } from '../js/core/commands.js';
import { todayGroups, localDay } from '../js/features/today/model.js';

const memory = new Map();
globalThis.localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key),
};

const dayOffset = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDay(date);
};

const reset = () => {
  state.domains = [{ id:'d1', title:'Дом' }];
  state.projects = [];
  state.tasks = [];
  state.knowledge = [];
  state.inbox = [];
  state.operationLog = [];
  state.taskProjections = [];
  state.inboxTombstones = [];
  state.pendingSyncOperations = [];
  memory.clear();
};

// 1. due ≠ plannedDay: selecting for today never touches the deadline.
reset();
{
  const task = createTask({ id:'t-due', title:'Срок', domainId:'d1', due:{ date: dayOffset(-2), time:null } });
  const dueBefore = JSON.stringify(task.due);
  updateTask(task.id, { status:'today' });
  assert.equal(task.plannedDay, dayOffset(0));
  assert.equal(JSON.stringify(task.due), dueBefore, 'due must not change when selecting for today');
  let groups = todayGroups(state.tasks);
  assert.equal(groups.deadlines.some(t => t.id === task.id), false, 'overdue planned task is not a deadline signal');
  assert.equal(groups.planned.some(t => t.id === task.id), true);
  updateTask(task.id, { status:'backlog' });
  assert.equal(task.plannedDay, null, 'backlog clears the planned day');
  assert.equal(task.focus, false);
  assert.equal(JSON.stringify(task.due), dueBefore, 'due must not change when removing from today');
  groups = todayGroups(state.tasks);
  assert.equal(groups.deadlines.some(t => t.id === task.id), true, 'overdue unplanned task is back in deadlines');
}

// 2. Rollover: planned yesterday is a leftover, not today's plan.
reset();
{
  const task = createTask({ id:'t-roll', title:'Вчерашняя', domainId:'d1' });
  updateTask(task.id, { status:'today', plannedDay: dayOffset(-1) });
  let groups = todayGroups(state.tasks);
  assert.equal(groups.planned.some(t => t.id === task.id), false, 'yesterday task is not in today plan');
  assert.equal(groups.focus.some(t => t.id === task.id), false);
  assert.equal(groups.leftover.some(t => t.id === task.id), true, 'yesterday task is a leftover');
  updateTask(task.id, { plannedDay: dayOffset(0) });
  groups = todayGroups(state.tasks);
  assert.equal(groups.leftover.some(t => t.id === task.id), false);
  assert.equal(groups.planned.some(t => t.id === task.id), true, 'carried task joins today plan');
}

// 3. Focus limit: at most FOCUS_LIMIT tasks in the day's focus.
reset();
{
  const ids = ['f1','f2','f3','f4'];
  ids.forEach(id => createTask({ id, title:id, domainId:'d1', status:'today' }));
  ids.slice(0, FOCUS_LIMIT).forEach(id => updateTask(id, { focus:true }));
  assert.throws(() => updateTask('f4', { focus:true }), /Фокус/);
  updateTask('f1', { focus:false });
  updateTask('f4', { focus:true });
  assert.equal(todayGroups(state.tasks).focus.length, FOCUS_LIMIT);
  // Focus is only valid for a task planned for today.
  const far = createTask({ id:'far', title:'Будущее', domainId:'d1' });
  assert.throws(() => updateTask(far.id, { plannedDay: dayOffset(2), focus:true }), /сегодня/);
}

// 4. Completion / reopen.
reset();
{
  const task = createTask({ id:'t-done', title:'Завершить', domainId:'d1', status:'today' });
  updateTask(task.id, { focus:true });
  updateTask(task.id, { status:'done' });
  assert.ok(task.completedAt, 'done sets completedAt');
  assert.equal(task.focus, false, 'done clears focus');
  let groups = todayGroups(state.tasks);
  assert.equal(groups.completed.some(t => t.id === task.id), true, 'done today');
  updateTask(task.id, { status:'today' });
  assert.equal(task.completedAt, null, 'reopen clears completedAt');
  assert.equal(task.plannedDay, dayOffset(0), 'reopen plans for today');
}

// 5. Reload / persistence.
reset();
{
  const task = createTask({ id:'t-persist', title:'Сохранить', domainId:'d1', status:'today' });
  updateTask(task.id, { focus:true });
  saveState();
  assert.equal(JSON.parse(memory.get(adapter.key)).schema, 9);
  state.tasks = [];
  assert.equal(loadState(), true);
  const restored = state.tasks.find(t => t.id === task.id);
  assert.ok(restored);
  assert.equal(restored.plannedDay, dayOffset(0));
  assert.equal(restored.focus, true);
}

// 6. Legacy schema 8: today/doing tasks get today's anchor, backlog gets null.
reset();
{
  memory.set(adapter.key, JSON.stringify({
    schema: 8, domains:[{ id:'d1', title:'Дом' }], projects: [], knowledge: [], inbox: [],
    tasks: [
      { id:'legacy-today', title:'Старая сегодня', domainId:'d1', status:'today', tags:[] },
      { id:'legacy-doing', title:'Старая в работе', domainId:'d1', status:'doing', tags:[] },
      { id:'legacy-backlog', title:'Старый бэклог', domainId:'d1', status:'backlog', tags:[] },
    ],
  }));
  assert.equal(loadState(), true);
  assert.equal(state.tasks.find(t => t.id === 'legacy-today').plannedDay, dayOffset(0));
  assert.equal(state.tasks.find(t => t.id === 'legacy-doing').plannedDay, dayOffset(0));
  assert.equal(state.tasks.find(t => t.id === 'legacy-backlog').plannedDay, null);
  assert.equal(state.tasks.every(t => t.focus === false), true);
}

console.log('Today plan: due ≠ plannedDay, rollover, Focus limit, completion/reopen, persistence and schema-8 migration passed.');
