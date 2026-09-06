import { state } from '../state.js';
import { loadState } from '../storage.js';
import adapter from '../storageAdapter.js';
import { captureInbox, deleteInbox, undoDeleteInbox } from '../core/commands.js';
import { getInboxItems } from '../features/inbox/model.js';
import { getDeviceId } from '../core/device.js';
import { APP_VERSION } from '../version.js';
import { loadCaptureDraft, saveCaptureDraft, clearCaptureDraft } from './draft.js';
import { registerCaptureServiceWorker, initInstallExperience, getServiceWorkerStatus } from './pwa.js';
import { initShareTarget, applyShareDraft, mergeShareDrafts, resolveShortcutEntryPoint } from './share-target.js';
import {
  VOICE_STATES,
  appendFinalTranscript,
  createVoiceController,
  queryMicrophonePermission,
} from './voice.js';
import { createSyncRuntime, requestSyncNow } from '../sync/runtime.js';
import { createSyncPanel } from '../sync/ui.js';
import { syncCapabilities } from '../sync/capabilities.js';
import { getEntityDeliveryState } from '../sync/outbox.js';

// Capture is a projection-only client: it never owns a Task model, so a
// routed resultRef arriving here is accepted only as a C2 projection
// reference. Declared explicitly — never inferred from state shape.
syncCapabilities.hasTaskModel = false;

const RECENT_LIMIT = 8;
const DRAFT_DEBOUNCE_MS = 400;
const MIC_INTRO_KEY = 'atlas_capture_mic_intro_v1';

// Expose state globally for debugging/automation (same convention as Studio).
try { window.state = state; } catch (_) {}

let currentView = 'capture';
let currentUserHint = null;
let currentInputType = 'text';
let currentEntryPoint = 'app';
let voiceController = null;
let microphonePermission = 'unknown';
let lastRemoval = null;
let toastTimer = null;
let storageOk = true;
let draftStorageOk = true;
let draftSaveTimer = null;
let hasDraft = false;

function safeSetText(el, text) {
  if (el) el.textContent = text;
}

function safeGetValue(el) {
  return el ? el.value : '';
}

function updateClearDraftVisibility() {
  const btn = document.getElementById('btnClearDraft');
  if (btn) {
    const textarea = document.getElementById('captureText');
    const hasText = textarea && safeGetValue(textarea).trim().length > 0;
    btn.hidden = !hasText && !hasDraft;
  }
}

export function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.replaceChildren();
  const msg = document.createElement('span');
  msg.textContent = message;
  toast.appendChild(msg);
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    toastTimer = null;
  }, duration);
}

function showToastWithUndo(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.replaceChildren();

  const msg = document.createElement('span');
  msg.textContent = message;

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'toast-undo';
  undoBtn.textContent = 'Отменить';
  undoBtn.addEventListener('click', () => {
    if (lastRemoval && undoDeleteInbox(lastRemoval)) {
      lastRemoval = null;
      updateCounter();
      renderInboxList();
      renderRecentItems();
      requestSyncNow(); // C3/W2: the restoration reaches other devices immediately
      toast.hidden = true;
    }
  });

  toast.append(msg, undoBtn);
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    lastRemoval = null;
    toastTimer = null;
  }, 5000);
}

function updateStatus(text) {
  safeSetText(document.getElementById('status'), text);
}

function updateCounter() {
  const count = Array.isArray(state.inbox) ? state.inbox.length : 0;
  safeSetText(document.getElementById('counter'), String(count));
}

function scheduleDraftSave() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;
    flushCaptureDraft();
  }, DRAFT_DEBOUNCE_MS);
}

export function flushCaptureDraft() {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }

  const text = safeGetValue(document.getElementById('captureText'));
  if (!text.trim()) {
    hasDraft = false;
    draftStorageOk = clearCaptureDraft();
    updateClearDraftVisibility();
    return draftStorageOk;
  }

  hasDraft = true;
  draftStorageOk = saveCaptureDraft({
    text,
    userHint: currentUserHint,
    inputType: currentInputType,
    entryPoint: currentEntryPoint,
  });
  updateClearDraftVisibility();
  return draftStorageOk;
}

