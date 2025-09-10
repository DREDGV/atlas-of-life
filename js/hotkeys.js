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
      search: 'ctrl+f',
      closeInspector: 'escape',
      statusPlan: '1',
      statusToday: '2', 
      statusDoing: '3',
      statusDone: '4',
      fitAll: 'ctrl+0',
      fitDomain: 'ctrl+1',
      fitProject: 'ctrl+2'
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
