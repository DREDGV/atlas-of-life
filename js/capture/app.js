import { state } from '../state.js';
import { loadState } from '../storage.js';
import adapter from '../storageAdapter.js';
import { captureInbox, deleteInbox, undoDeleteInbox } from '../core/commands.js';
import { getInboxItems } from '../features/inbox/model.js';
import { getDeviceId } from '../core/device.js';
import { APP_VERSION, APP_LABEL } from '../version.js';
import { loadCaptureDraft, saveCaptureDraft, clearCaptureDraft } from './draft.js';
import { registerCaptureServiceWorker, initInstallExperience, isStandalone, getServiceWorkerStatus } from './pwa.js';
import { initShareTarget, applyShareDraft, mergeShareWithExisting } from './share-target.js';

const RECENT_LIMIT = 8;
const DRAFT_DEBOUNCE_MS = 400;

let currentView = 'capture';
let currentUserHint = null;
let currentInputType = 'text';
let isRecording = false;
let recognition = null;
let lastRemoval = null;
let toastTimer = null;
let storageOk = true;
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
    const textarea = document.getElementById('captureText');
    const text = safeGetValue(textarea).trim();
    if (text) {
      hasDraft = true;
      saveCaptureDraft({ text, userHint: currentUserHint, inputType: currentInputType });
    } else {
      hasDraft = false;
      clearCaptureDraft();
    }
    updateClearDraftVisibility();
  }, DRAFT_DEBOUNCE_MS);
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
    card.append(textEl, meta);
    container.appendChild(card);
  });
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
    body.append(textEl, meta);

    const actions = document.createElement('div');
    actions.className = 'inbox-row-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'inbox-delete-btn';
    deleteBtn.setAttribute('aria-label', 'Удалить запись');
    deleteBtn.title = 'Удалить запись';
    deleteBtn.textContent = '🗑';
    deleteBtn.addEventListener('click', () => {
      lastRemoval = deleteInbox(item.id);
      if (lastRemoval) {
        updateCounter();
        renderInboxList();
        renderRecentItems();
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
    showToast('Хранилище недоступно');
    return;
  }

  const textarea = document.getElementById('captureText');
  const text = safeGetValue(textarea).trim();
  if (!text) {
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
      splitLines: false,
    });

    if (created.length > 0) {
      textarea.value = '';
      clearCaptureDraft();
      hasDraft = false;
      currentUserHint = null;
      currentInputType = 'text';
      document.querySelectorAll('.capture-hint').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      });
      updateClearDraftVisibility();
      updateStatus('Сохранено на этом устройстве');
      updateCounter();
      renderRecentItems();
      showToast('Запись сохранена во Входящих');
    }
  } catch (err) {
    updateStatus('Не удалось сохранить');
    showToast('Ошибка сохранения');
  }
}

function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btnMic = document.getElementById('btnMic');
  const voiceStatus = document.getElementById('voiceStatus');

  if (!SpeechRecognition) {
    btnMic.disabled = true;
    btnMic.title = 'Голосовой ввод не поддерживается этим браузером';
    safeSetText(voiceStatus, 'Голосовой ввод не поддерживается этим браузером.');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'ru-RU';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isRecording = true;
    btnMic.classList.add('recording');
    btnMic.setAttribute('aria-pressed', 'true');
    safeSetText(voiceStatus, 'Слушаю…');
  };

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += transcript;
      } else {
        interim += transcript;
      }
    }

    const textarea = document.getElementById('captureText');
    if (final) {
      const current = safeGetValue(textarea);
      textarea.value = current ? current + ' ' + final : final;
      currentInputType = 'voice';
      safeSetText(voiceStatus, 'Проверьте текст');
      scheduleDraftSave();
    } else if (interim) {
      safeSetText(voiceStatus, 'Распознаю…');
    }
  };

  recognition.onerror = (event) => {
    isRecording = false;
    btnMic.classList.remove('recording');
    btnMic.setAttribute('aria-pressed', 'false');
    if (event.error === 'not-allowed') {
      safeSetText(voiceStatus, 'Доступ к микрофону запрещён. Разрешите в настройках браузера.');
    } else {
      safeSetText(voiceStatus, 'Ошибка распознавания');
    }
  };

  recognition.onend = () => {
    isRecording = false;
    btnMic.classList.remove('recording');
    btnMic.setAttribute('aria-pressed', 'false');
  };

  btnMic.addEventListener('click', () => {
    if (isRecording) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (e) {
        safeSetText(voiceStatus, 'Не удалось запустить распознавание');
      }
    }
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
      hasDraft = true;
      saveCaptureDraft(result.draft);
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

  initVoice();
  initOnlineStatus();
  registerCaptureServiceWorker({
    showToast,
    flushDraft: () => {
      const textarea = document.getElementById('captureText');
      const text = safeGetValue(textarea).trim();
      if (text) {
        saveCaptureDraft({ text, userHint: currentUserHint, inputType: currentInputType });
      }
    }
  });
  initInstallExperience();

  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  if (action === 'new') {
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

function initOnlineStatus() {
  const updateOnlineStatus = () => {
    const online = navigator.onLine;
    const statusEl = document.getElementById('status');
    if (online) {
      safeSetText(statusEl, 'Онлайн · локальные записи сохранены');
      statusEl.classList.remove('offline');
    } else {
      safeSetText(statusEl, 'Офлайн · записи сохраняются на устройстве');
      statusEl.classList.add('offline');
    }
  };

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
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
    const merged = mergeShareWithExisting(existingDraft.text, shareDraft.text);
    textarea.value = merged;
    currentUserHint = existingDraft.userHint || shareDraft.userHint;
    currentInputType = shareDraft.inputType;
    hasDraft = true;
    saveCaptureDraft({ text: merged, userHint: currentUserHint, inputType: currentInputType });
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
    hasDraft = true;
    saveCaptureDraft(shareDraft);
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

function updateInfoPanel() {
  const versionEl = document.getElementById('infoVersion');
  const statusEl = document.getElementById('infoStatus');
  const swEl = document.getElementById('infoSW');
  const inboxEl = document.getElementById('infoInbox');
  
  safeSetText(versionEl, `Версия: ${APP_VERSION}`);
  safeSetText(statusEl, navigator.onLine ? 'Онлайн' : 'Офлайн');
  safeSetText(swEl, `Service Worker: ${getServiceWorkerStatus()}`);
  
  const count = Array.isArray(state.inbox) ? state.inbox.length : 0;
  safeSetText(inboxEl, `Записей в Inbox: ${count}`);
}

function navigateTo(view) {
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
