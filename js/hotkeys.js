// Hotkeys management system
// Handles keyboard shortcuts with customizable key bindings

import { state } from './state.js';
import { saveState } from './storage.js';

let hotkeyHandlers = {};
let isHotkeysEnabled = true;

// Parse key combination string (e.g., "ctrl+n", "shift+alt+f1")
function parseKeyCombo(combo) {
  const parts = combo.toLowerCase().split('+');
  const modifiers = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false
  };
  
  let key = parts[parts.length - 1];
  
  for (let i = 0; i < parts.length - 1; i++) {
    const mod = parts[i].trim();
    if (modifiers.hasOwnProperty(mod)) {
      modifiers[mod] = true;
    }
  }
  
  return { key, modifiers };
}

// Check if key combination matches
function matchesKeyCombo(event, combo) {
  const { key, modifiers } = parseKeyCombo(combo);
  
  // Normalize key names
  const eventKey = event.key.toLowerCase();
  const normalizedKey = key === 'escape' ? 'escape' : 
                       key === 'enter' ? 'enter' :
                       key === 'space' ? ' ' : key;
  
  return eventKey === normalizedKey &&
         event.ctrlKey === modifiers.ctrl &&
         event.shiftKey === modifiers.shift &&
         event.altKey === modifiers.alt &&
         event.metaKey === modifiers.meta;
}

// Register a hotkey handler
export function registerHotkey(combo, handler, description = '') {
  hotkeyHandlers[combo] = { handler, description };
}

// Unregister a hotkey
export function unregisterHotkey(combo) {
  delete hotkeyHandlers[combo];
}

// Enable/disable hotkeys
export function setHotkeysEnabled(enabled) {
  isHotkeysEnabled = enabled;
}

// Get current hotkey settings
export function getHotkeySettings() {
  return state.settings.hotkeys;
}

// Update hotkey setting
export function updateHotkey(action, newCombo) {
  if (state.settings.hotkeys.hasOwnProperty(action)) {
    // Unregister old hotkey
    const oldCombo = state.settings.hotkeys[action];
    if (hotkeyHandlers[oldCombo]) {
      unregisterHotkey(oldCombo);
    }
    
    // Update setting
    state.settings.hotkeys[action] = newCombo;
    
    // Register new hotkey
    if (newCombo && newCombo.trim()) {
      registerHotkey(newCombo, hotkeyHandlers[oldCombo]?.handler, hotkeyHandlers[oldCombo]?.description);
    }
    
    saveState();
  }
}

