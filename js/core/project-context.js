const localDay = date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');

export const projectDefaults = () => ({ outcome:'', lifecycle:'active', pauseReason:'', reviewOn:null, reviewedAt:null, completedAt:null, nextActionId:null });
export function validReviewDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0,10) === value;
}
export function validateProjectContext(project, tasks) {
  if (!['active','paused','completed'].includes(project.lifecycle)) throw new Error('Неизвестное состояние проекта');
  if (project.reviewOn !== null && !validReviewDay(project.reviewOn)) throw new Error('Некорректная дата обзора');
  if (project.lifecycle === 'paused' && !project.pauseReason.trim()) throw new Error('Укажите причину паузы');
  if (project.nextActionId && !tasks.some(t => t.id === project.nextActionId && t.projectId === project.id && t.status !== 'done')) throw new Error('Следующий шаг должен быть открытой задачей этого проекта');
  if (project.lifecycle === 'completed' && tasks.some(t => t.projectId === project.id && t.status !== 'done')) throw new Error('Сначала разберите открытые задачи проекта');
}
export function buildProjectContext(atlas, projectId, now = Date.now()) {
  const raw = atlas.projects.find(p => p.id === projectId);
  if (!raw) return null;
  const p = { ...projectDefaults(), ...raw };
  const tasks = atlas.tasks.filter(t => t.projectId === p.id);
  const evidence = tasks.filter(t => t.status === 'done' && Number.isFinite(t.completedAt) && t.completedAt > 0)
    .map(t => ({ kind:'task.completed', timestamp:t.completedAt, entityId:t.id })).sort((a,b) => b.timestamp-a.timestamp);
  const nextAction = tasks.find(t => t.id === p.nextActionId && t.status !== 'done') || null;
  const signals = [];
  if (p.lifecycle === 'paused') signals.push({ kind:'paused', label:p.reviewOn && p.reviewOn <= localDay(new Date(now)) ? 'Пора пересмотреть паузу' : 'Осознанная пауза', reason:p.pauseReason, taskIds:[] });
  else if (p.lifecycle === 'completed') signals.push({ kind:'completed', label:'Проект завершён', reason:'Завершение подтверждено вами.', taskIds:[] });
  else if (!nextAction) signals.push({ kind:'next', label:'Выберите следующий шаг', reason:'Для активного проекта не выбрана открытая задача.', taskIds:[] });
  return { ...p, nextAction, evidence, signals, suggestedActions:signals.map(s => ({ kind:s.kind, label:s.label })) };
}
