// js/app.js
import { state, $, $$, initDemoData, getRandomProjectColor } from "./state.js";
import { loadState, saveState, exportJson, importJsonV26 as importJson } from "./storage.js";
import {
  initMap,
  layoutMap,
  drawMap,
  centerView,
  fitActiveDomain,
  fitActiveProject,
  resetView,
  setShowFps,
  undoLastMove,
  getMapNodes,
} from "./view_map.js";
import { renderToday } from "./view_today.js";
import { parseQuick } from "./parser.js";
import { openInspectorFor } from "./inspector.js";
import { logEvent } from "./utils/analytics.js";
import { initializeHotkeys } from "./hotkeys.js";
import { initAutocomplete } from "./autocomplete.js";
import { AnalyticsDashboard, analyticsDashboard } from "./analytics.js";
import { CosmicAnimations } from "./cosmic-effects.js";

// I18N
const I18N = {
  views: { map: "Карта", today: "Сегодня" },
  sidebar: { domains: "Домены", filters: "Фильтры" },
  hints: { quick: "Шорткаты: #тег @проект !сегодня 10:00 ~30м" },
  actions: { export: "Экспорт", import: "Импорт" },
  toggles: {
    links: "Связи",
    aging: "Давность",
    glow: "Свечение",
    edges: "Рёбра",
  },
  wip: (cur, lim) => `WIP: ${cur} / ${lim}`,
  errors: { import: "Не удалось импортировать JSON: " },
  defaults: { taskTitle: "Новая задача" },
};
window.I18N = I18N;

// Expose state globally for addons compatibility
try { window.state = state; } catch (_) {}

// App version (SemVer-like label used in UI)
let APP_VERSION = "Atlas_of_life_v0.2.18.5-bug-fix";

// ephemeral UI state
const ui = {
  newDomain: false,
  newDomColor: "#2dd4bf",
  newDomDraft: "",
  newDomError: "",
};
const palette = [
  "#2dd4bf",
  "#f59e0b",
  "#60a5fa",
  "#a78bfa",
  "#ef4444",
  "#10b981",
  "#f472b6",
  "#eab308",
];

// simple modal helpers
function openModal({
  title,
  bodyHTML,
  onConfirm,
  confirmText = "Ок",
  cancelText = "Отмена",
}) {
  const modal = document.getElementById("modal");
  document.getElementById("modalTitle").textContent = title || "Диалог";
  document.getElementById("modalBody").innerHTML = bodyHTML || "";
  const btnOk = document.getElementById("modalOk");
  const btnCancel = document.getElementById("modalCancel");
  btnOk.textContent = confirmText;
  document.getElementById("modalCancel").textContent = cancelText;
  function close() {
    modal.style.display = "none";
    btnOk.onclick = null;
    btnCancel.onclick = null;
  }
  btnCancel.onclick = () => close();
  btnOk.onclick = () => {
    try {
      onConfirm && onConfirm(document.getElementById("modalBody"));
    } finally {
      close();
    }
  };
  // Не показываем модальное окно при инициализации
  if (title && title !== "Диалог") {
    modal.style.display = "flex";
  }
}

// toast helper
function showToast(text, cls = "ok", ms = 2500) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.className = "toast " + (cls || "");
  el.textContent = text;
  el.style.display = "block";
  el.style.opacity = "1";
  setTimeout(() => {
    el.style.transition = "opacity .3s linear";
    el.style.opacity = "0";
    setTimeout(() => {
      el.style.display = "none";
      el.style.transition = "";
    }, 320);
  }, ms);
}

// undo toast helper with action button
function showUndoToast(text, undoAction, ms = 8000) {
  const el = document.getElementById("toast");
  if (!el) return;
  
  // Create undo button
  const undoBtn = document.createElement("button");
  undoBtn.textContent = "Отменить";
  undoBtn.className = "undo-btn";
  undoBtn.style.cssText = `
    margin-left: 12px;
    padding: 4px 8px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  `;
  
  // Set up toast content
  el.className = "toast undo";
  el.innerHTML = text;
  el.appendChild(undoBtn);
  el.style.display = "block";
  el.style.opacity = "1";
  
  // Handle undo button click
  undoBtn.onclick = () => {
    undoAction();
    el.style.display = "none";
  };
  
  // Auto-hide after timeout
  setTimeout(() => {
    if (el.style.display !== "none") {
      el.style.transition = "opacity .3s linear";
      el.style.opacity = "0";
      setTimeout(() => {
        el.style.display = "none";
        el.style.transition = "";
        el.innerHTML = "";
      }, 320);
    }
  }, ms);
}

function openHotkeysModal() {
  const hotkeys = state.settings.hotkeys;
  const hotkeyDescriptions = {
    newTask: 'Создать новую задачу',
    newProject: 'Создать новый проект', 
    newDomain: 'Создать новый домен',
    search: 'Открыть поиск',
    closeInspector: 'Закрыть инспектор',
    statusPlan: 'Установить статус "План"',
    statusToday: 'Установить статус "Сегодня"', 
    statusDoing: 'Установить статус "В работе"',
    statusDone: 'Установить статус "Готово"',
    fitAll: 'Показать все объекты',
    fitDomain: 'Подогнать активный домен',
    fitProject: 'Подогнать активный проект'
  };
  
  let bodyHTML = '<div style="display:flex;flex-direction:column;gap:12px;max-height:400px;overflow-y:auto;">';
  
  // Add help text
  bodyHTML += '<div style="background:var(--panel-2);padding:8px;border-radius:4px;margin-bottom:8px;">';
  bodyHTML += '<strong>💡 Подсказка:</strong> Нажмите на поле ввода и нажмите нужную комбинацию клавиш для изменения горячей клавиши.';
  bodyHTML += '</div>';
  
  // Add current hotkeys reference
  bodyHTML += '<div style="background:var(--panel-2);padding:8px;border-radius:4px;margin-bottom:8px;">';
  bodyHTML += '<strong>⌨️ Текущие горячие клавиши:</strong><br/>';
  bodyHTML += '• <kbd>Ctrl+N</kbd> - новая задача<br/>';
  bodyHTML += '• <kbd>Ctrl+Shift+N</kbd> - новый проект<br/>';
  bodyHTML += '• <kbd>Ctrl+Shift+D</kbd> - новый домен<br/>';
  bodyHTML += '• <kbd>Ctrl+F</kbd> - поиск<br/>';
  bodyHTML += '• <kbd>1,2,3,4</kbd> - смена статуса<br/>';
  bodyHTML += '• <kbd>Escape</kbd> - закрыть инспектор<br/>';
  bodyHTML += '• <kbd>Ctrl+0</kbd> - показать все<br/>';
  bodyHTML += '</div>';
  
  // Add hotkey settings
  for (const [action, combo] of Object.entries(hotkeys)) {
    const description = hotkeyDescriptions[action] || action;
    bodyHTML += `
      <div style="display:flex;align-items:center;gap:8px;padding:4px;">
        <label style="flex:1;font-size:14px;">${description}:</label>
        <input type="text" 
               id="hotkey-${action}" 
               value="${combo}" 
               style="width:120px;padding:4px 8px;border:1px solid var(--panel-2);border-radius:4px;background:var(--panel-1);color:var(--text);"
               readonly />
        <button onclick="clearHotkey('${action}')" 
                style="padding:4px 8px;background:var(--muted);color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
          Очистить
        </button>
      </div>
    `;
  }
  
  bodyHTML += '</div>';
  
  openModal({
    title: "⌨️ Настройки горячих клавиш",
    bodyHTML: bodyHTML,
    onConfirm: () => {
      // Save hotkey changes
      for (const [action] of Object.entries(hotkeys)) {
        const input = document.getElementById(`hotkey-${action}`);
        if (input && input.value !== state.settings.hotkeys[action]) {
          window.hotkeys.update(action, input.value);
        }
      }
      showToast("Горячие клавиши обновлены", "ok");
    },
    confirmText: "Сохранить",
    cancelText: "Отмена"
  });
  
  // Add event listeners for hotkey input
  setTimeout(() => {
    for (const [action] of Object.entries(hotkeys)) {
      const input = document.getElementById(`hotkey-${action}`);
      if (input) {
        input.addEventListener('keydown', (e) => {
          e.preventDefault();
          const combo = getKeyComboString(e);
          if (combo) {
            input.value = combo;
          }
        });
      }
    }
  }, 100);
}

