// js/view_today.js - Enhanced Today View with Drag&Drop
import { state } from './state.js';
import { saveState } from './storage.js';

// UI state for today view
const todayUI = {
  order: JSON.parse(localStorage.getItem('atlas_today_order') || '{}'),
  open: false,
  filters: {
    priority: 'all', // all, p1, p2, p3, p4
    status: 'active', // all, active, done
    time: 'all' // all, with-time, without-time
  },
  viewMode: 'normal' // normal, compact
};

// Save UI state
function saveTodayUI() {
  try {
    localStorage.setItem('atlas_today_order', JSON.stringify(todayUI.order));
  } catch (e) {
    console.warn('Failed to save today UI state:', e);
  }
}

// Check if two dates are the same day
function isSameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// Get task due date
function getDue(task) {
  if (task.due) return task.due;
  if (task.scheduledFor) return task.scheduledFor;
  if (task.when && typeof task.when === "object" && task.when.date) return task.when.date;
  return null;
}

// Apply filters to tasks
function applyFilters(tasks) {
  return tasks.filter(task => {
    // Priority filter
    if (todayUI.filters.priority !== 'all') {
      const priority = task.priority ?? 2;
      if (todayUI.filters.priority === 'p1' && priority !== 1) return false;
      if (todayUI.filters.priority === 'p2' && priority !== 2) return false;
      if (todayUI.filters.priority === 'p3' && priority !== 3) return false;
      if (todayUI.filters.priority === 'p4' && priority !== 4) return false;
    }
    
    // Status filter
    if (todayUI.filters.status === 'active' && task.status === 'done') return false;
    if (todayUI.filters.status === 'done' && task.status !== 'done') return false;
    
    // Time filter
    if (todayUI.filters.time === 'with-time' && !task._due) return false;
    if (todayUI.filters.time === 'without-time' && task._due) return false;
    
    return true;
  });
}

// Pick and sort today's tasks
function pickTodayTasks() {
  const now = Date.now();
  const tasks = (state.tasks || [])
    .filter(t => {
      if (!t) return false;
      if (t.status === "today") return true;
      if (t.status === "done") return true; // Включаем выполненные задачи
      const due = getDue(t);
      return due && isSameDay(due, now);
    })
    .map(t => ({ ...t }));

  // Add sorting properties
  tasks.forEach(t => {
    t._due = getDue(t);
    t._prio = t.priority ?? 2;
    t._upd = t.updatedAt || 0;
    t._ord = todayUI.order[t.id] ?? 0;
  });

  // Smart sorting
  tasks.sort((a, b) => {
    // 1. User-defined order first
    const ap = a._ord !== 0;
    const bp = b._ord !== 0;
    if (ap !== bp) return ap ? -1 : 1;
    if (ap && bp && a._ord !== b._ord) return a._ord - b._ord;

    // 2. Tasks with due time first
    const ad = a._due ? 1 : 0;
    const bd = b._due ? 1 : 0;
    if (ad !== bd) return bd - ad;

    // 3. Earlier due time first
    if (a._due && b._due && a._due !== b._due) return a._due - b._due;

    // 4. Higher priority first (p1 > p2 > p3 > p4)
    if (a._prio !== b._prio) return a._prio - b._prio;

    // 5. More recent updates first
    return b._upd - a._upd;
  });

  // Apply filters
  return applyFilters(tasks);
}

// Calculate day statistics
function calculateDayStats() {
  const now = Date.now();
  const allTasks = (state.tasks || [])
    .filter(t => {
      if (!t) return false;
      if (t.status === "today") return true;
      const due = getDue(t);
      return due && isSameDay(due, now);
    });

  const completed = allTasks.filter(t => t.status === 'done').length;
  const total = allTasks.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  const overdue = allTasks.filter(t => {
    if (t.status === 'done') return false;
    const due = getDue(t);
    return due && Date.now() - due > 60 * 1000;
  }).length;

  const highPriority = allTasks.filter(t => 
    t.status !== 'done' && (t.priority === 1 || t.priority === 2)
  ).length;

  return { completed, total, progress, overdue, highPriority };
}

