import { state } from '../state.js';
import { loadState } from '../storage.js';
import adapter from '../storageAdapter.js';
import { captureInbox, deleteInbox, undoDeleteInbox } from '../core/commands.js';
import { getInboxItems } from '../features/inbox/index.js';
import { getDeviceId } from '../core/device.js';
import { APP_VERSION } from '../version.js';
import { loadCaptureDraft, saveCaptureDraft, clearCaptureDraft } from './draft.js';

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

function safeSetText(el, text) {
  if (el) el.textContent = text;
}

function safeGetValue(el) {
  return el ? el.value : '';
}

function showToast(message, duration = 3000) {
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
      saveCaptureDraft({ text, userHint: currentUserHint, inputType: currentInputType });
    } else {
      clearCaptureDraft();
    }
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

function navigateTo(view) {
  currentView = view;
  const captureView = document.getElementById('captureView');
  const inboxView = document.getElementById('inboxView');
  const navCapture = document.getElementById('navCapture');
  const navInbox = document.getElementById('navInbox');

  if (view === 'capture') {
    captureView.hidden = false;
    inboxView.hidden = true;
    navCapture.classList.add('active');
    navCapture.setAttribute('aria-current', 'page');
    navInbox.classList.remove('active');
    navInbox.removeAttribute('aria-current');
    renderRecentItems();
  } else {
    captureView.hidden = true;
    inboxView.hidden = false;
    navCapture.classList.remove('active');
    navCapture.removeAttribute('aria-current');
    navInbox.classList.add('active');
    navInbox.setAttribute('aria-current', 'page');
    renderInboxList();
  }
  window.location.hash = view;
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
      currentUserHint = null;
      currentInputType = 'text';
      document.querySelectorAll('.capture-hint').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      });
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
  restoreHintUI();
  showToast('Черновик восстановлен', 3000);
}

function init() {
  let raw = null;
  try {
    raw = adapter.load();
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

  document.getElementById('btnSave').addEventListener('click', saveCapture);
  document.getElementById('btnAllInbox').addEventListener('click', () => navigateTo('inbox'));
  document.getElementById('btnNewCapture').addEventListener('click', () => {
    navigateTo('capture');
    const textarea = document.getElementById('captureText');
    if (textarea) textarea.focus();
  });

  document.getElementById('navCapture').addEventListener('click', () => navigateTo('capture'));
  document.getElementById('navInbox').addEventListener('click', () => navigateTo('inbox'));

  document.querySelectorAll('.capture-hint').forEach(btn => {
    btn.addEventListener('click', () => selectHint(btn.dataset.hint));
  });

  const textarea = document.getElementById('captureText');
  textarea.addEventListener('input', scheduleDraftSave);
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveCapture();
    }
  });

  initVoice();

  const hash = window.location.hash.slice(1);
  if (hash === 'inbox') {
    navigateTo('inbox');
  } else {
    navigateTo('capture');
  }

  window.addEventListener('hashchange', () => {
    const h = window.location.hash.slice(1);
    if (h === 'inbox' || h === 'capture') {
      navigateTo(h);
    }
  });
}

init();
