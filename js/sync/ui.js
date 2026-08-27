// js/sync/ui.js — minimal Sync v1 user layer (Stage C1).
//
// Shared by Atlas Studio (desktop) and Atlas Capture (PWA):
//   - createSyncBadge: a compact live status control (state + pending count);
//   - createSyncPanel: the setup / status panel (pairing form, status rows,
//     create-code for the next device, revoke, conflict list);
//   - openSyncModal: a desktop modal wrapper around the panel.
//
// All text is set via textContent (no innerHTML with user data) — server URLs,
// device names and conflict reasons are treated as untrusted.
import { claimPairingCode } from './http-transport.js';

function el(tag, className, text){
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTime(timestamp){
  if (!timestamp) return '—';
  try {
    return new Date(timestamp).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch (_) {
    return String(timestamp);
  }
}

function shortId(deviceId){
  return deviceId ? deviceId.slice(0, 8) : '—';
}

// ---------------------------------------------------------------------------
// Live badge
// ---------------------------------------------------------------------------

export function createSyncBadge({ runtime, onClick }){
  const button = el('button', 'atlas-sync-badge', 'Синхронизация');
  button.type = 'button';
  if (onClick) button.addEventListener('click', onClick);

  function render(status){
    let text = 'Синхронизация';
    let state = 'off';
    if (!status.configured) {
      text = 'Синхронизация выкл.';
    } else if (status.syncing) {
      text = 'Синхронизация…';
      state = 'syncing';
    } else if (status.authFailed) {
      text = 'Синхронизация: привязка';
      state = 'error';
    } else if (status.lastError) {
      text = 'Синхронизация: ошибка';
      state = 'error';
    } else if (status.pending > 0) {
      text = `Ожидают: ${status.pending}`;
      state = 'pending';
    } else if (status.failed > 0) {
      text = `Ошибки: ${status.failed}`;
      state = 'error';
    } else {
      text = 'Синхронизация: вкл.';
      state = 'ok';
    }
    button.textContent = text;
    button.dataset.state = state;
    button.title = status.lastError
      ? status.lastError
      : status.configured
        ? `Последняя синхронизация: ${formatTime(status.lastSyncAt)}`
        : 'Синхронизация между устройствами выключена';
  }

  render(runtime.getStatus());
  const unsubscribe = runtime.subscribe ? runtime.subscribe(render) : null;
  return {
    el: button,
    destroy(){
      if (typeof unsubscribe === 'function') unsubscribe();
    },
  };
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function createSyncPanel({ runtime, mount }){
  if (!mount) throw new Error('createSyncPanel: mount is required');
  mount.replaceChildren();
  let disposed = false;
  const unsubscribe = runtime.subscribe ? runtime.subscribe(() => {
    if (!disposed) render();
  }) : null;

  function render(){
    if (disposed) return;
    const status = runtime.getStatus();
    mount.replaceChildren();
    if (!status.configured) {
      mount.appendChild(renderSetupForm());
    } else {
      mount.appendChild(renderConnected(status));
    }
  }

  function renderSetupForm(){
    const wrap = el('div', 'atlas-sync-setup');
    wrap.appendChild(el('p', 'atlas-sync-hint',
      'Привяжите это устройство к вашему серверу синхронизации. Код создаётся на уже привязанном устройстве (Атлас → Синхронизация → «Код для устройства») или на сервере.'));

    const fieldEndpoint = el('label', 'atlas-sync-field');
    fieldEndpoint.append(el('span', 'atlas-sync-label', 'Адрес сервера (https://…)'));
    const inputEndpoint = el('input');
    inputEndpoint.type = 'url';
    inputEndpoint.placeholder = 'https://atlas.example.com';
    inputEndpoint.value = '';
    fieldEndpoint.appendChild(inputEndpoint);

    const fieldName = el('label', 'atlas-sync-field');
    fieldName.append(el('span', 'atlas-sync-label', 'Имя устройства'));
    const inputName = el('input');
    inputName.type = 'text';
    inputName.placeholder = 'Мой телефон';
    inputName.value = '';
    fieldName.appendChild(inputName);

    const fieldCode = el('label', 'atlas-sync-field');
    fieldCode.append(el('span', 'atlas-sync-label', 'Код привязки (8 цифр)'));
    const inputCode = el('input');
    inputCode.type = 'text';
    inputCode.inputMode = 'numeric';
    inputCode.maxLength = 8;
    inputCode.placeholder = '00000000';
    fieldCode.appendChild(inputCode);

    const errorLine = el('div', 'atlas-sync-error');
    errorLine.hidden = true;
    const actions = el('div', 'atlas-sync-actions');
    const submit = el('button', 'atlas-sync-btn atlas-sync-btn-primary', 'Привязать');
    submit.type = 'button';
    submit.addEventListener('click', async () => {
      errorLine.hidden = true;
      const endpoint = inputEndpoint.value.trim();
      const code = inputCode.value.trim().replace(/\D/g, '');
      const deviceName = inputName.value.trim() || 'Atlas device';
      if (!endpoint || !code) {
        errorLine.textContent = 'Заполните адрес сервера и код привязки.';
        errorLine.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Привязка…';
      try {
        await runtime.pair({ endpoint, code, deviceName });
      } catch (error) {
        errorLine.textContent = error?.message || String(error);
        errorLine.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Привязать';
      }
    });
    actions.appendChild(submit);

    wrap.append(fieldEndpoint, fieldName, fieldCode, errorLine, actions);
    return wrap;
  }

  function renderConnected(status){
    const wrap = el('div', 'atlas-sync-connected');

    const rows = el('div', 'atlas-sync-rows');
    const row = (label, value) => {
      const r = el('div', 'atlas-sync-row');
      r.append(el('span', 'atlas-sync-row-label', label), el('span', 'atlas-sync-row-value', value));
      return r;
    };
    rows.append(
      row('Сервер', status.endpoint || '—'),
      row('Устройство', `${status.deviceName || '—'} (${shortId(status.deviceId)})`),
      row('Последняя синхронизация', formatTime(status.lastSyncAt)),
      row('Ожидают отправки', String(status.pending)),
      row('Ошибки отправки', String(status.failed)),
      row('Конфликты', String(status.conflicts)),
    );
    wrap.appendChild(rows);

    if (status.lastError) {
      const error = el('div', 'atlas-sync-error');
      error.textContent = status.lastError;
      wrap.appendChild(error);
    }

    const actions = el('div', 'atlas-sync-actions');
    const syncNow = el('button', 'atlas-sync-btn atlas-sync-btn-primary', 'Синхронизировать сейчас');
    syncNow.type = 'button';
    syncNow.addEventListener('click', () => runtime.syncNow());
    const createCode = el('button', 'atlas-sync-btn', 'Код для нового устройства');
    createCode.type = 'button';
    createCode.addEventListener('click', async () => {
      createCode.disabled = true;
      createCode.textContent = 'Создание кода…';
      try {
        const { code, expiresAt } = await runtime.createPairingCode();
        const codeLine = el('div', 'atlas-sync-code');
        codeLine.append(
          el('span', 'atlas-sync-code-digits', code || '—'),
          el('span', 'atlas-sync-code-expires', `действует до ${formatTime(expiresAt)}`),
        );
        wrap.insertBefore(codeLine, actions.nextSibling || null);
        wrap.appendChild(codeLine);
      } catch (error) {
        const errorLine = el('div', 'atlas-sync-error');
        errorLine.textContent = error?.message || String(error);
        wrap.appendChild(errorLine);
      } finally {
        createCode.disabled = false;
        createCode.textContent = 'Код для нового устройства';
      }
    });
    const revoke = el('button', 'atlas-sync-btn atlas-sync-btn-danger', 'Отключить синхронизацию');
    revoke.type = 'button';
    revoke.addEventListener('click', async () => {
      if (!window.confirm('Отключить синхронизацию на этом устройстве? Локальные данные останутся нетронутыми.')) return;
      revoke.disabled = true;
      await runtime.unpair();
    });
    actions.append(syncNow, createCode, revoke);
    wrap.appendChild(actions);

    const conflicts = runtime.getConflicts();
    const unresolved = conflicts.filter(entry => entry.resolution !== 'resolved');
    if (conflicts.length > 0) {
      const details = el('details', 'atlas-sync-conflicts');
      details.appendChild(el('summary', 'atlas-sync-conflicts-summary',
        unresolved.length > 0
          ? `Требуют решения: ${unresolved.length}${conflicts.length > unresolved.length ? ` (решено ${conflicts.length - unresolved.length})` : ''}`
          : `Конфликты (решено: ${conflicts.length})`));
      const list = el('ul', 'atlas-sync-conflicts-list');
      for (const entry of conflicts.slice(-20).reverse()) {
        const item = el('li');
        item.className = entry.resolution === 'resolved' ? 'atlas-sync-conflict is-resolved' : 'atlas-sync-conflict';
        const type = entry.operation?.type || 'unknown';
        const reason = entry.reason || '';
        const when = formatTime(entry.detectedAt);
        item.append(
          el('strong', null, type),
          el('span', null, ` — ${reason} · ${when}`),
        );
        if (entry.resolution === 'resolved') {
          item.appendChild(el('div', 'atlas-sync-conflict-resolved',
            `решено: ${entry.resolutionAction || 'dismiss'}`));
        } else {
          item.appendChild(buildConflictActions(entry));
        }
        list.appendChild(item);
      }
      details.appendChild(list);
      wrap.appendChild(details);
    }

    return wrap;
  }

  // C3: user actions for a pending conflict. The wording is human, not
  // technical — no "baseVersion mismatch" in the UI.
  function buildConflictActions(entry){
    const actions = el('div', 'atlas-sync-conflict-actions');
    const opType = entry.operation?.type || '';
    const conflictStatus = entry.conflictStatus || (entry.status || '');

    const addAction = (label, action, primary) => {
      const button = el('button', `atlas-sync-btn${primary ? ' atlas-sync-btn-primary' : ''}`, label);
      button.type = 'button';
      button.addEventListener('click', async () => {
        try {
          await runtime.resolveConflict(entry, action);
        } catch (error) {
          button.after(el('div', 'atlas-sync-error', error?.message || String(error)));
        }
      });
      actions.appendChild(button);
    };

    if (conflictStatus === 'deleted_race') {
      addAction('Оставить удалённой', 'keep_deleted');
      addAction('Восстановить и применить', 'restore_apply', true);
      return actions;
    }
    if (conflictStatus === 'base_version' && opType === 'inbox.update') {
      addAction('Оставить локальную', 'keep_local');
      addAction('Принять удалённую', 'accept_remote');
      addAction('Сохранить обе', 'keep_both');
      return actions;
    }
    // invalid / unsupported / other: dismissing is the only sensible action.
    addAction('Пропустить', 'dismiss');
    return actions;
  }

  render();
  return {
    destroy(){
      disposed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      mount.replaceChildren();
    },
  };
}

// ---------------------------------------------------------------------------
// Desktop modal wrapper
// ---------------------------------------------------------------------------

export function openSyncModal({ runtime, title = 'Синхронизация' }){
  const overlay = el('div', 'atlas-sync-modal-overlay');
  const modal = el('div', 'atlas-sync-modal');
  const header = el('div', 'atlas-sync-modal-header');
  header.appendChild(el('h3', null, title));
  const closeBtn = el('button', 'atlas-sync-modal-close', '✕');
  closeBtn.type = 'button';
  header.appendChild(closeBtn);
  const body = el('div', 'atlas-sync-modal-body');

  let panel = null;
  function open(){
    body.replaceChildren();
    panel = createSyncPanel({ runtime, mount: body });
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  function close(){
    document.removeEventListener('keydown', onKey);
    if (panel) panel.destroy();
    overlay.remove();
  }

  modal.append(header, body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  open();
  return { close, el: overlay };
}

// Helper for capturing the pairing code entered in a dialog created by the
// host app (kept for symmetry with claimPairingCode usage).
export { claimPairingCode };