function renderRecentItems() {
  const container = document.getElementById('recentList');
  if (!container) return;
  container.replaceChildren();

  const items = getInboxItems().slice(0, RECENT_LIMIT);
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'capture-empty';
    empty.textContent = 'Пока нет записей';
    container.appendChild(empty);
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'capture-card';

    const textEl = document.createElement('div');
    textEl.className = 'capture-card-text';
    textEl.textContent = item.rawText || item.text;

    const fullText = item.rawText || item.text || '';
    const isLong = fullText.length > 120 || fullText.split('\n').length > 3;
    if (isLong) {
      card.setAttribute('aria-expanded', 'false');
      textEl.classList.add('capture-card-text--collapsed');
      card.addEventListener('click', () => {
        const expanded = card.getAttribute('aria-expanded') === 'true';
        card.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        textEl.classList.toggle('capture-card-text--collapsed', !expanded);
        textEl.classList.toggle('capture-card-text--expanded', expanded);
      });
    }

    const meta = document.createElement('div');
    meta.className = 'capture-card-meta';

    const time = document.createElement('span');
    time.className = 'capture-card-time';
    time.textContent = formatTime(item.createdAt);

    const typeIcon = document.createElement('span');
    typeIcon.className = 'capture-card-type';
    typeIcon.textContent = item.inputType === 'voice' ? '🎤' : '📝';

    const hint = document.createElement('span');
    hint.className = 'capture-card-hint';
    if (item.userHint) {
      const hintLabels = { task: 'Задача', thought: 'Мысль', note: 'Заметка' };
      hint.textContent = hintLabels[item.userHint] || '';
    }

    meta.append(time, typeIcon, hint);
    const deliveryBadge = buildInboxDeliveryBadge(item.id);
    if (deliveryBadge) meta.appendChild(deliveryBadge);
    card.append(textEl, meta);
    container.appendChild(card);
  });
}

const PRIORITY_LABELS = { 1: 'Низкий', 2: 'Обычный', 3: 'Высокий', 4: 'Критичный' };

function getTaskProjection(taskId) {
  const list = Array.isArray(state.taskProjections) ? state.taskProjections : [];
  return list.find(entry => entry.id === taskId) || null;
}

// Task due is structured ({ date: 'YYYY-MM-DD', time: 'HH:MM' | null }) —
// render the human label for both structured and legacy timestamp forms.
function formatDueLabel(due) {
  if (!due) return null;
  if (typeof due === 'object' && due.date) {
    const parts = String(due.date).split('-').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      const date = new Date(parts[0], parts[1] - 1, parts[2]);
      const label = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      return due.time ? `${label}, ${due.time}` : label;
    }
    return null;
  }
  const ts = Number(due);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// Processing state badge: К разбору / Разобрана · тип / Отброшена.
function buildInboxStatusBadge(item) {
  const badge = document.createElement('span');
  badge.className = 'inbox-row-status';
  if (item.status === 'discarded') {
    badge.textContent = 'Отброшена';
    badge.dataset.state = 'discarded';
  } else if (item.status === 'processed') {
    if (item.resultRef?.type === 'task') {
      badge.textContent = '✓ Разобрана';
      badge.dataset.state = 'processed';
    } else {
      const labels = { task: 'Задача', thought: 'Мысль', note: 'Заметка' };
      badge.textContent = `✓ Разобрана · ${labels[item.itemType] || 'Запись'}`;
      badge.dataset.state = 'processed';
    }
  } else {
    badge.textContent = 'К разбору';
    badge.dataset.state = 'pending';
  }
  return badge;
}

function buildInboxDeliveryBadge(itemId) {
  const deliveryState = getEntityDeliveryState('inbox', itemId);
  if (!deliveryState) return null;
  const badge = document.createElement('span');
  badge.className = 'inbox-row-delivery';
  badge.dataset.state = deliveryState;
  badge.textContent = {
    pending: '⏳ Ждёт отправки',
    failed: '⚠ Ошибка отправки',
    rejected: '⚠ Не принято сервером',
  }[deliveryState];
  return badge;
}

