// js/ui/checklist.js - Модуль компонента чек-листа
import { getChecklist, debouncedSaveChecklist } from '../storage.js';

// Глобальные переменные для управления окном
let currentModal = null;
let currentEntityKey = null;
let undoBuffer = null;
let undoTimeout = null;

// Типы данных
/**
 * @typedef {Object} ChecklistItem
 * @property {string} id - uuid-like идентификатор
 * @property {string} text - текст задачи
 * @property {boolean} completed - выполнена ли задача
 * @property {number} createdAt - timestamp создания
 * @property {number} updatedAt - timestamp обновления
 */

/**
 * Открывает окно управления чек-листом
 * @param {Object} options - параметры окна
 * @param {string} options.type - тип сущности (domain/project/task)
 * @param {string} options.id - идентификатор сущности
 * @param {HTMLElement} options.anchor - элемент-якорь
 * @param {number} options.x - координата X курсора
 * @param {number} options.y - координата Y курсора
 */
export async function openChecklist({ type, id, anchor, x, y }) {
  // Проверяем фичефлаг
  if (!window.state?.ui?.features?.checklist) {
    return;
  }

  // Закрываем предыдущее окно если есть
  closeChecklist();

  const entityKey = `${type}:${id}`;
  currentEntityKey = entityKey;

  // Загружаем данные
  const items = await getChecklist(entityKey);
  
  // Создаем модальное окно
  currentModal = createModal(entityKey, items, x, y);
  document.body.appendChild(currentModal);

  // Настраиваем обработчики
  setupEventListeners();

  // Фокус на поле ввода
  const input = currentModal.querySelector('.checklist-input');
  if (input) {
    input.focus();
  }
}

/**
 * Закрывает окно чек-листа
 */
export function closeChecklist() {
  if (currentModal) {
    cleanupEventListeners();
    document.body.removeChild(currentModal);
    currentModal = null;
    currentEntityKey = null;
  }
  
  // Очищаем undo буфер
  if (undoTimeout) {
    clearTimeout(undoTimeout);
    undoTimeout = null;
  }
  undoBuffer = null;
}

/**
 * Создает HTML модального окна
 */
function createModal(entityKey, items, x, y) {
  const modal = document.createElement('div');
  modal.className = 'checklist-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'false');
  modal.setAttribute('aria-labelledby', 'checklistTitle');
  
  const pendingItems = items.filter(item => !item.completed);
  const completedItems = items.filter(item => item.completed);
  
  modal.innerHTML = `
    <div class="checklist-header">
      <h3 id="checklistTitle" class="checklist-title">Чек-лист</h3>
      <button class="checklist-close" aria-label="Закрыть">×</button>
    </div>
    
    <div class="checklist-tabs">
      <button class="checklist-tab active" data-tab="pending">
        📋 Невыполненные (${pendingItems.length})
      </button>
      <button class="checklist-tab" data-tab="completed">
        ✅ Выполненные (${completedItems.length})
      </button>
    </div>
    
    <div class="checklist-content">
      <div class="checklist-tab-content active" data-tab="pending">
        ${renderItems(pendingItems, 'pending')}
      </div>
      <div class="checklist-tab-content" data-tab="completed">
        ${renderItems(completedItems, 'completed')}
      </div>
    </div>
    
    <div class="checklist-add">
      <input type="text" class="checklist-input" placeholder="Добавить задачу..." />
      <button class="checklist-add-btn">+</button>
    </div>
  `;
  
  // Позиционируем окно
  positionModal(modal, x, y);
  
  return modal;
}

/**
 * Рендерит список задач для вкладки
 */
function renderItems(items, tabType) {
  if (items.length === 0) {
    return `
      <div class="checklist-empty">
        ${tabType === 'pending' ? 'Нет невыполненных задач' : 'Нет выполненных задач'}
      </div>
    `;
  }
  
  return items.map(item => `
    <div class="checklist-item ${item.completed ? 'task--completed' : ''}" data-item-id="${item.id}">
      <input type="checkbox" ${item.completed ? 'checked' : ''} class="checklist-checkbox" />
      <span class="checklist-text" data-item-id="${item.id}">${escapeHtml(item.text)}</span>
      <div class="checklist-actions">
        <button class="checklist-edit" data-item-id="${item.id}" title="Редактировать">✏️</button>
        <button class="checklist-delete" data-item-id="${item.id}" title="Удалить">🗑️</button>
      </div>
    </div>
  `).join('');
}

/**
 * Позиционирует модальное окно
 */
