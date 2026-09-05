import { state } from '../../state.js';
import { getInboxItems } from './model.js';
import { createEditState } from './edit-state.js';
import { createRoutingDraftState } from './routing-draft.js';
import { openInspectorFor } from '../../inspector.js';
import { setDomainVisible } from '../../ui/map-session.js';
import {
  captureInbox,
  createDomain,
  createProject,
  deleteInbox,
  revertInboxRoute,
  routeInboxToTask,
  routeInboxToKnowledge,
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

// Processing queue filters, mapped onto the existing statuses. The statuses
// stay in the model; the UI offers a simple user-facing set.
const QUEUE_FILTERS = [
  { key: 'review', label: 'К разбору', matches: status => status === 'new' || status === 'reviewed' },
  { key: 'done', label: 'Разобранные', matches: status => status === 'processed' || status === 'discarded' },
  { key: 'all', label: 'Все', matches: () => true },
];
let queueFilter = 'review';

// The one expanded card in the queue; everything else stays compact.
let activeProcessingId = null;

// Quick Capture hint state (ephemeral UI state, like the routing draft).
let captureUserHint = null;
let captureDomainHintId = null;
let savedBannerCount = 0;

// Session defaults for sequential processing: the last explicit choice the
// user made while routing. In-memory only; nothing is auto-confirmed, and
// Capture domainHintId always wins over these defaults.
const sessionDefaults = { domainId: null, projectId: null, priority: null };

// Local search + batch selection state (ephemeral UI state).
let searchQuery = '';
let batchMode = false;
let batchSelection = new Set();
let batchDomainId = '';
let batchProjectId = '';
let batchPriority = DEFAULT_PRIORITY;

// Which dialog view is currently open ('capture' | 'list'), for hotkeys.
let currentDialogView = 'list';

// Capture hints are ephemeral per Capture session: after a successful save they
// are cleared, and leaving Capture without saving clears them too — stale hints
// must never silently apply to a new record.
function resetCaptureHints(){
  captureUserHint = null;
  captureDomainHintId = null;
}

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

// Sync v1 (C1/C2): refresh the visible Inbox UI after remote operations were
// applied. Never interrupts an open processing card — only the list refreshes,
// so a user mid-processing is not yanked back to the queue.
export function refreshInboxAfterRemoteApply(){
  updateCounter();
  if (!root || root.hidden) return;
  if (currentDialogView !== 'list') return;
  openInboxList();
}

function closeInbox(){
  // Leaving the overlay exits edit mode; the draft itself stays preserved.
  editState.exit();
  // Leaving Capture without saving must not leak its hints into a new capture.
  if (currentDialogView === 'capture') resetCaptureHints();
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
// Domain → Project → Priority/Due (collapsed behind "Дополнительно").
// Selections live in a local routing draft; Domain/Project can be created
// inline through Core commands. A Capture domain hint proposes the initial
// domain but never locks it.
function buildRoutingControls(item){
  const isKnowledge = item.itemType !== 'task';
  const wrap = document.createElement('div');
  wrap.className = 'inbox-route';

  const domains = Array.isArray(state.domains) ? state.domains : [];
  const draft = routingDraftState.get(item.id) || {};
  // Initial proposal: Capture domain hint wins, then the session default.
  if (!Object.hasOwn(draft, 'domainId') && item.domainHintId && domains.some(domain => domain.id === item.domainHintId)) {
    draft.domainId = item.domainHintId;
  } else if (!Object.hasOwn(draft, 'domainId') && sessionDefaults.domainId && domains.some(domain => domain.id === sessionDefaults.domainId)) {
    draft.domainId = sessionDefaults.domainId;
  }

  const stepLabel = document.createElement('div');
  stepLabel.className = 'inbox-step-label';
  stepLabel.textContent = 'Куда?';
  wrap.appendChild(stepLabel);
  if (isKnowledge) {
    const explanation = document.createElement('div');
    explanation.className = 'inbox-result-meta';
    explanation.textContent = item.itemType === 'thought'
      ? 'Идея для развития. Сохраните рядом с проектом или доменом.'
      : 'Сведения, к которым можно вернуться. Сохраните в нужном контексте.';
    wrap.append(explanation);
  }

  let domainSelect = null;
  let projectSelect = null;
  let priority = draft.priority ?? sessionDefaults.priority ?? DEFAULT_PRIORITY;
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
    empty.textContent = isKnowledge ? 'Без контекста' : 'Нет доменов';
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
    const defaultDomainId = isKnowledge && draft.domainId === null ? null : draftDomainValid
      ? draft.domainId
      : (state.activeDomain || domains[0]?.id || null);
    domainSelect = makeSelect(
      [...(isKnowledge ? [{ value: '', text: 'Без контекста', selected: !defaultDomainId }] : []), ...domains.map(domain => ({
        value: domain.id,
        text: domain.title,
        selected: domain.id === defaultDomainId,
      }))]
    );
    domainRow.appendChild(domainSelect);
    domainSelect.setAttribute('aria-label', 'Домен назначения');
  }
  wrap.appendChild(domainRow);

  // ---- Project (filtered by the chosen Domain) ----
  const projectRow = document.createElement('div');
  projectRow.className = 'inbox-route-row';
  projectRow.appendChild(makeLabel('Проект'));

  if (domains.length > 0) {
    projectSelect = makeSelect([]);
    projectSelect.setAttribute('aria-label', 'Проект назначения');
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
      const effectiveProjectId = Object.hasOwn(draft, 'projectId') ? draft.projectId : sessionDefaults.projectId ?? null;
      if (effectiveProjectId && projects.some(project => project.id === effectiveProjectId)) {
        projectSelect.value = effectiveProjectId;
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
    createProjectButton.disabled = !domainSelect.value;
    domainSelect.addEventListener('change', () => { createProjectButton.disabled = !domainSelect.value; });
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
    wrap.appendChild(projectRow);
  }

  // ---- Priority ----
  const priorityBar = document.createElement('div');
  priorityBar.className = 'inbox-priority-bar';
  PRIORITY_ORDER.forEach(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inbox-type-button inbox-priority-button';
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
  const dueDateWrap = document.createElement('div');
  dueDateWrap.className = 'inbox-due-field';
  const dueDateLabel = document.createElement('label');
  dueDateLabel.className = 'inbox-due-label';
  dueDateLabel.textContent = 'Дата';
  dueDate = document.createElement('input');
  dueDate.type = 'date';
  dueDate.className = 'inbox-input inbox-input--date';
  if (draft.dueDate) dueDate.value = draft.dueDate;
  dueDate.addEventListener('input', saveDraft);
  dueDateWrap.append(dueDateLabel, dueDate);

  const dueTimeWrap = document.createElement('div');
  dueTimeWrap.className = 'inbox-due-field';
  const dueTimeLabel = document.createElement('label');
  dueTimeLabel.className = 'inbox-due-label';
  dueTimeLabel.textContent = 'Время';
  const dueTimeOptional = document.createElement('span');
  dueTimeOptional.className = 'inbox-due-optional';
  dueTimeOptional.textContent = 'необязательно';
  dueTimeLabel.appendChild(dueTimeOptional);
  dueTime = document.createElement('input');
  dueTime.type = 'time';
  dueTime.className = 'inbox-input inbox-input--time';
  if (draft.dueTime) dueTime.value = draft.dueTime;
  dueTime.addEventListener('input', saveDraft);
  dueTimeWrap.append(dueTimeLabel, dueTime);

  // ---- Submit ----
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'inbox-button primary';
  submit.textContent = isKnowledge ? (item.itemType === 'thought' ? 'Сохранить как мысль' : 'Сохранить как заметку') : 'Создать задачу';
  submit.dataset.routeSubmit = 'true';
  submit.addEventListener('click', () => {
    const due = dueDate.value
      ? { date: dueDate.value, time: dueTime.value || null }
      : null;
    const projectId = projectSelect ? projectSelect.value || null : null;
    const domainId = projectId ? undefined : (domainSelect ? domainSelect.value || null : null);
    try {
      const result = (isKnowledge ? routeInboxToKnowledge : routeInboxToTask)(item.id, { projectId, domainId, priority, due });
      if (result) {
        routingDraftState.clear(item.id);
        sessionDefaults.domainId = domainSelect ? domainSelect.value || null : null;
        sessionDefaults.projectId = projectSelect ? projectSelect.value || null : null;
        sessionDefaults.priority = priority;
        commit('inbox:route');
        if (isKnowledge) { queueFilter = 'done'; activeProcessingId = item.id; }
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
  dueRow.className = 'inbox-route-row inbox-route-row--due';
  dueRow.append(makeLabel('Когда'), dueDateWrap, dueTimeWrap);

  // "Дополнительно" is collapsed by default: priority and due only take the
  // screen when the user actually needs them. Draft values survive.
  const extraSection = document.createElement('div');
  extraSection.className = 'inbox-route-extra';
  extraSection.hidden = true;
  extraSection.append(priorityRow, dueRow);

  const extraToggle = document.createElement('button');
  extraToggle.type = 'button';
  extraToggle.className = 'inbox-extra-toggle';
  extraToggle.textContent = '▸ Дополнительно';
  extraToggle.addEventListener('click', () => {
    const open = extraSection.hidden;
    extraSection.hidden = !open;
    extraToggle.textContent = open ? '▾ Дополнительно' : '▸ Дополнительно';
  });

  const submitRow = document.createElement('div');
  submitRow.className = 'inbox-route-row';
  submitRow.append(submit);

  if (!isKnowledge) wrap.append(extraToggle, extraSection);
  wrap.append(submitRow);
  projectSelect?.addEventListener('change', saveDraft);
  return wrap;
}

// Shows a routed result: "Разобрана → Задача: …" with Open / Return actions.
function buildLinkedResult(item, task){
  const knowledge = item.resultRef.type === 'knowledge';
  const kindLabel = knowledge ? ITEM_TYPE_LABELS[item.resultRef.kind] : 'Задача';
  const wrap = document.createElement('div');
  wrap.className = 'inbox-result';

  const title = document.createElement('div');
  title.className = 'inbox-result-title';
  title.textContent = `→ ${kindLabel}: ${task?.title || item.resultRef.title || '(результат недоступен)'}`;

  const meta = document.createElement('div');
  meta.className = 'inbox-result-meta';
  if (task) {
    const taskProject = state.projects.find(project => project.id === task.projectId);
    const taskDomain = state.domains.find(domain => domain.id === (task.domainId || taskProject?.domainId));
    const location = [taskDomain?.title, taskProject?.title].filter(Boolean).join(' / ') || 'Без контекста';
    if (location) {
      const locSpan = document.createElement('span');
      locSpan.textContent = location;
      meta.appendChild(locSpan);
    }
    if (!knowledge) {
      const prioChip = document.createElement('span');
      prioChip.className = `inbox-priority-chip inbox-priority-chip--p${task.priority || 2}`;
      prioChip.textContent = PRIORITY_LABELS[task.priority] || 'Обычный';
      meta.appendChild(prioChip);
      const dueStr = formatDue(task.due);
      if (dueStr) {
        const dueSpan = document.createElement('span');
        dueSpan.textContent = dueStr;
        meta.appendChild(dueSpan);
      }
    }
  } else if (knowledge) {
    meta.textContent = ([item.resultRef.domainTitle, item.resultRef.projectTitle].filter(Boolean).join(' / ') || 'Без контекста') + ' · Откройте в Studio, где сохранён материал';
  }

  const actions = document.createElement('div');
  actions.className = 'inbox-row-actions';

  if (task) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'inbox-button primary';
    open.textContent = knowledge ? 'Открыть результат' : 'Открыть задачу';
    open.addEventListener('click', () => {
      closeInbox();
      // Reveal the task on the map and focus its inspector: switch to the map
      // view, ensure its domain is visible, then center the camera on the task.
      const taskProject = state.projects.find(project => project.id === task.projectId);
      const domainId = task.domainId || taskProject?.domainId || null;
      if (domainId) {
        state.activeDomain = domainId;
        setDomainVisible(domainId, true, state.domains);
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
      try { if (knowledge && domainId) mapApi.fitDomain?.(domainId); else if (!knowledge && mapApi.fitTask) mapApi.fitTask(task.id); } catch (_) {}
      openInspectorFor({ ...task, _type: knowledge ? 'knowledge' : 'task' });
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
        window.showToast(knowledge ? 'Верните материал на устройстве, где он сохранён. Изменённый материал удалять небезопасно.' : 'Задача уже изменена — автоматический возврат небезопасен', 'warn');
      }
      return;
    }
    if (result) {
      routingDraftState.clear(item.id);
      commit('inbox:route-revert');
      queueFilter = 'review';
      activeProcessingId = item.id;
    }
    openInboxList();
  });
  actions.appendChild(revert);

  const editRouted = document.createElement('button');
  editRouted.type = 'button';
  editRouted.className = 'inbox-button tertiary';
  editRouted.textContent = '✎ Править';
  editRouted.addEventListener('click', () => enterEditMode(item.id));
  if (!knowledge) actions.appendChild(editRouted);

  const deleteRouted = document.createElement('button');
  deleteRouted.type = 'button';
  deleteRouted.className = 'inbox-button destructive';
  deleteRouted.textContent = 'Удалить';
  deleteRouted.addEventListener('click', () => {
    try {
      lastRemoval = deleteInbox(item.id);
    } catch (error) {
      // Review: routed records cannot be deleted while linked to a result —
      // revert first, then delete. Explain instead of failing silently.
      if (typeof window.showToast === 'function') {
        window.showToast('Сначала «Вернуть в разбор» — запись связана с результатом', 'warn');
      }
      return;
    }
    if (lastRemoval) {
      editState.clear(item.id);
      routingDraftState.clear(item.id);
      commit('inbox:delete');
      openInboxList();
    }
  });
  if (!knowledge) actions.appendChild(deleteRouted);

  wrap.append(title, meta, actions);
  return wrap;
}

// Final state for processed Thought/Note and discarded records without a
// routed Task: a clear result plus "Вернуть в разбор" (Core → reviewed).
function buildFinalizedResult(item){
  const wrap = document.createElement('div');
  wrap.className = `inbox-result${item.status === 'discarded' ? ' inbox-result--discarded' : ''}`;

  const title = document.createElement('div');
  title.className = 'inbox-result-title';
  if (item.status === 'discarded') {
    title.textContent = 'Отброшена';
  } else if (item.itemType === 'thought' || item.itemType === 'note') {
    title.textContent = `${ITEM_TYPE_LABELS[item.itemType]} · Сохранена в прежней версии без назначения. Верните в разбор, чтобы добавить в Atlas.`;
  } else {
    title.textContent = 'Разобрана';
  }

  const actions = document.createElement('div');
  actions.className = 'inbox-row-actions';
  const revert = document.createElement('button');
  revert.type = 'button';
  revert.className = 'inbox-button secondary';
  revert.textContent = 'Вернуть в разбор';
  revert.addEventListener('click', () => {
    if (updateInbox(item.id, { status: 'reviewed' })) {
      commit('inbox:restored');
    }
    openInboxList();
  });
  actions.appendChild(revert);

  wrap.append(title, actions);
  return wrap;
}

function enterEditMode(itemId){
  // One focus at a time: the edited record becomes the active card.
  activeProcessingId = itemId;
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
  discard.className = 'inbox-button destructive';
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
  row.className = 'inbox-row inbox-row--active';
  row.dataset.processingId = item.id;

  const body = document.createElement('div');
  body.className = 'inbox-row-body';

  const text = document.createElement('div');
  text.className = 'inbox-row-text';
  text.textContent = item.text;

  const meta = document.createElement('div');
  meta.className = 'inbox-row-meta';

  const time = document.createElement('span');
  time.className = 'inbox-time';
  const createdStr = formatProcessingTime(item.createdAt);
  const editedStr = item.updatedAt && item.updatedAt > (item.createdAt || 0)
    ? formatProcessingTime(item.updatedAt)
    : '';
  if (editedStr) {
    time.textContent = `Создано ${createdStr} · изменено ${editedStr}`;
  } else {
    time.textContent = `Создано ${createdStr}`;
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

  const isTask = item.itemType === 'task';
  const isRouted = !!item.resultRef;
  // Final states without a routed Task: processed Thought/Note or discarded.
  const isFinalized = !isRouted && (item.status === 'processed' || item.status === 'discarded');

  body.append(text, meta);

  // Capture hints are proposals, never confirmed routing.
  const hintBits = [];
  if (item.userHint) {
    hintBits.push(`Подсказка: ${ITEM_TYPE_LABELS[item.userHint] || item.userHint}`);
  }
  if (item.domainHintId) {
    const hintDomain = state.domains.find(domain => domain.id === item.domainHintId);
    if (hintDomain) hintBits.push(`Предложенный домен: ${hintDomain.title}`);
  }
  if (hintBits.length > 0) {
    const hintLine = document.createElement('div');
    hintLine.className = 'inbox-hint-line';
    hintLine.textContent = hintBits.join(' · ');
    body.appendChild(hintLine);
  }

  // Read-only provenance: rawText, source, input type, capture time.
  const provenanceToggle = document.createElement('button');
  provenanceToggle.type = 'button';
  provenanceToggle.className = 'inbox-extra-toggle';
  provenanceToggle.textContent = '▸ Исходник';
  const provenanceBlock = document.createElement('div');
  provenanceBlock.className = 'inbox-provenance';
  provenanceBlock.hidden = true;
  if (item.text !== item.rawText) {
    const currentLine = document.createElement('div');
    currentLine.className = 'inbox-provenance-line';
    const currentLabel = document.createElement('span');
    currentLabel.className = 'inbox-provenance-label';
    currentLabel.textContent = 'Текущий текст';
    const currentVal = document.createElement('span');
    currentVal.className = 'inbox-provenance-value';
    currentVal.textContent = item.text;
    currentLine.append(currentLabel, currentVal);
    provenanceBlock.appendChild(currentLine);
  }
  const rawLine = document.createElement('div');
  rawLine.className = 'inbox-provenance-line';
  const rawLabel = document.createElement('span');
  rawLabel.className = 'inbox-provenance-label';
  rawLabel.textContent = 'Исходный текст';
  const rawVal = document.createElement('span');
  rawVal.className = 'inbox-provenance-value inbox-provenance-value--raw';
  rawVal.textContent = item.rawText;
  rawLine.append(rawLabel, rawVal);
  provenanceBlock.appendChild(rawLine);
  const metaLines = [
    ['Источник', item.source === 'mobile-capture' ? 'Mobile' : 'Desktop'],
    ['Ввод', item.inputType === 'voice' ? 'Голос' : 'Текст'],
    ['Время захвата', formatProcessingTime(item.createdAt)],
  ];
  metaLines.forEach(([label, value]) => {
    const line = document.createElement('div');
    line.className = 'inbox-provenance-line';
    const lbl = document.createElement('span');
    lbl.className = 'inbox-provenance-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'inbox-provenance-value';
    val.textContent = value;
    line.append(lbl, val);
    provenanceBlock.appendChild(line);
  });
  provenanceToggle.addEventListener('click', () => {
    const open = provenanceBlock.hidden;
    provenanceBlock.hidden = !open;
    provenanceToggle.textContent = open ? '▾ Исходник' : '▸ Исходник';
  });
  body.append(provenanceToggle, provenanceBlock);

  if (isRouted) {
    const resultTask = (item.resultRef.type === 'knowledge' ? state.knowledge : state.tasks).find(task => task.id === item.resultRef.id);
    body.appendChild(buildLinkedResult(item, resultTask));
  } else if (isFinalized) {
    body.appendChild(buildFinalizedResult(item));
  } else {
    // The main question first: "Что это?". The picker stays available while
    // the user can still change their mind, including for Task items.
    const questionLabel = document.createElement('div');
    questionLabel.className = 'inbox-step-label';
    questionLabel.textContent = 'Что это?';
    body.appendChild(questionLabel);
    body.appendChild(typeBar);

    if (isTask) {
      body.appendChild(buildRoutingControls(item));
    } else if (item.itemType === 'thought' || item.itemType === 'note') {
      body.appendChild(buildRoutingControls(item));
    }
  }

  // Routed cards own their full action set inside the linked-result block
  // (Открыть задачу / Вернуть в разбор / Править / Удалить) — the card-level
  // action row is only for non-routed cards, to avoid duplicated buttons.
  if (!isRouted) {
    const actions = document.createElement('div');
    actions.className = 'inbox-row-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'inbox-button secondary';
    edit.textContent = '✎ Править';
    edit.addEventListener('click', () => enterEditMode(item.id));
    actions.appendChild(edit);

    if (!isFinalized) {
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'inbox-button secondary';
      discard.textContent = 'Отбросить';
      discard.addEventListener('click', () => {
        if (updateInbox(item.id, { status: 'discarded' })) {
          commit('inbox:discarded');
        }
        openInboxList();
      });
      actions.appendChild(discard);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'inbox-button destructive';
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
    actions.appendChild(remove);

    row.append(body, actions);
  } else {
    row.append(body);
  }
  return row;
}

// Compact queue row: non-active records show text + minimal meta only.
function renderCompactRow(item){
  const row = document.createElement('article');
  const statusClass = (item.status === 'processed' || item.status === 'discarded')
    ? ' inbox-row--processed' : '';
  row.className = `inbox-row inbox-row--compact${statusClass}`;

  const text = document.createElement('div');
  text.className = 'inbox-row-text';
  text.textContent = item.text;

  const meta = document.createElement('div');
  meta.className = 'inbox-row-meta';

  const time = document.createElement('span');
  time.className = 'inbox-time';
  time.textContent = formatProcessingTime(item.createdAt);
  meta.append(time);

  if (item.itemType) meta.appendChild(typeChip(item));

  // Routed tasks carry their priority as a compact colored marker, so the
  // queue itself shows importance without expanding the row.
  if (item.resultRef?.type === 'task') {
    const task = state.tasks.find(entry => entry.id === item.resultRef.id);
    if (task) {
      const marker = document.createElement('span');
      marker.className = `inbox-priority-marker inbox-priority-marker--p${task.priority || 2}`;
      marker.textContent = PRIORITY_LABELS[task.priority] || 'Обычный';
      meta.appendChild(marker);
    }
  }

  const chevron = document.createElement('span');
  chevron.className = 'inbox-compact-chevron';
  chevron.textContent = '›';

  row.append(text, meta, chevron);
  row.addEventListener('click', () => {
    // One focus at a time: expanding a compact record leaves edit mode
    // (the draft stays preserved) and collapses the previous active card.
    editState.exit();
    activeProcessingId = item.id;
    openInboxList();
  });
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
  currentDialogView = 'capture';
  const body = document.getElementById('inboxDialogBody');
  body.innerHTML = `
    <p class="inbox-help">Запишите мысли как есть. Каждая непустая строка станет отдельной записью.</p>
    <textarea id="inboxCaptureText" class="inbox-capture" rows="7" placeholder="Позвонить врачу&#10;Идея для проекта&#10;Купить подарок"></textarea>
    <div class="inbox-capture-extras"></div>
    <div class="inbox-actions">
      <button type="button" class="inbox-button secondary" id="inboxOpenList">Открыть список</button>
      <button type="button" class="inbox-button secondary" id="inboxCaptureRefine">+ Уточнить</button>
      <button type="button" class="inbox-button primary" id="inboxCaptureSave">Сохранить</button>
    </div>
    <div class="inbox-saved-banner" id="inboxSavedBanner" hidden></div>`;

  const input = document.getElementById('inboxCaptureText');
  const extras = document.querySelector('#inboxDialogBody .inbox-capture-extras');
  const refineButton = document.getElementById('inboxCaptureRefine');

  // ---- "+ Уточнить": Capture hints (type + domain), never final routing ----
  const hintBlock = document.createElement('div');
  hintBlock.className = 'inbox-capture-hints-block';
  hintBlock.hidden = true;

  const hintLabel = document.createElement('div');
  hintLabel.className = 'inbox-step-label';
  hintLabel.textContent = 'Подсказка типа:';
  const hintBar = document.createElement('div');
  hintBar.className = 'inbox-type-bar';
  ['task', 'thought', 'note'].forEach(hint => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inbox-type-button';
    button.dataset.captureHint = hint;
    button.textContent = `${ITEM_TYPE_ICONS[hint]} ${ITEM_TYPE_LABELS[hint]}`;
    button.addEventListener('click', () => {
      captureUserHint = captureUserHint === hint ? null : hint;
      updateHintUI();
    });
    hintBar.appendChild(button);
  });

  const domainRow = document.createElement('div');
  domainRow.className = 'inbox-route-row';
  domainRow.appendChild(makeLabel('Домен'));
  const domainSelect = makeSelect([
    { value: '', text: 'не выбран', selected: true },
    ...(Array.isArray(state.domains) ? state.domains : []).map(domain => ({
      value: domain.id,
      text: domain.title,
    })),
  ]);
  domainSelect.addEventListener('change', () => {
    captureDomainHintId = domainSelect.value || null;
  });
  domainRow.appendChild(domainSelect);

  const multiNote = document.createElement('div');
  multiNote.className = 'inbox-help';
  multiNote.textContent = 'Уточнение применится ко всем записям';
  multiNote.hidden = true;
  input.addEventListener('input', () => {
    multiNote.hidden = !input.value.includes('\n');
  });

  hintBlock.append(hintLabel, hintBar, domainRow, multiNote);
  extras.appendChild(hintBlock);

  function updateHintUI(){
    hintBar.querySelectorAll('button').forEach(button => {
      const active = button.dataset.captureHint === captureUserHint;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    domainSelect.value = captureDomainHintId || '';
  }
  updateHintUI();

  refineButton.addEventListener('click', () => {
    const open = hintBlock.hidden;
    hintBlock.hidden = !open;
    refineButton.textContent = open ? '− Скрыть уточнение' : '+ Уточнить';
  });

  // ---- Saved banner: a natural next step after Capture ----
  const savedBanner = document.getElementById('inboxSavedBanner');
  if (savedBannerCount > 0) {
    const text = document.createElement('span');
    const n = savedBannerCount;
    const plural = n === 1 ? 'запись' : (n >= 2 && n <= 4 ? 'записи' : 'записей');
    text.textContent = `✓ Сохранено ${n} ${plural}`;
    const goButton = document.createElement('button');
    goButton.type = 'button';
    goButton.className = 'inbox-button primary';
    goButton.textContent = 'Разобрать сейчас';
    goButton.addEventListener('click', () => {
      savedBannerCount = 0;
      queueFilter = 'review';
      openInboxList();
    });
    savedBanner.append(text, goButton);
    savedBanner.hidden = false;
  }

  const save = () => {
    const created = captureInbox(input.value, {
      userHint: captureUserHint,
      domainHintId: captureDomainHintId,
    });
    if (!created.length) {
      input.focus();
      return;
    }
    commit('inbox:capture');
    resetCaptureHints();
    savedBannerCount = created.length;
    input.value = '';
    updateHintUI();
    openInboxCapture();
  };
  document.getElementById('inboxCaptureSave').addEventListener('click', save);
  document.getElementById('inboxOpenList').addEventListener('click', () => {
    savedBannerCount = 0;
    resetCaptureHints();
    openInboxList();
  });
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  });
  requestAnimationFrame(() => input.focus());
}

function computeVisibleItems(){
  const activeFilter = QUEUE_FILTERS.find(filter => filter.key === queueFilter) || QUEUE_FILTERS[QUEUE_FILTERS.length - 1];
  const allItems = getInboxItems();
  const query = searchQuery.trim().toLowerCase();
  return allItems.filter(item => {
    if (!activeFilter.matches(item.status)) return false;
    if (!query) return true;
    const haystack = [
      item.text,
      item.rawText,
      item.itemType ? (ITEM_TYPE_LABELS[item.itemType] || item.itemType) : '',
      item.domainHintId ? (state.domains.find(domain => domain.id === item.domainHintId)?.title || '') : '',
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

function batchSetType(type){
  let applied = 0;
  for (const id of batchSelection) {
    const item = state.inbox.find(entry => entry.id === id);
    if (!item || item.resultRef) continue;
    updateInbox(id, { itemType: type });
    applied += 1;
  }
  commit('batch:type');
  if (typeof window.showToast === 'function') window.showToast(`Тип установлен: ${applied}`, 'ok');
  openInboxList();
}

function batchDiscard(){
  let applied = 0;
  for (const id of batchSelection) {
    const item = state.inbox.find(entry => entry.id === id);
    if (!item || item.resultRef) continue;
    updateInbox(id, { status: 'discarded' });
    applied += 1;
  }
  batchSelection.clear();
  batchMode = false;
  commit('batch:discard');
  if (typeof window.showToast === 'function') window.showToast(`Отброшено: ${applied}`, 'ok');
  openInboxList();
}

function batchAssignDomain(domainId){
  if (!domainId) return;
  let applied = 0;
  for (const id of batchSelection) {
    const item = state.inbox.find(entry => entry.id === id);
    if (!item || item.resultRef) continue;
    updateInbox(id, { domainHintId: domainId });
    applied += 1;
  }
  commit('batch:domain');
  if (typeof window.showToast === 'function') window.showToast(`Домен назначен: ${applied}`, 'ok');
  openInboxList();
}

// Sequential batch routing: stop at the first failure, never repeat a success,
// never corrupt the queue. Already-routed records are skipped by the command
// guard, not silently duplicated.
function batchCreateTasks(projectId, domainId, priority){
  const targets = [...batchSelection].filter(id => {
    const item = state.inbox.find(entry => entry.id === id);
    return item && item.itemType === 'task' && !item.resultRef;
  });
  let created = 0;
  for (const id of targets) {
    try {
      routeInboxToTask(id, {
        projectId: projectId || undefined,
        domainId: projectId ? undefined : (domainId || undefined),
        priority,
      });
      created += 1;
    } catch (error) {
      commit('batch:route-partial');
      if (typeof window.showToast === 'function') {
        window.showToast(`Ошибка: ${error.message}. Создано ${created} из ${targets.length}`, 'warn');
      }
      openInboxList();
      return;
    }
  }
  sessionDefaults.domainId = domainId || null;
  sessionDefaults.projectId = projectId || null;
  sessionDefaults.priority = priority;
  batchSelection.clear();
  batchMode = false;
  commit('batch:route');
  if (typeof window.showToast === 'function') window.showToast(`Создано задач: ${created}`, 'ok');
  openInboxList();
}

function renderBatchBar(container){
  const bar = document.createElement('div');
  bar.className = 'inbox-batch-bar';

  const count = document.createElement('span');
  count.className = 'inbox-help';
  count.textContent = `Выбрано: ${batchSelection.size}`;

  const typeBar = document.createElement('div');
  typeBar.className = 'inbox-type-bar';
  ['task', 'thought', 'note'].forEach(type => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inbox-type-button';
    button.dataset.batchType = type;
    button.textContent = `${ITEM_TYPE_ICONS[type]} ${ITEM_TYPE_LABELS[type]}`;
    button.addEventListener('click', () => batchSetType(type));
    typeBar.appendChild(button);
  });

  const discardButton = document.createElement('button');
  discardButton.type = 'button';
  discardButton.className = 'inbox-button secondary';
  discardButton.textContent = 'Отбросить';
  discardButton.addEventListener('click', batchDiscard);

  const domainSelect = makeSelect([
    { value: '', text: 'Домен: —', selected: batchDomainId === '' },
    ...(Array.isArray(state.domains) ? state.domains : []).map(domain => ({
      value: domain.id,
      text: domain.title,
      selected: domain.id === batchDomainId,
    })),
  ]);
  domainSelect.addEventListener('change', () => {
    batchDomainId = domainSelect.value;
    batchAssignDomain(batchDomainId || '');
  });

  const projectSelect = makeSelect([{ value: '', text: 'Проект: —', selected: true }]);
  const repopulate = () => {
    projectSelect.replaceChildren();
    projectSelect.appendChild(new Option('Проект: —', ''));
    state.projects
      .filter(project => project.domainId === batchDomainId)
      .forEach(project => {
        const option = new Option(project.title, project.id);
        if (project.id === batchProjectId) option.selected = true;
        projectSelect.appendChild(option);
      });
  };
  domainSelect.addEventListener('change', () => {
    batchProjectId = '';
    repopulate();
  });
  projectSelect.addEventListener('change', () => {
    batchProjectId = projectSelect.value;
  });
  repopulate();

  const priorityBar = document.createElement('div');
  priorityBar.className = 'inbox-priority-bar';
  PRIORITY_ORDER.forEach(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inbox-type-button inbox-priority-button';
    button.dataset.priority = String(value);
    if (value === batchPriority) button.classList.add('is-active');
    button.textContent = PRIORITY_LABELS[value];
    button.addEventListener('click', () => {
      batchPriority = value;
      priorityBar.querySelectorAll('button').forEach(other => {
        other.classList.toggle('is-active', other === button);
      });
    });
    priorityBar.appendChild(button);
  });

  const taskCount = [...batchSelection].filter(id => {
    const item = state.inbox.find(entry => entry.id === id);
    return item && item.itemType === 'task' && !item.resultRef;
  }).length;

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'inbox-button primary';
  createButton.textContent = `Создать ${taskCount} задач`;
  createButton.disabled = taskCount === 0;
  createButton.addEventListener('click', () => {
    batchCreateTasks(batchProjectId || null, batchDomainId || null, batchPriority);
  });

  bar.append(count, typeBar, discardButton, domainSelect, projectSelect, priorityBar, createButton);
  container.appendChild(bar);
}

function renderBatchRows(container, items){
  const list = document.createElement('div');
  list.className = 'inbox-list';
  items.forEach(item => {
    const row = document.createElement('article');
    row.className = 'inbox-row inbox-row--batch';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = batchSelection.has(item.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) batchSelection.add(item.id);
      else batchSelection.delete(item.id);
      openInboxList();
    });

    const text = document.createElement('div');
    text.className = 'inbox-row-text';
    text.textContent = item.text;

    row.append(checkbox, text);
    if (item.itemType) row.appendChild(typeChip(item));
    list.appendChild(row);
  });
  container.appendChild(list);
}

export function openInboxList(){
  createShell();
  root.hidden = false;
  setBodyTitle('Входящие · разбор');
  savedBannerCount = 0;
  currentDialogView = 'list';
  const body = document.getElementById('inboxDialogBody');
  body.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'inbox-toolbar';
  const summary = document.createElement('div');
  summary.className = 'inbox-summary';
  const allItems = getInboxItems();
  const remainingCount = allItems.filter(item => item.status === 'new' || item.status === 'reviewed').length;
  summary.textContent = allItems.length === 0
    ? 'Здесь пусто.'
    : `К разбору: ${remainingCount}`;
  const captureButton = document.createElement('button');
  captureButton.type = 'button';
  captureButton.className = 'inbox-button inbox-button--capture';
  captureButton.textContent = '+ Записать';
  captureButton.addEventListener('click', openInboxCapture);
  toolbar.append(summary, captureButton);
  body.appendChild(toolbar);

  // Calm, full-width local search.
  const searchRow = document.createElement('div');
  searchRow.className = 'inbox-search-row';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'inbox-search-input';
  searchInput.placeholder = 'Найти во входящих…';
  searchInput.value = searchQuery;
  searchInput.setAttribute('aria-label', 'Найти во входящих');
  searchRow.appendChild(searchInput);
  body.appendChild(searchRow);

  // One control strip: queue filters on the left, batch mode switch on the right.
  const batchToggle = document.createElement('button');
  batchToggle.type = 'button';
  batchToggle.className = `inbox-button inbox-mode-toggle${batchMode ? ' is-active' : ''}`;
  batchToggle.setAttribute('aria-pressed', batchMode ? 'true' : 'false');
  batchToggle.textContent = batchMode ? 'Готово' : 'Выбрать несколько';
  batchToggle.addEventListener('click', () => {
    batchMode = !batchMode;
    if (!batchMode) batchSelection.clear();
    openInboxList();
  });

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
      if (queueFilter !== 'review') batchSelection.clear();
      openInboxList();
    });
    filters.appendChild(button);
  });

  const controlsRow = document.createElement('div');
  controlsRow.className = 'inbox-controls-row';
  controlsRow.append(filters, batchToggle);
  body.appendChild(controlsRow);

  const listWrap = document.createElement('div');
  body.appendChild(listWrap);

  // Keyboard hints: one quiet line at the bottom, out of the way.
  const kbdHint = document.createElement('div');
  kbdHint.className = 'inbox-kbd-hint';
  kbdHint.innerHTML =
    '<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> тип · <kbd>J</kbd>/<kbd>K</kbd> запись · <kbd>Enter</kbd> готово · <kbd>Esc</kbd> свернуть';
  kbdHint.setAttribute('aria-hidden', 'true');
  body.appendChild(kbdHint);

  const renderQueue = () => {
    listWrap.replaceChildren();
    const items = computeVisibleItems();

    if (!batchMode) {
      // One active/expanded card; the rest of the queue stays compact. After a
      // record is processed it leaves "К разбору" and the next one takes over.
      if (!items.some(item => item.id === activeProcessingId)) {
        activeProcessingId = items[0]?.id ?? null;
      }
      const activeItem = items.find(item => item.id === activeProcessingId) || items[0] || null;
      // Started actually processing -> reviewed (automatic, Core command).
      if (activeItem && activeItem.status === 'new' && !activeItem.resultRef) {
        updateInbox(activeItem.id, { status: 'reviewed' });
      }
    }

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
      listWrap.appendChild(undo);
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inbox-empty-block';
      if (searchQuery.trim()) {
        empty.textContent = 'Ничего не найдено';
      } else if (queueFilter === 'review') {
        const line = document.createElement('div');
        line.textContent = 'Всё разобрано';
        const capture = document.createElement('button');
        capture.type = 'button';
        capture.className = 'inbox-button primary';
        capture.textContent = 'Записать новую мысль';
        capture.addEventListener('click', openInboxCapture);
        empty.append(line, capture);
      } else if (queueFilter === 'done') {
        empty.textContent = 'Пока ничего не разобрано';
      } else {
        empty.textContent = 'Здесь пусто.';
      }
      listWrap.appendChild(empty);
      return;
    }

    if (batchMode) {
      listWrap.classList.add('inbox-list-wrap--batch');
      renderBatchBar(listWrap);
      renderBatchRows(listWrap, items);
      return;
    }
    listWrap.classList.remove('inbox-list-wrap--batch');

    const list = document.createElement('div');
    list.className = 'inbox-list';
    items.forEach(item => {
      const row = editState.isActive(item.id)
        ? renderEditRow(item)
        : (item.id === activeProcessingId
          ? renderDisplayRow(item)
          : renderCompactRow(item));
      list.appendChild(row);
    });
    listWrap.appendChild(list);
  };

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderQueue();
  });

  renderQueue();
}

