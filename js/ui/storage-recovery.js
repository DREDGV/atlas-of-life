import adapter from '../storageAdapter.js';
import { BACKUP_KEY, RECOVERY_KEY, getStorageStatus, downloadStateText, prepareState } from '../storage.js';
import { restoreAtlasSnapshot } from '../core/commands.js';

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
    host.querySelector('p').textContent = 'Перед изменением Atlas сохраняет один предыдущий снимок. Здесь можно скачать данные или явно восстановить снимок. Sync приостановлен, пока эта панель открыта.';
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
  let backup = null;
  try { backup = localStorage.getItem(BACKUP_KEY); if (backup !== null) prepareState(backup); } catch (_) { backup = null; }
  if (backup !== null) button('Восстановить предыдущий снимок', () => {
    if (!confirm('Восстановить локальный Atlas из предыдущего снимка? Текущие данные будут сохранены отдельно.')) return;
    restoreAtlasSnapshot(backup, { localBackup:true }); location.reload();
  });
  if (backup !== null) {
    button('Скачать предыдущий снимок', () => downloadStateText(backup, 'atlas-previous.json'));
    const data = prepareState(backup);
    const info = document.createElement('p');
    info.textContent = `Предыдущий снимок: ${data.tasks.length} задач, ${data.inbox.length} входящих, ${data.knowledge.length} материалов.`;
    actions.after(info);
  }
  try {
    const original = localStorage.getItem(RECOVERY_KEY);
    if (original !== null) button('Скачать данные до восстановления', () => downloadStateText(original, 'atlas-before-restore.json'));
  } catch (_) {}
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
  input.onchange = async () => {
    try {
      const file = input.files[0]; if (!file) return;
      const raw = await file.text(); prepareState(raw);
      if (!confirm('Восстановить локальный Atlas из выбранного файла?')) return;
      restoreAtlasSnapshot(raw); location.reload();
    } catch (error) { message.textContent = error.message; }
  };
  button('Открыть резервный JSON', () => input.click());
  host.append(input); document.body.append(host);
}
