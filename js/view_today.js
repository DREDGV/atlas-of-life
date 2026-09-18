// Today screen: the day plan seen through one day at a time.
//
// The selected day is ephemeral UI state — it is never persisted and never
// written into storage. Opening Today always starts from today itself; the day
// is a view parameter, not a piece of the plan. What the plan contains is
// persisted `plannedDay` and goes through Core commands like everything else.
import { state, FOCUS_LIMIT } from './state.js';
import { updateTask } from './core/commands.js';
import { requestSyncNow } from './sync/runtime.js';
import {
  dayView,
  dayCapacity,
  localDay,
  stepDay,
  plannedDayOf,
  dueLabel,
  planDayLabel,
  planDayShiftLabel,
} from './features/today/model.js';
import { formatDay, plural } from './ui/status-language.js';
// E1: a first, honest capacity line. Three focus tasks that each take an hour
// and a half is already a full working window, so the line warns instead of
// blessing an endless list. It is a reading, not a limit: nothing is refused.
export const DAY_CAPACITY_MIN = 240;

const ui = { day: localDay() };

// The app calls this when Today is opened, so the screen returns to the day it
// is named after instead of remembering a scroll through next week.
export function setTodayDay(day){
  ui.day = typeof day === 'string' && day ? day : localDay();
}