// Escape HTML
function escapeHtml(s) {
  return String(s || "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

// Render today's tasks
export function renderToday() {
  const wrap = document.getElementById('viewToday');
  if (state.view !== 'today') {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';

  const tasks = pickTodayTasks();
  const stats = calculateDayStats();

  if (tasks.length === 0) {
    wrap.innerHTML = `
      <div class="today-empty">
        <div class="today-empty-icon">📅</div>
        <div class="today-empty-text">На сегодня задач нет</div>
        <div class="today-empty-hint">Добавьте через форму снизу или выберите из бэклога</div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = `
    <div class="today-header">
      <div class="today-title">Сегодня</div>
      <div class="today-subtitle">${tasks.length} задач • Drag&Drop для сортировки</div>
    </div>
    
    <div class="today-stats">
      <div class="today-stat">
        <div class="today-stat-value">${stats.completed}/${stats.total}</div>
        <div class="today-stat-label">Выполнено</div>
      </div>
      <div class="today-stat">
        <div class="today-stat-value">${stats.progress}%</div>
        <div class="today-stat-label">Прогресс</div>
      </div>
      <div class="today-stat">
        <div class="today-stat-value">${stats.highPriority}</div>
        <div class="today-stat-label">Приоритетных</div>
      </div>
      <div class="today-stat">
        <div class="today-stat-value">${stats.overdue}</div>
        <div class="today-stat-label">Просрочено</div>
      </div>
    </div>
    
    <div class="today-filters">
      <div class="today-filter-group">
        <label>Приоритет:</label>
        <div class="today-filter-buttons">
          <button class="today-filter-btn ${todayUI.filters.priority === 'all' ? 'active' : ''}" data-filter="priority" data-value="all">Все</button>
          <button class="today-filter-btn ${todayUI.filters.priority === 'p1' ? 'active' : ''}" data-filter="priority" data-value="p1">P1</button>
          <button class="today-filter-btn ${todayUI.filters.priority === 'p2' ? 'active' : ''}" data-filter="priority" data-value="p2">P2</button>
          <button class="today-filter-btn ${todayUI.filters.priority === 'p3' ? 'active' : ''}" data-filter="priority" data-value="p3">P3</button>
          <button class="today-filter-btn ${todayUI.filters.priority === 'p4' ? 'active' : ''}" data-filter="priority" data-value="p4">P4</button>
        </div>
      </div>
      
      <div class="today-filter-group">
        <label>Статус:</label>
        <div class="today-filter-buttons">
          <button class="today-filter-btn ${todayUI.filters.status === 'all' ? 'active' : ''}" data-filter="status" data-value="all">Все</button>
          <button class="today-filter-btn ${todayUI.filters.status === 'active' ? 'active' : ''}" data-filter="status" data-value="active">Активные</button>
          <button class="today-filter-btn ${todayUI.filters.status === 'done' ? 'active' : ''}" data-filter="status" data-value="done">Выполненные</button>
        </div>
      </div>
      
      <div class="today-filter-group">
        <label>Время:</label>
        <div class="today-filter-buttons">
          <button class="today-filter-btn ${todayUI.filters.time === 'all' ? 'active' : ''}" data-filter="time" data-value="all">Все</button>
          <button class="today-filter-btn ${todayUI.filters.time === 'with-time' ? 'active' : ''}" data-filter="time" data-value="with-time">С временем</button>
          <button class="today-filter-btn ${todayUI.filters.time === 'without-time' ? 'active' : ''}" data-filter="time" data-value="without-time">Без времени</button>
        </div>
      </div>
      
      <div class="today-view-controls">
        <button class="today-view-btn ${todayUI.viewMode === 'normal' ? 'active' : ''}" data-view="normal">Обычный</button>
        <button class="today-view-btn ${todayUI.viewMode === 'compact' ? 'active' : ''}" data-view="compact">Компактный</button>
      </div>
    </div>
    
    <div class="today-list ${todayUI.viewMode === 'compact' ? 'compact' : ''}">
      ${tasks.map(t => renderTaskRow(t)).join('')}
      ${tasks.length > 10 ? '<div class="today-scroll-hint">↓ Прокрутите вниз для просмотра всех задач</div>' : ''}
    </div>
  `;

  // Add event listeners
  addTaskEventListeners();
  addFilterEventListeners();
}

// Render single task row
function renderTaskRow(task) {
  const due = task._due;
  const dueTime = due ? new Date(due).toLocaleTimeString('ru-RU', { 
    hour: '2-digit', 
    minute: '2-digit' 
  }) : '';
  
  const isOverdue = due && Date.now() - due > 60 * 1000;
  const priorityClass = `priority-${task._prio}`;
  const overdueClass = isOverdue ? 'overdue' : '';
  
  const tags = (task.tags || []).map(t => `#${t}`).join(' ');
  const estimate = task.estimateMin ? `~${task.estimateMin}м` : '';

  return `
    <div class="today-task ${priorityClass} ${overdueClass}" data-id="${task.id}" draggable="true">
      <div class="today-task-checkbox">
        <input type="checkbox" ${task.status === 'done' ? 'checked' : ''} />
      </div>
      
      <div class="today-task-content">
        <div class="today-task-title">
          ${escapeHtml(task.title || 'Без названия')}
          ${tags ? `<span class="today-task-tags">${escapeHtml(tags)}</span>` : ''}
        </div>
        <div class="today-task-meta">
          ${estimate ? `<span class="today-task-estimate">${estimate}</span>` : ''}
          ${dueTime ? `<span class="today-task-time ${isOverdue ? 'overdue' : ''}">${dueTime}</span>` : ''}
        </div>
      </div>
      
      <div class="today-task-actions">
        <button class="today-task-edit" title="Переименовать">✎</button>
        <div class="today-task-handle" title="Перетащить для сортировки">⋮⋮</div>
      </div>
    </div>
  `;
}

// Add event listeners to tasks
function addTaskEventListeners() {
  const wrap = document.getElementById('viewToday');
  
  // Checkbox changes
  wrap.querySelectorAll('.today-task-checkbox input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const taskId = e.target.closest('.today-task').dataset.id;
      const task = state.tasks.find(t => t.id === taskId);
      if (task) {
        task.status = e.target.checked ? 'done' : 'today';
        task.updatedAt = Date.now();
        try { saveState(); } catch (_) {}
        renderToday();
      }
    });
  });

  // Edit buttons
  wrap.querySelectorAll('.today-task-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const taskId = e.target.closest('.today-task').dataset.id;
      const task = state.tasks.find(t => t.id === taskId);
      if (task) {
        const newTitle = prompt('Новое название задачи:', task.title || '');
        if (newTitle !== null && newTitle.trim()) {
          task.title = newTitle.trim();
          task.updatedAt = Date.now();
          try { saveState(); } catch (_) {}
          renderToday();
        }
      }
    });
  });

  // Drag and drop
  wrap.querySelectorAll('.today-task').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', row.dataset.id);
      row.classList.add('dragging');
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('drag-over');
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      
      const dragId = e.dataTransfer.getData('text/plain');
      if (!dragId || dragId === row.dataset.id) return;
      
      const tasks = pickTodayTasks();
      const order = tasks.map(t => t.id);
      const from = order.indexOf(dragId);
      const to = order.indexOf(row.dataset.id);
      
      if (from < 0 || to < 0) return;
      
      // Reorder
      order.splice(to, 0, order.splice(from, 1)[0]);
      
      // Update order
      const base = 10;
      const newOrder = {};
      order.forEach((id, i) => {
        newOrder[id] = (i + 1) * base;
      });
      
      todayUI.order = newOrder;
      saveTodayUI();
      renderToday();
    });
  });
}