function positionModal(modal, x, y) {
  const rect = modal.getBoundingClientRect();
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight
  };
  
  // Авто-прилипание к краям
  let finalX = x;
  let finalY = y;
  
  if (x + rect.width > viewport.width - 20) {
    finalX = viewport.width - rect.width - 20;
  }
  if (y + rect.height > viewport.height - 20) {
    finalY = viewport.height - rect.height - 20;
  }
  
  modal.style.left = `${Math.max(20, finalX)}px`;
  modal.style.top = `${Math.max(20, finalY)}px`;
}

/**
 * Настраивает обработчики событий
 */
function setupEventListeners() {
  if (!currentModal) return;
  
  // Закрытие по клику вне окна
  document.addEventListener('click', handleOutsideClick);
  
  // Закрытие по Escape
  document.addEventListener('keydown', handleKeydown);
  
  // Обработчики внутри модального окна
  currentModal.addEventListener('click', handleModalClick);
  currentModal.addEventListener('keydown', handleModalKeydown);
  
  // Обработчик изменения видимости вкладки
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

/**
 * Удаляет обработчики событий
 */
function cleanupEventListeners() {
  document.removeEventListener('click', handleOutsideClick);
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

/**
 * Обработчик клика вне модального окна
 */
function handleOutsideClick(e) {
  if (currentModal && !currentModal.contains(e.target)) {
    closeChecklist();
  }
}

/**
 * Обработчик нажатий клавиш
 */
function handleKeydown(e) {
  if (e.key === 'Escape' && currentModal) {
    closeChecklist();
  }
}

/**
 * Обработчик кликов внутри модального окна
 */
function handleModalClick(e) {
  const target = e.target;
  
  // Закрытие
  if (target.classList.contains('checklist-close')) {
    closeChecklist();
    return;
  }
  
  // Переключение вкладок
  if (target.classList.contains('checklist-tab')) {
    switchTab(target.dataset.tab);
    return;
  }
  
  // Чекбокс
  if (target.classList.contains('checklist-checkbox')) {
    toggleItem(target.closest('.checklist-item').dataset.itemId);
    return;
  }
  
  // Добавление задачи
  if (target.classList.contains('checklist-add-btn')) {
    addItem();
    return;
  }
  
  // Редактирование
  if (target.classList.contains('checklist-edit')) {
    editItem(target.dataset.itemId);
    return;
  }
  
  // Удаление
  if (target.classList.contains('checklist-delete')) {
    deleteItem(target.dataset.itemId);
    return;
  }
  
  // Двойной клик по тексту для редактирования
  if (target.classList.contains('checklist-text')) {
    editItem(target.dataset.itemId);
    return;
  }
}

/**
 * Обработчик нажатий клавиш внутри модального окна
 */
function handleModalKeydown(e) {
  const target = e.target;
  
  // Enter в поле ввода
  if (target.classList.contains('checklist-input')) {
    if (e.key === 'Enter') {
      if (e.ctrlKey) {
        addItem();
        target.focus(); // Оставляем фокус для Ctrl+Enter
      } else {
        addItem();
      }
    }
    return;
  }
  
  // Space/Enter на элементе списка
  if (target.classList.contains('checklist-item')) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const checkbox = target.querySelector('.checklist-checkbox');
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        toggleItem(target.dataset.itemId);
      }
    }
    
    // Delete для удаления
    if (e.key === 'Delete') {
      deleteItem(target.dataset.itemId);
    }
    return;
  }
}

/**
 * Обработчик изменения видимости вкладки
 */
function handleVisibilityChange() {
  if (document.hidden && currentModal) {
    // Закрываем окно если вкладка скрыта больше минуты
    setTimeout(() => {
      if (document.hidden && currentModal) {
        closeChecklist();
      }
    }, 60000);
  }
}

/**
 * Переключает вкладку
 */