// C2: the routed result card. Renders the read-only Task projection when
// present, otherwise the honest fallback (no broken reference).
function buildTaskResultCard(item) {
  const card = document.createElement('div');
  card.className = 'inbox-result';
  const projection = getTaskProjection(item.resultRef.id);
  if (!projection) {
    const missing = document.createElement('div');
    missing.className = 'inbox-result-missing';
    missing.textContent = 'Результат недоступен на этом устройстве';
    card.appendChild(missing);
    return card;
  }

  const title = document.createElement('div');
  title.className = 'inbox-result-title';
  title.textContent = projection.title;

  const lines = [];
  const location = [projection.domainTitle, projection.projectTitle]
    .filter(Boolean)
    .join(' · ');
  if (location) lines.push(location);
  const priorityLabel = PRIORITY_LABELS[projection.priority] || null;
  const dueLabel = formatDueLabel(projection.due);
  const meta = [priorityLabel, dueLabel].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);

  card.appendChild(title);
  lines.forEach(text => {
    const line = document.createElement('div');
    line.className = 'inbox-result-line';
    line.textContent = text;
    card.appendChild(line);
  });

  if (projection.status === 'done') {
    const done = document.createElement('div');
    done.className = 'inbox-result-done';
    done.textContent = '✓ Выполнено';
    card.appendChild(done);
  }
  return card;
}