// Add filter event listeners
function addFilterEventListeners() {
  const wrap = document.getElementById('viewToday');
  if (!wrap) return;
  
  // Filter buttons
  wrap.querySelectorAll('.today-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const filter = e.target.dataset.filter;
      const value = e.target.dataset.value;
      
      if (filter && value) {
        todayUI.filters[filter] = value;
        saveTodayUI();
        renderToday();
      }
    });
  });
  
  // View mode buttons
  wrap.querySelectorAll('.today-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const mode = e.target.dataset.view;
      if (mode) {
        todayUI.viewMode = mode;
        saveTodayUI();
        renderToday();
      }
    });
  });
}

// Add keyboard shortcuts
function addKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'today') return;
    
    // Escape - clear filters
    if (e.key === 'Escape') {
      todayUI.filters = { priority: 'all', status: 'active', time: 'all' };
      saveTodayUI();
      renderToday();
      e.preventDefault();
    }
    
    // Number keys for priority filters
    if (e.key >= '1' && e.key <= '4') {
      todayUI.filters.priority = `p${e.key}`;
      saveTodayUI();
      renderToday();
    }
    
    // A for all priorities
    if (e.key === 'a' || e.key === 'A') {
      todayUI.filters.priority = 'all';
      saveTodayUI();
      renderToday();
    }
    
    // V for view mode toggle
    if (e.key === 'v' || e.key === 'V') {
      todayUI.viewMode = todayUI.viewMode === 'normal' ? 'compact' : 'normal';
      saveTodayUI();
      renderToday();
    }
  });
}

// Initialize keyboard shortcuts
addKeyboardShortcuts();
