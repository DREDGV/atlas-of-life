// js/inbox.js
// Inbox system for quick thought capture and distribution

import { state, generateId } from './state.js';
import { saveState } from './storage.js';

// Inbox state
let inboxItems = [];
let isInboxInitialized = false;

// Initialize inbox system
export function initInbox() {
  if (isInboxInitialized) return;
  
  // Load inbox items from state
  if (state.inbox && Array.isArray(state.inbox)) {
    inboxItems = state.inbox;
  } else {
    state.inbox = [];
    inboxItems = [];
  }
  
  isInboxInitialized = true;
  console.log('Inbox system initialized with', inboxItems.length, 'items');
}

// Check if inbox is enabled
function isInboxEnabled() {
  return state.settings?.showInbox === true;
}

// Add item to inbox
export function addToInbox(text, metadata = {}) {
  if (!isInboxEnabled()) {
    if (window.showToast) window.showToast('Инбокс отключен в настройках', 'warn');
    return false;
  }
  
  if (!text || text.trim().length === 0) {
    if (window.showToast) window.showToast('Нельзя добавить пустой элемент в Инбокс', 'warn');
    return false;
  }
  
  const item = {
    id: generateId(),
    text: text.trim(),
    createdAt: new Date().toISOString(),
    status: 'inbox',
    type: 'task', // Default type
    metadata: {
      priority: 'p3',
      tags: [],
      dueDate: null,
      parentId: null,
      projectId: null,
      domainId: null,
      ...metadata
    }
  };
  
  inboxItems.push(item);
  state.inbox = inboxItems;
  try {
    saveState();
  } catch (error) {
    console.error('Error saving inbox item:', error);
  }
  
  if (window.showToast) window.showToast(`Добавлено в Инбокс: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`, 'ok');
  return true;
}

// Get all inbox items
export function getInboxItems() {
  return inboxItems.filter(item => item.status === 'inbox');
}

// Remove item from inbox
export function removeFromInbox(itemId) {
  const index = inboxItems.findIndex(item => item.id === itemId);
  if (index !== -1) {
    inboxItems.splice(index, 1);
    state.inbox = inboxItems;
    try {
      saveState();
    } catch (error) {
      console.error('Error saving after inbox removal:', error);
    }
    return true;
  }
  return false;
}

// Update item metadata
export function updateInboxItem(itemId, updates) {
  const item = inboxItems.find(item => item.id === itemId);
  if (item) {
    Object.assign(item.metadata, updates);
    state.inbox = inboxItems;
    try {
      saveState();
    } catch (error) {
      console.error('Error saving after inbox update:', error);
    }
    return true;
  }
  return false;
}

// Convert inbox item to task/idea/note
export function distributeInboxItem(itemId, targetType = 'task', targetProjectId = null, targetDomainId = null) {
  const item = inboxItems.find(item => item.id === itemId);
  if (!item) return false;
  
  // Create new object based on target type
  const newObject = {
    id: generateId(),
    title: item.text,
    createdAt: item.createdAt,
    updatedAt: new Date().toISOString(),
    status: item.metadata.priority === 'p1' ? 'today' : 'backlog',
    priority: item.metadata.priority,
    tags: item.metadata.tags || [],
    dueDate: item.metadata.dueDate,
    parentId: item.metadata.parentId,
    projectId: targetProjectId || item.metadata.projectId,
    domainId: targetDomainId || item.metadata.domainId
  };
  
  // Add to appropriate collection (with duplicate check)
  if (targetType === 'task') {
    if (!state.tasks) state.tasks = [];
    // Check for duplicates
    const exists = state.tasks.some(t => t.title === newObject.title && t.createdAt === newObject.createdAt);
    if (!exists) {
      state.tasks.push(newObject);
    }
  } else if (targetType === 'idea') {
    if (!state.ideas) state.ideas = [];
    const exists = state.ideas.some(i => i.title === newObject.title && i.createdAt === newObject.createdAt);
    if (!exists) {
      state.ideas.push(newObject);
    }
  } else if (targetType === 'note') {
    if (!state.notes) state.notes = [];
    const exists = state.notes.some(n => n.title === newObject.title && n.createdAt === newObject.createdAt);
    if (!exists) {
      state.notes.push(newObject);
    }
  }
  
  // Remove from inbox
  removeFromInbox(itemId);
  
  // Force save state after distribution
  try {
    saveState();
  } catch (error) {
    console.error('Error saving state after distribution:', error);
  }
  
  // Trigger map redraw and today update (with enhanced safety checks)
  try {
    // Check if canvas exists and is ready
    const canvas = document.getElementById('canvas');
    if (!canvas) {
      console.warn('Canvas not found, skipping map redraw');
      return true;
    }
    
    // Check if app is fully initialized
    if (!window.state || !window.state.domains) {
      console.warn('App not fully initialized, skipping map redraw');
      return true;
    }
    
    // Additional safety check - ensure state is valid
    if (!Array.isArray(window.state.tasks) || !Array.isArray(window.state.domains)) {
      console.warn('State arrays not properly initialized, skipping map redraw');
      return true;
    }
    
    // Use requestAnimationFrame for safer UI updates
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(() => {
        try {
          // Check if functions exist and call them
          if (window.drawMap && typeof window.drawMap === 'function') {
            window.drawMap();
          } else {
            console.warn('drawMap function not available');
          }
          
          if (window.renderToday && typeof window.renderToday === 'function') {
            window.renderToday();
          } else {
            console.warn('renderToday function not available');
          }
        } catch (uiError) {
          console.error('Error in requestAnimationFrame UI update:', uiError);
          // Try one more time with a delay
          setTimeout(() => {
            try {
              if (window.drawMap && typeof window.drawMap === 'function') {
                window.drawMap();
              }
              if (window.renderToday && typeof window.renderToday === 'function') {
                window.renderToday();
              }
            } catch (retryError) {
              console.error('Error in retry UI update:', retryError);
            }
          }, 200);
        }
      });
    } else {
      // Fallback for older browsers
      setTimeout(() => {
        try {
          if (window.drawMap && typeof window.drawMap === 'function') {
            window.drawMap();
          }
          if (window.renderToday && typeof window.renderToday === 'function') {
            window.renderToday();
          }
        } catch (fallbackError) {
          console.error('Error in fallback UI update:', fallbackError);
        }
      }, 100);
    }
  } catch (error) {
    console.error('Error updating UI after distribution:', error);
  }
  
  if (window.showToast) window.showToast(`Элемент распределен как ${targetType === 'task' ? 'задача' : targetType === 'idea' ? 'идея' : 'заметка'}`, 'ok');
  return true;
}

