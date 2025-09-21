/**
 * Модуль для окна управления чек-листом
 * Открывается по правому клику на иконку чек-листа
 */

import { getChecklist, saveChecklist, debouncedSaveChecklist } from '../storage.js';

let currentChecklistWindow = null;
let currentChecklist = null;
let cleanupHandlers = [];
let lastDeletedItem = null;
let lastDeletedTimer = null;
let dragItemId = null;
let isWindowInteracting = false; // защищаемся от закрытия при ресайзе/перетаскивании
let suppressCloseUntil = 0; // время до которого блокируем автозакрытие (ms since performance.now)
let resizeObserver = null;
let resizeSilenceTimer = null;

/**
 * Открывает окно управления чек-листом
 * @param {Object} checklist - объект чек-листа
 * @param {number} x - координата X курсора
 * @param {number} y - координата Y курсора
 */
export async function openChecklistWindow(checklist, x, y) {
  // Закрываем предыдущее окно если есть
  closeChecklistWindow();
  
  currentChecklist = checklist;
  
  // Загружаем элементы чек-листа из storage
  const items = await getChecklist(checklist.id);
  
  // Создаем HTML структуру окна
  const windowHTML = `
    <div id="checklist-window" class="checklist-window show" style="position:fixed; z-index:10000; display:none; opacity:0; max-height:60vh; background:#1a1a1a; border:1px solid #333; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.5); pointer-events:auto;" role="dialog" aria-modal="false" aria-labelledby="checklistTitle">
      <div class="checklist-window-header">
        <h3 id="checklistTitle" class="checklist-window-title">${checklist.title || 'Чек-лист'}</h3>
        <button type="button" class="checklist-window-close" aria-label="Закрыть">×</button>
      </div>
      
      <div class="checklist-window-tabs">
        <button class="checklist-tab active" data-tab="pending">
          Невыполненные (<span id="pending-count">0</span>)
        </button>
        <button class="checklist-tab" data-tab="completed">
          Выполненные (<span id="completed-count">0</span>)
        </button>
      </div>
      
      <div class="checklist-window-content">
        <div class="checklist-tab-content active" id="pending-content">
          <div class="checklist-items" id="pending-items"></div>
        </div>
        <div class="checklist-tab-content" id="completed-content">
          <div class="checklist-items" id="completed-items"></div>
        </div>
      </div>
      
      <div class="checklist-window-footer">
        <div class="add-item-form">
          <input type="text" id="new-item-input" placeholder="Добавить новый пункт..." />
          <button id="add-item-btn">+</button>
        </div>
      </div>
    </div>
  `;
  
  // Добавляем окно в DOM
  document.body.insertAdjacentHTML('beforeend', windowHTML);
  currentChecklistWindow = document.getElementById('checklist-window');
  
  // Позиционируем окно
  positionWindow(x, y);
  
  // Настраиваем обработчики событий
  setupEventListeners();
  
  // Загружаем данные и рендерим
  await loadChecklistData();
  await renderItems();
  
  // Показываем окно
  currentChecklistWindow.style.display = 'block';
  setTimeout(() => {
    currentChecklistWindow.style.opacity = '1';
  }, 10);
}

/**
 * Закрывает окно управления чек-листом
 */
export function closeChecklistWindow() {
  if (currentChecklistWindow) {
    currentChecklistWindow.classList.remove('show');
    setTimeout(() => {
      if (currentChecklistWindow && currentChecklistWindow.parentNode) {
        currentChecklistWindow.parentNode.removeChild(currentChecklistWindow);
      }
      currentChecklistWindow = null;
      currentChecklist = null;
      // Чистка
      cleanupHandlers.forEach(off => { try { off(); } catch(_) {} });
      cleanupHandlers = [];
      if (lastDeletedTimer) { clearTimeout(lastDeletedTimer); lastDeletedTimer = null; }
      lastDeletedItem = null;
    }, 200);
  }
}

/**
 * Позиционирует окно рядом с курсором
 */
function positionWindow(x, y) {
  const modalEl = currentChecklistWindow;
  const rect = modalEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let left = x + 10;
  let top = y - 10;
  
  // Проверяем, не выходит ли окно за границы экрана
  if (left + rect.width > viewportWidth) {
    left = x - rect.width - 10;
  }
  if (top + rect.height > viewportHeight) {
    top = viewportHeight - rect.height - 10;
  }
  if (left < 0) left = 10;
  if (top < 0) top = 10;
  
  modalEl.style.left = left + 'px';
  modalEl.style.top = top + 'px';
}

