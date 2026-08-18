import { state } from '../../state.js';
import { getInboxItems } from './model.js';
import { createEditState } from './edit-state.js';
import {
  captureInbox,
  convertInboxToTask,
  deleteInbox,
  undoDeleteInbox,
  updateInbox,
} from '../../core/commands.js';

let root = null;
let onStateChange = () => {};
let lastRemoval = null;

// Edit flow state: "unsaved draft" and "active edit mode" are separate.
// Escape/Back leave edit mode but keep the draft; Save and Delete clear both.
const editState = createEditState();

const ITEM_TYPE_LABELS = { task: 'Задача', thought: 'Мысль', note: 'Заметка' };
const ITEM_TYPE_ICONS = { task: '✓', thought: '💭', note: '📝' };
const PROCESSING_STATUS_LABELS = {
  new: 'Новая',
  reviewed: 'Просмотрена',
  processed: 'Разобрана',
  discarded: 'Отброшена',
};
const PROCESSING_STATUS_ORDER = ['new', 'reviewed', 'processed', 'discarded'];

function isTypingTarget(target){
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.matches('input, textarea, select')
  );
}

function updateCounter(){
  const count = Array.isArray(state.inbox) ? state.inbox.length : 0;
  const counter = document.getElementById('inboxCount');
  if (!counter) return;
  counter.textContent = count ? String(count) : '';
  counter.hidden = count === 0;
}

function closeInbox(){
  // Leaving the overlay exits edit mode; the draft itself stays preserved.
  editState.exit();
  if (root) root.hidden = true;
}

function commit(reason){
  updateCounter();
  onStateChange(reason);
}

// Today's records read as a bare time; older ones as date + time.
function formatProcessingTime(ts){
  if (!ts) return '';
  const d = new Date(ts);
  const isToday = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `${date}, ${time}`;
}

function typeChip(item){
  const type = item.itemType;
  const chip = document.createElement('span');
  chip.className = `inbox-type-chip ${type ? `is-${type}` : 'is-none'}`;
  chip.textContent = type
    ? `${ITEM_TYPE_ICONS[type]} ${ITEM_TYPE_LABELS[type]}`
    : 'Тип не выбран';
  return chip;
}

function enterEditMode(itemId){
  const item = state.inbox.find(entry => entry.id === itemId);
  editState.enter(itemId, item?.text ?? '');
  openInboxList();
  requestAnimationFrame(() => {
    const area = root?.querySelector(`[data-edit-id="${itemId}"]`);
    if (area) {
      area.focus();
      const length = area.value.length;
      area.setSelectionRange(length, length);
    }
  });
}

function exitEditMode(){
  editState.exit();
  openInboxList();
}

function renderEditRow(item){
  const row = document.createElement('article');
  row.className = 'inbox-row inbox-row--edit';

  const area = document.createElement('textarea');
  area.className = 'inbox-edit-area';
  area.dataset.editId = item.id;
  area.value = editState.getDraft(item.id, item.text);
  area.rows = Math.max(2, Math.min(6, area.value.split('\n').length + 1));
  area.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      // Leave edit mode and keep the draft; stop the overlay's Esc handler.
      event.preventDefault();
      event.stopPropagation();
      exitEditMode();
    }
  });

  const actions = document.createElement('div');
  actions.className = 'inbox-row-actions';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'inbox-button primary';
  save.textContent = 'Сохранить';
  save.addEventListener('click', () => {
    if (updateInbox(item.id, { text: area.value })) {
      editState.clear(item.id);
      commit('inbox:update');
    }
    openInboxList();
  });

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'inbox-button secondary';
  back.textContent = 'Назад';
  back.addEventListener('click', () => exitEditMode());

  const discard = document.createElement('button');
  discard.type = 'button';
  discard.className = 'inbox-button secondary';
  discard.textContent = 'Отменить правки';
  discard.addEventListener('click', () => {
    editState.clear(item.id);
    openInboxList();
  });

  const updateDiscardVisibility = () => {
    discard.hidden = !editState.isDirty(item.id, item.text);
  };
  area.addEventListener('input', () => {
    editState.setDraft(item.id, area.value);
    updateDiscardVisibility();
  });
  updateDiscardVisibility();

  const hint = document.createElement('span');
  hint.className = 'inbox-help';
  hint.textContent = 'rawText оригинала не изменяется';

  actions.append(save, back, discard);
  row.append(area, actions, hint);
  return row;
}