function renderInboxList() {
  const container = document.getElementById('inboxList');
  if (!container) return;
  container.replaceChildren();

  const items = getInboxItems();
  const countEl = document.getElementById('inboxCount');
  if (countEl) {
    const n = items.length;
    countEl.textContent = n === 1 ? '1 запись' : n >= 2 && n <= 4 ? `${n} записи` : `${n} записей`;
  }

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'capture-empty';
    empty.textContent = 'Входящие пусты';
    container.appendChild(empty);
    return;
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'inbox-row';

    const body = document.createElement('div');
    body.className = 'inbox-row-body';

    const textEl = document.createElement('div');
    textEl.className = 'inbox-row-text';
    textEl.textContent = item.rawText || item.text;

    const meta = document.createElement('div');
    meta.className = 'inbox-row-meta';

    const time = document.createElement('span');
    time.textContent = formatTime(item.createdAt);

    const typeIcon = document.createElement('span');
    typeIcon.textContent = item.inputType === 'voice' ? '🎤' : '📝';

    const source = document.createElement('span');
    source.className = 'inbox-row-source';
    source.textContent = item.source === 'mobile-capture' ? 'Мобильный' : 'Десктоп';

    const hint = document.createElement('span');
    if (item.userHint) {
      const hintLabels = { task: 'Задача', thought: 'Мысль', note: 'Заметка' };
      hint.textContent = hintLabels[item.userHint];
    }

    meta.append(time, typeIcon, source, hint);
    const deliveryBadge = buildInboxDeliveryBadge(item.id);
    if (deliveryBadge) meta.appendChild(deliveryBadge);
    body.append(textEl, meta);
    body.appendChild(buildInboxStatusBadge(item));
    if (item.resultRef?.type === 'task') {
      body.appendChild(buildTaskResultCard(item));
    } else if (item.resultRef?.type === 'knowledge') {
      const receipt = document.createElement('div');
      receipt.className = 'inbox-result';
      receipt.textContent = `${item.resultRef.kind === 'thought' ? 'Мысль' : 'Заметка'} · ${item.resultRef.title} · ${[item.resultRef.domainTitle, item.resultRef.projectTitle].filter(Boolean).join(' / ') || 'Без контекста'} · Сохранено в Studio`;
      body.appendChild(receipt);
    }

    const actions = document.createElement('div');
    actions.className = 'inbox-row-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'inbox-delete-btn';
    deleteBtn.setAttribute('aria-label', 'Удалить запись');
    deleteBtn.title = 'Удалить запись';
    deleteBtn.textContent = '🗑';
    if (item.resultRef?.type === 'knowledge') {
      deleteBtn.disabled = true;
      deleteBtn.title = 'Сначала верните материал в разбор в Studio';
    }
    deleteBtn.addEventListener('click', () => {
      lastRemoval = deleteInbox(item.id);
      if (lastRemoval) {
        updateCounter();
        renderInboxList();
        renderRecentItems();
        requestSyncNow(); // C3/W2: the deletion reaches other devices immediately
        showToastWithUndo('Запись удалена');
      }
    });

    actions.appendChild(deleteBtn);
    row.append(body, actions);
    container.appendChild(row);
  });
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function selectHint(hint) {
  const buttons = document.querySelectorAll('.capture-hint');
  if (currentUserHint === hint) {
    currentUserHint = null;
    buttons.forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });
  } else {
    currentUserHint = hint;
    buttons.forEach(btn => {
      const isActive = btn.dataset.hint === hint;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }
  scheduleDraftSave();
}

function restoreHintUI() {
  const buttons = document.querySelectorAll('.capture-hint');
  buttons.forEach(btn => {
    const isActive = btn.dataset.hint === currentUserHint;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function saveCapture() {
  if (!storageOk) {
    const draftSaved = flushCaptureDraft();
    showToast(draftSaved
      ? 'Не удалось сохранить во Входящие. Текст оставлен в черновике.'
      : 'Не удалось сохранить запись. Текст оставлен на экране — скопируйте его перед закрытием.', 8000);
    return;
  }

  const textarea = document.getElementById('captureText');
  const text = safeGetValue(textarea);
  if (!text.trim()) {
    textarea.focus();
    return;
  }

  updateStatus('Сохраняется…');

  try {
    const created = captureInbox(text, {
      inputType: currentInputType,
      source: 'mobile-capture',
      status: 'new',
      userHint: currentUserHint,
      deviceId: getDeviceId(),
      entryPoint: currentEntryPoint,
      splitLines: false,
    });

    if (created.length > 0) {
      textarea.value = '';
      clearCaptureDraft();
      hasDraft = false;
      currentUserHint = null;
      currentInputType = 'text';
      currentEntryPoint = 'app';
      document.querySelectorAll('.capture-hint').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      });
      updateClearDraftVisibility();
      updateStatus('Сохранено на этом устройстве');
      updateCounter();
      renderRecentItems();
      showToast('Запись сохранена во Входящих');
      requestSyncNow(); // C1: durable capture is in the outbox — deliver it
    }
  } catch (err) {
    updateStatus('Не удалось сохранить');
    const draftSaved = flushCaptureDraft();
    showToast(draftSaved
      ? 'Не удалось сохранить во Входящие. Текст оставлен в черновике.'
      : 'Не удалось сохранить запись. Текст оставлен на экране — скопируйте его перед закрытием.', 8000);
  }
}

const VOICE_STATUS_TEXT = {
  [VOICE_STATES.UNSUPPORTED]: 'Голосовой ввод недоступен в этом браузере. Текстовые записи продолжают работать.',
  [VOICE_STATES.IDLE]: '',
  [VOICE_STATES.REQUESTING]: 'Запрашиваю доступ…',
  [VOICE_STATES.LISTENING]: 'Слушаю…',
  [VOICE_STATES.PROCESSING]: 'Распознаю…',
  [VOICE_STATES.RESULT]: 'Проверьте текст',
  [VOICE_STATES.NO_SPEECH]: 'Речь не распознана. Попробуйте ещё раз.',
  [VOICE_STATES.DENIED]: 'Микрофон отключён. Разрешите доступ в настройках сайта / браузера.',
  [VOICE_STATES.AUDIO_ERROR]: 'Не удалось получить доступ к микрофону.',
  [VOICE_STATES.NETWORK_ERROR]: 'Для голосового распознавания сейчас нет соединения.',
  [VOICE_STATES.LANGUAGE_ERROR]: 'Русский язык распознавания сейчас недоступен.',
  [VOICE_STATES.GENERIC_ERROR]: 'Не удалось распознать речь.',
  [VOICE_STATES.ABORTED]: 'Голосовой ввод остановлен.',
};

function updateVoiceUI(state) {
  const btnMic = document.getElementById('btnMic');
  const listening = state === VOICE_STATES.LISTENING;
  btnMic.classList.toggle('recording', listening);
  btnMic.setAttribute('aria-pressed', listening ? 'true' : 'false');
  safeSetText(document.getElementById('voiceStatus'), VOICE_STATUS_TEXT[state] || '');
}

function hasSeenMicIntro() {
  try {
    return localStorage.getItem(MIC_INTRO_KEY) === 'seen';
  } catch (_) {
    return false;
  }
}

function markMicIntroSeen() {
  try {
    localStorage.setItem(MIC_INTRO_KEY, 'seen');
  } catch (_) {}
}

function showMicIntroDialog() {
  const dialog = document.getElementById('micIntroDialog');
  if (!dialog) return Promise.resolve(true);
  markMicIntroSeen();

  return new Promise(resolve => {
    const btnContinue = document.getElementById('btnMicIntroContinue');
    const btnLater = document.getElementById('btnMicIntroLater');

    function finish(shouldContinue) {
      btnContinue.removeEventListener('click', onContinue);
      btnLater.removeEventListener('click', onLater);
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
      resolve(shouldContinue);
    }
    function onContinue() { finish(true); }
    function onLater() { finish(false); }
    function onCancel(event) {
      event.preventDefault();
      finish(false);
    }

    btnContinue.addEventListener('click', onContinue);
    btnLater.addEventListener('click', onLater);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
  });
}

function showMicDeniedDialog() {
  const dialog = document.getElementById('micDeniedDialog');
  if (!dialog || dialog.open) return;
  const btnHelp = document.getElementById('btnMicDeniedHelp');
  const btnText = document.getElementById('btnMicUseText');
  const help = document.getElementById('micDeniedInstructions');

  help.hidden = true;
  function cleanup() {
    btnHelp.removeEventListener('click', onHelp);
    btnText.removeEventListener('click', onText);
  }
  function onHelp() {
    help.hidden = false;
    help.focus();
  }
  function onText() {
    cleanup();
    dialog.close();
    document.getElementById('captureText').focus();
  }

  btnHelp.addEventListener('click', onHelp);
  btnText.addEventListener('click', onText);
  dialog.addEventListener('close', cleanup, { once: true });
  dialog.showModal();
}

async function refreshMicrophonePermission() {
  microphonePermission = await queryMicrophonePermission(navigator);
  return microphonePermission;
}

async function beginVoiceSession() {
  if (!voiceController?.isSupported()) return;
  const permission = await refreshMicrophonePermission();
  if (permission === 'denied') {
    updateVoiceUI(VOICE_STATES.DENIED);
    showMicDeniedDialog();
    return;
  }

  if (!hasSeenMicIntro()) {
    const shouldContinue = await showMicIntroDialog();
    if (!shouldContinue) {
      updateVoiceUI(VOICE_STATES.IDLE);
      document.getElementById('btnMic').focus();
      return;
    }
  }

  voiceController.start();
}

function initVoice() {
  const btnMic = document.getElementById('btnMic');
  voiceController = createVoiceController({
    lang: 'ru-RU',
    scope: window,
    onState: updateVoiceUI,
    onInterim: () => safeSetText(document.getElementById('voiceStatus'), 'Распознаю…'),
    onFinal: transcript => {
      const textarea = document.getElementById('captureText');
      textarea.value = appendFinalTranscript(safeGetValue(textarea), transcript);
      currentInputType = 'voice';
      flushCaptureDraft();
    },
    onError: state => {
      if (state === VOICE_STATES.DENIED) {
        microphonePermission = 'denied';
        showMicDeniedDialog();
      }
    },
  });

  if (!voiceController.isSupported()) {
    btnMic.disabled = true;
    btnMic.title = 'Голосовой ввод недоступен в этом браузере';
    updateVoiceUI(VOICE_STATES.UNSUPPORTED);
    return;
  }

  updateVoiceUI(VOICE_STATES.IDLE);
  btnMic.addEventListener('click', () => {
    const state = voiceController.getState();
    if ([VOICE_STATES.REQUESTING, VOICE_STATES.LISTENING, VOICE_STATES.PROCESSING].includes(state)) {
      voiceController.stop();
      return;
    }
    beginVoiceSession();
  });
}

function restoreDraft() {
  const draft = loadCaptureDraft();
  if (!draft || !draft.text) return;

  const textarea = document.getElementById('captureText');
  if (textarea) {
    textarea.value = draft.text;
  }
  currentUserHint = draft.userHint;
  currentInputType = draft.inputType;
  currentEntryPoint = draft.entryPoint;
  hasDraft = true;
  restoreHintUI();
  updateClearDraftVisibility();
  showToast('Черновик восстановлен', 3000);
}

function init() {
  let raw = null;
  try {
    raw = localStorage.getItem(adapter.key);
  } catch (e) {
    storageOk = false;
    updateStatus('Локальное хранилище недоступно');
    showToast('Новые записи временно не сохраняются.', 8000);
    document.getElementById('btnSave').disabled = true;
  }

  if (raw && storageOk) {
    try {
      const ok = loadState();
      if (!ok) {
        storageOk = false;
        updateStatus('Локальные данные Atlas не удалось прочитать');
        showToast('Запись сохранена только как черновик.', 8000);
        document.getElementById('btnSave').disabled = true;
      }
    } catch (e) {
      storageOk = false;
      updateStatus('Локальные данные Atlas не удалось прочитать');
      showToast('Запись сохранена только как черновик.', 8000);
      document.getElementById('btnSave').disabled = true;
    }
  }

  safeSetText(document.getElementById('version'), APP_VERSION);
  updateCounter();

  restoreDraft();

  const shareDraft = initShareTarget();
  if (shareDraft) {
    const existing = loadCaptureDraft();
    const result = applyShareDraft(shareDraft, existing);
    if (result.action === 'replace') {
      const textarea = document.getElementById('captureText');
      textarea.value = result.draft.text;
      currentUserHint = result.draft.userHint;
      currentInputType = result.draft.inputType;
      currentEntryPoint = result.draft.entryPoint;
      hasDraft = true;
      flushCaptureDraft();
      restoreHintUI();
      updateClearDraftVisibility();
      showToast('Получено через «Поделиться». Проверьте запись перед сохранением.', 5000);
    } else if (result.action === 'choice') {
      showShareChoiceDialog(result.draft, result.existing);
    }
  }

  document.getElementById('btnSave').addEventListener('click', saveCapture);
  document.getElementById('btnAllInbox').addEventListener('click', () => navigateTo('inbox'));
  document.getElementById('btnNewCapture').addEventListener('click', () => {
    navigateTo('capture');
    const textarea = document.getElementById('captureText');
    if (textarea) textarea.focus();
  });

  document.getElementById('btnClearDraft').addEventListener('click', () => {
    const textarea = document.getElementById('captureText');
    const text = safeGetValue(textarea).trim();
    if (!text) return;
    if (!confirm('Очистить черновик?')) return;
    textarea.value = '';
    clearCaptureDraft();
    currentUserHint = null;
    currentInputType = 'text';
    currentEntryPoint = 'app';
    hasDraft = false;
    document.querySelectorAll('.capture-hint').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });
    updateClearDraftVisibility();
    showToast('Черновик очищен');
  });

  document.getElementById('navCapture').addEventListener('click', () => navigateTo('capture'));
  document.getElementById('navInbox').addEventListener('click', () => navigateTo('inbox'));

  document.getElementById('btnInfo').addEventListener('click', () => navigateTo('info'));
  document.getElementById('btnBackFromInfo').addEventListener('click', () => navigateTo('capture'));

  document.querySelectorAll('.capture-hint').forEach(btn => {
    btn.addEventListener('click', () => selectHint(btn.dataset.hint));
  });

  const textarea = document.getElementById('captureText');
  textarea.addEventListener('input', () => {
    scheduleDraftSave();
    updateClearDraftVisibility();
  });
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveCapture();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushCaptureDraft();
    } else {
      refreshMicrophonePermission();
    }
  });
  window.addEventListener('pagehide', flushCaptureDraft);
  window.addEventListener('beforeunload', flushCaptureDraft);

  initVoice();
  initOnlineStatus();
  initSync();
  registerCaptureServiceWorker({
    showToast,
    flushDraft: flushCaptureDraft,
  });
  initInstallExperience();

  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  if (action === 'new') {
    currentEntryPoint = resolveShortcutEntryPoint(loadCaptureDraft());
    navigateTo('capture');
    clearShareParamsFromUrl();
  } else {
    const hash = window.location.hash.slice(1);
    if (hash === 'inbox') {
      navigateTo('inbox');
    } else if (hash === 'info') {
      navigateTo('info');
    } else {
      navigateTo('capture');
    }
  }

  window.addEventListener('hashchange', () => {
    const h = window.location.hash.slice(1);
    if (h === 'inbox' || h === 'capture' || h === 'info') {
      navigateTo(h);
    }
  });
}

function clearShareParamsFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('action');
    window.history.replaceState({}, '', url.pathname + url.hash);
  } catch (_) {}
}

function updateOnlineStatus() {
  const online = navigator.onLine;
  const statusEl = document.getElementById('status');
  if (!statusEl) return;
  if (online) {
    safeSetText(statusEl, 'Онлайн · текстовые записи сохраняются локально');
    statusEl.classList.remove('offline');
  } else {
    safeSetText(statusEl, 'Офлайн · текстовые записи работают. Голос может быть недоступен.');
    statusEl.classList.add('offline');
  }
}

function initOnlineStatus() {
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}

// Sync v1 (C1): remote transport runtime + status + pairing panel.
// Fire-and-forget by design: a sync failure never blocks capture.
function initSync() {
  let syncRuntime = null;
  try {
    syncRuntime = createSyncRuntime({});
    syncRuntime.start();
    window.atlasSync = syncRuntime;
  } catch (error) {
    console.warn('sync runtime failed to start', error?.message || error);
    return;
  }

  const panelMount = document.getElementById('infoSyncBody');
  if (panelMount) {
    try {
      createSyncPanel({ runtime: syncRuntime, mount: panelMount });
    } catch (error) {
      console.warn('sync panel failed to render', error?.message || error);
    }
  }

  // Remote operations were applied → refresh the visible lists.
  syncRuntime.subscribe(status => {
    if (status.pulled > 0) {
      updateCounter();
    }
    // Recent cards also carry per-record delivery markers; refresh them on
    // push/ack even when the cycle pulled no remote operations.
    renderRecentItems();
    // Delivery metadata changes on push/ack even when nothing was pulled.
    // Re-render the visible Inbox so per-record pending/error markers clear
    // immediately after acknowledgment.
    if (currentView === 'inbox') renderInboxList();
  });

  // The header status line reflects the delivery state while sync is
  // configured; otherwise it stays the classic network indicator.
  syncRuntime.subscribe(status => {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    if (!status.configured) {
      updateOnlineStatus();
      return;
    }
    statusEl.classList.remove('offline');
    if (!status.online) {
      safeSetText(statusEl, 'Офлайн · синхронизация ждёт сети');
      statusEl.classList.add('offline');
    } else if (status.syncing) {
      safeSetText(statusEl, 'Синхронизация…');
    } else if (status.authFailed) {
      safeSetText(statusEl, 'Синхронизация: нужна привязка');
    } else if (status.lastError) {
      safeSetText(statusEl, 'Синхронизация: ошибка');
    } else if (status.pending > 0) {
      safeSetText(statusEl, `Ожидают отправки: ${status.pending}`);
    } else if (status.rejected > 0) {
      safeSetText(statusEl, `Отклонено сервером: ${status.rejected}`);
    } else if (status.failed > 0) {
      safeSetText(statusEl, `Ошибки отправки: ${status.failed}`);
    } else {
      safeSetText(statusEl, 'Синхронизация включена');
    }
  });
}

