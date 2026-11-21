import { state } from '../../state.js';
import { updateTask } from '../../core/commands.js';
import { requestSyncNow } from '../../sync/runtime.js';
import { localDay } from '../today/model.js';
import { formatDay, plural } from '../../ui/status-language.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function openDayRow(id) {
  document.querySelector('.chip[data-view="today"]').click();
  const title = document.querySelector('#viewToday .todo[data-id="' + CSS.escape(String(id)) + '"] .today-task-title');
  if (title) {
    title.click();
    title.focus({ preventScroll: true });
    title.scrollIntoView({ block: 'nearest' });
  }
}

let signature;
export function renderMapDay(host, model, reveal) {
  if (!host) return;
  const nextSignature = JSON.stringify(model);
  if (nextSignature === signature && host.childElementCount) return;
  signature = nextSignature;
  const expanded = new Set([...host.querySelectorAll('details[open]')].map(el => el.dataset.group));
  const focused = host.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  host.replaceChildren();
  host.append(element('h3', '', 'Сегодня на карте'));
  const capacity = model.capacity;
  const totals = [capacity.count + ' ' + plural(capacity.count, 'задача', 'задачи', 'задач')];
  if (capacity.minutes) totals.push(capacity.minutes + ' мин');
  if (capacity.unestimated) totals.push('без оценки — ' + capacity.unestimated);
  host.append(element('p', 'map-day-context', 'В плане · ' + totals.join(' · ')));
  const fold = (key, label) => {
    const group = element('details');
    group.dataset.group = key;
    group.open = expanded.has(key);
    const summary = element('summary', '', label);
    summary.dataset.key = key;
    group.append(summary);
    host.append(group);
    return group;
  };
  const alert = element('p', 'map-day-error');
  alert.setAttribute('role', 'alert');
  function addRow(parent, row, rank) {
    const card = element('div', 'map-day-row');
    const name = element('button', 'map-day-name', row.title);
    name.type = 'button';
    name.title = 'Показать на карте';
    name.dataset.key = 'map-' + row.id;
    name.onclick = () => reveal(row.id);
    if (rank) {
      const mark = element('span', 'map-day-mark', String(rank));
      mark.setAttribute('aria-hidden', 'true');
      name.prepend(mark);
    }
    card.append(name, element('small', 'map-day-context', row.context));
    if (row.reason) card.append(element('span', 'map-day-reason', row.reason));
    let label = row.reason ? 'На сегодня' : 'Открыть в «Сегодня»';
    if (row.reason && row.plannedDay) label = 'Перенести · ' + (formatDay(row.plannedDay, model.day) || row.plannedDay).toLowerCase() + ' → сегодня';
    const action = element('button', 'map-day-action', label);
    action.type = 'button';
    action.dataset.key = 'day-' + row.id;
    action.onclick = () => {
      const task = state.tasks.find(item => item.id === row.id);
      if (!task || task.status === 'done' || (task.plannedDay || null) !== row.plannedDay || localDay() !== model.day) {
        window.mapApi?.refresh?.({ layout: true });
        host.querySelector('[role=alert]').textContent = 'План изменился. Проверьте актуальные подсказки.';
        return;
      }
      if (task.plannedDay !== model.day) {
        try { updateTask(task.id, { plannedDay: model.day }); }
        catch (error) { alert.textContent = 'Не удалось сохранить. ' + error.message; return; }
        requestSyncNow();
      }
      openDayRow(task.id);
    };
    card.append(action);
    parent.append(card);
  }
  if (model.focus.length) {
    host.append(element('h4', '', 'Фокус дня'));
    for (const row of model.focus) addRow(host, row);
  }
  if (model.planned.length) {
    const plan = fold('plan', 'Вне фокуса · ' + model.planned.length);
    for (const row of model.planned) addRow(plan, row);
  }
  if (model.suggestions.length) host.append(element('h4', '', 'Что взять сегодня'));
  for (const [index, row] of model.suggestions.slice(0, 3).entries()) addRow(host, row, index + 1);
  if (model.suggestions.length > 3) {
    const more = fold('more', 'Ещё ' + (model.suggestions.length - 3));
    for (const row of model.suggestions.slice(3)) addRow(more, row);
  } else if (!model.suggestions.length && !capacity.count) {
    host.append(element('p', 'map-day-context', 'Здесь появятся задачи со сроком и выбранные шаги проектов.'));
  }
  host.append(alert);
  if (focused) [...host.querySelectorAll('[data-key]')].find(el => el.dataset.key === focused)?.focus({ preventScroll: true });
}