// Show distribution modal for inbox item
export function showDistributionModal(itemId) {
  const item = inboxItems.find(item => item.id === itemId);
  if (!item) return;
  
  const modal = document.createElement('div');
  modal.id = 'inbox-distribution-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: var(--panel);
    border: 1px solid var(--panel-2);
    border-radius: 8px;
    padding: 20px;
    min-width: 500px;
    max-width: 600px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  `;
  
  // Get available projects and domains
  const projects = state.projects || [];
  const domains = state.domains || [];
  
  content.innerHTML = `
    <div style="margin-bottom: 16px;">
      <h3 style="margin: 0 0 8px 0; color: var(--text);">📤 Распределить элемент</h3>
      <div style="padding: 12px; background: var(--panel-2); border-radius: 4px; margin-bottom: 16px;">
        <strong>${item.text}</strong>
        ${item.metadata.tags.length > 0 ? `<br><small>Теги: ${item.metadata.tags.join(', ')}</small>` : ''}
        ${item.metadata.priority ? `<br><small>Приоритет: ${item.metadata.priority}</small>` : ''}
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
      <div>
        <label style="display: block; margin-bottom: 8px; font-weight: 600;">Тип объекта:</label>
        <select id="distribute-type" style="width: 100%; padding: 8px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel); color: var(--text);">
          <option value="task">📋 Задача</option>
          <option value="idea">💡 Идея</option>
          <option value="note">📝 Заметка</option>
        </select>
      </div>
      
      <div>
        <label style="display: block; margin-bottom: 8px; font-weight: 600;">Приоритет:</label>
        <select id="distribute-priority" style="width: 100%; padding: 8px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel); color: var(--text);">
          <option value="p1" ${item.metadata.priority === 'p1' ? 'selected' : ''}>🔴 P1 - Критический</option>
          <option value="p2" ${item.metadata.priority === 'p2' ? 'selected' : ''}>🟠 P2 - Высокий</option>
          <option value="p3" ${item.metadata.priority === 'p3' ? 'selected' : ''}>🟡 P3 - Средний</option>
          <option value="p4" ${item.metadata.priority === 'p4' ? 'selected' : ''}>⚪ P4 - Низкий</option>
        </select>
      </div>
    </div>
    
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600;">Домен:</label>
      <select id="distribute-domain" style="width: 100%; padding: 8px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel); color: var(--text);">
        <option value="">Не назначен</option>
        ${domains.map(d => `<option value="${d.id}">${d.title}</option>`).join('')}
      </select>
    </div>
    
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600;">Проект:</label>
      <select id="distribute-project" style="width: 100%; padding: 8px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel); color: var(--text);">
        <option value="">Не назначен</option>
        ${projects.map(p => `<option value="${p.id}">${p.title}</option>`).join('')}
      </select>
    </div>
    
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600;">Теги (через запятую):</label>
      <input type="text" id="distribute-tags" value="${item.metadata.tags.join(', ')}" placeholder="важный, работа, срочно" style="width: 100%; padding: 8px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel); color: var(--text);">
    </div>
    
    <div style="margin-bottom: 16px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 600;">Срок выполнения:</label>
      <input type="date" id="distribute-due" value="${item.metadata.dueDate || ''}" style="width: 100%; padding: 8px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel); color: var(--text);">
    </div>
    
    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      <button id="distribute-cancel" style="padding: 8px 16px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel); color: var(--text); cursor: pointer;">Отмена</button>
      <button id="distribute-save" style="padding: 8px 16px; border: none; border-radius: 4px; background: var(--accent); color: white; cursor: pointer;">Распределить</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Event handlers
  const cleanup = () => {
    document.body.removeChild(modal);
  };
  
  document.getElementById('distribute-cancel').onclick = cleanup;
  modal.onclick = (e) => {
    if (e.target === modal) cleanup();
  };
  
  document.getElementById('distribute-save').onclick = () => {
    const type = document.getElementById('distribute-type').value;
    const priority = document.getElementById('distribute-priority').value;
    const domainId = document.getElementById('distribute-domain').value;
    const projectId = document.getElementById('distribute-project').value;
    const tags = document.getElementById('distribute-tags').value.split(',').map(t => t.trim()).filter(t => t);
    const dueDate = document.getElementById('distribute-due').value;
    
    // Update item metadata
    updateInboxItem(itemId, {
      priority,
      tags,
      dueDate: dueDate || null,
      projectId: projectId || null,
      domainId: domainId || null
    });
    
    // Distribute the item
    distributeInboxItem(itemId, type, projectId || null, domainId || null);
    cleanup();
    
    // Refresh inbox list if open
    if (document.getElementById('inbox-list-modal')) {
      document.body.removeChild(document.getElementById('inbox-list-modal'));
      showInboxListModal();
    }
  };
  
  // Keyboard shortcuts
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      document.getElementById('distribute-save').click();
    }
  };
}

