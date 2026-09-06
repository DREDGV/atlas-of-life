import { state } from './state.js';
import { updateTask } from './core/commands.js';
import { requestSyncNow } from './sync/runtime.js';
import { todayGroups, dueDay, localDay } from './features/today/model.js';

export function renderToday(){
  const wrap = document.getElementById('viewToday');
  if (!wrap) return;
  if (state.view !== 'today') { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block'; wrap.replaceChildren();
  const heading = document.createElement('h2'); heading.textContent = 'Сегодня';
  const explanation = document.createElement('p'); explanation.className = 'hint';
  explanation.textContent = 'Выбранные задачи — ваше решение. Сроки показаны отдельно и не добавляют задачи в план автоматически.';
  const error = document.createElement('p'); error.setAttribute('role','alert'); error.className = 'today-error';
  wrap.append(heading, explanation, error);
  const groups = todayGroups(state.tasks);
  const change = (task, status) => {
    try { updateTask(task.id, { status }); requestSyncNow(); renderToday(); }
    catch (failure) {
      renderToday();
      wrap.querySelector('[role="alert"]').textContent = 'Изменение не сохранено. ' + failure.message;
    }
  };
  const section = (title, tasks, kind, empty) => {
    const area = document.createElement('section'); area.className = 'today-section'; area.dataset.todayGroup = kind;
    const label = document.createElement('h3'); label.textContent = `${title} · ${tasks.length}`; area.append(label);
    if (!tasks.length) { const text = document.createElement('p'); text.className = 'hint'; text.textContent = empty; area.append(text); }
    for (const task of tasks) {
      const row = document.createElement('div'); row.className = 'todo'; row.dataset.id = task.id;
      const content = document.createElement('div'); content.className = 'today-content';
      const open = document.createElement('button'); open.className = 'today-task-title'; open.type = 'button'; open.textContent = task.title;
      open.onclick = async () => { const { openInspectorFor } = await import('./inspector.js'); openInspectorFor({ ...task, _type:'task' }); };
      const context = state.projects.find(project => project.id === task.projectId);
      const domain = state.domains.find(domain => domain.id === (context?.domainId || task.domainId));
      const meta = document.createElement('div'); meta.className = 'hint';
      const due = dueDay(task);
      meta.textContent = [domain?.title, context?.title, task.status === 'doing' ? 'В работе' : '',
        due ? `${due < localDay() && task.status !== 'done' ? 'Срок истёк' : 'Срок'}: ${due}${task.due?.time ? ' ' + task.due.time : ''}` : 'Без срока'].filter(Boolean).join(' · ');
      content.append(open, meta); row.append(content);
      const button = (text, status) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = text; b.onclick = () => change(task, status); row.append(b); };
      if (kind === 'deadlines') button('Выбрать на сегодня', 'today');
      else if (kind === 'completed') button('Вернуть на сегодня', 'today');
      else { button('Выполнено', 'done'); button('Убрать из выбранного', 'backlog'); }
      area.append(row);
    }
    wrap.append(area);
  };
  section('Выбрано и в работе', groups.planned, 'planned', 'Выберите задачи из проекта или раздела сроков. Срок указывать необязательно.');
  section('Срок наступил — ещё не выбрано', groups.deadlines, 'deadlines', 'Нет задач с наступившим сроком вне выбранного.');
  section('Выполнено сегодня', groups.completed, 'completed', 'Выполненные задачи появятся здесь.');
}
