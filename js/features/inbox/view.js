import { state } from '../../state.js';
import { getInboxItems } from './model.js';
import {
  captureInbox,
  convertInboxToTask,
  deleteInbox,
  undoDeleteInbox,
} from '../../core/commands.js';

let root = null;
let onStateChange = () => {};
let lastRemoval = null;

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
  if (root) root.hidden = true;
}

function commit(reason){
  updateCounter();
  onStateChange(reason);
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
  setBodyTitle('Входящие');
  const body = document.getElementById('inboxDialogBody');
  body.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'inbox-toolbar';
  const summary = document.createElement('div');
  summary.className = 'inbox-help';
  const items = getInboxItems();
  summary.textContent = items.length
    ? `Неразобранных записей: ${items.length}`
    : 'Входящие разобраны. Здесь спокойно.';
  const captureButton = document.createElement('button');
  captureButton.type = 'button';
  captureButton.className = 'inbox-button primary';
  captureButton.textContent = '+ Записать';
  captureButton.addEventListener('click', openInboxCapture);
  toolbar.append(summary, captureButton);
  body.appendChild(toolbar);

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
    const row = document.createElement('article');
    row.className = 'inbox-row';
    const text = document.createElement('div');
    text.className = 'inbox-row-text';
    text.textContent = item.text;
    const actions = document.createElement('div');
    actions.className = 'inbox-row-actions';
    const toTask = document.createElement('button');
    toTask.type = 'button';
    toTask.className = 'inbox-button primary';
    toTask.textContent = 'В задачу';
    toTask.addEventListener('click', () => {
      if (convertInboxToTask(item.id)) {
        lastRemoval = null;
        commit('inbox:convert-to-task');
        openInboxList();
      }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'inbox-button danger';
    remove.textContent = 'Удалить';
    remove.addEventListener('click', () => {
      lastRemoval = deleteInbox(item.id);
      if (lastRemoval) {
        commit('inbox:delete');
        openInboxList();
      }
    });
    actions.append(toTask, remove);
    row.append(text, actions);
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