function showShareChoiceDialog(shareDraft, existingDraft) {
  const dialog = document.getElementById('shareDialog');
  if (!dialog) return;

  const btnAppend = document.getElementById('btnShareAppend');
  const btnReplace = document.getElementById('btnShareReplace');
  const btnCancel = document.getElementById('btnShareCancel');

  function cleanup() {
    btnAppend.removeEventListener('click', onAppend);
    btnReplace.removeEventListener('click', onReplace);
    btnCancel.removeEventListener('click', onCancel);
    dialog.close();
  }

  function onAppend() {
    const textarea = document.getElementById('captureText');
    const merged = mergeShareDrafts(existingDraft, shareDraft);
    textarea.value = merged.text;
    currentUserHint = merged.userHint;
    currentInputType = merged.inputType;
    currentEntryPoint = merged.entryPoint;
    hasDraft = true;
    flushCaptureDraft();
    restoreHintUI();
    updateClearDraftVisibility();
    showToast('Текст добавлен к черновику', 3000);
    cleanup();
  }

  function onReplace() {
    const textarea = document.getElementById('captureText');
    textarea.value = shareDraft.text;
    currentUserHint = shareDraft.userHint;
    currentInputType = shareDraft.inputType;
    currentEntryPoint = shareDraft.entryPoint;
    hasDraft = true;
    flushCaptureDraft();
    restoreHintUI();
    updateClearDraftVisibility();
    showToast('Черновик заменён', 3000);
    cleanup();
  }

  function onCancel() {
    showToast('Текст не принят', 2000);
    cleanup();
  }

  btnAppend.addEventListener('click', onAppend);
  btnReplace.addEventListener('click', onReplace);
  btnCancel.addEventListener('click', onCancel);

  dialog.showModal();
}

