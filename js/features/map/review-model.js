import { domainAttention, REVIEW_HISTORY_DAYS } from '../../core/review-history.js';
import { buildProjectContext } from '../../core/project-context.js';
import { localDay, dueState, dueLabel } from '../today/model.js';

export function buildReview(atlas, days = 7, now = Date.now()) {
  const start = now - days * 86400000;
  const since = Math.max(atlas.reviewHistory?.since || now, now - REVIEW_HISTORY_DAYS * 86400000);
  const events = (atlas.reviewHistory?.events || []).filter(event => event.timestamp >= start && event.timestamp <= now)
    .sort((a, b) => b.timestamp - a.timestamp);
  const needs = [];
  const today = localDay(now);
  const domainTitles = new Map(atlas.domains.map(domain => [domain.id, domain.title]));
  const projects = new Map(atlas.projects.map(project => [project.id, project]));
  const distribution = (atlas.domains || []).map(domain => {
    const attention = domainAttention(domain, now);
    if (attention.due) needs.push({ type: 'domain', id: domain.id, title: domain.title,
      reason: 'Пора вернуться к сфере', detail: `Выбран обзор каждые ${attention.interval} дней.`, date: attention.nextAt });
    const facts = events.filter(event => event.domainId === domain.id);
    return { ...domain, attention, done: facts.filter(event => event.kind === 'task.done').length,
      reopened: facts.filter(event => event.kind === 'task.reopened').length,
      reviews: facts.filter(event => ['domain.review', 'project.review'].includes(event.kind)).length };
  });
  const missingDomains = new Map();
  for (const event of events) {
    if (distribution.some(row => row.id === event.domainId)) continue;
    if (!missingDomains.has(event.domainId)) missingDomains.set(event.domainId, {
      id: event.domainId, title: event.domainTitle || 'Без контекста', historical: true,
      attention: {}, done: 0, reopened: 0, reviews: 0,
    });
    const row = missingDomains.get(event.domainId);
    if (event.kind === 'task.done') row.done++;
    if (event.kind === 'task.reopened') row.reopened++;
    if (['project.review', 'domain.review'].includes(event.kind)) row.reviews++;
  }
  distribution.push(...missingDomains.values());
  for (const task of atlas.tasks) {
    const deadline = dueState(task, today);
    if (deadline.kind !== 'overdue') continue;
    const project = projects.get(task.projectId);
    const domain = domainTitles.get(project?.domainId ?? task.domainId);
    const context = [domain, project?.title].filter(Boolean).join(' / ') || 'Без контекста';
    needs.push({ type: 'task', id: task.id, title: task.title,
      reason: 'Проверить срок', detail: `${context} · ${dueLabel(task, today)}`, date: 0 });
  }
  for (const project of atlas.projects || []) {
    const context = buildProjectContext(atlas, project.id, now);
    if (context.lifecycle === 'active' && !context.nextAction) {
      needs.push({ type: 'project', id: project.id, title: project.title,
        reason: 'Выбрать следующий шаг', detail: context.outcome || 'Уточните желаемый результат проекта.', date: Infinity });
    }
    if (context.lifecycle === 'paused' && project.reviewOn && project.reviewOn <= today) {
      needs.push({ type: 'project', id: project.id, title: project.title,
        reason: 'Пересмотреть паузу', detail: project.pauseReason, date: Date.parse(project.reviewOn) });
    }
  }
  needs.sort((a, b) => a.date - b.date || a.title.localeCompare(b.title, 'ru'));
  return { days, since, complete: since <= start, events, needs, distribution,
    done: events.filter(event => event.kind === 'task.done').length,
    reopened: events.filter(event => event.kind === 'task.reopened').length,
    reviews: events.filter(event => ['domain.review', 'project.review'].includes(event.kind)).length };
}

export function reviewEventLabel(event) {
  const labels = { 'task.done': 'Задача выполнена', 'task.reopened': 'Задача возвращена в работу',
    'project.create': 'Создан проект', 'domain.create': 'Создана сфера', 'domain.review': 'Сфера просмотрена' };
  if (event.kind === 'project.review') {
    if (event.previousLifecycle === event.lifecycle) return 'Проект просмотрен';
    return { active: 'Проект просмотрен · активен', paused: 'Решение о паузе', completed: 'Проект завершён' }[event.lifecycle] || 'Проект просмотрен';
  }
  return labels[event.kind];
}
