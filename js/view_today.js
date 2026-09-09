import { state, FOCUS_LIMIT } from './state.js';
import { updateTask } from './core/commands.js';
import { requestSyncNow } from './sync/runtime.js';
import { todayGroups, dueDay, localDay, plannedDayOf } from './features/today/model.js';

export function renderToday(){
  const wrap = document.getElementById('viewToday');
  if (!wrap) return;
  if (state.view !== 'today') { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block'; wrap.replaceChildren();
  const heading = document.createElement('h2'); heading.textContent = 'Сегодня';
  const explanation = document.createElement('p'); explanation.className = 'hint';
  explanation.textContent = 'Фокус — главное на сегодня. Сроки — сигнал внимания: они не добавляют задачи в план автоматически.';
  const error = document.createElement('p'); error.setAttribute('role','alert'); error.className = 'today-error';
  wrap.append(heading, explanation, error);
  const groups = todayGroups(state.tasks);
  const change = (task, patch) => {
    try { updateTask(task.id, patch); requestSyncNow(); renderToday(); }
    catch (failure) {
      renderToday();
      wrap.querySelector('[role="alert"]').textContent = 'Изменение не сохранено. ' + failure.message;
    }
  };
  const row = (task, kind, actions) => {
    const item = document.createElement('div'); item.className = 'todo'; item.dataset.id = task.id;
    const content = document.createElement('div'); content.className = 'today-content';
    const open = document.createElement('button'); open.className = 'today-task-title'; open.type = 'button'; open.textContent = task.title;
    open.onclick = async () => { const { openInspectorFor } = await import('./inspector.js'); openInspectorFor({ ...task, _type:'task' }); };
    const context = state.projects.find(project => project.id === task.projectId);
    const domain = state.domains.find(domain => domain.id === (context?.domainId || task.domainId));
    const meta = document.createElement('div'); meta.className = 'hint';
    const due = dueDay(task);
    const parts = [domain?.title, context?.title];
    if (task.status === 'doing') parts.push('В работе');
    if (kind === 'leftover') parts.push(`Было запланировано: ${plannedDayOf(task)}`);
    if (due) parts.push(`${due < localDay() && task.status !== 'done' ? 'Срок истёк' : 'Срок'}: ${due}${task.due?.time ? ' ' + task.due.time : ''}`);
    meta.textContent = parts.filter(Boolean).join(' · ') || 'Без срока';
    content.append(open, meta); item.append(content);
    for (const [label, patch] of actions) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = label;
      button.onclick = () => change(task, patch);
      item.append(button);
    }
    return item;
  };
  const section = (title, tasks, kind, empty, actions) => {
    const area = document.createElement('section'); area.className = 'today-section'; area.dataset.todayGroup = kind;
    const label = document.createElement('h3'); label.textContent = `${title} · ${tasks.length}`; area.append(label);
    if (!tasks.length) { const text = document.createElement('p'); text.className = 'hint'; text.textContent = empty; area.append(text); }
    tasks.forEach(task => area.append(row(task, kind, actions)));
    wrap.append(area);
  };
  section(`Фокус дня · ${groups.focus.length} из ${FOCUS_LIMIT}`, groups.focus, 'focus',
    'Главное на сегодня: до трёх задач, которые вы реально собираетесь сделать.',
    [['Выполнено', { status:'done' }], ['Убрать из фокуса', { focus:false }]]);
  section('Выбрано на сегодня', groups.planned, 'planned',
    'Остальной план дня. Выберите задачу из проекта или раздела сроков.',
    [['В фокус', { focus:true }], ['Выполнено', { status:'done' }], ['Убрать из выбранного', { status:'backlog' }]]);
  section('Осталось с прошлых дней', groups.leftover, 'leftover',
    'Незавершённое с прошлых дней. Решите по каждой задаче: перенести на сегодня или вернуть в backlog.',
    [['Перенести на сегодня', { plannedDay: localDay(), focus: false }], ['Вернуть в backlog', { status:'backlog' }]]);
  section('Срок наступил — ещё не выбрано', groups.deadlines, 'deadlines',
    'Нет задач с наступившим сроком вне выбранного.',
    [['Выбрать на сегодня', { status:'today' }], ['В фокус', { status:'today', focus:true }]]);
  section('Выполнено сегодня', groups.completed, 'completed',
    'Выполненные задачи появятся здесь.',
    [['Вернуть на сегодня', { status:'today' }]]);
}
