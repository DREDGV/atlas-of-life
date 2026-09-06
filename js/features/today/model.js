// A due date is a deadline, never an implicit decision to work on a task.
export function localDay(value = new Date()){
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function dueDay(task){
  if (task.due?.date) return task.due.date;
  return typeof task.due === 'number' ? localDay(task.due) : null;
}
export function todayGroups(tasks, now = new Date()){
  const day = localDay(now);
  const active = tasks.filter(task => task.status !== 'done');
  return {
    planned: active.filter(task => ['today','doing'].includes(task.status)),
    deadlines: active.filter(task => dueDay(task) && dueDay(task) <= day && !['today','doing'].includes(task.status))
      .sort((a,b) => dueDay(a).localeCompare(dueDay(b)) || (b.priority || 2) - (a.priority || 2)),
    completed: tasks.filter(task => task.status === 'done' && task.completedAt && localDay(task.completedAt) === day),
  };
}