// Simple text parser for shortcodes
export function parseInboxText(text) {
  const metadata = {
    priority: 'p3',
    tags: [],
    dueDate: null
  };
  
  // Parse priority (p1, p2, p3, p4)
  const priorityMatch = text.match(/\bp([1-4])\b/);
  if (priorityMatch) {
    metadata.priority = `p${priorityMatch[1]}`;
  }
  
  // Parse tags (#tag)
  const tagMatches = text.match(/#(\w+)/g);
  if (tagMatches) {
    metadata.tags = tagMatches.map(tag => tag.substring(1));
  }
  
  // Parse due dates (!today, !tomorrow, !monday, etc.)
  const dateMatch = text.match(/!(\w+)/);
  if (dateMatch) {
    const dateStr = dateMatch[1].toLowerCase();
    const today = new Date();
    
    if (dateStr === 'today') {
      metadata.dueDate = today.toISOString().split('T')[0];
    } else if (dateStr === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      metadata.dueDate = tomorrow.toISOString().split('T')[0];
    }
  }
  
  // Parse time estimates (~30m, ~1h, ~2d)
  const timeMatch = text.match(/~(\d+)([mhd])/);
  if (timeMatch) {
    const value = parseInt(timeMatch[1]);
    const unit = timeMatch[2];
    // Store as metadata for now
    metadata.estimate = `${value}${unit}`;
  }
  
  return metadata;
}

// Global functions for hotkeys
window.openInboxCapture = function() {
  if (!isInboxEnabled()) {
    if (window.showToast) window.showToast('Инбокс отключен в настройках', 'warn');
    return;
  }
  
  showInboxCaptureOverlay();
};

window.openInboxList = function() {
  if (!isInboxEnabled()) {
    if (window.showToast) window.showToast('Инбокс отключен в настройках', 'warn');
    return;
  }
  
  showInboxListModal();
};

// Show capture overlay
function showInboxCaptureOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'inbox-capture-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: var(--panel);
    border: 1px solid var(--panel-2);
    border-radius: 8px;
    padding: 20px;
    min-width: 400px;
    max-width: 600px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  `;
  
  modal.innerHTML = `
    <div style="margin-bottom: 16px;">
      <h3 style="margin: 0 0 8px 0; color: var(--text);">📥 Быстрый захват</h3>
      <p style="margin: 0; color: var(--text-2); font-size: 14px;">
        Напишите что угодно и нажмите Enter. Используйте шорткоды: #тег @проект !сегодня ~30м p1
      </p>
    </div>
    <textarea 
      id="inbox-capture-text" 
      placeholder="Ваша мысль..."
      style="
        width: 100%;
        height: 80px;
        padding: 12px;
        border: 1px solid var(--panel-2);
        border-radius: 4px;
        background: var(--panel);
        color: var(--text);
        font-family: inherit;
        font-size: 14px;
        resize: vertical;
        outline: none;
      "
    ></textarea>
    <div style="margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end;">
      <button id="inbox-capture-cancel" style="
        padding: 8px 16px;
        border: 1px solid var(--panel-2);
        border-radius: 4px;
        background: var(--panel);
        color: var(--text);
        cursor: pointer;
      ">Отмена</button>
      <button id="inbox-capture-save" style="
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        background: var(--accent);
        color: white;
        cursor: pointer;
      ">Сохранить</button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  const textarea = document.getElementById('inbox-capture-text');
  const cancelBtn = document.getElementById('inbox-capture-cancel');
  const saveBtn = document.getElementById('inbox-capture-save');
  
  // Focus and select text
  textarea.focus();
  textarea.select();
  
  // Event handlers
  const cleanup = () => {
    document.body.removeChild(overlay);
  };
  
  cancelBtn.onclick = cleanup;
  overlay.onclick = (e) => {
    if (e.target === overlay) cleanup();
  };
  
  saveBtn.onclick = () => {
    const text = textarea.value.trim();
    if (text) {
      // Support multiline input - each line becomes separate inbox item
      const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      if (lines.length === 1) {
        // Single line - parse metadata
        const metadata = parseInboxText(text);
        addToInbox(text, metadata);
      } else {
        // Multiple lines - add each as separate item
        lines.forEach((line, index) => {
          const metadata = parseInboxText(line);
          addToInbox(line, metadata);
        });
        if (window.showToast) window.showToast(`Добавлено ${lines.length} элементов в Инбокс`, 'ok');
      }
    }
    cleanup();
  };
  
  // Keyboard shortcuts
  textarea.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveBtn.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  };
}

