import {
  DEFAULT_INBOX_SYNC_ENDPOINT,
  clearInboxSyncConfig,
  loadInboxSyncConfig,
  saveInboxSyncConfig,
} from './config.js';
import { getDeviceId } from '../core/device.js';
import {
  claimInboxDevice,
  createInboxPairingCode,
  revokeInboxDevice,
} from './http-transport.js';

function deviceName(){
  const ua = globalThis.navigator?.userAgent || '';
  if (/Android/i.test(ua)) return 'Atlas Capture Android';
  return 'Atlas Studio PC';
}

function button(text, type = 'button'){
  const element = document.createElement('button');
  element.type = type;
  element.textContent = text;
  return element;
}

function formatCode(value){
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  return digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
}

export function openInboxSyncSetup(){
  return new Promise(resolve => {
    const current = loadInboxSyncConfig();
    const connected = Boolean(current.enabled && current.token);
    const dialog = document.createElement('dialog');
    dialog.className = 'atlas-sync-dialog';

    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'atlas-sync-form';

    const title = document.createElement('h2');
    title.textContent = connected ? 'Синхронизация подключена' : 'Подключить устройство';
    const description = document.createElement('p');
    description.textContent = connected
      ? 'Записи синхронизируются автоматически. Можно подключить ещё одно устройство.'
      : 'Введите одноразовый код, показанный на уже подключённом устройстве.';
    const error = document.createElement('div');
    error.className = 'atlas-sync-error';
    error.hidden = true;
    const content = document.createElement('div');
    content.className = 'atlas-sync-pairing';
    const actions = document.createElement('div');
    actions.className = 'atlas-sync-actions';
    const close = button('Закрыть');
    actions.append(close);

    function showError(value){
      error.textContent = value;
      error.hidden = !value;
    }

    function setBusy(value){
      for (const control of form.querySelectorAll('button,input')) control.disabled = value;
    }

    function finish(value){
      dialog.close();
      dialog.remove();
      resolve(value);
    }

    if (connected) {
      const status = document.createElement('div');
      status.className = 'atlas-sync-connected';
      status.textContent = '● Устройство подключено';
      const codeResult = document.createElement('div');
      codeResult.className = 'atlas-sync-code-result';
      codeResult.hidden = true;
      const createCode = button('Подключить другое устройство');
      const disconnect = button('Отключить это устройство');
      disconnect.className = 'danger';
      createCode.addEventListener('click', async () => {
        showError('');
        setBusy(true);
        try {
          const result = await createInboxPairingCode(current);
          codeResult.textContent = formatCode(result.code);
          codeResult.hidden = false;
          description.textContent = 'Введите этот код на другом устройстве в течение 5 минут.';
        } catch (requestError) {
          showError(requestError.message || 'Не удалось создать код подключения');
        } finally {
          setBusy(false);
        }
      });
      disconnect.addEventListener('click', async () => {
        showError('');
        setBusy(true);
        try {
          await revokeInboxDevice(current);
          clearInboxSyncConfig();
          finish({ enabled: false });
        } catch (requestError) {
          showError(requestError.message || 'Не удалось отключить устройство');
          setBusy(false);
        }
      });
      content.append(status, createCode, codeResult, disconnect);
    } else {
      const code = document.createElement('input');
      code.type = 'text';
      code.inputMode = 'numeric';
      code.autocomplete = 'one-time-code';
      code.placeholder = '0000 0000';
      code.maxLength = 9;
      code.className = 'atlas-sync-code-input';
      code.setAttribute('aria-label', 'Код подключения');
      code.addEventListener('input', () => { code.value = formatCode(code.value); });
      const connect = button('Подключить', 'submit');
      connect.className = 'primary';
      actions.prepend(connect);
      content.append(code);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const normalizedCode = code.value.replace(/\D/g, '');
        if (!/^\d{8}$/.test(normalizedCode)) {
          showError('Введите 8 цифр кода подключения');
          return;
        }
        showError('');
        setBusy(true);
        try {
          const claimed = await claimInboxDevice({
            endpoint: DEFAULT_INBOX_SYNC_ENDPOINT,
            code: normalizedCode,
            deviceId: getDeviceId(),
            deviceName: deviceName(),
          });
          const saved = saveInboxSyncConfig({
            enabled: true,
            endpoint: DEFAULT_INBOX_SYNC_ENDPOINT,
            token: claimed.token,
          });
          finish(saved);
        } catch (requestError) {
          showError(requestError.status === 401
            ? 'Код неверный, уже использован или истёк'
            : requestError.message || 'Не удалось подключить устройство');
          setBusy(false);
        }
      });
      setTimeout(() => code.focus(), 0);
    }

    form.append(title, description, content, error, actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    close.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      finish(null);
    });
    dialog.showModal();
  });
}