// Initialize hotkeys from settings
export function initializeHotkeys() {
  // Clear existing handlers
  hotkeyHandlers = {};
  
  // Ensure hotkeys settings exist
  if (!state.settings.hotkeys) {
    state.settings.hotkeys = {
      newTask: 'ctrl+n',
      newProject: 'ctrl+shift+n', 
      newDomain: 'ctrl+shift+d',
      newIdea: 'ctrl+i',
      newNote: 'ctrl+shift+i',
      newChecklist: 'ctrl+shift+c',
      search: 'ctrl+f',
      closeInspector: 'escape',
      statusPlan: '1',
      statusToday: '2', 
      statusDoing: '3',
      statusDone: '4',
      fitAll: 'ctrl+0',
      fitDomain: 'ctrl+1',
      fitProject: 'ctrl+2',
      zoomIn: 'ctrl+plus',
      zoomOut: 'ctrl+minus',
      resetZoom: 'ctrl+0',
      panMode: 'space',
      deleteSelected: 'delete',
      duplicateSelected: 'ctrl+d',
      toggleGlow: 'ctrl+g',
      toggleFps: 'ctrl+shift+f',
      nextSearchResult: 'f3',
      previousSearchResult: 'shift+f3'
    };
  }
  
  // Register default hotkeys
  const hotkeys = state.settings.hotkeys;
  
  // New task
  registerHotkey(hotkeys.newTask, () => {
    try {
      const quickAdd = document.getElementById('quickAdd');
      if (quickAdd) {
        quickAdd.focus();
        quickAdd.select();
      }
    } catch (error) {
      console.error('Error in newTask hotkey:', error);
    }
  }, 'Создать новую задачу');
  
  // New project
  registerHotkey(hotkeys.newProject, () => {
    try {
      const quickAdd = document.getElementById('quickAdd');
      if (quickAdd) {
        quickAdd.value = '@';
        quickAdd.focus();
        quickAdd.setSelectionRange(1, 1);
      }
    } catch (error) {
      console.error('Error in newProject hotkey:', error);
    }
  }, 'Создать новый проект');
  
  // New domain
  registerHotkey(hotkeys.newDomain, () => {
    try {
      const quickAdd = document.getElementById('quickAdd');
      if (quickAdd) {
        quickAdd.value = '##';
        quickAdd.focus();
        quickAdd.setSelectionRange(2, 2);
      }
    } catch (error) {
      console.error('Error in newDomain hotkey:', error);
    }
  }, 'Создать новый домен');
  
  // New idea
  registerHotkey(hotkeys.newIdea, () => {
    try {
      const quickAdd = document.getElementById('quickAdd');
      if (quickAdd) {
        quickAdd.value = '!';
        quickAdd.focus();
        quickAdd.setSelectionRange(1, 1);
      }
    } catch (error) {
      console.error('Error in newIdea hotkey:', error);
    }
  }, 'Создать новую идею');
  
  // New note
  registerHotkey(hotkeys.newNote, () => {
    try {
      const quickAdd = document.getElementById('quickAdd');
      if (quickAdd) {
        quickAdd.value = '?';
        quickAdd.focus();
        quickAdd.setSelectionRange(1, 1);
      }
    } catch (error) {
      console.error('Error in newNote hotkey:', error);
    }
  }, 'Создать новую заметку');
  
  // New checklist
  registerHotkey(hotkeys.newChecklist, () => {
    try {
      const quickAdd = document.getElementById('quickAdd');
      if (quickAdd) {
        quickAdd.value = '✓';
        quickAdd.focus();
        quickAdd.setSelectionRange(1, 1);
      }
    } catch (error) {
      console.error('Error in newChecklist hotkey:', error);
    }
  }, 'Создать новый чек-лист');
  
  // Search
  registerHotkey(hotkeys.search, () => {
    try {
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    } catch (error) {
      console.error('Error in search hotkey:', error);
    }
  }, 'Открыть поиск');
  
  // Close inspector
  registerHotkey(hotkeys.closeInspector, () => {
    try {
      const inspector = document.getElementById('inspector');
      if (inspector && inspector.style.display !== 'none') {
        if (typeof openInspectorFor === 'function') {
          openInspectorFor(null);
        }
      }
    } catch (error) {
      console.error('Error in closeInspector hotkey:', error);
    }
  }, 'Закрыть инспектор');
  
  // Status changes (only when inspector is open and task is selected)
  registerHotkey(hotkeys.statusPlan, () => {
    const inspector = document.getElementById('inspector');
    if (inspector && inspector.style.display !== 'none') {
      const statusBtn = document.querySelector('.status-buttons .btn[data-st="backlog"]');
      if (statusBtn) statusBtn.click();
    }
  }, 'Установить статус "План"');
  
  registerHotkey(hotkeys.statusToday, () => {
    const inspector = document.getElementById('inspector');
    if (inspector && inspector.style.display !== 'none') {
      const statusBtn = document.querySelector('.status-buttons .btn[data-st="today"]');
      if (statusBtn) statusBtn.click();
    }
  }, 'Установить статус "Сегодня"');
  
  registerHotkey(hotkeys.statusDoing, () => {
    const inspector = document.getElementById('inspector');
    if (inspector && inspector.style.display !== 'none') {
      const statusBtn = document.querySelector('.status-buttons .btn[data-st="doing"]');
      if (statusBtn) statusBtn.click();
    }
  }, 'Установить статус "В работе"');
  
  registerHotkey(hotkeys.statusDone, () => {
    const inspector = document.getElementById('inspector');
    if (inspector && inspector.style.display !== 'none') {
      const statusBtn = document.querySelector('.status-buttons .btn[data-st="done"]');
      if (statusBtn) statusBtn.click();
    }
  }, 'Установить статус "Готово"');
  
  // Fit functions
  registerHotkey(hotkeys.fitAll, () => {
    if (window.mapApi && window.mapApi.fitAll) {
      window.mapApi.fitAll();
    }
  }, 'Показать все объекты');
  
  registerHotkey(hotkeys.fitDomain, () => {
    if (window.mapApi && window.mapApi.fitActiveDomain) {
      window.mapApi.fitActiveDomain();
    }
  }, 'Подогнать активный домен');
  
  registerHotkey(hotkeys.fitProject, () => {
    if (window.mapApi && window.mapApi.fitActiveProject) {
      window.mapApi.fitActiveProject();
    }
  }, 'Подогнать активный проект');
  
  // Zoom controls
  registerHotkey(hotkeys.zoomIn, () => {
    if (window.mapApi && window.mapApi.setZoom) {
      const currentScale = window.mapApi.getScale();
      window.mapApi.setZoom(Math.min(currentScale + 10, 220));
    }
  }, 'Увеличить масштаб');
  
  registerHotkey(hotkeys.zoomOut, () => {
    if (window.mapApi && window.mapApi.setZoom) {
      const currentScale = window.mapApi.getScale();
      window.mapApi.setZoom(Math.max(currentScale - 10, 50));
    }
  }, 'Уменьшить масштаб');
  
  registerHotkey(hotkeys.resetZoom, () => {
    if (window.mapApi && window.mapApi.setZoom) {
      window.mapApi.setZoom(100);
    }
  }, 'Сбросить масштаб');
  
  // Pan mode (spacebar)
  registerHotkey(hotkeys.panMode, () => {
    if (window.mapApi && window.mapApi.setPanMode) {
      window.mapApi.setPanMode();
    }
  }, 'Режим панорамирования');
  
  // Delete selected object
  registerHotkey(hotkeys.deleteSelected, () => {
    const inspector = document.getElementById('inspector');
    if (inspector && inspector.style.display !== 'none') {
      const deleteBtn = document.querySelector('.btn-danger');
      if (deleteBtn) deleteBtn.click();
    }
  }, 'Удалить выбранный объект');
  
  // Duplicate selected object
  registerHotkey(hotkeys.duplicateSelected, () => {
    const inspector = document.getElementById('inspector');
    if (inspector && inspector.style.display !== 'none') {
      const duplicateBtn = document.querySelector('[data-action="duplicate"]');
      if (duplicateBtn) duplicateBtn.click();
    }
  }, 'Дублировать выбранный объект');
  
  // Toggle glow effects
  registerHotkey(hotkeys.toggleGlow, () => {
    if (window.mapApi && window.mapApi.toggleGlow) {
      window.mapApi.toggleGlow();
    }
  }, 'Переключить эффекты свечения');
  
  // Toggle FPS display
  registerHotkey(hotkeys.toggleFps, () => {
    if (window.mapApi && window.mapApi.toggleFps) {
      window.mapApi.toggleFps();
    }
  }, 'Переключить отображение FPS');
  
  // Search navigation
  registerHotkey(hotkeys.nextSearchResult, () => {
    if (window.mapApi && window.mapApi.nextSearchResult) {
      window.mapApi.nextSearchResult();
    }
  }, 'Следующий результат поиска');
  
  registerHotkey(hotkeys.previousSearchResult, () => {
    if (window.mapApi && window.mapApi.previousSearchResult) {
      window.mapApi.previousSearchResult();
    }
  }, 'Предыдущий результат поиска');
}

// Global keydown handler
document.addEventListener('keydown', (event) => {
  if (!isHotkeysEnabled) return;
  
  // Don't trigger hotkeys when typing in inputs
  if (event.target.tagName === 'INPUT' || 
      event.target.tagName === 'TEXTAREA' || 
      event.target.contentEditable === 'true') {
    return;
  }
  
  // Check all registered hotkeys
  for (const [combo, { handler }] of Object.entries(hotkeyHandlers)) {
    if (matchesKeyCombo(event, combo)) {
      event.preventDefault();
      event.stopPropagation();
      try {
        handler();
      } catch (error) {
        console.error('Hotkey handler error:', error);
      }
      break; // Only trigger one hotkey per event
    }
  }
});

// Export for global access
window.hotkeys = {
  register: registerHotkey,
  unregister: unregisterHotkey,
  setEnabled: setHotkeysEnabled,
  getSettings: getHotkeySettings,
  update: updateHotkey,
  initialize: initializeHotkeys
};

// Functions are already exported individually above