export function initInbox(options = {}){
  onStateChange = options.onStateChange || (() => {});
  createShell();
  updateCounter();
  document.getElementById('btnInbox')?.addEventListener('click', openInboxList);
  document.addEventListener('keydown', event => {
    if (!root || root.hidden) return;
    const key = event.key;

    if (key === 'Escape') {
      // Collapse an open collapsible first (Дополнительно / Исходник).
      const openExtra = root.querySelector('.inbox-route-extra:not([hidden]), .inbox-provenance:not([hidden])');
      if (openExtra) {
        openExtra.hidden = true;
        root.querySelectorAll('.inbox-extra-toggle').forEach(toggle => {
          if (toggle.textContent.startsWith('▾')) toggle.textContent = toggle.textContent.replace('▾', '▸');
        });
        event.preventDefault();
        return;
      }
      // Esc closes the overlay only from outside the dialog; while working
      // inside a record it must not unexpectedly close the whole center.
      const insideDialog = event.target instanceof Element && event.target.closest('.inbox-dialog');
      if (!insideDialog) {
        event.preventDefault();
        closeInbox();
      }
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
      return;
    }

    if (isTypingTarget(event.target)) return;
    if (currentDialogView !== 'list' || batchMode) return;

    // J / ↓ — next record, K / ↑ — previous record.
    if (key === 'j' || key === 'J' || key === 'ArrowDown' || key === 'k' || key === 'K' || key === 'ArrowUp') {
      const items = computeVisibleItems();
      if (items.length === 0) return;
      const index = items.findIndex(item => item.id === activeProcessingId);
      const direction = (key === 'j' || key === 'J' || key === 'ArrowDown') ? 1 : -1;
      const base = index < 0 ? 0 : index;
      const next = items[Math.max(0, Math.min(items.length - 1, base + direction))];
      if (next && next.id !== activeProcessingId) {
        editState.exit();
        activeProcessingId = next.id;
        openInboxList();
      }
      event.preventDefault();
      return;
    }

    // 1 / 2 / 3 — set the confirmed type of the active record.
    if (key === '1' || key === '2' || key === '3') {
      const item = state.inbox.find(entry => entry.id === activeProcessingId);
      if (!item || item.resultRef) return;
      if (item.status === 'processed' || item.status === 'discarded') return;
      const type = { '1': 'task', '2': 'thought', '3': 'note' }[key];
      if (updateInbox(item.id, { itemType: type })) commit('inbox:update');
      openInboxList();
      event.preventDefault();
      return;
    }

    // Enter — the unambiguous primary action (Thought/Note → processed).
    if (key === 'Enter') {
      if (event.target instanceof HTMLButtonElement) return; // native click wins
      const item = state.inbox.find(entry => entry.id === activeProcessingId);
      if (!item || item.resultRef) return;
      if (item.itemType !== 'thought' && item.itemType !== 'note') return;
      if (item.status === 'processed' || item.status === 'discarded') return;
      root.querySelector('[data-route-submit]')?.click();
      openInboxList();
      event.preventDefault();
    }
  });
}

export function openProcessingItem(id){
  queueFilter = 'review';
  searchQuery = '';
  batchMode = false;
  activeProcessingId = id;
  openInboxList();
}