function getKeyComboString(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  if (event.metaKey) parts.push('meta');
  
  let key = event.key.toLowerCase();
  if (key === ' ') key = 'space';
  if (key === 'control' || key === 'shift' || key === 'alt' || key === 'meta') return null;
  
  parts.push(key);
  return parts.join('+');
}

function clearHotkey(action) {
  const input = document.getElementById(`hotkey-${action}`);
  if (input) {
    input.value = '';
  }
}

function openThemeModal() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  
  let bodyHTML = '<div style="display:flex;flex-direction:column;gap:12px;">';
  bodyHTML += '<div style="background:var(--panel-2);padding:8px;border-radius:4px;">';
  bodyHTML += '<strong>🎨 Выберите тему оформления:</strong>';
  bodyHTML += '</div>';
  
  bodyHTML += `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--panel-2);border-radius:4px;cursor:pointer;">
        <input type="radio" name="theme" value="dark" ${currentTheme === 'dark' ? 'checked' : ''} style="margin:0;">
        <span>🌙 Темная тема</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--panel-2);border-radius:4px;cursor:pointer;">
        <input type="radio" name="theme" value="light" ${currentTheme === 'light' ? 'checked' : ''} style="margin:0;">
        <span>☀️ Светлая тема</span>
      </label>
    </div>
  `;
  
  bodyHTML += '</div>';
  
  openModal({
    title: "🎨 Настройки темы",
    bodyHTML: bodyHTML,
    onConfirm: () => {
      const selectedTheme = document.querySelector('input[name="theme"]:checked')?.value;
      if (selectedTheme && selectedTheme !== currentTheme) {
        document.documentElement.setAttribute('data-theme', selectedTheme);
        localStorage.setItem('atlas_theme', selectedTheme);
        showToast(`Тема изменена на ${selectedTheme === 'dark' ? 'темную' : 'светлую'}`, "ok");
      }
    },
    confirmText: "Применить",
    cancelText: "Отмена"
  });
}

function openDisplayModal() {
  let bodyHTML = '<div style="display:flex;flex-direction:column;gap:12px;">';
  bodyHTML += '<div style="background:var(--panel-2);padding:8px;border-radius:4px;">';
  bodyHTML += '<strong>📱 Настройки отображения:</strong>';
  bodyHTML += '</div>';
  
  bodyHTML += `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--panel-2);border-radius:4px;">
        <input type="checkbox" id="displayLinks" ${state.showLinks ? 'checked' : ''} style="margin:0;">
        <span>🔗 Показывать связи между элементами</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--panel-2);border-radius:4px;">
        <input type="checkbox" id="displayAging" ${state.showAging ? 'checked' : ''} style="margin:0;">
        <span>⏰ Показывать давность элементов</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--panel-2);border-radius:4px;">
        <input type="checkbox" id="displayGlow" ${state.showGlow ? 'checked' : ''} style="margin:0;">
        <span>✨ Показывать свечение элементов</span>
      </label>
    </div>
    
    <div style="border-top:1px solid var(--panel-2);padding-top:12px;margin-top:8px;">
      <button onclick="
        console.log('Analytics button clicked');
        console.log('analyticsDashboard available:', !!window.analyticsDashboard);
        if (window.analyticsDashboard) {
          window.analyticsDashboard.openModal();
  } else {
          alert('Аналитика недоступна. Проверьте консоль для ошибок.');
        }
      " style="
        width:100%;padding:12px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;display:flex;align-items:center;justify-content:center;gap:8px;
      ">
        📊 Открыть аналитику
      </button>
    </div>
  `;
  
  bodyHTML += '</div>';
  
  openModal({
    title: "📱 Настройки отображения",
    bodyHTML: bodyHTML,
    onConfirm: () => {
      const links = document.getElementById('displayLinks').checked;
      const aging = document.getElementById('displayAging').checked;
      const glow = document.getElementById('displayGlow').checked;
      
      if (links !== state.showLinks || aging !== state.showAging || glow !== state.showGlow) {
        state.showLinks = links;
        state.showAging = aging;
        state.showGlow = glow;
        saveState();
        drawMap();
        showToast("Настройки отображения обновлены", "ok");
      }
    },
    confirmText: "Применить",
    cancelText: "Отмена"
  });
}

function openExportModal() {
  let bodyHTML = '<div style="display:flex;flex-direction:column;gap:12px;">';
  bodyHTML += '<div style="background:var(--panel-2);padding:8px;border-radius:4px;">';
  bodyHTML += '<strong>💾 Экспорт и импорт данных:</strong>';
  bodyHTML += '</div>';
  
  bodyHTML += `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button id="exportBtn" style="padding:8px 12px;background:var(--accent);color:white;border:none;border-radius:4px;cursor:pointer;">
        📤 Экспортировать все данные
      </button>
      <label for="importData" style="padding:8px 12px;background:var(--ok);color:white;border-radius:4px;cursor:pointer;text-align:center;">
        📥 Импортировать данные
      </label>
      <input type="file" id="importData" accept=".json" style="display:none;">
      <button id="clearBtn" style="padding:8px 12px;background:var(--warn);color:white;border:none;border-radius:4px;cursor:pointer;">
        🗑️ Очистить все данные
      </button>
    </div>
  `;
  
  bodyHTML += '</div>';
  
  openModal({
    title: "💾 Экспорт/Импорт",
    bodyHTML: bodyHTML,
    onConfirm: () => {
      // Setup event handlers after modal is shown
      setTimeout(() => {
        const exportBtn = document.getElementById('exportBtn');
        const importInput = document.getElementById('importData');
        const clearBtn = document.getElementById('clearBtn');
        
        if (exportBtn) {
          exportBtn.onclick = () => {
            try {
              exportJson();
              showToast("Данные экспортированы", "ok");
            } catch (error) {
              showToast("Ошибка экспорта: " + error.message, "error");
            }
          };
        }
        
        if (importInput) {
          importInput.onchange = async (e) => {
            if (!e.target.files || !e.target.files[0]) return;
            try {
              await importJson(e.target.files[0]);
              renderSidebar();
              if (window.layoutMap) window.layoutMap();
              if (window.drawMap) window.drawMap();
              renderToday();
              showToast("Данные импортированы", "ok");
            } catch (err) {
              showToast("Ошибка импорта: " + err.message, "error");
            } finally {
              e.target.value = "";
            }
          };
        }
        
        if (clearBtn) {
          clearBtn.onclick = () => {
            if (confirm("Вы уверены, что хотите очистить все данные? Это действие нельзя отменить.")) {
              try {
                localStorage.clear();
                location.reload();
              } catch (error) {
                showToast("Ошибка очистки: " + error.message, "error");
              }
            }
          };
        }
      }, 100);
    },
    confirmText: "Закрыть",
    cancelText: "Отмена"
  });
}

// expose globally for addons/other modules
try { window.showToast = showToast; } catch (_) {}
try { window.clearHotkey = clearHotkey; } catch (_) {}
try { window.openModal = openModal; } catch (_) {}
try { window.getMapNodes = getMapNodes; } catch (_) {}

// Функции для работы с идеями и заметками
window.saveIdea = function(ideaId) {
  const idea = state.ideas.find(i => i.id === ideaId);
  if (!idea) return;
  
  const title = document.getElementById('ideaTitle').value;
  const content = document.getElementById('ideaContent').value;
  
  idea.title = title;
  idea.content = content;
  idea.updatedAt = Date.now();
  
  closeModal();
  drawMap();
};

window.saveNote = function(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  if (!note) return;
  
  const title = document.getElementById('noteTitle').value;
  const content = document.getElementById('noteContent').value;
  
  note.title = title;
  note.content = content;
  note.updatedAt = Date.now();
  
  closeModal();
  drawMap();
};

window.deleteIdea = function(ideaId) {
  state.ideas = state.ideas.filter(i => i.id !== ideaId);
  closeModal();
  drawMap();
};

window.deleteNote = function(noteId) {
  state.notes = state.notes.filter(n => n.id !== noteId);
  closeModal();
  drawMap();
};

window.closeModal = function() {
  const modal = document.querySelector('.modal');
  if (modal) {
    modal.remove();
  }
};

// Analytics dashboard will be initialized in init() function

// Initialize cosmic animations (with protection against multiple initialization)
let cosmicAnimations;
if (!window.cosmicAnimations) {
  try {
    cosmicAnimations = new CosmicAnimations();
    window.cosmicAnimations = cosmicAnimations;
    console.log('Cosmic animations initialized successfully');
  } catch (e) {
    console.warn('Failed to initialize cosmic animations:', e);
  }
} else {
  console.log('Cosmic animations already initialized, skipping...');
}