function formatCapacity(minutes){
  if (minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

export function renderToday(){
  const wrap = document.getElementById('viewToday');
  if (!wrap) return;
  if (state.view !== 'today') { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block'; wrap.replaceChildren();

  const groups = dayView(state.tasks, ui.day);
  const capacity = dayCapacity(state.tasks, ui.day);
  const today = groups.today;

  const change = (task, patch) => {
    try { updateTask(task.id, patch); requestSyncNow(); renderToday(); }
    catch (failure) {
      renderToday();
      const alert = wrap.querySelector('[role="alert"]');
      if (alert) alert.textContent = 'Изменение не сохранено. ' + failure.message;
    }
  };

  const goToDay = (day) => { ui.day = day; renderToday(); };

  // --- Day navigation -------------------------------------------------------
  const heading = document.createElement('h2');
  heading.textContent = 'Сегодня';
  const explanation = document.createElement('p');
  explanation.className = 'hint';
  explanation.textContent = 'Фокус — главное на сегодня. Сроки — сигнал внимания: они не добавляют задачи в план автоматически. Планировать можно на любой день вперёд.';

  const nav = document.createElement('div');
  nav.className = 'today-nav';
  const previous = document.createElement('button');
  previous.type = 'button'; previous.className = 'btn'; previous.textContent = '‹';
  previous.setAttribute('aria-label', 'Предыдущий день');
  previous.onclick = () => goToDay(stepDay(ui.day, -1));
  const dayLabel = document.createElement('span');
  dayLabel.className = 'today-day';
  dayLabel.dataset.todayDay = ui.day;
  dayLabel.textContent = `${planDayLabel(ui.day, today)}${groups.isToday ? '' : ` · ${planDayShiftLabel(ui.day, today)}`}`;
  const next = document.createElement('button');
  next.type = 'button'; next.className = 'btn'; next.textContent = '›';
  next.setAttribute('aria-label', 'Следующий день');
  next.onclick = () => goToDay(stepDay(ui.day, 1));
  const picker = document.createElement('input');
  picker.type = 'date'; picker.className = 'today-day-picker'; picker.value = ui.day;
  picker.setAttribute('aria-label', 'День плана');
  picker.onchange = () => { if (picker.value) goToDay(picker.value); };
  const backToToday = document.createElement('button');
  backToToday.type = 'button'; backToToday.className = 'btn'; backToToday.textContent = 'Сегодня';
  backToToday.disabled = groups.isToday;
  backToToday.onclick = () => goToDay(today);
  nav.append(previous, dayLabel, next, picker, backToToday);

  // --- Capacity of the selected day ----------------------------------------
  const size = formatCapacity(capacity.minutes);
  const capacityLine = document.createElement('p');
  capacityLine.className = 'today-capacity';
  capacityLine.dataset.over = String(capacity.minutes > DAY_CAPACITY_MIN);
  const capacityParts = [`В плане: ${capacity.count} ${plural(capacity.count, 'задача', 'задачи', 'задач')}`];
  capacityParts.push(size ? `· оценено на ${size}` : '· оценки не указаны');
  if (capacity.unestimated) {
    capacityParts.push(`· без оценки: ${capacity.unestimated}`);
  }
  if (capacity.minutes > DAY_CAPACITY_MIN) {
    capacityParts.push(`· больше привычных ${formatCapacity(DAY_CAPACITY_MIN)}`);
  }
  capacityLine.textContent = capacityParts.join(' ');
  capacityLine.setAttribute('role', 'status');

  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  error.className = 'today-error';

  wrap.append(heading, explanation, nav, capacityLine, error);

  // --- Rows and sections ----------------------------------------------------
  const row = (task, kind, actions) => {
    const item = document.createElement('div'); item.className = 'todo'; item.dataset.id = task.id;
    const content = document.createElement('div'); content.className = 'today-content';
    const open = document.createElement('button'); open.className = 'today-task-title'; open.type = 'button'; open.textContent = task.title;
    open.onclick = async () => { const { openInspectorFor } = await import('./inspector.js'); openInspectorFor({ ...task, _type:'task' }); };
    const context = state.projects.find(project => project.id === task.projectId);
    const domain = state.domains.find(domain => domain.id === (context?.domainId || task.domainId));
    const meta = document.createElement('div'); meta.className = 'hint';
    const parts = [domain?.title, context?.title];
    if (task.status === 'doing') parts.push('В работе');
    if (kind === 'leftover' || kind === 'ahead') {
      parts.push(`План: ${planDayLabel(plannedDayOf(task), today)}`);
    }
    const deadline = dueLabel(task, today);
    if (deadline) parts.push(deadline);
    meta.textContent = parts.filter(Boolean).join(' · ') || 'Без контекста и срока';
    content.append(open, meta); item.append(content);
    for (const [label, patch] of actions) {
      if (!patch) continue;
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

  // Today is the only day that holds attention, so it is the only day that
  // shows the focus group and accepts a focus decision.
  if (groups.isToday) {
    section(`Фокус дня · ${groups.focus.length} из ${FOCUS_LIMIT}`, groups.focus, 'focus',
      'Главное на сегодня: до трёх задач, которые вы реально собираетесь сделать.',
      [['Выполнено', { status:'done' }], ['Убрать из фокуса', { focus:false }]]);
  }
  const plannedTitle = groups.isToday
    ? 'Выбрано на сегодня'
    : `Выбрано на ${planDayLabel(ui.day, today).toLowerCase()}`;
  section(plannedTitle, groups.planned, 'planned',
    groups.isToday
      ? 'Остальной план дня. Выберите задачу из проекта или раздела сроков.'
      : 'На этот день пока ничего не выбрано. Задачу можно взять из сроков ниже или запланировать из задачи на карте.',
    groups.isToday
      ? [['В фокус', { focus:true }], ['Выполнено', { status:'done' }], ['Убрать из выбранного', { status:'backlog' }]]
      : [['Выполнено', { status:'done' }], ['Убрать из плана', { status:'backlog' }],
         groups.isFuture ? ['На сегодня', { status:'today', plannedDay: today }] : null]);

  if (!groups.isToday) {
    section('Не сделано раньше', groups.leftover, 'leftover',
      'Незавершённое с более ранних дней под этот день не попадает.',
      [['Перенести на этот день', { plannedDay: ui.day }], ['Вернуть в backlog', { status:'backlog' }]]);
  } else {
    section('Осталось с прошлых дней', groups.leftover, 'leftover',
      'Незавершённое с прошлых дней. Решите по каждой задаче: перенести на сегодня или вернуть в backlog.',
      [['Перенести на сегодня', { plannedDay: localDay(), focus: false }], ['Вернуть в backlog', { status:'backlog' }]]);
  }

  if (groups.isToday) {
    section('Запланировано на следующие дни', groups.ahead, 'ahead',
      'Планы на будущие дни появятся здесь — их можно открыть и изменить.',
      [['На сегодня', { plannedDay: localDay() }], ['Убрать из плана', { status:'backlog' }]]);
  }

  section(`Срок наступил${groups.isToday ? '' : ` к ${planDayLabel(ui.day, today).toLowerCase()}`} — ещё не выбрано`,
    groups.deadlines, 'deadlines',
    'Нет задач с наступившим сроком вне выбранного.',
    groups.isToday
      ? [['Выбрать на сегодня', { status:'today' }], ['В фокус', { status:'today', focus:true }]]
      : [['Выбрать на этот день', { plannedDay: ui.day }]]);

  section(`Выполнено ${planDayShiftLabel(ui.day, today)}`, groups.completed, 'completed',
    'Выполненные задачи появятся здесь.',
    groups.isToday
      ? [['Вернуть на сегодня', { status:'today' }]]
      : [['Вернуть на этот день', { plannedDay: ui.day }]]);
}
