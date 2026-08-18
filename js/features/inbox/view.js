import { state } from '../../state.js';
import { getInboxItems } from './model.js';
import { createEditState } from './edit-state.js';
import { createRoutingDraftState } from './routing-draft.js';
import { openInspectorFor } from '../../inspector.js';
import {
  captureInbox,
  createDomain,
  createProject,
  deleteInbox,
  revertInboxRoute,
  routeInboxToTask,
  undoDeleteInbox,
  updateInbox,
} from '../../core/commands.js';

let root = null;
let onStateChange = () => {};
let lastRemoval = null;

// Edit flow state: "unsaved draft" and "active edit mode" are separate.
// Escape/Back leave edit mode but keep the draft; Save and Delete clear both.
const editState = createEditState();

// Unfinished Task-routing selections per Inbox item (Domain/Project/Priority/
// Due). Temporary UI state — survives re-renders, filter switches and overlay
// close; cleared after a successful route, revert or delete.
const routingDraftState = createRoutingDraftState();

const ITEM_TYPE_LABELS = { task: 'Задача', thought: 'Мысль', note: 'Заметка' };
const ITEM_TYPE_ICONS = { task: '✓', thought: '💭', note: '📝' };
const PROCESSING_STATUS_LABELS = {
  new: 'Новая',
  reviewed: 'Просмотрена',
  processed: 'Разобрана',
  discarded: 'Отброшена',
};
const PROCESSING_STATUS_ORDER = ['new', 'reviewed', 'processed', 'discarded'];

// Priority is the existing 1..4 scale; label it for humans in the UI.
const PRIORITY_LABELS = { 1: 'Низкий', 2: 'Обычный', 3: 'Высокий', 4: 'Критичный' };
const PRIORITY_ORDER = [1, 2, 3, 4];
const DEFAULT_PRIORITY = 2;

// Processing queue filters, mapped onto the existing statuses.
const QUEUE_FILTERS = [
  { key: 'new', label: 'Новые', matches: status => status === 'new' },
  { key: 'reviewed', label: 'В работе', matches: status => status === 'reviewed' },
  { key: 'processed', label: 'Разобранные', matches: status => status === 'processed' || status === 'discarded' },
  { key: 'all', label: 'Все', matches: () => true },
];
let queueFilter = 'new';

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

function formatDue(due){
  if (!due?.date) return '';
  const [y, m, d] = due.date.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const dateStr = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return due.time ? `${dateStr} ${due.time}` : dateStr;
}

function makeLabel(text){
  const label = document.createElement('span');
  label.className = 'inbox-route-label';
  label.textContent = text;
  return label;
}

function makeSelect(options, className = 'inbox-select'){
  const select = document.createElement('select');
  select.className = className;
  options.forEach(({ value, text, selected }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    if (selected) option.selected = true;
    select.appendChild(option);
  });
  return select;
}