// Calculate statistics for sidebar
function calculateStats() {
  const tasks = state.tasks || [];
  
  
  // Start with all tasks
  let filteredTasks = tasks;
  
  // Apply active domain filter if active
  if (state.activeDomain) {
    filteredTasks = filteredTasks.filter(t => {
      // Task belongs to active domain if:
      // 1. Task has domainId matching active domain
      // 2. Task belongs to a project in the active domain
      if (t.domainId === state.activeDomain) return true;
      if (t.projectId) {
        const project = state.projects.find(p => p.id === t.projectId);
        return project && project.domainId === state.activeDomain;
      }
      return false;
    });
  }
  
  // Apply status filter if active
  if (state.filterStatus && state.filterStatus !== 'all') {
    filteredTasks = filteredTasks.filter(t => t.status === state.filterStatus);
  }
  
  // Apply search filter if active
  if (state.searchQuery) {
    filteredTasks = filteredTasks.filter(t => 
      t.title.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
      (t.tags || []).some(tag => tag.toLowerCase().includes(state.searchQuery.toLowerCase()))
    );
  }
  
  return {
    totalTasks: filteredTasks.length,
    backlog: filteredTasks.filter(t => t.status === 'backlog').length,
    today: filteredTasks.filter(t => t.status === 'today').length,
    doing: filteredTasks.filter(t => t.status === 'doing').length,
    done: filteredTasks.filter(t => t.status === 'done').length
  };
}

// Highlight search results on the map
function highlightSearchResults(query, domains, projects, tasks) {
  // This will be used to highlight matching nodes on the map
  // For now, we'll store the search results in state for map rendering
  state.searchResults = {
    domains: domains.map(d => d.id),
    projects: projects.map(p => p.id),
    tasks: tasks.map(t => t.id)
  };
}

// Attach event handlers to domain rows
function attachDomainHandlers() {
  // Handle domain row clicks
  const domainRows = document.querySelectorAll('[data-domain]');
  domainRows.forEach(row => {
    const domainId = row.getAttribute('data-domain');
    
    // Single click
    row.addEventListener('click', (e) => {
      if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        // toggle multiselect list
        let ds = state.activeDomains;
        if (!ds) ds = state.activeDomains = [];
        const arr = Array.isArray(ds) ? ds : Array.from(ds);
        const set = new Set(arr);
        if (set.has(domainId)) set.delete(domainId);
        else set.add(domainId);
        state.activeDomains = Array.from(set);
        state.activeDomain = null;
        updateDomainsList();
        updateStatistics();
        if (window.layoutMap) window.layoutMap();
        if (window.drawMap) window.drawMap();
        try { window.mapApi && window.mapApi.fitAll && window.mapApi.fitAll(); } catch(_){}
        return;
      }
      state.activeDomain = domainId;
      try { state.activeDomains = []; } catch(_){}
      updateDomainsList();
      updateStatistics();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
      if (window.mapApi && window.mapApi.fitActiveDomain) window.mapApi.fitActiveDomain();
      if (window.updateDomainButton) window.updateDomainButton();
    });
    
    // Double click
    row.addEventListener('dblclick', () => {
      state.activeDomain = domainId;
      updateStatistics();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
      if (window.mapApi && window.mapApi.fitActiveDomain) window.mapApi.fitActiveDomain();
      if (window.updateDomainButton) window.updateDomainButton();
    });
    
    // Context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (window.openDomainMenuX) window.openDomainMenuX(domainId, row);
    });
    
    // Prevent text selection and cursor appearance
    row.style.userSelect = 'none';
    row.style.cursor = 'pointer';
  });
  
  // Handle domain actions (⋯ button)
  const actionButtons = document.querySelectorAll('[data-dom]');
  actionButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const domainId = btn.getAttribute('data-dom');
      const row = btn.closest('[data-domain]');
      if (domainId && window.openDomainMenuX) {
        window.openDomainMenuX(domainId, row);
      }
    });
  });
}

// Update only statistics section without re-rendering entire sidebar
function updateStatistics() {
  const stats = calculateStats();
  const statsSection = document.querySelector('.stats-section');
  if (statsSection) {
    // Update total tasks count and clear domain filter button
    const totalSpan = statsSection.querySelector('span[style*="font-size:10px"]');
    if (totalSpan) {
      totalSpan.textContent = `${stats.totalTasks} задач`;
    }
    
    // Update clear domain filter button
    const clearBtn = statsSection.querySelector('#clearDomainFilter');
    if (state.activeDomain && !clearBtn) {
      // Add button if domain is active but button doesn't exist
      const container = statsSection.querySelector('div[style*="display:flex;align-items:center"]');
      if (container) {
        const button = document.createElement('button');
        button.id = 'clearDomainFilter';
        button.style.cssText = 'background:none;border:1px solid var(--muted);color:var(--muted);padding:2px 6px;border-radius:4px;font-size:9px;cursor:pointer';
        button.textContent = 'Все домены';
                      button.addEventListener('click', () => {
                        state.activeDomain = null;
                        updateDomainsList();
                        updateStatistics();
                        if (window.layoutMap) window.layoutMap();
                        if (window.drawMap) window.drawMap();
                        if (window.updateDomainButton) window.updateDomainButton();
                      });
        container.insertBefore(button, totalSpan);
      }
    } else if (!state.activeDomain && clearBtn) {
      // Remove button if no domain is active
      clearBtn.remove();
    }
    
    // Update stat pills
    const pills = statsSection.querySelectorAll('.stat-pill');
    if (pills.length >= 4) {
      pills[0].textContent = `план: ${stats.backlog}`;
      pills[1].textContent = `сегодня: ${stats.today}`;
      pills[2].textContent = `в работе: ${stats.doing}`;
      pills[3].textContent = `готово: ${stats.done}`;
    }
  }
  
  // Update status filters - СКРЫТЫ (не используются)
  const statusWrap = document.getElementById("tagsList");
  if (statusWrap) {
    // Фильтры статусов временно скрыты
    statusWrap.innerHTML = '';
  }
}

// Update only domains list without re-rendering entire sidebar
function updateDomainsList() {
  const dWrap = document.getElementById("domainsList");
  if (!dWrap) return;
  
  // Filter domains based on search query
  const domainsToShow = state.searchQuery 
    ? state.domains.filter(d => d.title.toLowerCase().includes(state.searchQuery.toLowerCase()))
    : state.domains;
    
  let html = domainsToShow
    .map((d) => {
      const projects = state.projects.filter((p) => p.domainId === d.id);
      const projectCount = projects.length;
      const taskCount = state.tasks.filter(t => {
        if (t.projectId) {
          return projects.some(p => p.id === t.projectId);
        }
        return t.domainId === d.id;
      }).length;
      
      let __active = false;
      try {
        const ds = state.activeDomains;
        if (ds && (Array.isArray(ds) ? ds.length : ds.size)) {
          const ids = new Set(Array.isArray(ds) ? ds : Array.from(ds));
          __active = ids.has(d.id);
        } else {
          __active = state.activeDomain === d.id;
        }
      } catch (_) {}
      const act = __active
        ? 'style="background:#111a23;border:1px solid #1e2a44"'
        : "";
      const color = d.color || "#2dd4bf";
      return `<div class="row" data-domain="${d.id}" ${act}>
      <div class="dot" style="background:${color}"></div>
      <div style="flex:1;min-width:0">
        <div class="title" style="font-weight:500;margin-bottom:2px">${d.title}</div>
        <div style="display:flex;gap:8px;font-size:10px;color:var(--muted)">
          <span>${projectCount} проектов</span>
          <span>${taskCount} задач</span>
        </div>
      </div>
      <div class="hint actions" data-dom="${d.id}" style="cursor:pointer;padding:4px">⋯</div>
    </div>`;
    })
    .join("");
    
  // Find the domains container
  const domainsContainer = dWrap.querySelector('.domains-container');
  if (domainsContainer) {
    domainsContainer.innerHTML = html;
    
    // Add click handler to container for clearing domain selection
    domainsContainer.addEventListener('click', (e) => {
      // Only clear if clicking on empty space (not on domain rows)
      if (e.target === domainsContainer) {
        state.activeDomain = null;
        updateDomainsList();
        updateStatistics();
        if (window.layoutMap) window.layoutMap();
        if (window.drawMap) window.drawMap();
        if (window.updateDomainButton) window.updateDomainButton();
      }
    });
    
    // Re-attach event handlers for domain rows
    attachDomainHandlers();
  }
}