/**
 * Настраивает обработчики событий
 */
function setupEventListeners() {
  // Переключение вкладок
  const tabs = currentChecklistWindow.querySelectorAll('.checklist-tab');
  tabs.forEach(tab => {
    const onClick = () => switchTab(tab.dataset.tab);
    tab.addEventListener('click', onClick);
    cleanupHandlers.push(() => tab.removeEventListener('click', onClick));
  });

  // Перемещение окна за шапку (pointer events)
  const headerEl = currentChecklistWindow.querySelector('.checklist-window-header');
  const closeBtnEl = currentChecklistWindow.querySelector('.checklist-window-close');
  let isDraggingWindow = false;
  let dragStartX = 0, dragStartY = 0, dragStartLeft = 0, dragStartTop = 0;
  const onPointerDownHeader = (e) => {
    if (e.button !== 0) return; // только ЛКМ
    // Не начинать перетаскивание, если клик по кнопке закрытия
    if (closeBtnEl && (e.target === closeBtnEl || closeBtnEl.contains(e.target))) {
      return;
    }
    isWindowInteracting = true;
    isDraggingWindow = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = currentChecklistWindow.getBoundingClientRect();
    dragStartLeft = rect.left;
    dragStartTop = rect.top;
    // фиксируем текущую позицию и отключаем translate, чтобы двигать в px
    currentChecklistWindow.style.left = dragStartLeft + 'px';
    currentChecklistWindow.style.top = dragStartTop + 'px';
    currentChecklistWindow.style.transform = 'none';
    try { headerEl.setPointerCapture(e.pointerId); } catch(_) {}
    e.preventDefault();
  };
  const onPointerMoveHeader = (e) => {
    if (!isDraggingWindow) return;
    e.preventDefault();
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    let left = dragStartLeft + dx;
    let top = dragStartTop + dy;
    // границы вьюпорта
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = currentChecklistWindow.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    left = Math.min(Math.max(0, left), vw - w);
    top = Math.min(Math.max(0, top), vh - h);
    currentChecklistWindow.style.left = left + 'px';
    currentChecklistWindow.style.top = top + 'px';
  };
  const onPointerUpHeader = (e) => {
    if (!isDraggingWindow) return;
    isDraggingWindow = false;
    isWindowInteracting = false;
    const now = (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    suppressCloseUntil = now + 500; // чтобы окно не закрылось по "клику вне" после перетаскивания
    try { headerEl.releasePointerCapture(e.pointerId); } catch(_) {}
    e.preventDefault();
  };
  if (headerEl) {
    headerEl.addEventListener('pointerdown', onPointerDownHeader);
    document.addEventListener('pointermove', onPointerMoveHeader);
    document.addEventListener('pointerup', onPointerUpHeader, true);
    cleanupHandlers.push(() => {
      try { headerEl.removeEventListener('pointerdown', onPointerDownHeader); } catch(_) {}
      try { document.removeEventListener('pointermove', onPointerMoveHeader); } catch(_) {}
      try { document.removeEventListener('pointerup', onPointerUpHeader, true); } catch(_) {}
    });
  }

  // Надёжное закрытие по кнопке «×»
  if (closeBtnEl) {
    const onCloseClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeChecklistWindow();
    };
    closeBtnEl.addEventListener('click', onCloseClick);
    cleanupHandlers.push(() => closeBtnEl.removeEventListener('click', onCloseClick));
  }
  
  // Добавление нового пункта
  const addBtn = currentChecklistWindow.querySelector('#add-item-btn');
  const input = currentChecklistWindow.querySelector('#new-item-input');
  
  const onAdd = async () => await addNewItem();
  addBtn.addEventListener('click', onAdd);
  cleanupHandlers.push(() => addBtn.removeEventListener('click', onAdd));
  const onKey = async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      await addNewItem();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      await addNewItem();
    }
  };
  input.addEventListener('keydown', onKey);
  cleanupHandlers.push(() => input.removeEventListener('keydown', onKey));
  
  // Закрытие по клику вне окна
  const onDocClick = (e) => {
    const now = (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    if (isWindowInteracting || now < suppressCloseUntil) return; // игнорируем клики, пока взаимодействуем/после ресайза
    if (currentChecklistWindow && !currentChecklistWindow.contains(e.target)) {
      if (window.isChecklistEditorOpen) return; // Не мешаем редактору
      closeChecklistWindow();
    }
  };
  document.addEventListener('click', onDocClick, true);
  cleanupHandlers.push(() => document.removeEventListener('click', onDocClick, true));

  // Трекинг взаимодействия внутри окна (в т.ч. нативный resize)
  const onWinPointerDown = () => { isWindowInteracting = true; };
  const onWinPointerUp = () => {
    isWindowInteracting = false;
    const now = (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    suppressCloseUntil = now + 500; // короткая защита после взаимодействия
  };
  currentChecklistWindow.addEventListener('mousedown', onWinPointerDown);
  document.addEventListener('mouseup', onWinPointerUp, true);
  cleanupHandlers.push(() => {
    try { currentChecklistWindow.removeEventListener('mousedown', onWinPointerDown); } catch(_) {}
    try { document.removeEventListener('mouseup', onWinPointerUp, true); } catch(_) {}
  });

  // Отслеживаем изменение размеров окна и удерживаем флаг взаимодействия до стабилизации
  try {
    resizeObserver = new ResizeObserver(() => {
      isWindowInteracting = true;
      if (resizeSilenceTimer) clearTimeout(resizeSilenceTimer);
      resizeSilenceTimer = setTimeout(() => {
        isWindowInteracting = false;
        const now = (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
        suppressCloseUntil = now + 500; // запас после завершения ресайза
      }, 250);
    });
    resizeObserver.observe(currentChecklistWindow);
    cleanupHandlers.push(() => {
      try { resizeObserver.disconnect(); } catch(_) {}
      if (resizeSilenceTimer) { clearTimeout(resizeSilenceTimer); resizeSilenceTimer = null; }
      resizeObserver = null;
    });
  } catch(_) {}
  
  // Закрытие по Escape
  const onEsc = (e) => {
    if (e.key === 'Escape' && currentChecklistWindow) {
      closeChecklistWindow();
    }
  };
  document.addEventListener('keydown', onEsc);
  cleanupHandlers.push(() => document.removeEventListener('keydown', onEsc));

  // Фокус-трап и hotkeys
  const onTrap = (e) => {
    if (!currentChecklistWindow) return;
    if (e.key === 'Tab') {
      const focusables = currentChecklistWindow.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key === 'Delete') {
      const active = document.activeElement;
      const itemEl = active && active.closest ? active.closest('.checklist-item') : null;
      if (itemEl) {
        const itemId = itemEl.dataset.itemId;
        if (itemId) {
          window.deleteChecklistItem(currentChecklist.id, itemId);
        }
      }
    }
    if ((e.key === ' ' || e.key === 'Enter')) {
      const active = document.activeElement;
      const label = active && active.classList && active.classList.contains('checklist-item-label') ? active : (active && active.closest ? active.closest('.checklist-item-label') : null);
      if (label) {
        const itemEl = label.closest('.checklist-item');
        const itemId = itemEl && itemEl.dataset ? itemEl.dataset.itemId : null;
        if (itemId) {
          e.preventDefault();
          window.toggleChecklistItem(currentChecklist.id, itemId);
        }
      }
    }
  };
  document.addEventListener('keydown', onTrap);
  cleanupHandlers.push(() => document.removeEventListener('keydown', onTrap));
}

/**
 * Переключает вкладку
 */
function switchTab(tabName) {
  // Обновляем кнопки вкладок
  const tabs = currentChecklistWindow.querySelectorAll('.checklist-tab');
  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Обновляем содержимое вкладок
  const contents = currentChecklistWindow.querySelectorAll('.checklist-tab-content');
  contents.forEach(content => {
    content.classList.toggle('active', content.id === tabName + '-content');
  });
}

/**
 * Загружает данные чек-листа
 */
async function loadChecklistData() {
  if (!currentChecklist) return;
  
  // Загружаем элементы из storage
  const items = await getChecklist(currentChecklist.id);
  currentChecklist.items = items || [];
}

/**
 * Рендерит элементы чек-листа
 */
async function renderItems() {
  if (!currentChecklist) return;
  
  // Загружаем актуальные данные
  const items = await getChecklist(currentChecklist.id);
  const pendingItems = items.filter(item => !item.completed);
  const completedItems = items.filter(item => item.completed);
  
  // Обновляем счетчики
  document.getElementById('pending-count').textContent = pendingItems.length;
  document.getElementById('completed-count').textContent = completedItems.length;
  
  // Рендерим невыполненные
  renderItemList('pending-items', pendingItems);
  
  // Рендерим выполненные
  renderItemList('completed-items', completedItems);
}

/**
 * Рендерит список элементов
 */
function renderItemList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = '';
  
  items.forEach(item => {
    const itemElement = createItemElement(item);
    container.appendChild(itemElement);
  });

  // Поддержка drag & drop сортировки
  const clearDropMarkers = () => {
    container.querySelectorAll('.drop-before, .drop-after').forEach(el => {
      el.classList.remove('drop-before');
      el.classList.remove('drop-after');
    });
  };

  const onDragOver = (e) => {
    e.preventDefault();
  };
  const onDrop = async (e) => {
    e.preventDefault();
    if (!dragItemId) return;
    const isCompletedTarget = containerId === 'completed-items';
    const children = Array.from(container.querySelectorAll('.checklist-item'));
    let insertIndex = children.findIndex((el) => {
      const rect = el.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    if (insertIndex === -1) insertIndex = children.length;

    const listItems = await getChecklist(currentChecklist.id);
    const byId = Object.fromEntries(listItems.map(i => [i.id, i]));
    const pendingIds = listItems.filter(i => !i.completed).map(i => i.id).filter(id => id !== dragItemId);
    const completedIds = listItems.filter(i => i.completed).map(i => i.id).filter(id => id !== dragItemId);

    // Вставляем элемент в целевой список
    if (isCompletedTarget) {
      completedIds.splice(insertIndex, 0, dragItemId);
    } else {
      pendingIds.splice(insertIndex, 0, dragItemId);
    }

    // Пересобираем итоговый массив: сначала pending, затем completed
    const newItems = [];
    pendingIds.forEach(id => newItems.push({ ...byId[id], completed: false }));
    completedIds.forEach(id => newItems.push({ ...byId[id], completed: true }));

    await debouncedSaveChecklist(currentChecklist.id, newItems);
    dragItemId = null;
    clearDropMarkers();
    await renderItems();
  };
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('drop', onDrop);
  cleanupHandlers.push(() => {
    try { container.removeEventListener('dragover', onDragOver); } catch(_) {}
    try { container.removeEventListener('drop', onDrop); } catch(_) {}
  });

  // Подсветка места вставки на элементах
  container.querySelectorAll('.checklist-item').forEach((rowEl, index) => {
    const onItemDragOver = (e) => {
      e.preventDefault();
      const rect = rowEl.getBoundingClientRect();
      clearDropMarkers();
      if (e.clientY < rect.top + rect.height / 2) rowEl.classList.add('drop-before');
      else rowEl.classList.add('drop-after');
    };
    const onItemDragLeave = () => {
      rowEl.classList.remove('drop-before');
      rowEl.classList.remove('drop-after');
    };
    const onItemDrop = async (e) => {
      e.preventDefault();
      if (!dragItemId) return;
      const isCompletedTarget = containerId === 'completed-items';
      const children = Array.from(container.querySelectorAll('.checklist-item'));
      let at = children.indexOf(rowEl);
      if (rowEl.classList.contains('drop-after')) at = at + 1;

      const listItems = await getChecklist(currentChecklist.id);
      const byId = Object.fromEntries(listItems.map(i => [i.id, i]));
      const pendingIds = listItems.filter(i => !i.completed).map(i => i.id).filter(id => id !== dragItemId);
      const completedIds = listItems.filter(i => i.completed).map(i => i.id).filter(id => id !== dragItemId);

      if (isCompletedTarget) completedIds.splice(at, 0, dragItemId); else pendingIds.splice(at, 0, dragItemId);

      const newItems = [];
      pendingIds.forEach(id => newItems.push({ ...byId[id], completed: false }));
      completedIds.forEach(id => newItems.push({ ...byId[id], completed: true }));

      await debouncedSaveChecklist(currentChecklist.id, newItems);
      dragItemId = null;
      clearDropMarkers();
      await renderItems();
    };

    rowEl.addEventListener('dragover', onItemDragOver);
    rowEl.addEventListener('dragleave', onItemDragLeave);
    rowEl.addEventListener('drop', onItemDrop);
    cleanupHandlers.push(() => {
      try { rowEl.removeEventListener('dragover', onItemDragOver); } catch(_) {}
      try { rowEl.removeEventListener('dragleave', onItemDragLeave); } catch(_) {}
      try { rowEl.removeEventListener('drop', onItemDrop); } catch(_) {}
    });
  });
}

/**
 * Создает элемент списка
 */
function createItemElement(item) {
  const div = document.createElement('div');
  div.className = 'checklist-item';
  div.dataset.itemId = item.id;
  div.setAttribute('draggable', 'true');
  
  div.innerHTML = `
    <div class="checklist-item-label">
      <input type="checkbox" ${item.completed ? 'checked' : ''} 
             onchange="window.toggleChecklistItem('${currentChecklist.id}', '${item.id}')" />
      <span class="checklist-item-text ${item.completed ? 'completed' : ''}">${item.text}</span>
    </div>
    <button class="checklist-item-delete" onclick="window.deleteChecklistItem('${currentChecklist.id}', '${item.id}')">🗑️</button>
  `;
  
  // DnD события
  div.addEventListener('dragstart', () => { dragItemId = item.id; div.classList.add('dragging'); });
  div.addEventListener('dragend', () => { div.classList.remove('dragging'); dragItemId = null; });

  // Добавляем обработчик двойного клика для редактирования
  const textSpan = div.querySelector('.checklist-item-text');
  textSpan.addEventListener('dblclick', () => editItemText(item.id, textSpan));
  
  return div;
}

/**
 * Добавляет новый пункт
 */
async function addNewItem() {
  const input = currentChecklistWindow.querySelector('#new-item-input');
  const text = input.value.trim();
  
  if (!text) return;
  
  const newItem = {
    id: Date.now().toString(),
    text: text,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  // Загружаем текущие элементы
  const items = await getChecklist(currentChecklist.id);
  items.push(newItem);
  
  // Сохраняем в storage
  await debouncedSaveChecklist(currentChecklist.id, items);
  
  // Обновляем отображение
  await renderItems();
  input.value = '';
}

/**
 * Переключает статус пункта
 */
window.toggleChecklistItem = async function(checklistId, itemId) {
  const items = await getChecklist(checklistId);
  const item = items.find(i => i.id === itemId);
  if (item) {
    item.completed = !item.completed;
    item.updatedAt = Date.now();
    await debouncedSaveChecklist(checklistId, items);
    await renderItems();
  }
};

/**
 * Удаляет пункт
 */
window.deleteChecklistItem = async function(checklistId, itemId) {
  const items = await getChecklist(checklistId);
  const idx = items.findIndex(i => i.id === itemId);
  if (idx === -1) return;
  const removed = items.splice(idx, 1)[0];

  lastDeletedItem = { checklistId, item: removed };
  if (lastDeletedTimer) clearTimeout(lastDeletedTimer);
  lastDeletedTimer = setTimeout(() => { lastDeletedItem = null; lastDeletedTimer = null; }, 5000);

  await debouncedSaveChecklist(checklistId, items);
  await renderItems();

  if (typeof window.showUndoToast === 'function') {
    window.showUndoToast('Пункт удалён', async () => {
      if (!lastDeletedItem) return;
      const cur = await getChecklist(checklistId);
      cur.push({ ...lastDeletedItem.item, updatedAt: Date.now() });
      await debouncedSaveChecklist(checklistId, cur);
      lastDeletedItem = null;
      if (lastDeletedTimer) { clearTimeout(lastDeletedTimer); lastDeletedTimer = null; }
      await renderItems();
    }, 5000);
  }
};

/**
 * Редактирует текст пункта
 */
async function editItemText(itemId, textElement) {
  const items = await getChecklist(currentChecklist.id);
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = item.text;
  input.className = 'checklist-item-edit';
  
  textElement.parentNode.replaceChild(input, textElement);
  input.focus();
  input.select();
  
  const saveEdit = async () => {
    const newText = input.value.trim();
    if (newText && newText !== item.text) {
      item.text = newText;
      item.updatedAt = Date.now();
      await debouncedSaveChecklist(currentChecklist.id, items);
    }
    await renderItems();
  };
  
  input.addEventListener('blur', saveEdit);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveEdit();
    }
  });
}

// Функция saveChecklist удалена - теперь используется debouncedSaveChecklist

// Делаем функции доступными глобально
window.openChecklistWindow = openChecklistWindow;
window.closeChecklistWindow = closeChecklistWindow;
