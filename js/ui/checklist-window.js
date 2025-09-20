/**
 * Модуль для окна управления чек-листом
 * Открывается по правому клику на иконку чек-листа
 */

let currentChecklistWindow = null;
let currentChecklist = null;

/**
 * Открывает окно управления чек-листом
 * @param {Object} checklist - объект чек-листа
 * @param {number} x - координата X курсора
 * @param {number} y - координата Y курсора
 */
export function openChecklistWindow(checklist, x, y) {
  // Закрываем предыдущее окно если есть
  closeChecklistWindow();
  
  currentChecklist = checklist;
  
  // Создаем HTML структуру окна
  const windowHTML = `
    <div id="checklist-window" class="checklist-window">
      <div class="checklist-window-header">
        <h3 class="checklist-window-title">${checklist.title}</h3>
        <button class="checklist-window-close" onclick="window.closeChecklistWindow()">×</button>
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
  loadChecklistData();
  renderItems();
  
  // Показываем окно
  currentChecklistWindow.style.display = 'block';
  setTimeout(() => {
    currentChecklistWindow.classList.add('show');
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
    }, 200);
  }
}

/**
 * Позиционирует окно рядом с курсором
 */
function positionWindow(x, y) {
  const window = currentChecklistWindow;
  const rect = window.getBoundingClientRect();
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
  
  window.style.left = left + 'px';
  window.style.top = top + 'px';
}

/**
 * Настраивает обработчики событий
 */
function setupEventListeners() {
  // Переключение вкладок
  const tabs = currentChecklistWindow.querySelectorAll('.checklist-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  
  // Добавление нового пункта
  const addBtn = currentChecklistWindow.querySelector('#add-item-btn');
  const input = currentChecklistWindow.querySelector('#new-item-input');
  
  addBtn.addEventListener('click', addNewItem);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addNewItem();
    }
  });
  
  // Закрытие по клику вне окна
  document.addEventListener('click', (e) => {
    if (currentChecklistWindow && !currentChecklistWindow.contains(e.target)) {
      closeChecklistWindow();
    }
  });
  
  // Закрытие по Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentChecklistWindow) {
      closeChecklistWindow();
    }
  });
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
function loadChecklistData() {
  if (!currentChecklist || !currentChecklist.items) {
    currentChecklist.items = [];
  }
}

/**
 * Рендерит элементы чек-листа
 */
function renderItems() {
  if (!currentChecklist) return;
  
  const pendingItems = currentChecklist.items.filter(item => !item.completed);
  const completedItems = currentChecklist.items.filter(item => item.completed);
  
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
}

/**
 * Создает элемент списка
 */
function createItemElement(item) {
  const div = document.createElement('div');
  div.className = 'checklist-item';
  div.dataset.itemId = item.id;
  
  div.innerHTML = `
    <label class="checklist-item-label">
      <input type="checkbox" ${item.completed ? 'checked' : ''} 
             onchange="window.toggleChecklistItem('${currentChecklist.id}', '${item.id}')" />
      <span class="checklist-item-text ${item.completed ? 'completed' : ''}">${item.text}</span>
    </label>
    <button class="checklist-item-delete" onclick="window.deleteChecklistItem('${currentChecklist.id}', '${item.id}')">🗑️</button>
  `;
  
  // Добавляем обработчик двойного клика для редактирования
  const textSpan = div.querySelector('.checklist-item-text');
  textSpan.addEventListener('dblclick', () => editItemText(item.id, textSpan));
  
  return div;
}

/**
 * Добавляет новый пункт
 */
function addNewItem() {
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
  
  currentChecklist.items.push(newItem);
  saveChecklist();
  renderItems();
  input.value = '';
}

/**
 * Переключает статус пункта
 */
window.toggleChecklistItem = function(checklistId, itemId) {
  const item = currentChecklist.items.find(i => i.id === itemId);
  if (item) {
    item.completed = !item.completed;
    item.updatedAt = Date.now();
    saveChecklist();
    renderItems();
  }
};

/**
 * Удаляет пункт
 */
window.deleteChecklistItem = function(checklistId, itemId) {
  currentChecklist.items = currentChecklist.items.filter(i => i.id !== itemId);
  saveChecklist();
  renderItems();
};

/**
 * Редактирует текст пункта
 */
function editItemText(itemId, textElement) {
  const item = currentChecklist.items.find(i => i.id === itemId);
  if (!item) return;
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = item.text;
  input.className = 'checklist-item-edit';
  
  textElement.parentNode.replaceChild(input, textElement);
  input.focus();
  input.select();
  
  const saveEdit = () => {
    const newText = input.value.trim();
    if (newText && newText !== item.text) {
      item.text = newText;
      item.updatedAt = Date.now();
      saveChecklist();
    }
    renderItems();
  };
  
  input.addEventListener('blur', saveEdit);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveEdit();
    }
  });
}

/**
 * Сохраняет чек-лист
 */
function saveChecklist() {
  if (window.state && window.state.checklists) {
    const index = window.state.checklists.findIndex(c => c.id === currentChecklist.id);
    if (index !== -1) {
      window.state.checklists[index] = currentChecklist;
      if (window.saveState) {
        window.saveState();
      }
    }
  }
}

// Делаем функции доступными глобально
window.openChecklistWindow = openChecklistWindow;
window.closeChecklistWindow = closeChecklistWindow;