// Compact Task-routing controls rendered inside the Processing card:
// Domain → Project (filtered by domain) → Priority → Due (date + time).
// Selections live in a local routing draft; Domain/Project can be created
// inline through Core commands.
function buildRoutingControls(item){
  const wrap = document.createElement('div');
  wrap.className = 'inbox-route';

  const domains = Array.isArray(state.domains) ? state.domains : [];
  const draft = routingDraftState.get(item.id) || {};

  let domainSelect = null;
  let projectSelect = null;
  let priority = draft.priority ?? DEFAULT_PRIORITY;
  let dueDate = null;
  let dueTime = null;

  const saveDraft = () => {
    routingDraftState.set(item.id, {
      domainId: domainSelect ? domainSelect.value || null : null,
      projectId: projectSelect ? projectSelect.value || null : null,
      priority,
      dueDate: dueDate ? dueDate.value : '',
      dueTime: dueTime ? dueTime.value : '',
    });
  };

  // ---- Domain ----
  const domainRow = document.createElement('div');
  domainRow.className = 'inbox-route-row';
  domainRow.appendChild(makeLabel('Домен'));

  if (domains.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'inbox-empty-state';
    empty.textContent = 'Нет доменов';
    const createDomainButton = document.createElement('button');
    createDomainButton.type = 'button';
    createDomainButton.className = 'inbox-button secondary';
    createDomainButton.textContent = '+ Создать домен';
    createDomainButton.addEventListener('click', () => {
      const title = prompt('Название домена:');
      if (!title || !title.trim()) return;
      const domain = createDomain({ title: title.trim() });
      if (domain) {
        routingDraftState.set(item.id, {
          ...(routingDraftState.get(item.id) || {}),
          domainId: domain.id,
        });
        commit('domain:create');
        openInboxList();
      }
    });
    domainRow.append(empty, createDomainButton);
  } else {
    const draftDomainValid = domains.some(domain => domain.id === draft.domainId);
    const defaultDomainId = draftDomainValid
      ? draft.domainId
      : (state.activeDomain || domains[0]?.id || null);
    domainSelect = makeSelect(
      domains.map(domain => ({
        value: domain.id,
        text: domain.title,
        selected: domain.id === defaultDomainId,
      }))
    );
    domainRow.appendChild(domainSelect);
  }
  wrap.appendChild(domainRow);

  // ---- Project (filtered by the chosen Domain) ----
  const projectRow = document.createElement('div');
  projectRow.className = 'inbox-route-row';
  projectRow.appendChild(makeLabel('Проект'));

  if (domains.length > 0) {
    projectSelect = makeSelect([]);
    const repopulateProjects = () => {
      projectSelect.replaceChildren();
      projectSelect.appendChild(new Option('Без проекта', ''));
      const domainId = domainSelect.value;
      const projects = state.projects.filter(project => project.domainId === domainId);
      if (projects.length === 0) {
        const none = new Option('Нет проектов', '');
        none.disabled = true;
        projectSelect.appendChild(none);
      }
      projects.forEach(project => projectSelect.appendChild(new Option(project.title, project.id)));
      if (draft.projectId && projects.some(project => project.id === draft.projectId)) {
        projectSelect.value = draft.projectId;
      } else {
        projectSelect.value = '';
      }
    };
    domainSelect.addEventListener('change', () => {
      repopulateProjects();
      saveDraft();
    });
    repopulateProjects();

    const createProjectButton = document.createElement('button');
    createProjectButton.type = 'button';
    createProjectButton.className = 'inbox-button secondary';
    createProjectButton.textContent = '+ Создать проект';
    createProjectButton.addEventListener('click', () => {
      const title = prompt('Название проекта:');
      if (!title || !title.trim()) return;
      const project = createProject({
        domainId: domainSelect.value,
        title: title.trim(),
      });
      if (project) {
        routingDraftState.set(item.id, {
          ...(routingDraftState.get(item.id) || {}),
          domainId: domainSelect.value,
          projectId: project.id,
        });
        commit('project:create');
        openInboxList();
      }
    });
    projectRow.append(projectSelect, createProjectButton);
  }
  wrap.appendChild(projectRow);

  // ---- Priority ----
  const priorityBar = document.createElement('div');
  priorityBar.className = 'inbox-priority-bar';
  PRIORITY_ORDER.forEach(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inbox-type-button';
    button.dataset.priority = String(value);
    if (value === priority) button.classList.add('is-active');
    button.setAttribute('aria-pressed', value === priority ? 'true' : 'false');
    button.textContent = PRIORITY_LABELS[value];
    button.addEventListener('click', () => {
      priority = value;
      priorityBar.querySelectorAll('button').forEach(other => {
        other.classList.toggle('is-active', other === button);
        other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      });
      saveDraft();
    });
    priorityBar.appendChild(button);
  });

  // ---- Due (date + optional time) ----
  dueDate = document.createElement('input');
  dueDate.type = 'date';
  dueDate.className = 'inbox-input';
  if (draft.dueDate) dueDate.value = draft.dueDate;
  dueDate.addEventListener('input', saveDraft);

  dueTime = document.createElement('input');
  dueTime.type = 'time';
  dueTime.className = 'inbox-input';
  if (draft.dueTime) dueTime.value = draft.dueTime;
  dueTime.addEventListener('input', saveDraft);

  // ---- Submit ----
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'inbox-button primary';
  submit.textContent = 'Создать задачу';
  submit.addEventListener('click', () => {
    const due = dueDate.value
      ? { date: dueDate.value, time: dueTime.value || null }
      : null;
    const projectId = projectSelect ? projectSelect.value || null : null;
    const domainId = projectId ? undefined : (domainSelect ? domainSelect.value || null : null);
    try {
      const result = routeInboxToTask(item.id, { projectId, domainId, priority, due });
      if (result) {
        routingDraftState.clear(item.id);
        commit('inbox:route');
      }
    } catch (error) {
      if (typeof window.showToast === 'function') {
        window.showToast(error?.message || 'Не удалось создать задачу', 'warn');
      }
    }
    openInboxList();
  });

  const priorityRow = document.createElement('div');
  priorityRow.className = 'inbox-route-row';
  priorityRow.append(makeLabel('Приоритет'), priorityBar);

  const dueRow = document.createElement('div');
  dueRow.className = 'inbox-route-row';
  dueRow.append(makeLabel('Когда'), dueDate, dueTime);

  const submitRow = document.createElement('div');
  submitRow.className = 'inbox-route-row';
  submitRow.append(submit);

  wrap.append(priorityRow, dueRow, submitRow);
  return wrap;
}