function renderSidebar() {
  const dWrap = document.getElementById("domainsList");
  let html = "";
  
  // Search bar
  html += `<div class="search-section" style="padding:8px 12px;border-bottom:1px solid var(--panel-2)">
    <input id="sidebarSearch" placeholder="🔍 Поиск доменов, проектов, задач..." 
           value="${state.searchQuery || ''}"
           style="width:100%;padding:6px 8px;background:var(--panel-2);border:1px solid var(--panel-2);border-radius:6px;color:var(--text);font-size:12px;outline:none"/>
  </div>`;
  
  // Statistics section - calculate filtered stats
  const stats = calculateStats();
  
  html += `<div class="stats-section" style="padding:8px 12px;border-bottom:1px solid var(--panel-2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <span style="font-size:11px;color:var(--muted);font-weight:600">СТАТИСТИКА</span>
      <div style="display:flex;align-items:center;gap:8px">
        ${state.activeDomain ? `<button id="clearDomainFilter" style="background:none;border:1px solid var(--muted);color:var(--muted);padding:2px 6px;border-radius:4px;font-size:9px;cursor:pointer">Все домены</button>` : ''}
        <span style="font-size:10px;color:var(--muted)">${stats.totalTasks} задач</span>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="stat-pill" style="background:rgba(157,177,201,0.1);color:var(--muted);padding:2px 6px;border-radius:4px;font-size:10px">план: ${stats.backlog}</div>
      <div class="stat-pill" style="background:rgba(242,201,76,0.15);color:var(--warn);padding:2px 6px;border-radius:4px;font-size:10px">сегодня: ${stats.today}</div>
      <div class="stat-pill" style="background:rgba(86,204,242,0.15);color:var(--accent);padding:2px 6px;border-radius:4px;font-size:10px">в работе: ${stats.doing}</div>
      <div class="stat-pill" style="background:rgba(25,195,125,0.15);color:var(--ok);padding:2px 6px;border-radius:4px;font-size:10px">готово: ${stats.done}</div>
    </div>
  </div>`;
  
  if (ui.newDomain) {
    html += `<div class="row" id="newDomRow" style="gap:6px;flex-wrap:wrap">
      <input id="newDomName" placeholder="Название домена" style="flex:1;min-width:140px;background:#0e172a;border:1px solid #1a2947;border-radius:8px;color:#e8f0fb;padding:6px 8px"/>
      <div id="newDomColors" style="display:flex;gap:6px;align-items:center">${palette
        .map(
          (c) =>
            `<div class="dot" data-col="${c}" style="width:14px;height:14px;border:1px solid #1e2a44;background:${c};border-radius:999px;cursor:pointer${
              c === ui.newDomColor ? ";outline:2px solid #fff5" : ""
            }"></div>`
        )
        .join("")}</div>
      <button class="btn" id="newDomSave">Создать</button>
      <button class="btn" id="newDomCancel">Отмена</button>
    </div>`;
  } else {
    html += `<div class="row"><button class="btn" id="btnAddDomain">+ Домен</button></div>`;
  }
  // Add domains container
  html += `<div class="domains-container"></div>`;
  
  dWrap.innerHTML = html;

  // Ensure domain controls (Show all / Fit all)
  try {
    if (!document.getElementById('domControls')) {
      const row = document.createElement('div');
      row.className = 'row';
      row.id = 'domControls';
      row.style.gap = '6px';
      row.style.flexWrap = 'wrap';
      const btnAll = document.createElement('button');
      btnAll.className = 'btn';
      btnAll.id = 'btnShowAll';
      btnAll.textContent = 'Все домены';
      const btnFit = document.createElement('button');
      btnFit.className = 'btn';
      btnFit.id = 'btnFitAll';
      btnFit.textContent = 'Вписать';
      row.appendChild(btnAll);
      row.appendChild(btnFit);
      dWrap.insertBefore(row, dWrap.firstChild);
    }
  } catch(_) {}
  
  // Populate domains container
  updateDomainsList();
  
  // Attach event handlers
  attachDomainHandlers();

  // handlers
  const addBtn = document.getElementById("btnAddDomain");
  if (addBtn) {
    addBtn.onclick = () => {
      ui.newDomain = true;
      renderSidebar();
      const inp = $("#newDomName");
      inp && inp.focus();
    };
  }
  const showAllBtn = document.getElementById('btnShowAll');
  if (showAllBtn) {
    showAllBtn.onclick = () => {
      try { state.activeDomains = []; } catch(_) {}
      state.activeDomain = null;
      renderSidebar();
      layoutMap();
      drawMap();
      try { window.mapApi && window.mapApi.fitAll && window.mapApi.fitAll(); } catch(_) {}
    };
  }
  const fitAllBtn = document.getElementById('btnFitAll');
  if (fitAllBtn) {
    fitAllBtn.onclick = () => {
      try { window.mapApi && window.mapApi.fitAll && window.mapApi.fitAll(); } catch(_) {}
    };
  }
  const row = document.getElementById("newDomRow");
  if (row) {
    const nameInput = $("#newDomName");
    if (nameInput) {
      nameInput.value = ui.newDomDraft || "";
      nameInput.placeholder = "Введите название домена";
      nameInput.focus();
    }
    // localize and add hint
    const btnSave = document.getElementById("newDomSave");
    if (btnSave) btnSave.textContent = "Сохранить";
    const btnCancel = document.getElementById("newDomCancel");
    if (btnCancel) btnCancel.textContent = "Отмена";
    let hint = document.getElementById("newDomHint");
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "newDomHint";
      hint.className = "hint";
      hint.style.width = "100%";
      row.appendChild(hint);
    }
    hint.textContent = ui.newDomError || "";
    $("#newDomColors")
      .querySelectorAll(".dot")
      .forEach((el) => {
        el.onclick = () => {
          ui.newDomColor = el.dataset.col;
          renderSidebar();
        };
      });
    function createDomain() {
      const name = (nameInput.value || "").trim();
      if (!name) {
        alert("Введите название домена");
        return;
      }
      if (
        state.domains.some((d) => d.title.toLowerCase() === name.toLowerCase())
      ) {
        alert("Такой домен уже есть");
        return;
      }
      const id = "d" + Math.random().toString(36).slice(2, 8);
      state.domains.push({
        id,
        title: name,
        color: ui.newDomColor,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      state.activeDomain = id;
      ui.newDomain = false;
      ui.newDomDraft = "";
      saveState();
      renderSidebar();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
      fitActiveDomain();
    }
    $("#newDomSave").onclick = () => createDomain();
    $("#newDomCancel").onclick = () => {
      ui.newDomain = false;
      ui.newDomDraft = "";
      renderSidebar();
    };
    nameInput.addEventListener("input", () => {
      ui.newDomDraft = nameInput.value;
      let err = "";
      const n = (nameInput.value || "").trim();
      if (!n) err = "Введите название домена";
      else if (
        state.domains.some((d) => d.title.toLowerCase() === n.toLowerCase())
      )
        err = "Такой домен уже существует";
      ui.newDomError = err;
      if (hint) hint.textContent = err;
    });
    // override save with soft validation + toast
    if (btnSave) {
      btnSave.onclick = () => {
        const n = (nameInput.value || "").trim();
        let err = "";
        if (!n) err = "Введите название домена";
        else if (
          state.domains.some((d) => d.title.toLowerCase() === n.toLowerCase())
        )
          err = "Такой домен уже существует";
        ui.newDomError = err;
        if (hint) hint.textContent = err;
        if (err) return;
        const id = "d" + Math.random().toString(36).slice(2, 8);
        state.domains.push({
          id,
          title: n,
          color: ui.newDomColor,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        state.activeDomain = id;
        ui.newDomain = false;
        ui.newDomDraft = "";
        saveState();
        renderSidebar();
        layoutMap();
        drawMap();
        fitActiveDomain();
        showToast(`Создан домен: ${n}`, "ok");
      };
    }
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createDomain();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        ui.newDomain = false;
        ui.newDomDraft = "";
        renderSidebar();
      }
    });
  }
  // Event handlers are now attached by attachDomainHandlers()

  // Status filters - use current stats
  const statusFilters = [
    { key: 'all', label: 'Все', count: stats.totalTasks, color: 'var(--muted)' },
    { key: 'backlog', label: 'План', count: stats.backlog, color: 'var(--muted)' },
    { key: 'today', label: 'Сегодня', count: stats.today, color: 'var(--warn)' },
    { key: 'doing', label: 'В работе', count: stats.doing, color: 'var(--accent)' },
    { key: 'done', label: 'Готово', count: stats.done, color: 'var(--ok)' }
  ];
  
  const statusWrap = document.getElementById("tagsList");
  statusWrap.innerHTML = statusFilters.map(status => 
    `<div class="tag ${state.filterStatus === status.key ? "active" : ""}" 
          data-status="${status.key}" 
          style="border-color:${status.color};color:${status.color}">
      ${status.label} (${status.count})
    </div>`
  ).join("");
  
  // Status filter handlers
  statusWrap.querySelectorAll(".tag[data-status]").forEach((el) => {
    el.onclick = () => {
      const val = el.dataset.status === 'all' ? null : el.dataset.status;
      state.filterStatus = val;
        renderSidebar();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
    };
  });

  // Tags section
  // Tags section - СКРЫТЫ (не используются)
  // Теги временно скрыты, так как не используются
  
  // Tag handlers - СКРЫТЫ (не используются)
  
  // Search functionality
  const searchInput = document.getElementById("sidebarSearch");
  if (searchInput) {
    // Store current value to prevent it from being cleared
    const currentValue = searchInput.value;
    
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase().trim();
      
      if (query.length === 0) {
        // Clear search - show all
        state.searchQuery = null;
        state.searchResults = null;
        // Don't re-render sidebar to preserve input value
        if (window.layoutMap) window.layoutMap();
        if (window.drawMap) window.drawMap();
        return;
      }
      
      // Filter domains, projects, and tasks
      const filteredDomains = state.domains.filter(d => 
        d.title.toLowerCase().includes(query)
      );
      const filteredProjects = state.projects.filter(p => 
        p.title.toLowerCase().includes(query)
      );
      const filteredTasks = state.tasks.filter(t => 
        t.title.toLowerCase().includes(query) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(query))
      );
      
      // Highlight search results
      highlightSearchResults(query, filteredDomains, filteredProjects, filteredTasks);
      
      // Update filter to show only matching items
      state.searchQuery = query;
      // Update only domains list and statistics, not entire sidebar
      updateDomainsList();
      updateStatistics();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
    });
    
    // Clear search on Escape
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.target.value = "";
        state.searchQuery = null;
        state.searchResults = null;
        updateDomainsList();
        updateStatistics();
        if (window.layoutMap) window.layoutMap();
        if (window.drawMap) window.drawMap();
      }
    });
  }
  
  // Clear domain filter button
  const clearDomainFilterBtn = document.getElementById("clearDomainFilter");
  if (clearDomainFilterBtn) {
    clearDomainFilterBtn.addEventListener("click", () => {
      state.activeDomain = null;
      updateDomainsList();
      updateStatistics();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
    });
  }
}

let currentMenu = null;
function closeDomainMenu() {
  if (currentMenu && currentMenu.remove) {
    currentMenu.remove();
    currentMenu = null;
    document.removeEventListener("click", onDocClick, true);
  }
}
function onDocClick(e) {
  if (currentMenu && !currentMenu.contains(e.target)) closeDomainMenu();
}
// REMOVED: legacy function openDomainMenu_old (150+ lines of unused code)

// Enhanced menu with friendly flows + toasts
function openDomainMenuX(id, rowEl) {
  closeDomainMenu();
  const d = state.domains.find((x) => x.id === id);
  const menu = document.createElement("div");
  menu.className = "domenu";
  menu.innerHTML = `
    <div class="item" data-act="focus">Фокус</div>
    <div class="item" data-act="rename">Переименовать</div>
    <div class="item" data-act="color">Цвет</div>
    <div class="palette" style="display:none">${palette
      .map(
        (c) => `<div class="dot" data-col="${c}" style="background:${c}"></div>`
      )
      .join("")}</div>
    <div class="item" data-act="merge">Слить с…</div>
    <div class="sep"></div>
    <div class="item" data-act="delete" style="color:#ffd1d1">Удалить</div>
  `;
  rowEl.insertAdjacentElement("afterend", menu);
  currentMenu = menu;
  document.addEventListener("click", onDocClick, true);

  menu.querySelector('[data-act="focus"]').onclick = () => {
    state.activeDomain = id;
    layoutMap();
    drawMap();
    fitActiveDomain();
    closeDomainMenu();
  };

  menu.querySelector('[data-act="rename"]').onclick = () => {
    const body = `<div style="display:flex;flex-direction:column;gap:8px">
      <input id=\"domName\" value=\"${d.title}\" placeholder=\"Введите название домена\"/>
      <div id=\"domHint\" class=\"hint\"></div>
    </div>`;
    openModal({
      title: "Переименование домена",
      bodyHTML: body,
      confirmText: "Сохранить",
      onConfirm: (bodyEl) => {
        const inp = bodyEl.querySelector("#domName");
        const name = (inp.value || "").trim();
        if (!name) {
          bodyEl.querySelector("#domHint").textContent =
            "Введите название домена";
          return;
        }
        if (
          state.domains.some(
            (x) => x.id !== id && x.title.toLowerCase() === name.toLowerCase()
          )
        ) {
          bodyEl.querySelector("#domHint").textContent =
            "Такой домен уже существует";
          return;
        }
        d.title = name;
        d.updatedAt = Date.now();
        saveState();
        renderSidebar();
        layoutMap();
        drawMap();
        closeDomainMenu();
      },
    });
  };

  menu.querySelector('[data-act="color"]').onclick = () => {
    const pal = menu.querySelector(".palette");
    pal.style.display = pal.style.display === "none" ? "flex" : "none";
    pal.querySelectorAll(".dot").forEach((dot) => {
      dot.onclick = () => {
        d.color = dot.dataset.col;
        d.updatedAt = Date.now();
        saveState();
        renderSidebar();
        layoutMap();
        drawMap();
        closeDomainMenu();
      };
    });
  };

  menu.querySelector('[data-act="merge"]').onclick = () => {
    const others = state.domains.filter((x) => x.id !== id);
    if (others.length === 0) {
      alert("Некуда сливать: доступен только один домен");
      return;
    }
    const body = `<label>Слить в:</label> <select id=\"selDom\">${others
      .map((o) => `<option value=\"${o.id}\">${o.title}</option>`)
      .join("")}</select>`;
    openModal({
      title: `Слить домен "${d.title}"`,
      bodyHTML: body,
      confirmText: "Слить",
      onConfirm: (bodyEl) => {
        const targetId = bodyEl.querySelector("#selDom").value;
        const target = state.domains.find((x) => x.id === targetId);
        if (!target || target.id === id) return;
        const movedPrjIds = state.projects
          .filter((p) => p.domainId === id)
          .map((p) => p.id);
        const prCount = movedPrjIds.length;
        const taskCount = state.tasks.filter((t) =>
          movedPrjIds.includes(t.projectId)
        ).length;
        state.projects.forEach((p) => {
          if (p.domainId === id) p.domainId = target.id;
        });
        state.domains = state.domains.filter((x) => x.id !== id);
        state.activeDomain = target.id;
        saveState();
        renderSidebar();
        layoutMap();
        drawMap();
        fitActiveDomain();
        closeDomainMenu();
        showToast(`Перенесено: ${prCount} проектов, ${taskCount} задач`, "ok");
      },
    });
  };

  menu.querySelector('[data-act="delete"]').onclick = () => {
    if (state.domains.length <= 1) {
      alert("Нельзя удалять последний домен");
      return;
    }
    const others = state.domains.filter((x) => x.id !== id);
    const body = `
      <div style=\"display:flex;flex-direction:column;gap:8px\">
        <label><input type=\"radio\" name=\"mode\" value=\"move\" checked/> Перенести проекты в:</label>
        <select id=\"selDom\">${others
          .map((o) => `<option value=\"${o.id}\">${o.title}</option>`)
          .join("")}</select>
        <label><input type=\"radio\" name=\"mode\" value=\"delete\"/> Удалить вместе с проектами и задачами</label>
      </div>`;
    openModal({
      title: `Удалить домен "${d.title}"?`,
      bodyHTML: body,
      confirmText: "Удалить",
      onConfirm: (bodyEl) => {
        const mode = bodyEl.querySelector('input[name="mode"]:checked').value;
        if (mode === "move") {
          const targetId = bodyEl.querySelector("#selDom").value;
          const projIds = state.projects
            .filter((p) => p.domainId === id)
            .map((p) => p.id);
          const taskCount = state.tasks.filter((t) =>
            projIds.includes(t.projectId)
          ).length;
          state.projects.forEach((p) => {
            if (p.domainId === id) p.domainId = targetId;
          });
          showToast(
            `Перенесено: ${projIds.length} проектов, ${taskCount} задач`,
            "ok"
          );
        } else {
          const projIds = state.projects
            .filter((p) => p.domainId === id)
            .map((p) => p.id);
          const removedTasks = state.tasks.filter((t) =>
            projIds.includes(t.projectId)
          ).length;
          state.tasks = state.tasks.filter(
            (t) => !projIds.includes(t.projectId)
          );
          state.projects = state.projects.filter((p) => p.domainId !== id);
          showToast(
            `Удалено: ${projIds.length} проектов, ${removedTasks} задач`,
            "warn"
          );
        }
        state.domains = state.domains.filter((x) => x.id !== id);
        // Clear active domain to show entire project instead of focusing on remaining domain
        state.activeDomain = null;
        saveState();
        
        // Update UI after domain deletion
        updateDomainsList();
        updateStatistics();
        if (window.layoutMap) window.layoutMap();
        if (window.drawMap) window.drawMap();
        if (window.renderToday) window.renderToday();
        if (window.renderSidebar) window.renderSidebar();
        renderSidebar();
        layoutMap();
        drawMap();
        closeDomainMenu();
      },
    });
  };
}

// Export to window for external access
window.openDomainMenuX = openDomainMenuX;

// REMOVED: legacy function domainActions_old (110+ lines of unused code)

function updateWip() {
  // New WIP logic: count tasks with status=today OR due=today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();
  
  const wip = state.tasks.filter((t) => {
    // Status is today
    if (t.status === "today") return true;
    
    // Has deadline today
    if (t.scheduledFor) {
      const taskDate = new Date(t.scheduledFor);
      taskDate.setHours(0, 0, 0, 0);
      return taskDate.getTime() === todayTimestamp;
    }
    
    return false;
  }).length;
  
  // Get WIP limit from settings, default to 5
  const wipLimit = state.settings?.wipTodayLimit || 5;
  
  const el = document.getElementById("wipInfo");
  el.textContent = I18N.wip(wip, wipLimit);
  el.className = "wip" + (wip > wipLimit ? " over" : "");
  
  // Show warning if over limit
  if (wip > wipLimit) {
    showToast(`Превышен лимит WIP: ${wip}/${wipLimit}`, "warn");
  }
}

function setupHeader() {
  $$(".chip").forEach((ch) => {
    ch.onclick = () => {
      $$(".chip").forEach((c) => c.classList.remove("active"));
      ch.classList.add("active");
      state.view = ch.dataset.view;
      $("#canvas").style.display = state.view === "map" ? "block" : "none";
      $("#viewToday").style.display = state.view === "today" ? "flex" : "none";
      if (state.view === "map") {
        drawMap();
      } else if (state.view === "today") {
        // Принудительно вызываем renderToday при переключении на today
        setTimeout(() => {
        renderToday();
        }, 10);
      }
    };
  });
  // Display settings moved to settings menu

  // fit/center buttons
  const btnCenter = $("#btnCenter");
  const btnFitDomain = $("#btnFitDomain");
  const btnFitProject = $("#btnFitProject");
  const btnReset = $("#btnReset");
  const btnFullscreen = $("#btnFullscreen");
  if (btnCenter) btnCenter.onclick = () => centerView();
  if (btnFitDomain) btnFitDomain.onclick = () => fitActiveDomain();
  if (btnFitProject) btnFitProject.onclick = () => fitActiveProject();
  if (btnReset) btnReset.onclick = () => resetView();
  if (btnFullscreen) btnFullscreen.onclick = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (_) {}
  };

  // Handle fullscreen change events to fix display glitches
  document.addEventListener('fullscreenchange', () => {
    setTimeout(() => {
      try {
        if (typeof window.onResize === 'function') window.onResize();
        if (typeof layoutMap === 'function') layoutMap();
        if (typeof drawMap === 'function') drawMap();
      } catch (_) {}
    }, 100);
  });
  
  // Debounced resize handler to prevent infinite loops
  let resizeToken = 0;
  window.onResize = () => {
    const token = ++resizeToken;
    setTimeout(() => {
      if (token !== resizeToken) return;   // только последний вызов
      const canvas = document.getElementById('canvas');
      if (!canvas) return;
      
      const w = canvas.clientWidth|0, h = canvas.clientHeight|0, dpr = Math.max(1, window.devicePixelRatio||1);
      // обновлять размер ТОЛЬКО если реально изменился на целый пиксель
      if (canvas.width !== (w*dpr)|0 || canvas.height !== (h*dpr)|0) {
        canvas.width  = (w*dpr)|0;
        canvas.height = (h*dpr)|0;
      }
      if (typeof requestDraw === 'function') requestDraw(); // один кадр
    }, 120);
  };

  // Export/import moved to settings menu
  // edge cap slider
  // zoom slider (top control)
  const zoomSlider = $("#zoomSlider");
  if (zoomSlider) {
    // try to initialize from map if available
    try {
      const current =
        (window.mapApi && window.mapApi.getScale && window.mapApi.getScale()) ||
        100;
      zoomSlider.value = String(Math.round(current));
    } catch (_) {}
    zoomSlider.oninput = (e) => {
      const v = parseInt(e.target.value, 10) || 100;
      // mapApi expects percent-like value 100 -> scale 1
      if (window.mapApi && window.mapApi.setZoom) window.mapApi.setZoom(v);
    };
  }
  // about/version modal
  const btnAbout = document.getElementById("btnAbout");
  if (btnAbout) {
    btnAbout.onclick = () => {
      openModal({
        title: "О версии",
        bodyHTML:
          '<div style="display:flex;flex-direction:column;gap:8px">' +
          `<div><strong>Версия:</strong> ${APP_VERSION}</div>` +
          `<div><a href="CHANGELOG.md" target="_blank" rel="noopener">📝 Открыть CHANGELOG</a></div>` +
          `<div><a href="IDEAS.md" target="_blank" rel="noopener">🚀 Открыть IDEAS</a></div>` +
          `<div><a href="REQUESTS.md" target="_blank" rel="noopener">📋 Открыть REQUESTS</a></div>` +
          '<div style="margin-top:12px;padding:8px;background:var(--panel-2);border-radius:4px;">' +
          '<strong>⚙️ Настройки:</strong><br/>' +
          'Все настройки приложения доступны через кнопку ⚙️ в верхней панели' +
          '</div>' +
          "</div>",
        confirmText: "Ок",
      });
    };
  }
  
  // hotkeys settings modal
  const btnHotkeys = document.getElementById("btnHotkeys");
  if (btnHotkeys) {
    btnHotkeys.onclick = () => {
      openHotkeysModal();
    };
  }
  // theme toggle using data-theme attribute (persist in localStorage)
  try{
    const THEME_KEY = 'atlas_theme';
    const cur = localStorage.getItem(THEME_KEY) || 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    const lab = document.createElement('label');
    lab.style.marginLeft = '8px';
    lab.innerHTML = `<input type="checkbox" id="tgTheme" ${cur==='light'?'checked':''}/> Тема`;
    document.querySelector('header .toggle')?.appendChild(lab);
    const tgl = document.getElementById('tgTheme');
    if(tgl){
      tgl.onchange = (e)=>{
        const next = e.target.checked ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(THEME_KEY, next);
      };
    }
  }catch(_){}
  
  // Setup settings dropdown
  const btnSettings = document.getElementById("btnSettings");
  const settingsMenu = document.getElementById("settingsMenu");
  
  console.log('Settings button:', btnSettings);
  console.log('Settings menu:', settingsMenu);
  
  if (btnSettings && settingsMenu) {
    console.log('Setting up settings dropdown...');
    
    // Toggle settings menu
    btnSettings.onclick = (e) => {
      console.log('Settings button clicked');
      e.stopPropagation();
      settingsMenu.classList.toggle('show');
      console.log('Menu classes:', settingsMenu.className);
    };
    
    // Handle settings menu items
    const settingsItems = document.querySelectorAll('.settings-item');
    console.log('Settings items found:', settingsItems.length);
    
    settingsItems.forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        console.log('Settings item clicked:', action);
        settingsMenu.classList.remove('show');
        
        switch (action) {
          case 'hotkeys':
            openHotkeysModal();
            break;
          case 'theme':
            openThemeModal();
            break;
          case 'display':
            openDisplayModal();
            break;
          case 'export':
            openExportModal();
            break;
        }
      };
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!btnSettings.contains(e.target) && !settingsMenu.contains(e.target)) {
        settingsMenu.classList.remove('show');
      }
    });
  } else {
    console.error('Settings elements not found!');
  }
}

function setupQuickAdd() {
  const qa = document.getElementById("quickAdd");
  const chips = document.getElementById("qaChips");
  
  if (!qa || !chips) {
    console.log("QuickAdd elements not found");
    return;
  }
  
  // Autocomplete suggestions
  let autocompleteVisible = false;
  let currentSuggestions = [];
  
  function showAutocomplete(suggestions) {
    if (suggestions.length === 0) {
      hideAutocomplete();
      return;
    }
    
    const autocompleteHTML = suggestions.map(s => 
      `<div class="autocomplete-item" data-value="${s.value}">
        <span class="autocomplete-icon">${s.icon}</span>
        <span class="autocomplete-text">${s.text}</span>
        <span class="autocomplete-hint">${s.hint}</span>
      </div>`
    ).join('');
    
    chips.innerHTML = `<div class="autocomplete-dropdown">${autocompleteHTML}</div>`;
    autocompleteVisible = true;
    currentSuggestions = suggestions;
    
    // Add click handlers
    chips.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const value = item.dataset.value;
        insertAutocomplete(value);
      });
    });
  }
  
  function hideAutocomplete() {
    autocompleteVisible = false;
    currentSuggestions = [];
    // Show parsed chips instead
    const parsed = parseQuick(qa.value);
    chips.innerHTML = "";
    if (parsed.tag)
      chips.innerHTML += `<div class="chip-mini">#${parsed.tag}</div>`;
    if (parsed.project)
      chips.innerHTML += `<div class="chip-mini">@${parsed.project}</div>`;
    if (parsed.when)
      chips.innerHTML += `<div class="chip-mini">!${parsed.when.label}</div>`;
    if (parsed.estimate)
      chips.innerHTML += `<div class="chip-mini">~${parsed.estimate}м</div>`;
    if (parsed.priority)
      chips.innerHTML += `<div class="chip-mini">p${parsed.priority}</div>`;
  }
  
  function insertAutocomplete(value) {
    const cursorPos = qa.selectionStart;
    const text = qa.value;
    const beforeCursor = text.substring(0, cursorPos);
    const afterCursor = text.substring(cursorPos);
    
    // Find the last incomplete token
    const lastSpace = beforeCursor.lastIndexOf(' ');
    const currentToken = beforeCursor.substring(lastSpace + 1);
    
    // Replace the current token with the selected value
    const newText = beforeCursor.substring(0, lastSpace + 1) + value + ' ' + afterCursor;
    qa.value = newText;
    
    // Set cursor position after the inserted value
    const newCursorPos = lastSpace + 1 + value.length + 1;
    qa.setSelectionRange(newCursorPos, newCursorPos);
    
    hideAutocomplete();
    qa.focus();
  }
  
  function getAutocompleteSuggestions(text, cursorPos) {
    const beforeCursor = text.substring(0, cursorPos);
    const lastSpace = beforeCursor.lastIndexOf(' ');
    const currentToken = beforeCursor.substring(lastSpace + 1).toLowerCase();
    
    if (currentToken.startsWith('#')) {
      // Tag suggestions
      const allTags = [...new Set(state.tasks.flatMap(t => t.tags || []))];
      const commonTags = ['дом', 'работа', 'покупки', 'здоровье', 'спорт', 'учеба', 'хобби'];
      const allSuggestions = [...new Set([...allTags, ...commonTags])];
      const matchingTags = allSuggestions.filter(tag => 
        tag.toLowerCase().includes(currentToken.substring(1))
      ).slice(0, 5);
      
      return matchingTags.map(tag => ({
        value: `#${tag}`,
        icon: '🏷️',
        text: tag,
        hint: 'тег'
      }));
    }
    
    if (currentToken.startsWith('@')) {
      // Project suggestions
      const matchingProjects = state.projects.filter(p => 
        p.title.toLowerCase().includes(currentToken.substring(1))
      ).slice(0, 5);
      
      return matchingProjects.map(p => ({
        value: `@${p.title}`,
        icon: '🪐',
        text: p.title,
        hint: 'проект'
      }));
    }
    
    if (currentToken.startsWith('!')) {
      // Time suggestions
      const timeSuggestions = [
        { value: '!сегодня', text: 'сегодня', hint: 'сегодня', icon: '📅' },
        { value: '!завтра', text: 'завтра', hint: 'завтра', icon: '📅' },
        { value: '!послезавтра', text: 'послезавтра', hint: 'послезавтра', icon: '📅' },
        { value: '!понедельник', text: 'понедельник', hint: 'понедельник', icon: '📅' },
        { value: '!вторник', text: 'вторник', hint: 'вторник', icon: '📅' },
        { value: '!среда', text: 'среда', hint: 'среда', icon: '📅' },
        { value: '!четверг', text: 'четверг', hint: 'четверг', icon: '📅' },
        { value: '!пятница', text: 'пятница', hint: 'пятница', icon: '📅' },
        { value: '!10:00', text: '10:00', hint: 'время', icon: '🕙' },
        { value: '!14:30', text: '14:30', hint: 'время', icon: '🕙' }
      ];
      
      return timeSuggestions.filter(s => 
        s.text.includes(currentToken.substring(1))
      );
    }
    
    if (currentToken.startsWith('p') && /^p[1-4]?$/.test(currentToken)) {
      // Priority suggestions
      return [
        { value: 'p1', text: 'p1', hint: 'высокий приоритет', icon: '🔴' },
        { value: 'p2', text: 'p2', hint: 'средний приоритет', icon: '🟡' },
        { value: 'p3', text: 'p3', hint: 'низкий приоритет', icon: '🟢' },
        { value: 'p4', text: 'p4', hint: 'очень низкий', icon: '⚪' }
      ].filter(s => s.text.startsWith(currentToken));
    }
    
    if (currentToken.startsWith('~')) {
      // Estimate suggestions
      return [
        { value: '~15м', text: '15м', hint: '15 минут', icon: '⏱️' },
        { value: '~30м', text: '30м', hint: '30 минут', icon: '⏱️' },
        { value: '~1ч', text: '1ч', hint: '1 час', icon: '⏱️' },
        { value: '~2ч', text: '2ч', hint: '2 часа', icon: '⏱️' }
      ].filter(s => s.text.includes(currentToken.substring(1)));
    }
    
    return [];
  }
  
  qa.addEventListener("input", (e) => {
    const text = qa.value;
    const cursorPos = qa.selectionStart;
    const suggestions = getAutocompleteSuggestions(text, cursorPos);
    
    if (suggestions.length > 0) {
      showAutocomplete(suggestions);
    } else {
      hideAutocomplete();
    }
  });
  qa.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitQuick(qa.value.trim());
      qa.value = "";
      chips.innerHTML = "";
    }
  });
  
  // Simple button handlers
  const addBtn = document.getElementById('addBtn');
  const addToDomainBtn = document.getElementById('addToDomainBtn');
  const clearBtn = document.getElementById('clearBtn');
  
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const text = qa.value.trim();
      if (text) {
        submitQuick(text);
        qa.value = "";
        chips.innerHTML = "";
      }
    });
  }
  
  if (addToDomainBtn) {
    addToDomainBtn.addEventListener('click', () => {
      const text = qa.value.trim();
      if (text) {
        submitQuickToDomain(text);
        qa.value = "";
        chips.innerHTML = "";
      }
    });
  }
  
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      qa.value = "";
      chips.innerHTML = "";
      qa.focus();
    });
  }
  
  // Update domain button state
  function updateDomainButton() {
    if (addToDomainBtn) {
      const hasActiveDomain = state.activeDomain && state.domains.find(d => d.id === state.activeDomain);
      addToDomainBtn.disabled = !hasActiveDomain;
      if (hasActiveDomain) {
        const domainName = state.domains.find(d => d.id === state.activeDomain)?.title || "домен";
        addToDomainBtn.title = `Добавить в домен "${domainName}"`;
      } else {
        addToDomainBtn.title = "Сначала выберите домен";
      }
    }
  }
  
  // Update button state when active domain changes
  updateDomainButton();
  window.updateDomainButton = updateDomainButton;
  // zoom slider hookup (view_map exposes setZoom)
  const zs = $("#zoomSlider");
  try{
    if(zs){
      zs.addEventListener('input', ()=>{
        if(window.mapApi && typeof window.mapApi.setZoom==='function'){
          window.mapApi.setZoom(parseInt(zs.value,10));
        }
      });
    }
  }catch(_){}
}