async function updateInfoPanel() {
  const versionEl = document.getElementById('infoVersion');
  const statusEl = document.getElementById('infoStatus');
  const storageEl = document.getElementById('infoStorage');
  const swEl = document.getElementById('infoSW');
  const voiceEl = document.getElementById('infoVoice');
  const microphoneEl = document.getElementById('infoMicrophone');

  await refreshMicrophonePermission();
  const permissionLabels = {
    granted: 'Разрешено',
    prompt: 'Требуется запрос',
    denied: 'Запрещено',
    unknown: 'Неизвестно',
  };
  
  safeSetText(versionEl, `Версия: ${APP_VERSION}`);
  safeSetText(statusEl, `Сеть: ${navigator.onLine ? 'Онлайн' : 'Офлайн'}`);
  safeSetText(storageEl, `Storage: ${storageOk && draftStorageOk ? 'Доступно' : 'Ошибка'}`);
  safeSetText(swEl, `Service Worker: ${getServiceWorkerStatus()}`);
  safeSetText(voiceEl, `Voice: ${voiceController?.isSupported() ? 'Поддерживается' : 'Не поддерживается'}`);
  safeSetText(microphoneEl, `Microphone: ${permissionLabels[microphonePermission]}`);
}

function navigateTo(view) {
  if (currentView === 'capture' && view !== 'capture') {
    const text = safeGetValue(document.getElementById('captureText'));
    if (text.trim()) flushCaptureDraft();
  }
  currentView = view;
  const captureView = document.getElementById('captureView');
  const inboxView = document.getElementById('inboxView');
  const infoView = document.getElementById('infoView');
  const navCapture = document.getElementById('navCapture');
  const navInbox = document.getElementById('navInbox');

  captureView.hidden = view !== 'capture';
  inboxView.hidden = view !== 'inbox';
  infoView.hidden = view !== 'info';

  if (view === 'capture' || view === 'info') {
    navCapture.classList.add('active');
    navCapture.setAttribute('aria-current', 'page');
    navInbox.classList.remove('active');
    navInbox.removeAttribute('aria-current');
  } else if (view === 'inbox') {
    navCapture.classList.remove('active');
    navCapture.removeAttribute('aria-current');
    navInbox.classList.add('active');
    navInbox.setAttribute('aria-current', 'page');
  }

  if (view === 'capture') renderRecentItems();
  if (view === 'inbox') renderInboxList();
  if (view === 'info') updateInfoPanel();

  if (view !== 'info') {
    window.location.hash = view;
  }
}

init();