// Shows a routed result: "Разобрана → Задача: …" with Open / Return actions.
function buildLinkedResult(item, task){
  const wrap = document.createElement('div');
  wrap.className = 'inbox-result';

  const title = document.createElement('div');
  title.className = 'inbox-result-title';
  title.textContent = `→ Задача: ${task ? task.title : '(задача удалена)'}`;

  const meta = document.createElement('div');
  meta.className = 'inbox-result-meta';
  if (task) {
    const taskProject = state.projects.find(project => project.id === task.projectId);
    const taskDomain = state.domains.find(domain => domain.id === (task.domainId || taskProject?.domainId));
    const parts = [
      [taskDomain?.title, taskProject?.title].filter(Boolean).join(' / '),
      PRIORITY_LABELS[task.priority] || `p${task.priority}`,
      formatDue(task.due),
    ].filter(Boolean);
    meta.textContent = parts.join(' · ');
  }

  const actions = document.createElement('div');
  actions.className = 'inbox-row-actions';

  if (task) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'inbox-button primary';
    open.textContent = 'Открыть задачу';
    open.addEventListener('click', () => {
      closeInbox();
      // Reveal the task on the map and focus its inspector: switch to the map
      // view, ensure its domain is visible, then center the camera on the task.
      const taskProject = state.projects.find(project => project.id === task.projectId);
      const domainId = task.domainId || taskProject?.domainId || null;
      if (domainId) {
        state.activeDomain = domainId;
        try { state.activeDomains = []; } catch (_) {}
      }
      state.view = 'map';
      const canvasEl = document.getElementById('canvas');
      const todayEl = document.getElementById('viewToday');
      if (canvasEl) canvasEl.style.display = 'block';
      if (todayEl) todayEl.style.display = 'none';
      document.querySelectorAll('.chip[data-view]').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.view === 'map');
      });
      try { if (window.renderSidebar) window.renderSidebar(); } catch (_) {}
      const mapApi = window.mapApi || {};
      try { if (mapApi.layoutMap) mapApi.layoutMap(); } catch (_) {}
      try { if (mapApi.drawMap) mapApi.drawMap(); } catch (_) {}
      try { if (mapApi.fitTask) mapApi.fitTask(task.id); } catch (_) {}
      openInspectorFor({ ...task, _type: 'task' });
    });
    actions.appendChild(open);
  }

  const revert = document.createElement('button');
  revert.type = 'button';
  revert.className = 'inbox-button secondary';
  revert.textContent = 'Вернуть в разбор';
  revert.addEventListener('click', () => {
    const result = revertInboxRoute(item.id);
    if (result?.refused) {
      if (typeof window.showToast === 'function') {
        window.showToast('Задача уже изменена — автоматический возврат небезопасен', 'warn');
      }
      return;
    }
    if (result) {
      routingDraftState.clear(item.id);
      commit('inbox:route-revert');
    }
    openInboxList();
  });
  actions.appendChild(revert);

  wrap.append(title, meta, actions);
  return wrap;
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

  const isTask = item.itemType === 'task';
  const isRouted = item.resultRef?.type === 'task';

  body.append(text, meta);
  // For Task items the routing block already states the type — no picker
  // duplication. Routed items are locked at `processed` — no status buttons.
  if (!isTask) body.appendChild(typeBar);
  if (!isRouted) body.appendChild(statusBar);

  if (isTask) {
    if (isRouted) {
      const resultTask = state.tasks.find(task => task.id === item.resultRef.id);
      body.appendChild(buildLinkedResult(item, resultTask));
    } else {
      body.appendChild(buildRoutingControls(item));
    }
  }

  const actions = document.createElement('div');
  actions.className = 'inbox-row-actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'inbox-button secondary';
  edit.textContent = '✎ Править';
  edit.addEventListener('click', () => enterEditMode(item.id));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'inbox-button danger';
  remove.textContent = 'Удалить';
  remove.addEventListener('click', () => {
    lastRemoval = deleteInbox(item.id);
    if (lastRemoval) {
      editState.clear(item.id);
      routingDraftState.clear(item.id);
      commit('inbox:delete');
      openInboxList();
    }
  });

  actions.append(edit, remove);
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
  const allItems = getInboxItems();
  const remainingCount = allItems.filter(item => item.status === 'new' || item.status === 'reviewed').length;
  summary.textContent = allItems.length === 0
    ? 'Входящие разобраны. Здесь спокойно.'
    : `Осталось разобрать: ${remainingCount} · Всего: ${allItems.length}`;
  const captureButton = document.createElement('button');
  captureButton.type = 'button';
  captureButton.className = 'inbox-button primary';
  captureButton.textContent = '+ Записать';
  captureButton.addEventListener('click', openInboxCapture);
  toolbar.append(summary, captureButton);
  body.appendChild(toolbar);

  // Processing queue filters, mapped onto the existing statuses.
  const filters = document.createElement('div');
  filters.className = 'inbox-filters';
  QUEUE_FILTERS.forEach(filter => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inbox-filter-button';
    button.dataset.queueFilter = filter.key;
    if (filter.key === queueFilter) button.classList.add('is-active');
    button.textContent = filter.label;
    button.addEventListener('click', () => {
      queueFilter = filter.key;
      openInboxList();
    });
    filters.appendChild(button);
  });
  body.appendChild(filters);

  const activeFilter = QUEUE_FILTERS.find(filter => filter.key === queueFilter) || QUEUE_FILTERS[QUEUE_FILTERS.length - 1];
  const items = allItems.filter(item => activeFilter.matches(item.status));

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
