// A due date is a deadline, never an implicit decision to work on a task.
// A planned day is the calendar day a task was explicitly selected for.
//
// The day plan is a *day* parameter, not a fixed "today": Today can look at
// yesterday, today or a future day, and every group below is computed for the
// day being viewed. Focus stays a today-only decision — a day that has not
// arrived cannot hold attention.
//
// Display language (statuses, day labels, deadline sentences) lives in
// `js/ui/status-language.js`, shared with the map and the Inspector.
import { deadlineLabel, deadlineState, daysBetween, formatDay, isDayKey } from '../../ui/status-language.js';

export function localDay(value = new Date()){
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
// Shift a day key by whole calendar days. Days are calendar days, so shifting
// goes through Date rather than through string arithmetic on the ISO text.
export function shiftDay(day, days){
  const [year, month, date] = String(day).split('-').map(Number);
  const shifted = new Date(year, month - 1, date);
  shifted.setDate(shifted.getDate() + days);
  return localDay(shifted);
}
// Step used by day navigation (‹ Предыдущий / Следующий ›).
export function stepDay(day, delta){
  return shiftDay(day, delta);
}
export function dueDay(task){
  if (task.due?.date) return task.due.date;
  return typeof task.due === 'number' ? localDay(task.due) : null;
}
export function plannedDayOf(task){
  return typeof task.plannedDay === 'string' && task.plannedDay ? task.plannedDay : null;
}
// A leftover is a task whose plan lies before the day being viewed and which is
// not finished — the plan itself decides, not the work status.
export function isLeftover(task, day){
  const planned = plannedDayOf(task);
  return planned !== null && planned < day && task.status !== 'done';
}
// Acceptance test for a persisted planned day — used by the Core command and by
// the view, so an invalid value never reaches the plan.
export function isDayKeyValue(value){
  return isDayKey(value);
}

// The day a plan is being shown for. Accepts a day key or a Date, because the
// screen and the regression tests both drive the same function.
export function asDay(value, fallback = localDay()){
  if (isDayKey(value)) return value;
  if (value instanceof Date) return localDay(value);
  return fallback;
}

// Today's screens keep their own vocabulary, but the wording is shared.
export function dueState(task, today = localDay()){
  return deadlineState(task, today);
}
export function dueLabel(task, today = localDay()){
  return deadlineLabel(task, today);
}

const byPriority = (a,b) => (a.priority || 2) - (b.priority || 2);
// The plan is carried by the day, not by the work status: a task planned for a
// later day waits as the backlog of that day, so filtering the day's plan by
// `today`/`doing` would hide exactly the tasks the day is planning for.
const isPlannedOn = (task, day) => plannedDayOf(task) === day;
const isEarlierPlan = (task, day) => {
  const planned = plannedDayOf(task);
  return planned !== null && planned < day;
};

// One day of the plan, from the point of view of `day`:
//   focus     — explicit Focus of that day (today only, capped by FOCUS_LIMIT);
//   planned   — selected for that day without the focus mark;
//   leftover  — selected for an earlier day and still unfinished;
//   ahead     — selected for a later day (shown only when looking at today, so
//               a plan for the next days is visible instead of hidden);
//   deadlines — due on or before `day` and not selected for it: a signal, not a plan;
//   completed — finished during that calendar day.
export function dayView(tasks, day = localDay(), now = new Date()){
  const today = localDay(now);
  const list = Array.isArray(tasks) ? tasks : [];
  const active = list.filter(task => task.status !== 'done');
  const plannedOn = active.filter(task => isPlannedOn(task, day));
  const view = {
    day,
    today,
    isToday: day === today,
    isPast: day < today,
    isFuture: day > today,
    // Focus is a today-only decision: on any other day the same task is simply
    // part of that day's plan, never of its focus.
    focus: (day === today ? plannedOn.filter(task => task.focus === true) : []).sort(byPriority),
    planned: plannedOn.filter(task => !(day === today && task.focus === true)).sort(byPriority),
    leftover: active.filter(task => isEarlierPlan(task, day))
      .sort((a,b) => (plannedDayOf(a) || '').localeCompare(plannedDayOf(b) || '') || byPriority(a,b)),
    ahead: [],
    deadlines: active.filter(task =>
      dueDay(task) && dueDay(task) <= day && plannedDayOf(task) === null)
      .sort((a,b) => dueDay(a).localeCompare(dueDay(b)) || byPriority(a,b)),
    completed: list.filter(task => task.status === 'done' && task.completedAt && localDay(task.completedAt) === day),
  };
  if (view.isToday) {
    // A plan for a later day is stored as the backlog of that day, so it is the
    // planned day — not the work status — that makes it "ahead".
    view.ahead = active.filter(task => {
      const planned = plannedDayOf(task);
      return planned !== null && planned > today;
    }).sort((a,b) => (plannedDayOf(a) || '').localeCompare(plannedDayOf(b) || '') || byPriority(a,b));
  }
  return view;
}

// Backward-compatible name: the day view of "today".
export function todayGroups(tasks, now = new Date()){
  return dayView(tasks, asDay(now), now);
}

// Capacity of one day's plan: how much work was explicitly put on it.
// `estimateMin` is optional, so unknown sizes are counted instead of guessed —
// a plan made of unestimated tasks must not look like a light day.
export function dayCapacity(tasks, day = localDay()){
  const planned = (Array.isArray(tasks) ? tasks : [])
    .filter(task => task.status !== 'done' && isPlannedOn(task, day));
  let minutes = 0;
  let unestimated = 0;
  for (const task of planned) {
    const estimate = Number(task.estimateMin);
    if (Number.isFinite(estimate) && estimate > 0) minutes += estimate;
    else unestimated += 1;
  }
  return { minutes, unestimated, count: planned.length };
}

// «вчера» / «сегодня» / «завтра» / «5 сен» — the one wording for a plan day.
export function planDayLabel(day, today = localDay()){
  return formatDay(day, today) ?? day;
}
export function planDayShiftLabel(day, today = localDay()){
  const delta = daysBetween(today, day);
  if (delta === null) return day;
  if (delta === -1) return 'вчера';
  if (delta === 0) return 'сегодня';
  if (delta === 1) return 'завтра';
  return delta > 0 ? `через ${planDayLabel(day, today)}` : planDayLabel(day, today);
}