function renderDisplayRow(item){
  const row = document.createElement('article');
  row.className = 'inbox-row';

  const body = document.createElement('div');
  body.className = 'inbox-row-body';

  const text = document.createElement('div');
  text.className = 'inbox-row-text';
  text.textContent = item.text;

  const meta = document.createElement('div');
  meta.className = 'inbox-row-meta';

  const time = document.createElement('span');
  time.className = 'inbox-time';
  time.textContent = formatProcessingTime(item.createdAt);

  if (item.updatedAt && item.updatedAt > (item.createdAt || 0)) {
    const edited = document.createElement('span');
    edited.className = 'inbox-edited-marker';
    edited.textContent = `изм. ${formatProcessingTime(item.updatedAt)}`;
    meta.append(edited);
  }

  meta.append(time, typeChip(item));

  // The capture hint stays visible as a hint only, separate from the
  // confirmed type.
  if (item.userHint && item.userHint !== item.itemType) {
    const hint = document.createElement('span');
    hint.className = 'inbox-hint-marker';
    hint.textContent = `подсказка: ${ITEM_TYPE_LABELS[item.userHint] || item.userHint}`;
    meta.append(hint);
  }

  // Compact confirmed-type picker: Task / Thought / Note / No type.
  // Calls the Core command directly; no separate form.
  const typeBar = document.createElement('div');
  typeBar.className = 'inbox-type-bar';
  const typeOptions = [
    { value: 'task', label: `${ITEM_TYPE_ICONS.task} ${ITEM_TYPE_LABELS.task}` },
    { value: 'thought', label: `${ITEM_TYPE_ICONS.thought} ${ITEM_TYPE_LABELS.thought}` },
    { value: 'note', label: `${ITEM_TYPE_ICONS.note} ${ITEM_TYPE_LABELS.note}` },
    { value: null, label: 'Без типа' },
  ];
  typeOptions.forEach(({ value, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inbox-type-button';
    button.dataset.itemType = value ?? 'none';
    const active = (item.itemType ?? null) === value;
    if (active) button.classList.add('is-active', value ? `is-${value}` : 'is-none');
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.textContent = label;
    button.addEventListener('click', () => {
      if ((item.itemType ?? null) === value) return;
      if (updateInbox(item.id, { itemType: value })) commit('inbox:update');
      openInboxList();
    });
    typeBar.appendChild(button);
  });

  const statusBar = document.createElement('div');
  statusBar.className = 'inbox-status-bar';
  PROCESSING_STATUS_ORDER.forEach(status => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inbox-status-button';
    if (item.status === status) button.classList.add('is-active', `is-${status}`);
    button.textContent = PROCESSING_STATUS_LABELS[status];
    button.addEventListener('click', () => {
      if (item.status === status) return;
      if (updateInbox(item.id, { status })) commit('inbox:update');
      openInboxList();
    });
    statusBar.appendChild(button);
  });

  body.append(text, meta, typeBar, statusBar);

  const actions = document.createElement('div');
  actions.className = 'inbox-row-actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'inbox-button secondary';
  edit.textContent = '✎ Править';
  edit.addEventListener('click', () => enterEditMode(item.id));

  const toTask = document.createElement('button');
  toTask.type = 'button';
  toTask.className = 'inbox-button primary';
  toTask.textContent = 'В задачу';
  toTask.addEventListener('click', () => {
    if (convertInboxToTask(item.id)) {
      editState.clear(item.id);
      lastRemoval = null;
      commit('inbox:convert-to-task');
      openInboxList();
    }
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'inbox-button danger';
  remove.textContent = 'Удалить';
  remove.addEventListener('click', () => {
    lastRemoval = deleteInbox(item.id);
    if (lastRemoval) {
      editState.clear(item.id);
      commit('inbox:delete');
      openInboxList();
    }
  });

  actions.append(edit, toTask, remove);
  row.append(body, actions);
  return row;
}

function createShell(){
  if (root) return root;
  root = document.createElement('div');
  root.id = 'inboxOverlay';
  root.className = 'inbox-overlay';
  root.hidden = true;
  root.innerHTML = `
    <div class="inbox-backdrop" data-inbox-close></div>
    <section class="inbox-dialog" role="dialog" aria-modal="true" aria-labelledby="inboxTitle">
      <header class="inbox-dialog-header">
        <div>
          <div class="inbox-kicker">Атлас Жизни</div>
          <h2 id="inboxTitle">Входящие</h2>
        </div>
        <button type="button" class="inbox-icon-button" data-inbox-close aria-label="Закрыть">×</button>
      </header>
      <div id="inboxDialogBody"></div>
    </section>`;
  document.body.appendChild(root);
  root.querySelectorAll('[data-inbox-close]').forEach(element => {
    element.addEventListener('click', closeInbox);
  });
  return root;
}

function setBodyTitle(title){
  const titleElement = document.getElementById('inboxTitle');
  if (titleElement) titleElement.textContent = title;
}

export function openInboxCapture(){
  createShell();
  root.hidden = false;
  setBodyTitle('Быстрый захват');
  const body = document.getElementById('inboxDialogBody');
  body.innerHTML = `
    <p class="inbox-help">Запишите мысли как есть. Каждая непустая строка станет отдельной записью.</p>
    <textarea id="inboxCaptureText" class="inbox-capture" rows="7" placeholder="Позвонить врачу&#10;Идея для проекта&#10;Купить подарок"></textarea>
    <div class="inbox-actions">
      <button type="button" class="inbox-button secondary" id="inboxOpenList">Открыть список</button>
      <button type="button" class="inbox-button primary" id="inboxCaptureSave">Сохранить</button>
    </div>`;
  const input = document.getElementById('inboxCaptureText');
  const save = () => {
    const created = captureInbox(input.value);
    if (!created.length) {
      input.focus();
      return;
    }
    commit('inbox:capture');
    openInboxList();
  };
  document.getElementById('inboxCaptureSave').addEventListener('click', save);
  document.getElementById('inboxOpenList').addEventListener('click', openInboxList);
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  });
  requestAnimationFrame(() => input.focus());
}