function switchTab(tabName) {
  if (!currentModal) return;
  
  // Обновляем кнопки вкладок
  currentModal.querySelectorAll('.checklist-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Обновляем содержимое вкладок
  currentModal.querySelectorAll('.checklist-tab-content').forEach(content => {
    content.classList.toggle('active', content.dataset.tab === tabName);
  });
}

/**
 * Переключает статус задачи
 */
async function toggleItem(itemId) {
  if (!currentEntityKey) return;
  
  const items = await getChecklist(currentEntityKey);
  const item = items.find(i => i.id === itemId);
  
  if (item) {
    item.completed = !item.completed;
    item.updatedAt = Date.now();
    
    await debouncedSaveChecklist(currentEntityKey, items);
    refreshModal();
  }
}

/**
 * Добавляет новую задачу
 */
async function addItem() {
  if (!currentEntityKey) return;
  
  const input = currentModal.querySelector('.checklist-input');
  const text = input.value.trim();
  
  if (!text) return;
  
  const items = await getChecklist(currentEntityKey);
  const newItem = {
    id: generateId(),
    text: text,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  items.push(newItem);
  await debouncedSaveChecklist(currentEntityKey, items);
  
  input.value = '';
  refreshModal();
}

/**
 * Редактирует задачу
 */
function editItem(itemId) {
  const item = currentModal.querySelector(`[data-item-id="${itemId}"]`);
  if (!item) return;
  
  const textSpan = item.querySelector('.checklist-text');
  const currentText = textSpan.textContent;
  
  // Создаем input для редактирования
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  input.className = 'checklist-edit-input';
  
  // Заменяем span на input
  textSpan.style.display = 'none';
  textSpan.parentNode.insertBefore(input, textSpan);
  input.focus();
  input.select();
  
  // Обработчики для input
  const finishEdit = async () => {
    const newText = input.value.trim();
    if (newText && newText !== currentText) {
      await updateItemText(itemId, newText);
    }
    textSpan.style.display = '';
    input.remove();
  };
  
  const cancelEdit = () => {
    textSpan.style.display = '';
    input.remove();
  };
  
  input.addEventListener('blur', finishEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  });
}

/**
 * Обновляет текст задачи
 */
async function updateItemText(itemId, newText) {
  if (!currentEntityKey) return;
  
  const items = await getChecklist(currentEntityKey);
  const item = items.find(i => i.id === itemId);
  
  if (item) {
    item.text = newText;
    item.updatedAt = Date.now();
    await debouncedSaveChecklist(currentEntityKey, items);
    refreshModal();
  }
}

/**
 * Удаляет задачу
 */
async function deleteItem(itemId) {
  if (!currentEntityKey) return;
  
  const items = await getChecklist(currentEntityKey);
  const itemIndex = items.findIndex(i => i.id === itemId);
  
  if (itemIndex === -1) return;
  
  // Сохраняем в undo буфер
  undoBuffer = {
    item: items[itemIndex],
    index: itemIndex,
    entityKey: currentEntityKey
  };
  
  // Удаляем элемент
  items.splice(itemIndex, 1);
  await debouncedSaveChecklist(currentEntityKey, items);
  
  // Показываем toast с возможностью отмены
  showUndoToast();
  
  refreshModal();
}

/**
 * Показывает toast с возможностью отмены
 */
function showUndoToast() {
  // Очищаем предыдущий timeout
  if (undoTimeout) {
    clearTimeout(undoTimeout);
  }
  
  // Создаем toast
  const toast = document.createElement('div');
  toast.className = 'checklist-toast';
  toast.innerHTML = `
    <span>Задача удалена</span>
    <button class="checklist-undo-btn">Отменить</button>
  `;
  
  document.body.appendChild(toast);
  
  // Обработчик отмены
  toast.querySelector('.checklist-undo-btn').addEventListener('click', async () => {
    if (undoBuffer) {
      const items = await getChecklist(undoBuffer.entityKey);
      items.splice(undoBuffer.index, 0, undoBuffer.item);
      await debouncedSaveChecklist(undoBuffer.entityKey, items);
      refreshModal();
    }
    document.body.removeChild(toast);
    undoBuffer = null;
  });
  
  // Автоматическое скрытие через 5 секунд
  undoTimeout = setTimeout(() => {
    if (document.body.contains(toast)) {
      document.body.removeChild(toast);
    }
    undoBuffer = null;
  }, 5000);
}

/**
 * Обновляет содержимое модального окна
 */
async function refreshModal() {
  if (!currentModal || !currentEntityKey) return;
  
  const items = await getChecklist(currentEntityKey);
  const pendingItems = items.filter(item => !item.completed);
  const completedItems = items.filter(item => item.completed);
  
  // Обновляем счетчики вкладок
  const pendingTab = currentModal.querySelector('[data-tab="pending"]');
  const completedTab = currentModal.querySelector('[data-tab="completed"]');
  
  if (pendingTab) {
    pendingTab.textContent = `📋 Невыполненные (${pendingItems.length})`;
  }
  if (completedTab) {
    completedTab.textContent = `✅ Выполненные (${completedItems.length})`;
  }
  
  // Обновляем содержимое вкладок
  const pendingContent = currentModal.querySelector('[data-tab="pending"]');
  const completedContent = currentModal.querySelector('[data-tab="completed"]');
  
  if (pendingContent) {
    pendingContent.innerHTML = renderItems(pendingItems, 'pending');
  }
  if (completedContent) {
    completedContent.innerHTML = renderItems(completedItems, 'completed');
  }
}

/**
 * Генерирует уникальный ID
 */
function generateId() {
  return 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Экранирует HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Экспортируем функции для глобального доступа
window.openChecklist = openChecklist;
window.closeChecklist = closeChecklist;
