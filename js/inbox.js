// js/inbox.js
// Inbox system for quick thought capture and distribution

import { state, generateId, saveState } from './state.js';
import { showToast } from './utils/toast.js';

// Inbox state
let inboxItems = [];
let isInboxInitialized = false;

// Initialize inbox system
export function initInbox() {
  if (isInboxInitialized) return;
  
  // Load inbox items from state
  if (state.inbox) {
    inboxItems = state.inbox;
  } else {
    state.inbox = inboxItems;
  }
  
  isInboxInitialized = true;
  console.log('Inbox system initialized');
}

// Check if inbox is enabled
function isInboxEnabled() {
  return state.settings?.showInbox === true;
}

// Add item to inbox
export function addToInbox(text, metadata = {}) {
  if (!isInboxEnabled()) {
    showToast('Инбокс отключен в настройках', 'warn');
    return false;
  }
  
  if (!text || text.trim().length === 0) {
    showToast('Нельзя добавить пустой элемент в Инбокс', 'warn');
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
  saveState();
  
  showToast(`Добавлено в Инбокс: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`, 'ok');
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
    saveState();
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
    saveState();
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
  
  // Add to appropriate collection
  if (targetType === 'task') {
    if (!state.tasks) state.tasks = [];
    state.tasks.push(newObject);
  } else if (targetType === 'idea') {
    if (!state.ideas) state.ideas = [];
    state.ideas.push(newObject);
  } else if (targetType === 'note') {
    if (!state.notes) state.notes = [];
    state.notes.push(newObject);
  }
  
  // Remove from inbox
  removeFromInbox(itemId);
  
  showToast(`Элемент распределен как ${targetType === 'task' ? 'задача' : targetType === 'idea' ? 'идея' : 'заметка'}`, 'ok');
  return true;
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
    showToast('Инбокс отключен в настройках', 'warn');
    return;
  }
  
  showInboxCaptureOverlay();
};

window.openInboxList = function() {
  if (!isInboxEnabled()) {
    showToast('Инбокс отключен в настройках', 'warn');
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
      const metadata = parseInboxText(text);
      addToInbox(text, metadata);
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
      <div style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0; color: var(--text);">📥 Инбокс (${items.length})</h3>
        <p style="margin: 0; color: var(--text-2); font-size: 14px;">
          Разложите элементы по проектам и доменам
        </p>
      </div>
      <div id="inbox-items-list" style="margin-bottom: 20px;">
        ${items.map(item => `
          <div class="inbox-item" data-id="${item.id}" style="
            padding: 12px;
            border: 1px solid var(--panel-2);
            border-radius: 4px;
            margin-bottom: 8px;
            background: var(--panel);
          ">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${item.text}</div>
                <div style="font-size: 12px; color: var(--text-2);">
                  ${item.metadata.tags.length > 0 ? `Теги: ${item.metadata.tags.join(', ')}` : ''}
                  ${item.metadata.priority ? ` • Приоритет: ${item.metadata.priority}` : ''}
                  ${item.metadata.dueDate ? ` • Срок: ${item.metadata.dueDate}` : ''}
                </div>
              </div>
              <div style="display: flex; gap: 4px; margin-left: 12px;">
                <button class="inbox-item-delete" data-id="${item.id}" style="
                  padding: 4px 8px;
                  border: 1px solid var(--danger);
                  border-radius: 4px;
                  background: transparent;
                  color: var(--danger);
                  cursor: pointer;
                  font-size: 12px;
                ">Удалить</button>
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
  
  // Delete buttons
  document.querySelectorAll('.inbox-item-delete').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.id;
      if (confirm('Удалить элемент из Инбокса?')) {
        removeFromInbox(itemId);
        showToast('Элемент удален из Инбокса', 'ok');
        cleanup();
        showInboxListModal(); // Refresh
      }
    };
  });
  
  // Keyboard shortcuts
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  };
}

// Initialize on load
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    initInbox();
  });
}
