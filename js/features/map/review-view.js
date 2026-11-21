import { state } from '../../state.js';
import { buildReview, reviewEventLabel } from './review-model.js';

let period = 7;
let dialog;
let navigate;
const date = timestamp => new Date(timestamp).toLocaleDateString('ru-RU');
function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function openObject(type, id) {
  dialog.close();
  if (type === 'task') return navigate.openTask(id);
  const entity = (type === 'project' ? state.projects : state.domains).find(item => item.id === id);
  if (entity) navigate.openArea({ type, id, domainId: type === 'domain' ? id : entity.domainId });
}

function drawReview() {
  const model = buildReview(state, period);
  dialog.replaceChildren();
  const header = make('header', 'review-header');
  const title = make('h2', '', 'Обзор жизни'); title.id = 'reviewTitle';
  const periodLabel = make('label', 'review-period', 'За период');
  const select = make('select'); select.setAttribute('aria-label', 'Период обзора');
  select.append(new Option('7 дней', '7'), new Option('30 дней', '30'));
  select.value = String(period);
  select.onchange = () => { period = Number(select.value); drawReview(); dialog.querySelector('select').focus(); };
  periodLabel.append(select);
  const close = make('button', 'btn', 'Закрыть'); close.onclick = () => dialog.close();
  header.append(title, periodLabel, close);
  const coverage = make('p', 'review-coverage', model.complete
    ? `История покрывает выбранные ${period} дней.`
    : `Непрерывное наблюдение с ${date(model.since)}. За выбранный период история неполная.`);
  const totals = make('div', 'review-totals');
  for (const [count, label] of [[model.done, 'Завершения задач'], [model.reopened, 'Возвраты в работу'], [model.reviews, 'Обзоры и решения']]) {
    const item = make('div'); item.append(make('strong', '', String(count)), make('span', '', label)); totals.append(item);
  }
  const columns = make('div', 'review-columns');
  const needs = make('section', 'review-needs');
  needs.append(make('h3', '', 'Чем пора заняться'));
  needs.append(make('p', 'review-caption', 'Текущее состояние · независимо от выбранного периода'));
  if (!model.needs.length) needs.append(make('p', 'review-caption', model.distribution.length
    ? 'Сроки обзоров не наступили. У активных проектов выбран шаг.'
    : 'Начните с создания сферы на карте и задайте, что важно в ней поддерживать.'));
  for (const need of model.needs) {
    const button = make('button', 'review-action');
    button.append(make('span', 'review-reason', need.reason), make('strong', '', need.title), make('span', '', need.detail));
    button.onclick = () => openObject(need.type, need.id);
    needs.append(button);
  }
  const distribution = make('section', 'review-distribution');
  distribution.append(make('h3', '', 'Куда было направлено внимание'));
  distribution.append(make('p', 'review-caption', 'Завершения задач и отмеченные обзоры в Atlas. Работа вне приложения здесь не видна.'));
  if (!model.distribution.length) distribution.append(make('p', 'review-caption', 'Создайте первую сферу на карте, чтобы задать её намерение и ритм обзора.'));
  const maximum = Math.max(1, ...model.distribution.map(row => row.done));
  for (const row of model.distribution) {
    const button = make(row.historical ? 'div' : 'button', 'review-domain');
    button.append(make('strong', '', row.title));
    const facts = row.done || row.reviews || row.reopened
      ? `Завершения — ${row.done} · обзоры — ${row.reviews} · возвраты — ${row.reopened}`
      : 'Нет отмеченных завершений и обзоров за период';
    button.append(make('span', 'review-caption', facts));
    const track = make('span', 'review-bar');
    const fill = make('span'); fill.style.width = `${row.done / maximum * 100}%`; track.append(fill); track.setAttribute('aria-hidden', 'true');
    button.append(track);
    const rhythm = row.historical ? 'Контекст на момент события' : row.attention.due ? 'Пора вернуться к сфере' : row.attention.nextAt
      ? `Обзор ${date(row.attention.nextAt)}` : 'Ритм по необходимости';
    button.append(make('span', 'review-rhythm', rhythm));
    if (!row.historical) button.onclick = () => openObject('domain', row.id);
    distribution.append(button);
  }
  columns.append(needs, distribution);
  const changes = make('section', 'review-changes');
  changes.append(make('h3', '', 'Что изменилось'));
  const list = make('div', 'review-events');
  if (!model.events.length) list.append(make('p', 'review-caption', 'За этот период пока нет записанных событий. Завершите задачу или отметьте обзор сферы.'));
  let shown = 0;
  const more = make('button', 'btn', 'Показать ещё');
  const appendEvents = () => {
    for (const event of model.events.slice(shown, shown + 50)) {
      const row = make('div', 'review-event');
      row.append(make('time', '', date(event.timestamp)));
      const content = make('div');
      content.append(make('span', 'review-caption', reviewEventLabel(event)), make('strong', '', event.title));
      content.append(make('span', 'review-caption', [event.domainTitle, event.entityType === 'task' ? event.projectTitle : null].filter(Boolean).join(' / ') || 'Без контекста'));
      if (event.detail) content.append(make('span', 'review-caption', event.detail));
      if (event.nextActionTitle) content.append(make('span', 'review-caption', `Следующий шаг — ${event.nextActionTitle}`));
      row.append(content);
      const collection = { task: state.tasks, project: state.projects, domain: state.domains }[event.entityType];
      if (collection.some(item => item.id === event.entityId)) {
        const open = make('button', 'btn', 'Открыть'); open.setAttribute('aria-label', `Открыть ${event.title}`);
        open.onclick = () => openObject(event.entityType, event.entityId); row.append(open);
      } else row.append(make('span', 'review-caption', 'Объект удалён'));
      list.append(row);
    }
    shown += 50; more.hidden = shown >= model.events.length;
  };
  more.onclick = appendEvents; appendEvents(); changes.append(list, more);
  dialog.append(header, coverage, totals, columns, changes,
    make('p', 'review-footer', 'Локальная история на этом устройстве · до 90 дней и 2000 событий. Переносы и удаления объектов сохраняют факты в исходной сфере. Экспорт Atlas включает историю.'));
}

export function renderReviewEntry(host, callbacks) {
  if (!host) return;
  navigate = callbacks;
  if (host.childElementCount) return;
  const button = make('button', 'review-entry', 'Обзор изменений и внимания ↗');
  button.type = 'button';
  button.onclick = () => {
    if (!dialog) {
      dialog = make('dialog', 'atlas-review'); dialog.setAttribute('aria-labelledby', 'reviewTitle');
      document.body.append(dialog);
    }
    drawReview(); dialog.showModal();
  };
  host.append(button);
}