// Show inbox list modal
function showInboxListModal() {
  const items = getInboxItems();
  
  const modal = document.createElement('div');
  modal.id = 'inbox-list-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: var(--panel);
    border: 1px solid var(--panel-2);
    border-radius: 8px;
    padding: 20px;
    min-width: 500px;
    max-width: 800px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  `;
  
  if (items.length === 0) {
    content.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-2);">
        <h3 style="margin: 0 0 8px 0;">📥 Инбокс пуст</h3>
        <p style="margin: 0;">Нажмите N для быстрого захвата мыслей</p>
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <button id="inbox-list-close" style="
          padding: 8px 16px;
          border: 1px solid var(--panel-2);
          border-radius: 4px;
          background: var(--panel);
          color: var(--text);
          cursor: pointer;
        ">Закрыть</button>
      </div>
    `;
  } else {
    content.innerHTML = `
      <div style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
          <div>
            <h3 style="margin: 0 0 8px 0; color: var(--text); font-size: 20px;">📥 Инбокс (${items.length})</h3>
            <p style="margin: 0; color: var(--text-2); font-size: 14px;">
              Разложите элементы по проектам и доменам
            </p>
          </div>
          <button id="inbox-help-toggle" title="Показать справку по горячим клавишам" style="
            padding: 8px 12px;
            border: 1px solid var(--panel-2);
            border-radius: 8px;
            background: var(--panel);
            color: var(--text);
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s ease;
          " onmouseover="this.style.background='var(--panel-2)'" 
             onmouseout="this.style.background='var(--panel)'">❓ Справка</button>
        </div>
        
        <!-- Help Panel -->
        <div id="inbox-help-panel" style="
          display: none;
          padding: 16px;
          background: var(--panel-2);
          border-radius: 8px;
          border: 1px solid var(--panel-2);
          margin-bottom: 16px;
        ">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div>
              <h4 style="margin: 0 0 8px 0; color: var(--text); font-size: 14px;">🎯 Быстрые действия:</h4>
              <div style="font-size: 12px; color: var(--text-2); line-height: 1.5;">
                <div><strong>1-4:</strong> Установить приоритет p1-p4</div>
                <div><strong>A:</strong> Назначить проект</div>
                <div><strong>T:</strong> Добавить тег</div>
                <div><strong>D:</strong> Установить дату</div>
                <div><strong>Enter:</strong> Выделить/снять элемент</div>
                <div><strong>Esc:</strong> Закрыть окно</div>
              </div>
            </div>
            <div>
              <h4 style="margin: 0 0 8px 0; color: var(--text); font-size: 14px;">📦 Пакетные операции:</h4>
              <div style="font-size: 12px; color: var(--text-2); line-height: 1.5;">
                <div><strong>Выделите элементы</strong> чекбоксами</div>
                <div><strong>📋 Задачи:</strong> Создать задачи</div>
                <div><strong>💡 Идеи:</strong> Создать идеи</div>
                <div><strong>📝 Заметки:</strong> Создать заметки</div>
                <div><strong>🗑️ Удалить:</strong> Удалить выбранные</div>
                <div><strong>❌ Снять:</strong> Снять выделение</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Batch Operations Panel -->
      <div id="batch-operations-panel" style="
        display: none;
        padding: 16px;
        background: linear-gradient(135deg, var(--panel-2) 0%, var(--panel) 100%);
        border-radius: 12px;
        margin-bottom: 20px;
        border: 2px solid var(--accent);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        animation: slideDown 0.3s ease-out;
      ">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <div style="
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: var(--accent);
            border-radius: 20px;
            color: white;
            font-weight: 600;
            font-size: 14px;
          ">
            📦 Пакетные операции
          </div>
          <div id="selected-count" style="
            padding: 4px 12px;
            background: rgba(0, 0, 0, 0.1);
            border-radius: 16px;
            color: var(--accent);
            font-weight: 600;
            font-size: 13px;
          ">0 выбрано</div>
        </div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button id="batch-task" title="Создать задачи из выбранных элементов (Ctrl+1)" style="
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
            color: white;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
            box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
          " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(59, 130, 246, 0.4)'" 
             onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(59, 130, 246, 0.3)'">📋 Задачи</button>
          <button id="batch-idea" title="Создать идеи из выбранных элементов (Ctrl+2)" style="
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            color: white;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
            box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
          " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(245, 158, 11, 0.4)'" 
             onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(245, 158, 11, 0.3)'">💡 Идеи</button>
          <button id="batch-note" title="Создать заметки из выбранных элементов (Ctrl+3)" style="
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
            box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
          " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(16, 185, 129, 0.4)'" 
             onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(16, 185, 129, 0.3)'">📝 Заметки</button>
          <button id="batch-delete" title="Удалить выбранные элементы (Ctrl+Del)" style="
            padding: 8px 16px;
            border: 2px solid var(--danger);
            border-radius: 8px;
            background: transparent;
            color: var(--danger);
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
          " onmouseover="this.style.background='var(--danger)'; this.style.color='white'; this.style.transform='translateY(-2px)'" 
             onmouseout="this.style.background='transparent'; this.style.color='var(--danger)'; this.style.transform='translateY(0)'">🗑️ Удалить</button>
          <button id="batch-clear" title="Снять выделение со всех элементов (Ctrl+D)" style="
            padding: 8px 16px;
            border: 1px solid var(--panel-2);
            border-radius: 8px;
            background: var(--panel);
            color: var(--text);
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
          " onmouseover="this.style.background='var(--panel-2)'; this.style.transform='translateY(-2px)'" 
             onmouseout="this.style.background='var(--panel)'; this.style.transform='translateY(0)'">❌ Снять</button>
        </div>
      </div>
      <div id="inbox-items-list" style="margin-bottom: 20px;">
        ${items.map(item => `
          <div class="inbox-item" data-id="${item.id}" style="
            padding: 16px;
            border: 2px solid var(--panel-2);
            border-radius: 12px;
            margin-bottom: 12px;
            background: linear-gradient(135deg, var(--panel) 0%, var(--panel-2) 100%);
            transition: all 0.3s ease;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
            cursor: pointer;
          " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 16px rgba(0, 0, 0, 0.1)'" 
             onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(0, 0, 0, 0.05)'">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div style="display: flex; align-items: flex-start; gap: 12px; flex: 1;">
                <div style="position: relative;">
                  <input type="checkbox" class="inbox-item-checkbox" data-id="${item.id}" style="
                    margin-top: 2px;
                    width: 20px;
                    height: 20px;
                    cursor: pointer;
                    accent-color: var(--accent);
                    transform: scale(1.2);
                  ">
                </div>
                <div style="flex: 1;">
                  <div style="
                    font-weight: 600; 
                    margin-bottom: 8px; 
                    font-size: 15px;
                    line-height: 1.4;
                    color: var(--text);
                  ">${item.text}</div>
                  <div style="
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                    align-items: center;
                  ">
                    ${item.metadata.tags.length > 0 ? `
                      <div style="
                        display: flex;
                        gap: 4px;
                        align-items: center;
                      ">
                        <span style="font-size: 11px; color: var(--text-2);">🏷️</span>
                        ${item.metadata.tags.map(tag => `
                          <span style="
                            padding: 2px 8px;
                            background: rgba(59, 130, 246, 0.1);
                            color: #3b82f6;
                            border-radius: 12px;
                            font-size: 11px;
                            font-weight: 500;
                          ">${tag}</span>
                        `).join('')}
                      </div>
                    ` : ''}
                    ${item.metadata.priority ? `
                      <div style="
                        display: flex;
                        align-items: center;
                        gap: 4px;
                      ">
                        <span style="font-size: 11px; color: var(--text-2);">⚡</span>
                        <span style="
                          padding: 2px 8px;
                          background: ${item.metadata.priority === 'p1' ? 'rgba(239, 68, 68, 0.1)' : 
                                       item.metadata.priority === 'p2' ? 'rgba(245, 158, 11, 0.1)' : 
                                       item.metadata.priority === 'p3' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(107, 114, 128, 0.1)'};
                          color: ${item.metadata.priority === 'p1' ? '#ef4444' : 
                                  item.metadata.priority === 'p2' ? '#f59e0b' : 
                                  item.metadata.priority === 'p3' ? '#3b82f6' : '#6b7280'};
                          border-radius: 12px;
                          font-size: 11px;
                          font-weight: 600;
                          text-transform: uppercase;
                        ">${item.metadata.priority}</span>
                      </div>
                    ` : ''}
                    ${item.metadata.dueDate ? `
                      <div style="
                        display: flex;
                        align-items: center;
                        gap: 4px;
                      ">
                        <span style="font-size: 11px; color: var(--text-2);">📅</span>
                        <span style="
                          padding: 2px 8px;
                          background: rgba(16, 185, 129, 0.1);
                          color: #10b981;
                          border-radius: 12px;
                          font-size: 11px;
                          font-weight: 500;
                        ">${item.metadata.dueDate}</span>
                      </div>
                    ` : ''}
                  </div>
                </div>
              </div>
              <div style="display: flex; gap: 6px; margin-left: 16px; flex-wrap: wrap;">
                <button class="inbox-item-quick-task" data-id="${item.id}" title="Быстро создать задачу (1)" style="
                  padding: 8px 10px;
                  border: none;
                  border-radius: 8px;
                  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
                  color: white;
                  cursor: pointer;
                  font-size: 12px;
                  font-weight: 500;
                  transition: all 0.2s ease;
                  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
                " onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(59, 130, 246, 0.3)'" 
                   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(59, 130, 246, 0.2)'">📋</button>
                <button class="inbox-item-quick-idea" data-id="${item.id}" title="Быстро создать идею (2)" style="
                  padding: 8px 10px;
                  border: none;
                  border-radius: 8px;
                  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                  color: white;
                  cursor: pointer;
                  font-size: 12px;
                  font-weight: 500;
                  transition: all 0.2s ease;
                  box-shadow: 0 2px 4px rgba(245, 158, 11, 0.2);
                " onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(245, 158, 11, 0.3)'" 
                   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(245, 158, 11, 0.2)'">💡</button>
                <button class="inbox-item-quick-note" data-id="${item.id}" title="Быстро создать заметку (3)" style="
                  padding: 8px 10px;
                  border: none;
                  border-radius: 8px;
                  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                  color: white;
                  cursor: pointer;
                  font-size: 12px;
                  font-weight: 500;
                  transition: all 0.2s ease;
                  box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);
                " onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(16, 185, 129, 0.3)'" 
                   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(16, 185, 129, 0.2)'">📝</button>
                <button class="inbox-item-distribute" data-id="${item.id}" title="Полное распределение (Enter)" style="
                  padding: 8px 12px;
                  border: none;
                  border-radius: 8px;
                  background: linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%);
                  color: white;
                  cursor: pointer;
                  font-size: 12px;
                  font-weight: 500;
                  transition: all 0.2s ease;
                  box-shadow: 0 2px 4px rgba(124, 58, 237, 0.2);
                " onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(124, 58, 237, 0.3)'" 
                   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(124, 58, 237, 0.2)'">⚙️</button>
                <button class="inbox-item-delete" data-id="${item.id}" title="Удалить элемент (Del)" style="
                  padding: 8px 10px;
                  border: 2px solid var(--danger);
                  border-radius: 8px;
                  background: transparent;
                  color: var(--danger);
                  cursor: pointer;
                  font-size: 12px;
                  font-weight: 500;
                  transition: all 0.2s ease;
                " onmouseover="this.style.background='var(--danger)'; this.style.color='white'; this.style.transform='translateY(-1px)'" 
                   onmouseout="this.style.background='transparent'; this.style.color='var(--danger)'; this.style.transform='translateY(0)'">🗑️</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
      <div style="text-align: center;">
        <button id="inbox-list-close" style="
          padding: 8px 16px;
          border: 1px solid var(--panel-2);
          border-radius: 4px;
          background: var(--panel);
          color: var(--text);
          cursor: pointer;
        ">Закрыть</button>
      </div>
    `;
  }
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Event handlers
  const cleanup = () => {
    document.body.removeChild(modal);
  };
  
  document.getElementById('inbox-list-close').onclick = cleanup;
  modal.onclick = (e) => {
    if (e.target === modal) cleanup();
  };
  
  // Help toggle button
  const helpToggle = document.getElementById('inbox-help-toggle');
  const helpPanel = document.getElementById('inbox-help-panel');
  if (helpToggle && helpPanel) {
    helpToggle.onclick = (e) => {
      e.stopPropagation();
      const isVisible = helpPanel.style.display !== 'none';
      helpPanel.style.display = isVisible ? 'none' : 'block';
      helpToggle.textContent = isVisible ? '❓ Справка' : '❌ Скрыть';
    };
  }
  
  // Quick action buttons
  document.querySelectorAll('.inbox-item-quick-task').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.id;
      try {
        distributeInboxItem(itemId, 'task');
        cleanup();
        // Delay refresh to avoid conflicts
        setTimeout(() => {
          if (document.getElementById('inbox-list-modal')) {
            showInboxListModal();
          }
        }, 100);
      } catch (error) {
        console.error('Error in quick task distribution:', error);
        if (window.showToast) window.showToast('Ошибка при создании задачи', 'error');
      }
    };
  });
  
  document.querySelectorAll('.inbox-item-quick-idea').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.id;
      try {
        distributeInboxItem(itemId, 'idea');
        cleanup();
        setTimeout(() => {
          if (document.getElementById('inbox-list-modal')) {
            showInboxListModal();
          }
        }, 100);
      } catch (error) {
        console.error('Error in quick idea distribution:', error);
        if (window.showToast) window.showToast('Ошибка при создании идеи', 'error');
      }
    };
  });
  
  document.querySelectorAll('.inbox-item-quick-note').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.id;
      try {
        distributeInboxItem(itemId, 'note');
        cleanup();
        setTimeout(() => {
          if (document.getElementById('inbox-list-modal')) {
            showInboxListModal();
          }
        }, 100);
      } catch (error) {
        console.error('Error in quick note distribution:', error);
        if (window.showToast) window.showToast('Ошибка при создании заметки', 'error');
      }
    };
  });
  
  // Distribute buttons
  document.querySelectorAll('.inbox-item-distribute').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.id;
      cleanup(); // Close list modal
      showDistributionModal(itemId); // Open distribution modal
    };
  });
  
  // Delete buttons
  document.querySelectorAll('.inbox-item-delete').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.id;
      if (confirm('Удалить элемент из Инбокса?')) {
        removeFromInbox(itemId);
        if (window.showToast) window.showToast('Элемент удален из Инбокса', 'ok');
        cleanup();
        showInboxListModal(); // Refresh
      }
    };
  });
  
  // Batch operations handlers
  const updateBatchPanel = () => {
    const checkboxes = document.querySelectorAll('.inbox-item-checkbox');
    const checkedBoxes = document.querySelectorAll('.inbox-item-checkbox:checked');
    const batchPanel = document.getElementById('batch-operations-panel');
    const selectedCount = document.getElementById('selected-count');
    
    if (checkedBoxes.length > 0) {
      batchPanel.style.display = 'block';
      selectedCount.textContent = `${checkedBoxes.length} выбрано`;
      
      // Update item styles
      checkboxes.forEach(checkbox => {
        const item = checkbox.closest('.inbox-item');
        if (checkbox.checked) {
          item.style.borderColor = 'var(--accent)';
          item.style.backgroundColor = 'var(--panel-2)';
        } else {
          item.style.borderColor = 'var(--panel-2)';
          item.style.backgroundColor = 'var(--panel)';
        }
      });
    } else {
      batchPanel.style.display = 'none';
      
      // Reset item styles
      checkboxes.forEach(checkbox => {
        const item = checkbox.closest('.inbox-item');
        item.style.borderColor = 'var(--panel-2)';
        item.style.backgroundColor = 'var(--panel)';
      });
    }
  };
  
  // Checkbox handlers
  document.querySelectorAll('.inbox-item-checkbox').forEach(checkbox => {
    checkbox.onchange = updateBatchPanel;
  });
  
  // Batch operation buttons
  const batchTaskBtn = document.getElementById('batch-task');
  if (batchTaskBtn) {
    batchTaskBtn.onclick = () => {
    const selectedIds = Array.from(document.querySelectorAll('.inbox-item-checkbox:checked'))
      .map(cb => cb.dataset.id);
    
    if (selectedIds.length === 0) return;
    
    try {
      selectedIds.forEach(itemId => {
        distributeInboxItem(itemId, 'task');
      });
      
      if (window.showToast) {
        window.showToast(`Создано ${selectedIds.length} задач`, 'ok');
      }
      
      cleanup();
      setTimeout(() => {
        if (document.getElementById('inbox-list-modal')) {
          showInboxListModal();
        }
      }, 100);
    } catch (error) {
      console.error('Error in batch task distribution:', error);
      if (window.showToast) window.showToast('Ошибка при создании задач', 'error');
    }
    };
  }
  
  const batchIdeaBtn = document.getElementById('batch-idea');
  if (batchIdeaBtn) {
    batchIdeaBtn.onclick = () => {
    const selectedIds = Array.from(document.querySelectorAll('.inbox-item-checkbox:checked'))
      .map(cb => cb.dataset.id);
    
    if (selectedIds.length === 0) return;
    
    try {
      selectedIds.forEach(itemId => {
        distributeInboxItem(itemId, 'idea');
      });
      
      if (window.showToast) {
        window.showToast(`Создано ${selectedIds.length} идей`, 'ok');
      }
      
      cleanup();
      setTimeout(() => {
        if (document.getElementById('inbox-list-modal')) {
          showInboxListModal();
        }
      }, 100);
    } catch (error) {
      console.error('Error in batch idea distribution:', error);
      if (window.showToast) window.showToast('Ошибка при создании идей', 'error');
    }
    };
  }
  
  const batchNoteBtn = document.getElementById('batch-note');
  if (batchNoteBtn) {
    batchNoteBtn.onclick = () => {
    const selectedIds = Array.from(document.querySelectorAll('.inbox-item-checkbox:checked'))
      .map(cb => cb.dataset.id);
    
    if (selectedIds.length === 0) return;
    
    try {
      selectedIds.forEach(itemId => {
        distributeInboxItem(itemId, 'note');
      });
      
      if (window.showToast) {
        window.showToast(`Создано ${selectedIds.length} заметок`, 'ok');
      }
      
      cleanup();
      setTimeout(() => {
        if (document.getElementById('inbox-list-modal')) {
          showInboxListModal();
        }
      }, 100);
    } catch (error) {
      console.error('Error in batch note distribution:', error);
      if (window.showToast) window.showToast('Ошибка при создании заметок', 'error');
    }
    };
  }
  
  const batchDeleteBtn = document.getElementById('batch-delete');
  if (batchDeleteBtn) {
    batchDeleteBtn.onclick = () => {
    const selectedIds = Array.from(document.querySelectorAll('.inbox-item-checkbox:checked'))
      .map(cb => cb.dataset.id);
    
    if (selectedIds.length === 0) return;
    
    if (confirm(`Удалить ${selectedIds.length} элементов из Инбокса?`)) {
      selectedIds.forEach(itemId => {
        removeFromInbox(itemId);
      });
      
      if (window.showToast) {
        window.showToast(`Удалено ${selectedIds.length} элементов`, 'ok');
      }
      
      cleanup();
      showInboxListModal(); // Refresh
    }
    };
  }
  
  const batchClearBtn = document.getElementById('batch-clear');
  if (batchClearBtn) {
    batchClearBtn.onclick = () => {
    document.querySelectorAll('.inbox-item-checkbox').forEach(checkbox => {
      checkbox.checked = false;
    });
    updateBatchPanel();
    };
  }
  
  // Keyboard shortcuts
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    } else if (e.key === 'F1' || (e.key === '?' && e.shiftKey)) {
      // Toggle help panel
      e.preventDefault();
      const helpToggle = document.getElementById('inbox-help-toggle');
      if (helpToggle) helpToggle.click();
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.altKey) {
      // Enter to select/deselect current item
      e.preventDefault();
      const focusedElement = document.activeElement;
      if (focusedElement && focusedElement.classList.contains('inbox-item')) {
        const checkbox = focusedElement.querySelector('.inbox-item-checkbox');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        }
      }
    } else if (e.key >= '1' && e.key <= '4') {
      // 1-4 for priority
      e.preventDefault();
      const selectedIds = Array.from(document.querySelectorAll('.inbox-item-checkbox:checked'))
        .map(cb => cb.dataset.id);
      
      if (selectedIds.length > 0) {
        const priority = `p${e.key}`;
        selectedIds.forEach(itemId => {
          updateInboxItem(itemId, { priority });
        });
        if (window.showToast) {
          window.showToast(`Установлен приоритет ${priority} для ${selectedIds.length} элементов`, 'ok');
        }
        cleanup();
        showInboxListModal(); // Refresh
      }
    } else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.altKey) {
      // A for project assignment
      e.preventDefault();
      const selectedIds = Array.from(document.querySelectorAll('.inbox-item-checkbox:checked'))
        .map(cb => cb.dataset.id);
      
      if (selectedIds.length > 0) {
        // Quick project assignment - use first available project
        const projects = state.projects || [];
        if (projects.length > 0) {
          const projectId = projects[0].id;
          selectedIds.forEach(itemId => {
            updateInboxItem(itemId, { projectId });
          });
          if (window.showToast) {
            window.showToast(`Назначен проект "${projects[0].title}" для ${selectedIds.length} элементов`, 'ok');
          }
          cleanup();
          showInboxListModal(); // Refresh
        } else {
          if (window.showToast) {
            window.showToast('Нет доступных проектов', 'warn');
          }
        }
      }
    } else if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.altKey) {
      // T for tag assignment
      e.preventDefault();
      const selectedIds = Array.from(document.querySelectorAll('.inbox-item-checkbox:checked'))
        .map(cb => cb.dataset.id);
      
      if (selectedIds.length > 0) {
        const tag = prompt('Введите тег для выбранных элементов:');
        if (tag && tag.trim()) {
          selectedIds.forEach(itemId => {
            const item = inboxItems.find(i => i.id === itemId);
            if (item) {
              const tags = [...item.metadata.tags];
              if (!tags.includes(tag.trim())) {
                tags.push(tag.trim());
                updateInboxItem(itemId, { tags });
              }
            }
          });
          if (window.showToast) {
            window.showToast(`Добавлен тег "${tag}" для ${selectedIds.length} элементов`, 'ok');
          }
          cleanup();
          showInboxListModal(); // Refresh
        }
      }
    } else if (e.key.toLowerCase() === 'd' && !e.ctrlKey && !e.altKey) {
      // D for date assignment
      e.preventDefault();
      const selectedIds = Array.from(document.querySelectorAll('.inbox-item-checkbox:checked'))
        .map(cb => cb.dataset.id);
      
      if (selectedIds.length > 0) {
        const date = prompt('Введите дату (YYYY-MM-DD) или "today"/"tomorrow":');
        if (date && date.trim()) {
          let dueDate = date.trim();
          if (dueDate === 'today') {
            dueDate = new Date().toISOString().split('T')[0];
          } else if (dueDate === 'tomorrow') {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            dueDate = tomorrow.toISOString().split('T')[0];
          }
          
          selectedIds.forEach(itemId => {
            updateInboxItem(itemId, { dueDate });
          });
          if (window.showToast) {
            window.showToast(`Установлена дата "${dueDate}" для ${selectedIds.length} элементов`, 'ok');
          }
          cleanup();
          showInboxListModal(); // Refresh
        }
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Navigate between items
      e.preventDefault();
      const items = Array.from(document.querySelectorAll('.inbox-item'));
      const currentIndex = items.findIndex(item => item === document.activeElement);
      
      if (currentIndex !== -1) {
        let nextIndex;
        if (e.key === 'ArrowDown') {
          nextIndex = (currentIndex + 1) % items.length;
        } else {
          nextIndex = currentIndex === 0 ? items.length - 1 : currentIndex - 1;
        }
        
        if (items[nextIndex]) {
          items[nextIndex].focus();
          items[nextIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } else if (items.length > 0) {
        // Focus first item if none focused
        items[0].focus();
      }
    } else if (e.key === 'Home') {
      // Focus first item
      e.preventDefault();
      const firstItem = document.querySelector('.inbox-item');
      if (firstItem) firstItem.focus();
    } else if (e.key === 'End') {
      // Focus last item
      e.preventDefault();
      const items = document.querySelectorAll('.inbox-item');
      if (items.length > 0) {
        items[items.length - 1].focus();
      }
    }
  };
  
  // Make items focusable and add focus styles
  document.querySelectorAll('.inbox-item').forEach((item, index) => {
    item.setAttribute('tabindex', '0');
    item.style.outline = 'none';
    
    // Add focus styles
    item.addEventListener('focus', () => {
      item.style.borderColor = 'var(--accent)';
      item.style.boxShadow = '0 0 0 2px rgba(124, 58, 237, 0.2)';
    });
    
    item.addEventListener('blur', () => {
      item.style.borderColor = 'var(--panel-2)';
      item.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.05)';
    });
  });
  
  // Focus first item on open
  setTimeout(() => {
    const firstItem = document.querySelector('.inbox-item');
    if (firstItem) firstItem.focus();
  }, 100);
}

// Initialize on load
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    initInbox();
  });
}
