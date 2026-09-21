// Derived observations, never a persisted assessment of a person's life.
import { dueState, localDay } from '../today/model.js';

export const ATTENTION_RULES = Object.freeze({ staleDays: 30, doingCount: 4 });

function ageInDays(task, now) {
  const raw = task.updatedAt ?? task.createdAt;
  const time = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(time) && time > 0
    ? Math.max(0, Math.floor((now - time) / 86400000)) : null;
}

export function buildAttention(atlas, now = Date.now()) {
  const today = localDay(new Date(now));
  const projects = new Map((atlas.projects || []).map(p => [p.id, p]));
  const taskGroups = new Map();
  const add = (key, task) => {
    if (!taskGroups.has(key)) taskGroups.set(key, []);
    taskGroups.get(key).push(task);
  };
  for (const task of atlas.tasks || []) {
    if (task.projectId) add(`project:${task.projectId}`, task);
    const domainId = task.projectId ? projects.get(task.projectId)?.domainId : task.domainId;
    if (domainId) add(`domain:${domainId}`, task);
  }
  const entries = new Map();
  for (const [type, collection] of [['domain', atlas.domains], ['project', atlas.projects]]) {
    for (const entity of collection || []) {
      const key = `${type}:${entity.id}`;
      const tasks = taskGroups.get(key) || [];
      const open = tasks.filter(t => t.status !== 'done');
      const overdue = open.filter(t => dueState(t, today).kind === 'overdue');
      const doing = open.filter(t => t.status === 'doing');
      const stale = open.filter(t => ageInDays(t, now) >= ATTENTION_RULES.staleDays);
      const signals = [];
      if (overdue.length) signals.push({ kind: 'overdue', label: `${overdue.length} просрочено`,
        reason: 'Срок прошёл, задача ещё не завершена.', taskIds: overdue.map(t => t.id) });
      if (doing.length >= ATTENTION_RULES.doingCount) signals.push({ kind: 'load', label: `${doing.length} начато`,
        reason: 'Одновременно в работе 4 или больше задач. Проверьте, посильна ли нагрузка.', taskIds: doing.map(t => t.id) });
      if (stale.length) signals.push({ kind: 'stale', label: `${stale.length} без движения`,
        reason: 'Открытые задачи не менялись в Atlas 30 дней или дольше.', taskIds: stale.map(t => t.id) });
      if (!open.length) signals.push({ kind: 'empty', label: 'Нет следующего шага',
        reason: 'Нет открытых задач. Возможно, здесь сейчас всё в порядке.', taskIds: [] });
      const ages = tasks.map(t => ageInDays(t, now)).filter(n => n !== null);
      entries.set(key, { id: entity.id, type, title: entity.title, domainId: type === 'domain' ? entity.id : entity.domainId,
        total: tasks.length, open: open.length, done: tasks.length - open.length,
        overdue: overdue.length, doing: doing.length, stale: stale.length,
        focus: open.filter(t => t.focus && t.plannedDay === today).length,
        plannedToday: open.filter(t => t.plannedDay === today).length,
        doneRatio: tasks.length ? (tasks.length - open.length) / tasks.length : 0,
        overdueRatio: tasks.length ? overdue.length / tasks.length : 0,
        lastActivityDays: ages.length ? Math.min(...ages) : null,
        signals, primary: signals[0] || { kind: 'calm', label: `${open.length} открыто`, reason: 'Нет сигналов по текущим правилам.' },
      });
    }
  }
  return entries;
}
