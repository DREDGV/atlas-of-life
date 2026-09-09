// A due date is a deadline, never an implicit decision to work on a task.
// A planned day is the calendar day a task was explicitly selected for.
export function localDay(value = new Date()){
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function dueDay(task){
  if (task.due?.date) return task.due.date;
  return typeof task.due === 'number' ? localDay(task.due) : null;
}
export function plannedDayOf(task){
  return typeof task.plannedDay === 'string' && task.plannedDay ? task.plannedDay : null;
}
export function isLeftover(task, day){
  const planned = plannedDayOf(task);
  return planned !== null && planned < day && task.status !== 'done';
}
const byPriority = (a,b) => (a.priority || 2) - (b.priority || 2);
export function todayGroups(tasks, now = new Date()){
  const day = localDay(now);
  const active = tasks.filter(task => task.status !== 'done');
  const plannedToday = active.filter(task =>
    plannedDayOf(task) === day && ['today','doing'].includes(task.status));
  return {
    focus: plannedToday.filter(task => task.focus === true).sort(byPriority),
    planned: plannedToday.filter(task => task.focus !== true).sort(byPriority),
    leftover: active.filter(task => isLeftover(task, day) && ['today','doing'].includes(task.status))
      .sort((a,b) => (plannedDayOf(a) || '').localeCompare(plannedDayOf(b) || '') || byPriority(a,b)),
    deadlines: active.filter(task =>
      dueDay(task) && dueDay(task) <= day && plannedDayOf(task) === null)
      .sort((a,b) => dueDay(a).localeCompare(dueDay(b)) || byPriority(a,b)),
    completed: tasks.filter(task => task.status === 'done' && task.completedAt && localDay(task.completedAt) === day),
  };
}