export function openInboxList(){
  createShell();
  root.hidden = false;
  setBodyTitle('Входящие · разбор');
  const body = document.getElementById('inboxDialogBody');
  body.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'inbox-toolbar';
  const summary = document.createElement('div');
  summary.className = 'inbox-help';
  const items = getInboxItems();
  const freshCount = items.filter(item => item.status === 'new').length;
  if (items.length === 0) {
    summary.textContent = 'Входящие разобраны. Здесь спокойно.';
  } else if (freshCount === 0) {
    summary.textContent = `Записей: ${items.length}`;
  } else {
    summary.textContent = `Новых: ${freshCount} · Всего: ${items.length}`;
  }
  const captureButton = document.createElement('button');
  captureButton.type = 'button';
  captureButton.className = 'inbox-button primary';
  captureButton.textContent = '+ Записать';
  captureButton.addEventListener('click', openInboxCapture);
  toolbar.append(summary, captureButton);
  body.appendChild(toolbar);

  if (lastRemoval) {
    const undo = document.createElement('div');
    undo.className = 'inbox-undo';
    const text = document.createElement('span');
    text.textContent = `Удалено: ${lastRemoval.item.text}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Отменить';
    button.addEventListener('click', () => {
      if (undoDeleteInbox(lastRemoval)) {
        lastRemoval = null;
        commit('inbox:undo-delete');
        openInboxList();
      }
    });
    undo.append(text, button);
    body.appendChild(undo);
  }

  const list = document.createElement('div');
  list.className = 'inbox-list';
  items.forEach(item => {
    const row = editState.isActive(item.id)
      ? renderEditRow(item)
      : renderDisplayRow(item);
    list.appendChild(row);
  });
  body.appendChild(list);
}

export function initInbox(options = {}){
  onStateChange = options.onStateChange || (() => {});
  createShell();
  updateCounter();
  document.getElementById('btnInbox')?.addEventListener('click', openInboxList);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && root && !root.hidden) {
      event.preventDefault();
      closeInbox();
      return;
    }
    if (
      event.key.toLowerCase() === 'n' &&
      !event.ctrlKey && !event.metaKey && !event.altKey &&
      !isTypingTarget(event.target)
    ) {
      event.preventDefault();
      event.stopPropagation();
      openInboxCapture();
    }
  });
}
