import adapter from '../storageAdapter.js';
import { BACKUP_KEY, RECOVERY_KEY, getStorageStatus, downloadStateText, prepareState, prepareReplacement } from '../storage.js';
import { restoreAtlasSnapshot } from '../core/commands.js';

const sections = [
  ['domains', 'Сферы'], ['projects', 'Проекты'], ['tasks', 'Задачи'],
  ['inbox', 'Записи во Входящих'], ['knowledge', 'Материалы'],
];

export async function showStorageReplacement({ read, name, localBackup = false }) {
  if (document.getElementById('storageReplacement')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'storageReplacement';
  dialog.setAttribute('aria-labelledby', 'replacementTitle');
  dialog.setAttribute('aria-describedby', 'replacementWarning');
  dialog.innerHTML = `
    <h2 id="replacementTitle">${localBackup ? 'Восстановление данных' : 'Импорт Atlas из JSON'}</h2>
    <p class="replacement-source"></p>
    <p id="replacementWarning">Atlas на этом устройстве будет целиком заменён. Текущие данные сохранятся в «Ещё → Резервные данные».</p>
    <p class="replacement-loading" role="status">Проверяем данные…</p>
    <table hidden>
      <thead><tr><th scope="col">Раздел</th><th scope="col">Сейчас</th><th scope="col">После замены</th></tr></thead>
      <tbody></tbody>
    </table>
    <p class="replacement-places" hidden></p>
    <p class="replacement-message" role="alert"></p>
    <form method="dialog">
      <button value="cancel" autofocus>Отмена</button>
      <button type="button" class="replacement-confirm" disabled>${localBackup ? 'Восстановить данные' : 'Заменить данные'}</button>
    </form>`;
  dialog.querySelector('.replacement-source').textContent = name;
  const alert = dialog.querySelector('[role=alert]');
  const confirm = dialog.querySelector('.replacement-confirm');
  const warning = dialog.querySelector('#replacementWarning');
  dialog.addEventListener('close', () => dialog.remove(), { once:true });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  document.body.append(dialog);
  dialog.showModal();

  try {
    const raw = await read();
    if (!dialog.open) return;
    const candidate = prepareReplacement(raw);
    const expectedCurrent = adapter.load();
    let current = {};
    try { if (expectedCurrent !== null) current = prepareState(expectedCurrent); }
    catch (_) {
      current = null;
      warning.textContent = 'Текущие данные не открылись. Atlas сохранит их отдельно перед заменой.';
    }
    const table = dialog.querySelector('table');
    for (const [key, label] of sections) {
      const row = table.tBodies[0].insertRow();
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = label;
      row.append(heading);
      row.insertCell().textContent = current ? current[key]?.length ?? 0 : '—';
      row.insertCell().textContent = candidate[key].length;
    }
    if (sections.every(([key]) => candidate[key].length === 0)) {
      warning.prepend('Выбранный снимок пуст. ');
    }
    const titles = candidate.domains.slice(0, 3).map(domain => domain.title).filter(Boolean);
    if (titles.length) {
      const places = dialog.querySelector('.replacement-places');
      const rest = candidate.domains.length - titles.length;
      places.textContent = `Сферы в снимке: ${titles.join(' · ')}${rest ? ` · ещё ${rest}` : ''}`;
      places.hidden = false;
    }
    table.hidden = false;
    confirm.disabled = false;
    confirm.onclick = () => {
      try {
        alert.textContent = '';
        restoreAtlasSnapshot(raw, {
          expectedCurrent, localBackup, reason: localBackup ? 'explicit-local-restore' : 'explicit-json-import',
        });
        confirm.disabled = true;
        location.reload();
      } catch (error) {
        alert.textContent = `Замена не выполнена. ${error.message}`;
      }
    };
  } catch (error) {
    warning.hidden = true;
    alert.textContent = error instanceof SyntaxError ? 'Файл содержит некорректный JSON.' : error.message;
  } finally {
    dialog.querySelector('.replacement-loading').hidden = true;
  }
}

export function showStorageRecovery(options = {}){
  const maintenance = options.maintenance === true;
  if (document.getElementById('storageRecovery')) return;
  if (maintenance) window.atlasSync?.stop();
  const host = document.createElement('section');
  host.id = 'storageRecovery';
  host.setAttribute('role', 'alert');
  Object.assign(host.style, { position:'fixed', inset:'0', zIndex:'100000', background:'#0b1220', color:'#e5edf8', padding:'max(24px, 6vw)', overflow:'auto', font:'16px/1.6 system-ui' });
  host.innerHTML = `<div style="max-width:660px;margin:auto"><h1>Данные Atlas не открылись</h1>
    <p>Исходное хранилище сохранено. Запись новых данных и синхронизация остановлены, чтобы не заменить ваш Atlas пустыми данными.</p>
    <p>Попробуйте загрузить данные ещё раз или восстановить проверенный снимок.</p>
    <details style="margin:20px 0"><summary>Техническая причина</summary><p id="recoveryReason"></p></details>
    <div id="recoveryActions" style="display:flex;gap:12px;flex-wrap:wrap"></div>
    <p>Восстановление заменяет локальный Atlas выбранным снимком. Текущие данные сохраняются отдельно; это не отмена изменений на других устройствах.</p>
    <p id="recoveryMessage" role="status"></p></div>`;
  host.querySelector('#recoveryReason').textContent = getStorageStatus().error;
  if (maintenance) {
    host.querySelector('h1').textContent = 'Резервные данные Atlas';
    host.querySelector('p').textContent = 'Здесь хранятся данные до последней замены и предыдущий снимок обычного сохранения. Синхронизация приостановлена, пока эта панель открыта.';
    host.querySelector('details').hidden = true;
  }
  const actions = host.querySelector('#recoveryActions');
  const message = host.querySelector('#recoveryMessage');
  const button = (text, action) => {
    const control = document.createElement('button'); control.type = 'button';
    control.textContent = text;
    Object.assign(control.style, { padding:'12px 16px', background:'#14273a', color:'#d3edff', border:'1px solid #365975', borderRadius:'8px', cursor:'pointer', font:'inherit' });
    control.onclick = async () => { try { await action(); } catch (error) { message.textContent = error.message; } };
    actions.append(control); return control;
  };
  button('Повторить загрузку', () => location.reload());
  if (maintenance) button('Закрыть', () => { host.remove(); window.atlasSync?.start(); });
  button('Скачать исходные данные', () => {
    const raw = adapter.load();
    if (raw === null) throw new Error('Сохранённых данных нет');
    downloadStateText(raw, 'atlas-recovery-original.json');
  });
  try {
    const original = localStorage.getItem(RECOVERY_KEY);
    if (original !== null) {
      try {
        prepareReplacement(original);
        button('Вернуть данные до замены', () => showStorageReplacement({
          read: () => original, name: 'Данные до последнего импорта или восстановления', localBackup:true,
        }));
      } catch (_) { /* Unreadable original remains available as a download. */ }
      button('Скачать данные до замены', () => downloadStateText(original, 'atlas-before-replacement.json'));
    }
  } catch (_) {}
  let backup = null;
  try { backup = localStorage.getItem(BACKUP_KEY); if (backup !== null) prepareReplacement(backup); } catch (_) { backup = null; }
  if (backup !== null) {
    button('Восстановить предыдущий снимок', () => showStorageReplacement({
      read: () => backup, name: 'Предыдущий снимок обычного сохранения', localBackup:true,
    }));
    button('Скачать предыдущий снимок', () => downloadStateText(backup, 'atlas-previous.json'));
    const data = prepareState(backup);
    const info = document.createElement('p');
    info.textContent = `Предыдущий снимок: ${data.tasks.length} задач, ${data.inbox.length} входящих, ${data.knowledge.length} материалов.`;
    actions.after(info);
  }
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
  input.onchange = () => {
    const file = input.files[0];
    input.value = '';
    if (file) void showStorageReplacement({ read: () => file.text(), name: file.name });
  };
  button('Открыть резервный JSON', () => input.click());
  host.append(input); document.body.append(host);
}
