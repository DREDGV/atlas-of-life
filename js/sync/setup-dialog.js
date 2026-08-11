import { loadInboxSyncConfig, saveInboxSyncConfig } from './config.js';

function field(labelText, input){
  const label = document.createElement('label');
  label.className = 'atlas-sync-field';
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(text, input);
  return label;
}

export function openInboxSyncSetup(){
  return new Promise(resolve => {
    const current = loadInboxSyncConfig();
    const dialog = document.createElement('dialog');
    dialog.className = 'atlas-sync-dialog';

    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'atlas-sync-form';

    const title = document.createElement('h2');
    title.textContent = 'Синхронизация Atlas';
    const description = document.createElement('p');
    description.textContent = 'Один адрес и ключ должны быть настроены на телефоне и компьютере.';

    const endpoint = document.createElement('input');
    endpoint.type = 'url';
    endpoint.required = true;
    endpoint.placeholder = 'https://atlas.example.ru';
    endpoint.autocomplete = 'url';
    endpoint.value = current.endpoint;

    const token = document.createElement('input');
    token.type = 'password';
    token.required = true;
    token.placeholder = 'Ключ устройства';
    token.autocomplete = 'off';
    token.value = current.token;

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = current.enabled;
    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'atlas-sync-enabled';
    const enabledText = document.createElement('span');
    enabledText.textContent = 'Включить автоматическую синхронизацию';
    enabledLabel.append(enabled, enabledText);

    function updateRequired(){
      endpoint.required = enabled.checked;
      token.required = enabled.checked;
    }
    enabled.addEventListener('change', updateRequired);
    updateRequired();

    const error = document.createElement('div');
    error.className = 'atlas-sync-error';
    error.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'atlas-sync-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Отмена';
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Сохранить';
    save.className = 'primary';
    actions.append(cancel, save);

    form.append(
      title,
      description,
      field('Адрес сервера', endpoint),
      field('Ключ синхронизации', token),
      enabledLabel,
      error,
      actions
    );
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    function finish(value){
      dialog.close();
      dialog.remove();
      resolve(value);
    }

    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      finish(null);
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const saved = saveInboxSyncConfig({
          enabled: enabled.checked,
          endpoint: endpoint.value,
          token: token.value,
        });
        finish(saved);
      } catch (saveError) {
        error.textContent = saveError.message;
        error.hidden = false;
      }
    });

    dialog.showModal();
    endpoint.focus();
  });
}
