import { dayView, dayCapacity, dueState, dueLabel, localDay } from '../today/model.js';
import { formatDay } from '../../ui/status-language.js';
import { ageInDays, ATTENTION_RULES, buildAttention } from './attention.js';

export function buildMapDay(atlas, now = Date.now(), attention = buildAttention(atlas, now)) {
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
  const covered = new Set(suggestions.map(row => row.id));
  const dueReviews = [];
  const missingSteps = [];
  for (const area of attention.values()) {
    const context = area.context;
    if (area.signals.some(signal => signal.kind === 'review')) {
      dueReviews.push({ ...areaRef(area), kind: 'review', reason: 'Наступил срок обзора сферы', action: 'Открыть обзор' });
    } else if (context?.lifecycle === 'paused' && context.reviewOn && context.reviewOn <= day) {
      dueReviews.push({ ...areaRef(area), kind: 'pause', reason: 'Наступил срок пересмотра паузы', action: 'Пересмотреть паузу' });
    } else if (context?.lifecycle === 'active' && !context.nextAction) {
      missingSteps.push({ ...areaRef(area), kind: 'next', reason: 'У активного проекта нет следующего шага', action: 'Выбрать шаг' });
    }
  }
  const quietTasks = [];
  for (const task of atlas.tasks) {
    const project = projects.get(task.projectId);
    if (task.status === 'done' || covered.has(task.id) || task.plannedDay >= day
        || (project?.lifecycle || 'active') !== 'active') continue;
    const days = ageInDays(task, now);
    if (days === null || days < ATTENTION_RULES.staleDays) continue;
    quietTasks.push({ ...describe(task), type: 'task', reason: `${days} дн. без изменений в Atlas`, days, action: 'Открыть задачу' });
  }
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'ru') || String(a.id).localeCompare(String(b.id));
  quietTasks.sort((a, b) => b.days - a.days || byTitle(a, b));
  return { day, capacity: dayCapacity(atlas.tasks, day), focus: groups.focus.map(describe),
    planned: groups.planned.map(describe), suggestions,
    returnSuggestions: [...dueReviews.sort(byTitle), ...missingSteps.sort(byTitle), ...quietTasks] };

  function areaRef(area) {
    return { id: area.id, title: area.title, type: area.type, domainId: area.domainId,
      context: area.type === 'project' ? domains.get(area.domainId) : null };
  }
}
