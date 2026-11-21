import { dayView, dayCapacity, dueState, dueLabel, localDay } from '../today/model.js';
import { formatDay } from '../../ui/status-language.js';

export function buildMapDay(atlas, now = Date.now()) {
  const day = localDay(now);
  const groups = dayView(atlas.tasks, day, now);
  const projects = new Map(atlas.projects.map(project => [project.id, project]));
  const domains = new Map(atlas.domains.map(domain => [domain.id, domain.title]));
  const describe = task => {
    const project = projects.get(task.projectId);
    const path = [domains.get(project?.domainId ?? task.domainId), project?.title].filter(Boolean);
    return { id: task.id, title: task.title, context: path.join(' / ') || 'Без контекста',
      plannedDay: task.plannedDay || null, priority: task.priority || 2 };
  };
  const suggestions = [];
  for (const task of atlas.tasks) {
    if (task.status === 'done' || task.plannedDay === day) continue;
    const deadline = dueState(task, day);
    const urgent = ['overdue', 'today'].includes(deadline.kind);
    const project = projects.get(task.projectId);
    const next = project && (project.lifecycle || 'active') === 'active' && project.nextActionId === task.id;
    if (!urgent && !(next && !task.plannedDay)) continue;
    const reasons = [];
    if (urgent) reasons.push(dueLabel(task, day));
    if (next) reasons.push('Следующий шаг проекта');
    if (task.plannedDay) reasons.push('План — ' + (formatDay(task.plannedDay, day) || task.plannedDay).toLocaleLowerCase('ru'));
    suggestions.push({ ...describe(task), reason: reasons.join(' · '), urgent,
      dueDay: urgent ? deadline.day : '', time: urgent ? task.due?.time || '24:00' : '' });
  }
  suggestions.sort((a,b) => Number(b.urgent) - Number(a.urgent) || a.dueDay.localeCompare(b.dueDay) ||
    a.time.localeCompare(b.time) || b.priority - a.priority || String(a.id).localeCompare(String(b.id)));
  return { day, capacity: dayCapacity(atlas.tasks, day), focus: groups.focus.map(describe),
    planned: groups.planned.map(describe), suggestions };
}