function submitQuick(text) {
  if (!text) return;
  
  // Simple logic: if text starts with @, create project; otherwise create task
  if (text.startsWith('@')) {
    const projectName = text.substring(1).trim();
    if (projectName) {
      const domainId = state.activeDomain || state.domains[0]?.id || null;
      if (!domainId) {
        showToast("Сначала выберите домен", "warn");
        return;
      }
      
      const newProject = {
        id: "p" + Math.random().toString(36).slice(2, 8),
        domainId: domainId,
        title: projectName,
        // Не добавляем color - будет использоваться единый по умолчанию
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      state.projects.push(newProject);
      saveState();
      layoutMap();
      drawMap();
      showToast(`Проект "${projectName}" создан`, "ok");
    }
  } else {
    // Parse the text to extract time, tags, etc.
  const parsed = parseQuick(text);
    const title = parsed.title || text;
    
    // Check if user wants to assign to a specific domain
  let domainId = null;
    
    // If there's an active domain, ask user if they want to assign to it
    if (state.activeDomain) {
      const domainName = state.domains.find(d => d.id === state.activeDomain)?.title || "домен";
      const assignToDomain = confirm(`Привязать задачу "${title}" к домену "${domainName}"?\n\nНажмите "ОК" - привязать к домену\nНажмите "Отмена" - создать независимую задачу`);
      if (assignToDomain) {
        domainId = state.activeDomain;
      }
    }
    
    // Determine status based on parsed time
    let status = "today"; // default
    if (parsed.when) {
      const now = Date.now();
      const taskTime = parsed.when.date;
      const diffHours = (taskTime - now) / (1000 * 60 * 60);
      
      if (diffHours < 0) {
        status = "backlog"; // past
      } else if (diffHours < 24) {
        status = "today"; // today
      } else {
        status = "backlog"; // future
      }
    }
    
    // Create task
    const newTask = {
    id: "t" + Math.random().toString(36).slice(2, 8),
      projectId: null,
      domainId: domainId, // null = fully independent, or specific domain
      title: title,
      tags: parsed.tag ? [parsed.tag] : [],
      status: status,
    estimateMin: parsed.estimate || null,
    priority: parsed.priority || 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    };
    
    // Add scheduled time if parsed
    if (parsed.when) {
      newTask.scheduledFor = parsed.when.date;
    }
    
    // Debug: show where task will be placed
    console.log("Creating task:", newTask);
    console.log("Domain assignment:", domainId ? `assigned to domain ${domainId}` : "fully independent");
    console.log("Time parsing:", parsed.when ? `scheduled for ${new Date(parsed.when.date).toLocaleString()}` : "no time");
    
    state.tasks.push(newTask);
  saveState();
  layoutMap();
  drawMap();
    updateWip(); // Update WIP count
    
    // Trigger cosmic animation for task creation
    if (window.cosmicAnimations) {
      setTimeout(() => {
        const taskNode = nodes?.find(n => n.id === newTask.id);
        if (taskNode) {
          window.cosmicAnimations.animateTaskCreation(taskNode.x, taskNode.y, newTask.status);
        }
      }, 100);
    }
    
    const location = domainId ? `в домене "${state.domains.find(d => d.id === domainId)?.title}"` : "как независимая";
    const timeInfo = parsed.when ? ` на ${parsed.when.label}` : "";
    showToast(`Задача "${title}" добавлена ${location}${timeInfo}`, "ok");
  }
  
  renderSidebar();
  updateWip();
}

function submitQuickToDomain(text) {
  if (!text) return;
  
  // Always create task in active domain (no confirmation needed)
  if (!state.activeDomain) {
    showToast("Сначала выберите домен", "warn");
    return;
  }
  
  // Parse the text to extract time, tags, etc.
  const parsed = parseQuick(text);
  const title = parsed.title || text;
  
  // Determine status based on parsed time
  let status = "today"; // default
  if (parsed.when) {
    const now = Date.now();
    const taskTime = parsed.when.date;
    const diffHours = (taskTime - now) / (1000 * 60 * 60);
    
    if (diffHours < 0) {
      status = "backlog"; // past
    } else if (diffHours < 24) {
      status = "today"; // today
    } else {
      status = "backlog"; // future
    }
  }
  
  const newTask = {
    id: "t" + Math.random().toString(36).slice(2, 8),
    projectId: null,
    domainId: state.activeDomain, // Always assign to active domain
    title: title,
    tags: parsed.tag ? [parsed.tag] : [],
    status: status,
    estimateMin: parsed.estimate || null,
    priority: parsed.priority || 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  // Add scheduled time if parsed
  if (parsed.when) {
    newTask.scheduledFor = parsed.when.date;
  }
  
  console.log("Creating task in domain:", newTask);
  
  state.tasks.push(newTask);
  saveState();
  layoutMap();
  drawMap();
  updateWip(); // Update WIP count
  
  const domainName = state.domains.find(d => d.id === state.activeDomain)?.title || "домен";
  const timeInfo = parsed.when ? ` на ${parsed.when.label}` : "";
  showToast(`Задача "${title}" добавлена в домен "${domainName}"${timeInfo}`, "ok");
  
  renderSidebar();
  updateWip();
}

async function init() {
  // Prevent double initialization
  if (window.__atlasInitDone) {
    console.log('Atlas already initialized, skipping...');
    return;
  }
  window.__atlasInitDone = true;
  
  // Normal initialization for all browsers (including Edge)
  console.log("Loading state...");
  const ok = loadState();
  console.log("Load state result:", ok);
  if (!ok) {
    console.log("Loading demo data...");
    initDemoData();
  }
  console.log("State after init:", { domains: state.domains.length, projects: state.projects.length, tasks: state.tasks.length });
  
  // Initialize hotkeys
  initializeHotkeys();
  
  // Initialize autocomplete
  console.log('About to initialize autocomplete...');
  initAutocomplete();
  
  // Initialize cosmic animations
  if (!window.cosmicAnimations) {
    import('./cosmic-effects.js').then(module => {
      window.cosmicAnimations = new module.CosmicAnimations();
      console.log('Cosmic animations initialized successfully');
    });
  }
  
  // Initialize analytics dashboard
  window.analyticsDashboard = analyticsDashboard;
  console.log('Analytics dashboard initialized successfully');
  
  // set version in brand + document title
  const brandEl = document.querySelector("header .brand");
  // Don't override APP_VERSION from CHANGELOG - use the hardcoded version
  if (brandEl) brandEl.textContent = APP_VERSION;
  document.title = APP_VERSION + " (modular)";
  renderSidebar();
  setupHeader();
  setupQuickAdd();
  // ensure header chips reflect persisted view
  try {
    $$(".chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.view === state.view);
    });
    $("#canvas").style.display = state.view === "map" ? "block" : "none";
    $("#viewToday").style.display = state.view === "today" ? "flex" : "none";
  } catch (_) {}
  // hotkeys: C/F/P/R + N new domain, FPS toggle
  window.addEventListener("keydown", (e) => {
    // Ctrl+Z -> undo last move
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const ok = undoLastMove && undoLastMove();
      if (ok) showToast("Отменено", "ok");
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setShowFps();
      return;
    }
    if (e.target && e.target.id === "quickAdd") return;
    const k = e.key.toLowerCase();
    if (k === "c") {
      e.preventDefault();
      centerView();
    }
    if (k === "f") {
      e.preventDefault();
      fitActiveDomain();
    }
    if (k === "p") {
      e.preventDefault();
      fitActiveProject();
    }
    if (k === "r") {
      e.preventDefault();
      resetView();
    }
    if (k === "n") {
      e.preventDefault();
      ui.newDomain = true;
      renderSidebar();
      $("#newDomName")?.focus();
    }
  });
  const canvas = document.getElementById("canvas");
  const tooltip = document.getElementById("tooltip");
  if (canvas && tooltip) {
    initMap(canvas, tooltip);
  }
  updateWip();
  
  // Принудительно скрываем модальное окно при инициализации
  const modal = document.getElementById("modal");
  if (modal) {
    modal.style.display = "none";
  }
}
init();


// expose renderers for external refresh (storage, addons)
try { window.renderSidebar = renderSidebar; } catch(_) {}
try { window.renderToday = renderToday; } catch(_) {}
try { window.openInspectorFor = openInspectorFor; } catch(_) {}

// Toggle all tags visibility
window.toggleAllTags = function() {
  state.showAllTags = !state.showAllTags;
  renderSidebar();
};
