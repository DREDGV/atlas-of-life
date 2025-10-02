// js/app.js
import { state, $, $$, initDemoData, getRandomProjectColor, generateId, getRandomIdeaColor, getRandomNoteColor, getDomainMood, getMoodColor, findObjectById, getObjectType, addChecklistItem, removeChecklistItem, toggleChecklistItem, getChecklistProgress, createChecklist, eventBus } from "./state.js";
import { loadState, saveState, exportJson, importJsonV26 as importJson, backupStateSnapshot, listBackups } from "./storage.js";
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
  requestDraw,
  requestLayout,
} from "./view_map.js";
import { renderToday } from "./view_today.js";
import { parseQuick } from "./parser.js";
import { openInspectorFor } from "./inspector.js";
import { logEvent } from "./utils/analytics.js";
import { initializeHotkeys } from "./hotkeys.js";
import { initAutocomplete } from "./autocomplete.js";
import { updateWip } from "./wip.js";
import { AnalyticsDashboard, analyticsDashboard } from "./analytics.js";
import { CosmicAnimations } from "./cosmic-effects.js";
import { openChecklist, closeChecklist } from "./ui/checklist.js";
import { openChecklistWindow, closeChecklistWindow } from "./ui/checklist-window.js";
import { initInbox } from "./inbox.js";

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

// Expose hierarchy functions globally for debugging
try { 
  // window.isHierarchyV2Enabled = isHierarchyV2Enabled;
  // window.setHierarchyV2Enabled = setHierarchyV2Enabled;
} catch (_) {}

// App version (SemVer-like label used in UI)
let APP_VERSION = "Atlas_of_life_v0.8.5.0";

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
  if (title && title !== "Диалог" && title !== "") {
  modal.style.display = "flex";
  }
}

// Read-only audit modal for hierarchy (safe)
function openHierarchyAuditModal() {
  try {
    // Lazy import to avoid coupling; use already loaded functions if present
    const modal = document.getElementById('modal');
    if (!modal) return;

    // collect stats without mutations
    const all = [
      ...(state.domains||[]),
      ...(state.projects||[]),
      ...(state.tasks||[]),
      ...(state.ideas||[]),
      ...(state.notes||[]),
    ];
    const totals = {
      domains: state.domains?.length||0,
      projects: state.projects?.length||0,
      tasks: state.tasks?.length||0,
      ideas: state.ideas?.length||0,
      notes: state.notes?.length||0,
    };
    let withParent = 0, brokenChildren = 0;
    const orphaned = [];
    const byId = new Map(all.map(o=>[o.id,o]));

    all.forEach(o=>{ if (o && o.parentId) withParent++; });
    // shallow child-parent symmetry check (best-effort, no mutate)
    all.forEach(p=>{
      const ch = p && p.children ? Object.values(p.children).flat() : [];
      ch.forEach(cid=>{
        const c = byId.get(cid);
        if (!c || c.parentId !== p.id) brokenChildren++;
      });
    });

    // minimal orphan scan: parentId points to missing
    all.forEach(o=>{
      if (o && o.parentId && !byId.get(o.parentId)) orphaned.push(o.id);
    });

    // try use validator if available
    let validationCount = 0;
    try {
      if (typeof window !== 'undefined' && window.state) {
        // validation.js attaches named export; we imported through state.js earlier
        // guard: use global function if exposed in bundling
        if (typeof validateHierarchy === 'function') {
          const errs = validateHierarchy(state) || [];
          validationCount = errs.length;
        }
      }
    } catch(_) {}

    const backups = listBackups();

    modal.innerHTML = `
      <div class="modal-content">
        <h2>🔍 Проверка иерархии (только чтение)</h2>
        <div class="stats-grid">
          <div class="stat-item"><span class="stat-label">Домены:</span><span class="stat-value">${totals.domains}</span></div>
          <div class="stat-item"><span class="stat-label">Проекты:</span><span class="stat-value">${totals.projects}</span></div>
          <div class="stat-item"><span class="stat-label">Задачи:</span><span class="stat-value">${totals.tasks}</span></div>
          <div class="stat-item"><span class="stat-label">Идеи:</span><span class="stat-value">${totals.ideas}</span></div>
          <div class="stat-item"><span class="stat-label">Заметки:</span><span class="stat-value">${totals.notes}</span></div>
        </div>
        <div class="hierarchy-status">
          <h3>Сводка:</h3>
          <div class="status-item"><span class="status-icon">🧭</span><span class="status-text">С родителем: ${withParent}</span></div>
          <div class="status-item"><span class="status-icon">🧩</span><span class="status-text">Несимметричных ссылок: ${brokenChildren}</span></div>
          <div class="status-item"><span class="status-icon">🪙</span><span class="status-text">Осиротевших: ${orphaned.length}</span></div>
          <div class="status-item"><span class="status-icon">✅</span><span class="status-text">Ошибок валидатора: ${validationCount}</span></div>
        </div>
        <div class="form-group">
          <label class="checkbox-label" style="cursor:default">
            <input type="checkbox" disabled ${false? 'checked':''}>
            <span class="checkmark"></span>
            Автоисправление (недоступно в режиме аудита)
          </label>
        </div>
        <div class="form-group">
          <div class="hint">Резервные копии (3 последних):<br>${backups.map(b=>`• ${b.key.split('__').pop()}: ${b.savedAt||'нет'}`).join('<br>')}</div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="copyAuditBtn">Скопировать отчёт</button>
          <button class="btn" id="makeBackupBtn">Создать бэкап</button>
          <button class="btn primary" id="closeAuditBtn">Закрыть</button>
        </div>
      </div>`;

    modal.style.display = 'flex';

    const copyBtn = document.getElementById('copyAuditBtn');
    if (copyBtn) copyBtn.onclick = () => {
      const report = {
        totals,
        withParent,
        brokenChildren,
        orphaned,
        validationCount,
        backups
      };
      try {
        navigator.clipboard.writeText(JSON.stringify(report, null, 2));
        showToast('Отчёт скопирован', 'ok');
      } catch (e) { showToast('Не удалось скопировать: '+e.message, 'warn'); }
    };

    const backupBtn = document.getElementById('makeBackupBtn');
    if (backupBtn) backupBtn.onclick = () => {
      try { backupStateSnapshot('hierarchy-audit'); showToast('Бэкап создан', 'ok'); }
      catch(e){ showToast('Ошибка бэкапа: '+e.message, 'warn'); }
    };

    const closeBtn = document.getElementById('closeAuditBtn');
    if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
  } catch (e) {
    showToast('Ошибка аудита: ' + e.message, 'warn');
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
  
  if (!event.key) return null; // Защита от undefined key
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
      <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--panel-2);border-radius:4px;">
        <input type="checkbox" id="displayDndHints" ${(state.settings && state.settings.showDndHints) ? 'checked' : ''} style="margin:0;">
        <span>🧲 Подсветка допустимых целей при перетаскивании (DnD)</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--panel-2);border-radius:4px;">
        <input type="checkbox" id="displayInbox" ${(state.settings && state.settings.showInbox) ? 'checked' : ''} style="margin:0;">
        <span>📥 Инбокс - быстрый захват мыслей (N - захват, I - разбор)</span>
      </label>
      <div style="display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--panel-2);border-radius:4px;">
        <div style="font-weight:600;">🧩 Вид иконки чек-листа на карте</div>
        <select id="checklistIconMode" style="width:100%;padding:6px;background:var(--panel);color:var(--text);border:1px solid var(--panel-2);border-radius:4px;">
          <option value="hybrid" ${state.settings && state.settings.checklistIconMode==='hybrid' ? 'selected' : ''}>Гибрид: заголовок + бэйдж, превью на зуме/ховере</option>
          <option value="title" ${state.settings && state.settings.checklistIconMode==='title' ? 'selected' : ''}>Только заголовок</option>
          <option value="minimal" ${state.settings && state.settings.checklistIconMode==='minimal' ? 'selected' : ''}>Минимум: заголовок + процент</option>
          <option value="preview2" ${state.settings && state.settings.checklistIconMode==='preview2' ? 'selected' : ''}>Превью: первые 2 строки</option>
          <option value="preview3" ${state.settings && state.settings.checklistIconMode==='preview3' ? 'selected' : ''}>Превью: первые 3 строки</option>
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--panel-2);border-radius:4px;">
        <div style="font-weight:600;">⏱️ Задержка всплывающих подсказок (мс)</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="number" id="tooltipDelay" min="0" max="10000" step="50" 
                 value="${state.settings && state.settings.tooltipDelay !== undefined ? state.settings.tooltipDelay : 500}"
                 style="flex:1;padding:6px;background:var(--panel);color:var(--text);border:1px solid var(--panel-2);border-radius:4px;"
                 placeholder="500"
                 oninput="this.value = Math.max(0, Math.min(10000, parseInt(this.value) || 0))"
                 onchange="this.value = Math.max(0, Math.min(10000, parseInt(this.value) || 0))">
          <div style="display:flex;flex-direction:column;gap:2px;">
            <button type="button" onclick="const input = document.getElementById('tooltipDelay'); input.value='0'; input.dispatchEvent(new Event('change'));" style="padding:4px 8px;font-size:11px;background:var(--panel-2);color:var(--text);border:1px solid var(--panel-2);border-radius:3px;cursor:pointer;">0мс</button>
            <button type="button" onclick="const input = document.getElementById('tooltipDelay'); input.value='200'; input.dispatchEvent(new Event('change'));" style="padding:4px 8px;font-size:11px;background:var(--panel-2);color:var(--text);border:1px solid var(--panel-2);border-radius:3px;cursor:pointer;">200мс</button>
            <button type="button" onclick="const input = document.getElementById('tooltipDelay'); input.value='500'; input.dispatchEvent(new Event('change'));" style="padding:4px 8px;font-size:11px;background:var(--panel-2);color:var(--text);border:1px solid var(--panel-2);border-radius:3px;cursor:pointer;">500мс</button>
            <button type="button" onclick="const input = document.getElementById('tooltipDelay'); input.value='1000'; input.dispatchEvent(new Event('change'));" style="padding:4px 8px;font-size:11px;background:var(--panel-2);color:var(--text);border:1px solid var(--panel-2);border-radius:3px;cursor:pointer;">1000мс</button>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text-2);">
          💡 Рекомендуемые значения: 0-200мс (быстро), 500мс (по умолчанию), 1000-2000мс (медленно)
        </div>
      </div>
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
      const dndHints = document.getElementById('displayDndHints').checked;
      const inbox = document.getElementById('displayInbox').checked;
      const iconMode = (document.getElementById('checklistIconMode') || {}).value || 'title';
      const tooltipDelayInput = document.getElementById('tooltipDelay');
      const tooltipDelay = tooltipDelayInput ? Math.max(0, Math.min(10000, parseInt(tooltipDelayInput.value) || 500)) : 500;
      
      console.log('🔧 Настройки отображения:', {
        tooltipDelay,
        currentTooltipDelay: state.settings?.tooltipDelay,
        settingsChanged: tooltipDelay !== (state.settings?.tooltipDelay || 500)
      });
      
      if (links !== state.showLinks || aging !== state.showAging || glow !== state.showGlow || (state.settings && dndHints !== !!state.settings.showDndHints) || (state.settings && inbox !== !!state.settings.showInbox) || (state.settings && iconMode !== state.settings.checklistIconMode) || (state.settings && tooltipDelay !== (state.settings.tooltipDelay || 500))) {
        state.showLinks = links;
        state.showAging = aging;
        state.showGlow = glow;
        if (!state.settings) state.settings = {};
        state.settings.showDndHints = !!dndHints;
        state.settings.showInbox = !!inbox;
        state.settings.checklistIconMode = iconMode;
        state.settings.tooltipDelay = tooltipDelay;
        console.log('💾 Сохраняем настройки:', state.settings);
        saveState();
        drawMap();
        showToast("Настройки отображения обновлены", "ok");
      } else {
        console.log('ℹ️ Настройки не изменились, пропускаем сохранение');
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

function openHierarchySettingsModal() {
  const modal = document.getElementById('modal');
  if (!modal) return;

  // Safe default (we keep v2 off by default for stability)
  const isEnabled = false;
  
  modal.innerHTML = `
    <div class="modal-content">
      <h2>🌐 Система иерархии v2</h2>
      <div class="form-group">
        <button class="btn" id="auditHierarchyBtn">Проверка иерархии (только чтение)</button>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="hierarchyToggle" ${isEnabled ? 'checked' : ''}>
          <span class="checkmark"></span>
          Включить систему иерархии v2
        </label>
        <div class="hint">
          Система иерархии позволяет создавать связи между объектами (домены → проекты → задачи).<br>
          <strong>Внимание:</strong> Это экспериментальная функция. Рекомендуется создать резервную копию данных.
        </div>
      </div>
      <div class="hierarchy-status">
        <h3>Текущий статус:</h3>
        <div class="status-item">
          <span class="status-icon">${isEnabled ? '✅' : '❌'}</span>
          <span class="status-text">${isEnabled ? 'Включена' : 'Отключена'}</span>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="cancelHierarchyBtn">Отмена</button>
        <button class="btn" id="migrationBtn">Миграция данных</button>
        <button class="btn primary" id="saveHierarchyBtn">Сохранить</button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  // Event handlers
  const auditBtn = document.getElementById('auditHierarchyBtn');
  if (auditBtn) {
    auditBtn.onclick = () => {
      closeModal();
      openHierarchyAuditModal();
    };
  }
  document.getElementById('saveHierarchyBtn').onclick = () => {
    const enabled = document.getElementById('hierarchyToggle').checked;
    // setHierarchyV2Enabled(enabled);
    saveState();
    
    closeModal();
    showToast(`Система иерархии v2 ${enabled ? 'включена' : 'отключена'}`, 'ok');
    
    // Перезагружаем страницу для применения изменений
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  document.getElementById('cancelHierarchyBtn').onclick = () => {
    closeModal();
  };

  document.getElementById('migrationBtn').onclick = () => {
    closeModal();
    openHierarchyMigrationModal();
  };
}

// Модальное окно миграции иерархии
function openHierarchyMigrationModal() {
  const modal = document.getElementById('modal');
  if (!modal) return;

  // Получаем статистику текущего состояния
  // const stats = getHierarchyStatistics();
  
  modal.innerHTML = `
    <div class="modal-content">
      <h2>🚀 Миграция к системе иерархии v2</h2>
      
      <div class="migration-info">
        <h3>📊 Текущее состояние:</h3>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Всего объектов:</span>
            <span class="stat-value">${stats.total}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">С родителем:</span>
            <span class="stat-value">${stats.withParent}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Независимых:</span>
            <span class="stat-value">${stats.withoutParent}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Всего связей:</span>
            <span class="stat-value">${stats.totalConnections}</span>
          </div>
        </div>
      </div>

      <div class="migration-options">
        <h3>⚙️ Опции миграции:</h3>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="restoreConnections" checked>
            <span class="checkmark"></span>
            Восстановить связи на основе существующих полей (domainId, projectId)
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="validateAfterMigration" checked>
            <span class="checkmark"></span>
            Валидировать иерархию после миграции
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="createBackup">
            <span class="checkmark"></span>
            Создать резервную копию перед миграцией
          </label>
        </div>
      </div>

      <div class="migration-warning">
        <h3>⚠️ Важно:</h3>
        <ul>
          <li>Миграция добавит поля иерархии ко всем объектам</li>
          <li>Существующие связи будут восстановлены автоматически</li>
          <li>Рекомендуется создать резервную копию данных</li>
          <li>Процесс можно отменить в любой момент</li>
        </ul>
      </div>

      <div class="modal-actions">
        <button class="btn" id="cancelMigrationBtn">Отмена</button>
        <button class="btn" id="previewMigrationBtn">Предпросмотр</button>
        <button class="btn primary" id="startMigrationBtn">Начать миграцию</button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  // Event handlers
  document.getElementById('cancelMigrationBtn').onclick = () => {
    closeModal();
  };

  document.getElementById('previewMigrationBtn').onclick = () => {
    previewMigration();
  };

  document.getElementById('startMigrationBtn').onclick = () => {
    startMigration();
  };
}

// Предпросмотр миграции
function previewMigration() {
  try {
    console.log('👁️ Предпросмотр миграции...');
    
    // Анализируем существующие данные
    const analysis = analyzeExistingData();
    
    // Показываем результаты в модальном окне
    const modal = document.getElementById('modal');
    if (modal) {
      modal.innerHTML = `
        <div class="modal-content">
          <h2>👁️ Предпросмотр миграции</h2>
          
          <div class="preview-results">
            <h3>📋 Что будет сделано:</h3>
            <div class="preview-item">
              <span class="preview-icon">🔧</span>
              <span class="preview-text">Инициализировать поля иерархии для ${analysis.totalObjects} объектов</span>
            </div>
            <div class="preview-item">
              <span class="preview-icon">🔗</span>
              <span class="preview-text">Восстановить ${analysis.potentialConnections} связей</span>
            </div>
            <div class="preview-item">
              <span class="preview-icon">🔍</span>
              <span class="preview-text">Валидировать все связи</span>
            </div>
            <div class="preview-item">
              <span class="preview-icon">💾</span>
              <span class="preview-text">Сохранить изменения</span>
            </div>
          </div>

          <div class="preview-warnings">
            <h3>⚠️ Предупреждения:</h3>
            ${analysis.issues.length > 0 ? 
              analysis.issues.map(issue => `<div class="warning-item">• ${issue}</div>`).join('') :
              '<div class="warning-item">• Предупреждений не найдено</div>'
            }
          </div>

          <div class="modal-actions">
            <button class="btn" id="backToMigrationBtn">Назад</button>
            <button class="btn primary" id="confirmMigrationBtn">Подтвердить миграцию</button>
          </div>
        </div>
      `;

      // Event handlers
      document.getElementById('backToMigrationBtn').onclick = () => {
        openHierarchyMigrationModal();
      };

      document.getElementById('confirmMigrationBtn').onclick = () => {
        startMigration();
      };
    }

  } catch (error) {
    console.error('❌ previewMigration: Ошибка предпросмотра:', error);
    showToast('Ошибка предпросмотра миграции', 'error');
  }
}

// Запуск миграции
function startMigration() {
  try {
    console.log('🚀 Запуск миграции...');
    
    // Получаем опции из формы
    const restoreConnections = document.getElementById('restoreConnections')?.checked ?? true;
    const validateAfterMigration = document.getElementById('validateAfterMigration')?.checked ?? true;
    const createBackup = document.getElementById('createBackup')?.checked ?? false;

    // Создаем резервную копию если нужно
    if (createBackup) {
      console.log('💾 Создание резервной копии...');
      // TODO: Реализовать создание резервной копии
    }

    // Показываем прогресс
    showMigrationProgress();

    // Запускаем миграцию
    // const result = migrateToHierarchyV2({
    //   restoreConnections,
    //   validateAfterMigration
    // });

    // Показываем результаты
    // showMigrationResults(result);

  } catch (error) {
    console.error('❌ startMigration: Ошибка миграции:', error);
    showToast('Ошибка миграции', 'error');
  }
}

// Показ прогресса миграции
function showMigrationProgress() {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.innerHTML = `
      <div class="modal-content">
        <h2>🚀 Миграция в процессе...</h2>
        
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" id="progressFill"></div>
          </div>
          <div class="progress-text" id="progressText">Инициализация...</div>
        </div>

        <div class="migration-steps" id="migrationSteps">
          <div class="step-item" id="step1">
            <span class="step-icon">⏳</span>
            <span class="step-text">Инициализация системы</span>
          </div>
          <div class="step-item" id="step2">
            <span class="step-icon">⏳</span>
            <span class="step-text">Восстановление связей</span>
          </div>
          <div class="step-item" id="step3">
            <span class="step-icon">⏳</span>
            <span class="step-text">Валидация иерархии</span>
          </div>
          <div class="step-item" id="step4">
            <span class="step-icon">⏳</span>
            <span class="step-text">Сохранение состояния</span>
          </div>
        </div>
      </div>
    `;

    // Анимация прогресса
    let progress = 0;
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    const steps = [
      { text: 'Инициализация системы...', duration: 1000 },
      { text: 'Восстановление связей...', duration: 1500 },
      { text: 'Валидация иерархии...', duration: 1000 },
      { text: 'Сохранение состояния...', duration: 500 }
    ];

    let currentStep = 0;
    const updateProgress = () => {
      if (currentStep < steps.length) {
        const step = steps[currentStep];
        if (progressText) progressText.textContent = step.text;
        
        const stepElement = document.getElementById(`step${currentStep + 1}`);
        if (stepElement) {
          stepElement.querySelector('.step-icon').textContent = '🔄';
        }

        setTimeout(() => {
          if (stepElement) {
            stepElement.querySelector('.step-icon').textContent = '✅';
          }
          currentStep++;
          progress += 25;
          if (progressFill) progressFill.style.width = `${progress}%`;
          updateProgress();
        }, step.duration);
      }
    };

    updateProgress();
  }
}

// Показ результатов миграции
function showMigrationResults(result) {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.innerHTML = `
      <div class="modal-content">
        <h2>${result.success ? '✅ Миграция завершена!' : '❌ Миграция завершена с ошибками'}</h2>
        
        <div class="migration-results">
          <h3>📊 Результаты:</h3>
          <div class="results-grid">
            <div class="result-item">
              <span class="result-label">Обработано объектов:</span>
              <span class="result-value">${result.steps[0]?.details?.processedObjects || 0}</span>
            </div>
            <div class="result-item">
              <span class="result-label">Восстановлено связей:</span>
              <span class="result-value">${result.steps[1]?.details?.restoredConnections || 0}</span>
            </div>
            <div class="result-item">
              <span class="result-label">Ошибок валидации:</span>
              <span class="result-value">${result.steps[2]?.details?.errors?.length || 0}</span>
            </div>
            <div class="result-item">
              <span class="result-label">Статус сохранения:</span>
              <span class="result-value">${result.steps[3]?.success ? '✅' : '❌'}</span>
            </div>
          </div>
        </div>

        ${result.errors.length > 0 ? `
          <div class="migration-errors">
            <h3>❌ Ошибки:</h3>
            <ul>
              ${result.errors.map(error => `<li>${error}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${result.warnings.length > 0 ? `
          <div class="migration-warnings">
            <h3>⚠️ Предупреждения:</h3>
            <ul>
              ${result.warnings.map(warning => `<li>${warning}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <div class="modal-actions">
          ${!result.success ? `
            <button class="btn" id="rollbackMigrationBtn">Откатить миграцию</button>
          ` : ''}
          <button class="btn primary" id="closeMigrationBtn">Закрыть</button>
        </div>
      </div>
    `;

    // Event handlers
    document.getElementById('closeMigrationBtn').onclick = () => {
      closeModal();
      if (result.success) {
        showToast('Миграция завершена успешно!', 'ok');
        // Перезагружаем страницу для применения изменений
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    };

    if (!result.success) {
      document.getElementById('rollbackMigrationBtn').onclick = () => {
        rollbackMigration();
      };
    }
  }
}

// Откат миграции
function rollbackMigration() {
  try {
    console.log('⏪ Откат миграции...');
    
    // const result = rollbackHierarchyMigration();
    
    // if (result.success) {
    //   showToast(`Откат завершен. Очищено объектов: ${result.clearedObjects}`, 'ok');
    //   closeModal();
    //   // Перезагружаем страницу
    //   setTimeout(() => {
    //     window.location.reload();
    //   }, 1000);
    // } else {
    //   showToast('Ошибка отката миграции', 'error');
    // }

  } catch (error) {
    console.error('❌ rollbackMigration: Ошибка отката:', error);
    showToast('Ошибка отката миграции', 'error');
  }
}

// Анализ существующих данных
function analyzeExistingData() {
  try {
    const allObjects = [
      ...state.domains,
      ...state.projects,
      ...state.tasks,
      ...state.ideas,
      ...state.notes
    ];

    const analysis = {
      totalObjects: allObjects.length,
      objectsWithHierarchy: 0,
      objectsWithoutHierarchy: 0,
      existingConnections: 0,
      potentialConnections: 0,
      issues: [],
      recommendations: []
    };

    allObjects.forEach(obj => {
      // Проверяем наличие полей иерархии
      const hasHierarchy = obj.parentId !== undefined || obj.children !== undefined || obj.locks !== undefined;
      
      if (hasHierarchy) {
        analysis.objectsWithHierarchy++;
      } else {
        analysis.objectsWithoutHierarchy++;
      }

      // Подсчитываем существующие связи
      if (obj.parentId) {
        analysis.existingConnections++;
      }

      // Подсчитываем потенциальные связи
      if (obj.domainId && getObjectType(obj) !== 'domain') {
        analysis.potentialConnections++;
      }
      if (obj.projectId && getObjectType(obj) === 'task') {
        analysis.potentialConnections++;
      }
    });

    return analysis;

  } catch (error) {
    console.error('❌ analyzeExistingData: Ошибка анализа:', error);
    return {
      totalObjects: 0,
      objectsWithHierarchy: 0,
      objectsWithoutHierarchy: 0,
      existingConnections: 0,
      potentialConnections: 0,
      issues: [`Критическая ошибка: ${error.message}`],
      recommendations: ['Обратитесь к разработчику']
    };
  }
}

// Информационная панель
function showInfoPanel(text, icon = '💡', isHtml = false) {
  console.log('💡 Showing info panel:', text, icon, isHtml);
  const infoPanel = document.getElementById('infoPanel');
  const infoText = document.getElementById('infoText');
  const infoIcon = infoPanel.querySelector('.info-icon');
  
  if (infoPanel && infoText) {
    if (isHtml) {
      infoText.innerHTML = text;
    } else {
      infoText.textContent = text;
    }
    if (infoIcon) infoIcon.textContent = icon;
    infoPanel.classList.add('show');
    
    // Автоскрытие через 10 секунд для длинных подсказок
    clearTimeout(window.infoPanelTimeout);
    if (text.length > 100) {
      window.infoPanelTimeout = setTimeout(() => {
        hideInfoPanel();
      }, 10000);
    }
  } else {
    console.error('❌ Info panel elements not found:', { infoPanel, infoText });
  }
}

function hideInfoPanel() {
  const infoPanel = document.getElementById('infoPanel');
  if (infoPanel) {
    infoPanel.classList.remove('show');
    clearTimeout(window.infoPanelTimeout);
  }
}

// Настройка подсказок для информационной панели
function setupInfoPanelTooltips() {
  console.log('🔧 Setting up info panel tooltips...');
  // Подсказки для кнопок навигации
  const navButtons = [
    { selector: '#btnCenter', text: 'Центрировать карту на текущем виде (горячая клавиша: C)', icon: '🎯' },
    { selector: '#btnFitDomain', text: 'Подогнать вид под активный домен (горячая клавиша: F)', icon: '🌍' },
    { selector: '#btnFitProject', text: 'Подогнать вид под активный проект (горячая клавиша: P)', icon: '🎯' },
    { selector: '#btnReset', text: 'Сбросить масштаб и позицию карты (горячая клавиша: R)', icon: '🔄' },
    { selector: '#btnFullscreen', text: 'Переключить полноэкранный режим', icon: '⛶' }
  ];

  navButtons.forEach(button => {
    const element = document.querySelector(button.selector);
    if (element) {
      element.addEventListener('mouseenter', () => {
        showInfoPanel(button.text, button.icon);
      });
      element.addEventListener('mouseleave', hideInfoPanel);
    }
  });

  // Подсказки для кнопок создания
  const createButtons = [
    { selector: '#createTaskBtn', text: 'Создать новую задачу <span class="kbd">Ctrl+N</span>', icon: '➕', isHtml: true },
    { selector: '#createProjectBtn', text: 'Создать новый проект <span class="kbd">Ctrl+Shift+N</span>', icon: '🎯', isHtml: true },
    { selector: '#createIdeaBtn', text: 'Создать новую идею - для хранения творческих мыслей', icon: '🌌' },
    { selector: '#createNoteBtn', text: 'Создать новую заметку - для записи важной информации', icon: '🪨' },
    { selector: '#btnAddDomain', text: 'Создать новый домен - основную сферу жизни <span class="kbd">Ctrl+Shift+D</span>', icon: '🌍', isHtml: true },
    { selector: '#btnAddChecklist', text: 'Создать новый чек-лист - для структурированных списков задач', icon: '✓' },
    { selector: '#btnInboxCapture', text: 'Быстрый захват идей и задач в инбокс', icon: '📥' },
    { selector: '#btnInboxList', text: 'Просмотр и обработка элементов инбокса', icon: '📋' }
  ];

  createButtons.forEach(button => {
    const element = document.querySelector(button.selector);
    if (element) {
      element.addEventListener('mouseenter', () => {
        showInfoPanel(button.text, button.icon, button.isHtml || false);
      });
      element.addEventListener('mouseleave', hideInfoPanel);
    }
  });

  // Подсказки для статусов задач
  const statusPills = [
    { selector: '.pill-backlog', text: 'Задачи в планах - будущие задачи, которые планируются к выполнению <span class="kbd">1</span>', icon: '📋', isHtml: true },
    { selector: '.pill-today', text: 'Задачи на сегодня - приоритетные задачи для выполнения сегодня <span class="kbd">2</span>', icon: '📅', isHtml: true },
    { selector: '.pill-doing', text: 'Задачи в работе - задачи, которые выполняются прямо сейчас <span class="kbd">3</span>', icon: '⚡', isHtml: true },
    { selector: '.pill-done', text: 'Выполненные задачи - завершенные задачи, готовые к архивированию <span class="kbd">4</span>', icon: '✅', isHtml: true }
  ];

  statusPills.forEach(pill => {
    const elements = document.querySelectorAll(pill.selector);
    elements.forEach(element => {
      element.addEventListener('mouseenter', () => {
        showInfoPanel(pill.text, pill.icon, pill.isHtml || false);
      });
      element.addEventListener('mouseleave', hideInfoPanel);
    });
  });

  // Подсказки для настроек
  const settingsItems = [
    { selector: '[data-action="hotkeys"]', text: 'Настроить горячие клавиши для быстрого доступа к функциям', icon: '⌨️' },
    { selector: '[data-action="display"]', text: 'Настройки отображения карты и объектов', icon: '📱' },
    { selector: '[data-action="hierarchy"]', text: 'Управление системой иерархии объектов (экспериментальная функция)', icon: '🌐' },
    { selector: '[data-action="export"]', text: 'Экспорт и импорт данных для резервного копирования', icon: '💾' },
    { selector: '#btnSettings', text: 'Открыть настройки приложения', icon: '⚙️' },
    { selector: '#btnAbout', text: 'Информация о версии приложения и изменениях (v0.2.16.2-chronos-concept)', icon: 'ℹ️' }
  ];

  settingsItems.forEach(item => {
    const element = document.querySelector(item.selector);
    if (element) {
      element.addEventListener('mouseenter', () => {
        showInfoPanel(item.text, item.icon);
      });
      element.addEventListener('mouseleave', hideInfoPanel);
    }
  });

  // Подсказки для переключателей видов
  const viewChips = [
    { selector: '[data-view="map"]', text: 'Карта - основной вид для работы с объектами и их связями', icon: '🗺️' },
    { selector: '[data-view="today"]', text: 'Сегодня - список задач на сегодня с приоритетами', icon: '📅' }
  ];

  viewChips.forEach(chip => {
    const element = document.querySelector(chip.selector);
    if (element) {
      element.addEventListener('mouseenter', () => {
        showInfoPanel(chip.text, chip.icon);
      });
      element.addEventListener('mouseleave', hideInfoPanel);
    }
  });

  // Подсказки для зум-слайдера
  const zoomSlider = document.getElementById('zoomSlider');
  if (zoomSlider) {
    zoomSlider.addEventListener('mouseenter', () => {
      showInfoPanel('Регулировка масштаба карты - от 50% до 220% <span class="kbd">Ctrl+0</span> <span class="kbd">Ctrl+1</span> <span class="kbd">Ctrl+2</span>', '🔍', true);
    });
    zoomSlider.addEventListener('mouseleave', hideInfoPanel);
  }

  // Подсказки для других элементов
  const otherElements = [
    { selector: '.brand', text: 'Название приложения и версия', icon: '🏷️' },
    { selector: '.version', text: 'Текущая версия приложения', icon: '📋' },
    { selector: '.spacer', text: 'Разделитель элементов интерфейса', icon: '📏' },
    { selector: '.legend', text: 'Легенда статусов задач', icon: '📊' },
    { selector: '.toggle', text: 'Переключатель отображения элементов', icon: '🔄' }
  ];

  otherElements.forEach(element => {
    const el = document.querySelector(element.selector);
    if (el) {
      el.addEventListener('mouseenter', () => {
        showInfoPanel(element.text, element.icon);
      });
      el.addEventListener('mouseleave', hideInfoPanel);
    }
  });

  // Подсказки для кнопки "О версии"
  const aboutBtn = document.getElementById('btnAbout');
  if (aboutBtn) {
    aboutBtn.addEventListener('mouseenter', () => {
      showInfoPanel('Информация о версии приложения и изменениях (v0.2.16.2-chronos-concept)', 'ℹ️');
    });
    aboutBtn.addEventListener('mouseleave', hideInfoPanel);
  }

  // Подсказки для левой панели
  const leftPanelSections = [
    { selector: '.section h3', text: 'Секции левой панели - домены, фильтры и подсказки', icon: '📂' },
    { selector: '#domainsList', text: 'Список доменов - основных сфер жизни', icon: '🌍' },
    { selector: '#tagsList', text: 'Фильтры по тегам - для быстрого поиска задач', icon: '🏷️' },
    { selector: '.creation-panel', text: 'Панель создания - быстрый доступ к созданию объектов', icon: '➕' }
  ];

  // Подсказки для поиска
  const searchElements = [
    { selector: '#searchInput', text: 'Поиск по названиям объектов на карте <span class="kbd">Ctrl+F</span>', icon: '🔍', isHtml: true },
    { selector: '#searchButton', text: 'Выполнить поиск по введенному запросу', icon: '🔍' }
  ];

  leftPanelSections.forEach(section => {
    const elements = document.querySelectorAll(section.selector);
    elements.forEach(element => {
      element.addEventListener('mouseenter', () => {
        showInfoPanel(section.text, section.icon);
      });
      element.addEventListener('mouseleave', hideInfoPanel);
    });
  });

  // Подсказки для поиска
  searchElements.forEach(element => {
    const el = document.querySelector(element.selector);
    if (el) {
      el.addEventListener('mouseenter', () => {
        showInfoPanel(element.text, element.icon, element.isHtml || false);
      });
      el.addEventListener('mouseleave', hideInfoPanel);
    }
  });

  // Подсказки для правой панели (инспектор)
  const inspectorPanel = document.getElementById('inspector');
  if (inspectorPanel) {
    inspectorPanel.addEventListener('mouseenter', () => {
      showInfoPanel('Инспектор - показывает детали выбранного объекта (задача, проект, домен, идея, заметка, чек-лист)', '🔍');
    });
    inspectorPanel.addEventListener('mouseleave', hideInfoPanel);
  }

  // Подсказки для шорткатов
  const hintSection = document.querySelector('.hint');
  if (hintSection) {
    hintSection.addEventListener('mouseenter', () => {
      showInfoPanel(
        'Шорткаты для быстрого создания: <code>#тег</code> <code>@проект</code> <code>!время</code> <code>~длительность</code> <code>#идея название</code> <code>#заметка название</code>', 
        '⚡', 
        true
      );
    });
    hintSection.addEventListener('mouseleave', hideInfoPanel);
  }

  // Подсказки для модальных окон
  const modalElements = [
    { selector: '#modal', text: 'Модальное окно для диалогов и подтверждений', icon: '💬' },
    { selector: '#modalTitle', text: 'Заголовок модального окна', icon: '📝' },
    { selector: '#modalBody', text: 'Содержимое модального окна', icon: '📄' },
    { selector: '#modalCancel', text: 'Кнопка отмены в модальном окне', icon: '❌' },
    { selector: '#modalOk', text: 'Кнопка подтверждения в модальном окне', icon: '✅' },
    { selector: '#toast', text: 'Уведомления и сообщения пользователю', icon: '🔔' }
  ];

  modalElements.forEach(element => {
    const el = document.querySelector(element.selector);
    if (el) {
      el.addEventListener('mouseenter', () => {
        showInfoPanel(element.text, element.icon);
      });
      el.addEventListener('mouseleave', hideInfoPanel);
    }
  });

  // Подсказки для навигации (перенесены из левой панели)
  const navHints = [
    { text: 'LMB + перетаскивание = панорамирование карты', icon: '🖱️' },
    { text: 'Alt + LMB + перетаскивание = перетаскивание объектов', icon: '🔄' },
    { text: 'Правый клик = контекстное меню для создания объектов', icon: '📋' },
    { text: 'Колесо мыши = масштабирование карты', icon: '🔍' },
    { text: 'Клик по объекту = выделение и показ в инспекторе', icon: '👆' },
    { text: 'Наведение на объекты = подробная информация в подсказке', icon: '💡' },
    { text: 'Двойной клик по чек-листу = открытие для редактирования', icon: '✓' }
  ];

  // Показываем подсказки навигации при наведении на карту
  const canvas = document.getElementById('canvas');
  if (canvas) {
    let hintIndex = 0;
    canvas.addEventListener('mouseenter', () => {
      // Временно отключено для тестирования новых подсказок
      // showInfoPanel(navHints[hintIndex].text, navHints[hintIndex].icon);
      // hintIndex = (hintIndex + 1) % navHints.length;
      console.log('🎯 Canvas hover - showing new tooltips instead of old nav hints');
    });
    canvas.addEventListener('mouseleave', hideInfoPanel);
  }

  // Подсказки для чек-листов
  const checklistElements = [
    { selector: '#checklistPopup', text: 'Всплывающее окно чек-листа с предварительным просмотром', icon: '📋' },
    { selector: '#editChecklistBtn', text: 'Редактировать чек-лист', icon: '✏️' },
    { selector: '#closeChecklistPopup', text: 'Закрыть всплывающее окно чек-листа', icon: '❌' }
  ];

  checklistElements.forEach(element => {
    const el = document.querySelector(element.selector);
    if (el) {
      el.addEventListener('mouseenter', () => {
        showInfoPanel(element.text, element.icon);
      });
      el.addEventListener('mouseleave', hideInfoPanel);
    }
  });

  // Подсказки для объектов на карте (через делегирование событий)
  setupMapObjectTooltips();
}

// Подсказки для объектов на карте
function setupMapObjectTooltips() {
  // Добавляем обработчики для объектов, которые будут создаваться динамически
  document.addEventListener('mouseover', (e) => {
    // Проверяем, является ли элемент объектом на карте
    if (e.target.classList.contains('domain-item') || 
        e.target.classList.contains('project-item') || 
        e.target.classList.contains('task-item') ||
        e.target.classList.contains('idea-item') ||
        e.target.classList.contains('note-item')) {
      
      const type = e.target.classList.contains('domain-item') ? 'domain' :
                   e.target.classList.contains('project-item') ? 'project' :
                   e.target.classList.contains('task-item') ? 'task' :
                   e.target.classList.contains('idea-item') ? 'idea' : 'note';
      
      const tooltips = {
        domain: { text: 'Домен - основная сфера жизни (работа, дом, хобби)', icon: '🌍' },
        project: { text: 'Проект - группа связанных задач в рамках домена', icon: '🎯' },
        task: { text: 'Задача - конкретное действие для выполнения', icon: '✅' },
        idea: { text: 'Идея - творческая мысль или концепция', icon: '🌌' },
        note: { text: 'Заметка - важная информация для запоминания', icon: '📝' }
      };
      
      if (tooltips[type]) {
        showInfoPanel(tooltips[type].text, tooltips[type].icon);
      }
    }
  });
  
  document.addEventListener('mouseout', (e) => {
    if (e.target.classList.contains('domain-item') || 
        e.target.classList.contains('project-item') || 
        e.target.classList.contains('task-item') ||
        e.target.classList.contains('idea-item') ||
        e.target.classList.contains('note-item')) {
      hideInfoPanel();
    }
  });
}

// expose globally for addons/other modules
try { window.showToast = showToast; } catch (_) {}
try { window.clearHotkey = clearHotkey; } catch (_) {}
try { window.openModal = openModal; } catch (_) {}
try { window.getMapNodes = getMapNodes; } catch (_) {}
try { window.showInfoPanel = showInfoPanel; } catch (_) {}
try { window.hideInfoPanel = hideInfoPanel; } catch (_) {}

// Функция для принудительной очистки дубликатов (можно вызвать из консоли)
window.cleanupDuplicates = function() {
  console.log('🧹 Принудительная очистка дубликатов...');
  
  // Проверяем, что state инициализирован
  if (!state || !state.ideas) {
    console.warn('⚠️ State не инициализирован, пропускаем очистку');
    return;
  }
  
  // Очищаем дубликаты идей - более агрессивная очистка
  if (state.ideas && state.ideas.length > 0) {
    const originalCount = state.ideas.length;
    const uniqueIdeas = [];
    const seenIds = new Set();
    const seenTitles = new Set();
    
    state.ideas.forEach(idea => {
      // Проверяем по ID и по названию
      const isDuplicate = seenIds.has(idea.id) || seenTitles.has(idea.title);
      
      if (!isDuplicate && idea.id && idea.title) {
        seenIds.add(idea.id);
        seenTitles.add(idea.title);
        uniqueIdeas.push(idea);
      } else {
        console.warn('🗑️ Удаляем дубликат идеи:', idea.title, idea.id);
      }
    });
    
    if (uniqueIdeas.length !== originalCount) {
      console.log(`✅ Очищено идей: ${originalCount} → ${uniqueIdeas.length}`);
      state.ideas = uniqueIdeas;
    }
  }
  
  // Очищаем дубликаты заметок
  if (state.notes && state.notes.length > 0) {
    const originalCount = state.notes.length;
    const uniqueNotes = [];
    const seenIds = new Set();
    
    state.notes.forEach(note => {
      if (!seenIds.has(note.id) && note.id && note.title) {
        seenIds.add(note.id);
        uniqueNotes.push(note);
      }
    });
    
    if (uniqueNotes.length !== originalCount) {
      console.log(`✅ Очищено заметок: ${originalCount} → ${uniqueNotes.length}`);
      state.notes = uniqueNotes;
    }
  }
  
  // Сохраняем изменения и перерисовываем карту
  saveState();
  requestLayout();
  console.log('✅ Очистка завершена!');
};

// Функции для работы с идеями и заметками
window.createIdea = function() {
  // Проверяем, нет ли уже идеи с таким же названием
  const existingIdea = state.ideas.find(idea => idea.title === 'Новая идея');
  if (existingIdea) {
    console.warn('⚠️ Идея "Новая идея" уже существует, используем существующую');
    return existingIdea;
  }
  
  const idea = {
    id: generateId(),
    title: 'Новая идея',
    content: '',
    domainId: state.activeDomain || 'd3',
    x: Math.random() * 400 - 200,
    y: Math.random() * 400 - 200,
    r: 30,
    color: getRandomIdeaColor(),
    opacity: 0.4,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  // Инициализируем поля иерархии
  // initHierarchyFields(idea, 'idea'); // Временно отключено
  
  state.ideas.push(idea);
  saveState();
  requestLayout(); // Use optimized layout request
  return idea;
};

window.createNote = function() {
  const note = {
    id: generateId(),
    title: 'Новая заметка',
    content: '',
    domainId: state.activeDomain || 'd3',
    x: Math.random() * 400 - 200,
    y: Math.random() * 400 - 200,
    r: 8,
    color: getRandomNoteColor(),
    opacity: 1.0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  // Инициализируем поля иерархии
  // initHierarchyFields(note, 'note'); // Временно отключено
  
  state.notes.push(note);
  saveState();
  requestLayout(); // Use optimized layout request
  return note;
};

window.saveIdea = function(ideaId) {
  const idea = state.ideas.find(i => i.id === ideaId);
  if (!idea) return;
  
  const title = document.getElementById('ideaTitle').value;
  const content = document.getElementById('ideaContent').value;
  const color = document.getElementById('ideaColor').value;
  const size = parseInt(document.getElementById('ideaSize').value);
  const opacity = parseFloat(document.getElementById('ideaOpacity').value);
  
  if (title.trim()) {
    idea.title = title.trim();
    idea.content = content.trim();
    idea.color = color;
    idea.r = size;
    idea.opacity = opacity;
    idea.updatedAt = Date.now();
    saveState();
    layoutMap();
    drawMap();
    closeModal();
    showToast(`Идея "${idea.title}" обновлена`, "ok");
  }
};

window.saveNote = function(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  if (!note) return;
  
  const title = document.getElementById('noteTitle').value;
  const content = document.getElementById('noteContent').value;
  const color = document.getElementById('noteColor').value;
  const size = parseInt(document.getElementById('noteSize').value);
  const opacity = parseFloat(document.getElementById('noteOpacity').value);
  
  if (title.trim()) {
    note.title = title.trim();
    note.content = content.trim();
    note.color = color;
    note.r = size;
    note.opacity = opacity;
    note.updatedAt = Date.now();
    saveState();
    layoutMap();
    drawMap();
    closeModal();
    showToast(`Заметка "${note.title}" обновлена`, "ok");
  }
};

window.deleteIdea = function(ideaId) {
  state.ideas = state.ideas.filter(i => i.id !== ideaId);
  saveState();
  layoutMap();
  drawMap();
  closeModal();
  showToast("Идея удалена", "ok");
};

window.deleteNote = function(noteId) {
  state.notes = state.notes.filter(n => n.id !== noteId);
  saveState();
  layoutMap();
  drawMap();
  closeModal();
  showToast("Заметка удалена", "ok");
};

// Функции сохранения для новых редакторов
window.saveTask = function(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  
  task.title = document.getElementById('taskTitle').value;
  task.description = document.getElementById('taskDescription').value;
  task.status = document.getElementById('taskStatus').value;
  task.priority = document.getElementById('taskPriority').value;
  task.tags = document.getElementById('taskTags').value.split(',').map(t => t.trim()).filter(t => t);
  task.dueDate = document.getElementById('taskDueDate').value ? new Date(document.getElementById('taskDueDate').value).getTime() : null;
  task.estimatedTime = document.getElementById('taskEstimatedTime').value;
  task.updatedAt = Date.now();
  
  saveState();
  layoutMap();
  drawMap();
  updateWip();
  closeModal();
  
  showToast(`Задача "${task.title}" обновлена`, "ok");
};

window.saveProject = function(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  
  project.title = document.getElementById('projectTitle').value;
  project.description = document.getElementById('projectDescription').value;
  project.domainId = document.getElementById('projectDomain').value;
  project.color = document.getElementById('projectColor').value;
  project.updatedAt = Date.now();
  
  saveState();
  layoutMap();
  drawMap();
  closeModal();
  
  showToast(`Проект "${project.title}" обновлен`, "ok");
};

window.deleteTask = function(taskId) {
  if (confirm('Удалить задачу?')) {
    state.tasks = state.tasks.filter(t => t.id !== taskId);
    saveState();
    layoutMap();
    drawMap();
    updateWip();
    closeModal();
  }
};

window.deleteProject = function(projectId) {
  if (confirm('Удалить проект и все его задачи?')) {
    state.tasks = state.tasks.filter(t => t.projectId !== projectId);
    state.projects = state.projects.filter(p => p.id !== projectId);
    saveState();
    layoutMap();
    drawMap();
    closeModal();
  }
};

window.saveDomain = function(domainId) {
  const domain = state.domains.find(d => d.id === domainId);
  if (!domain) return;
  
  domain.title = document.getElementById('domainTitle').value;
  domain.description = document.getElementById('domainDescription').value;
  domain.mood = document.getElementById('domainMood').value;
  domain.color = document.getElementById('domainColor').value;
  domain.updatedAt = Date.now();
  
  saveState();
  layoutMap();
  drawMap();
  renderSidebar();
  closeModal();
  
  showToast(`Домен "${domain.title}" обновлен`, "ok");
};

window.deleteDomain = function(domainId) {
  if (confirm('Удалить домен и все его проекты и задачи?')) {
    state.tasks = state.tasks.filter(t => {
      const project = state.projects.find(p => p.id === t.projectId);
      return project && project.domainId !== domainId;
    });
    state.projects = state.projects.filter(p => p.domainId !== domainId);
    state.domains = state.domains.filter(d => d.id !== domainId);
    saveState();
    layoutMap();
    drawMap();
    renderSidebar();
    closeModal();
  }
};

window.closeModal = function() {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.style.display = 'none';
  }
};

// Импортируем функции редакторов из view_map.js
window.showIdeaEditor = function(idea) {
  // Простая версия для быстрого создания
  const modal = document.getElementById('modal');
  if (!modal) return;
  
  modal.innerHTML = `
    <div class="box idea-editor">
      <div class="title">🌌 Редактировать идею</div>
      <div class="body">
        <div class="form-group">
          <label>Название идеи:</label>
          <input type="text" id="ideaTitle" value="${idea.title}" placeholder="Введите название идеи" class="form-input">
        </div>
        <div class="form-group">
          <label>Описание:</label>
          <textarea id="ideaContent" placeholder="Опишите вашу идею подробнее..." class="form-textarea">${idea.content}</textarea>
        </div>
        <div class="form-group">
          <label>Цвет:</label>
          <div class="color-picker">
            <input type="color" id="ideaColor" value="${idea.color}" class="color-input">
            <div class="color-presets">
              <div class="color-preset" data-color="#ff6b6b" style="background: #ff6b6b;"></div>
              <div class="color-preset" data-color="#4ecdc4" style="background: #4ecdc4;"></div>
              <div class="color-preset" data-color="#45b7d1" style="background: #45b7d1;"></div>
              <div class="color-preset" data-color="#96ceb4" style="background: #96ceb4;"></div>
              <div class="color-preset" data-color="#feca57" style="background: #feca57;"></div>
              <div class="color-preset" data-color="#ff9ff3" style="background: #ff9ff3;"></div>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Размер:</label>
          <input type="range" id="ideaSize" min="20" max="60" value="${idea.r}" class="form-range">
          <span class="size-value">${idea.r}px</span>
        </div>
        <div class="form-group">
          <label>Прозрачность:</label>
          <input type="range" id="ideaOpacity" min="0.1" max="1" step="0.1" value="${idea.opacity}" class="form-range">
          <span class="opacity-value">${Math.round(idea.opacity * 100)}%</span>
        </div>
      </div>
      <div class="buttons">
        <button class="btn" onclick="closeModal()">Отмена</button>
        <button class="btn primary" onclick="saveIdea('${idea.id}')">💾 Сохранить</button>
        <button class="btn danger" onclick="deleteIdea('${idea.id}')">🗑️ Удалить</button>
      </div>
    </div>
    <div class="backdrop"></div>
  `;
  modal.style.display = 'flex';
  
  // Добавляем обработчики для цветовых пресетов
  modal.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const color = preset.dataset.color;
      modal.querySelector('#ideaColor').value = color;
    });
  });
  
  // Добавляем обработчики для слайдеров с дебаунсингом
  let sizeTimeout, opacityTimeout;
  
  modal.querySelector('#ideaSize').addEventListener('input', (e) => {
    modal.querySelector('.size-value').textContent = e.target.value + 'px';
    
    // Дебаунсинг для обновления размера
    clearTimeout(sizeTimeout);
    sizeTimeout = setTimeout(() => {
      idea.r = parseInt(e.target.value);
      requestDraw();
    }, 100);
  });
  
  modal.querySelector('#ideaOpacity').addEventListener('input', (e) => {
    modal.querySelector('.opacity-value').textContent = Math.round(e.target.value * 100) + '%';
    
    // Дебаунсинг для обновления прозрачности
    clearTimeout(opacityTimeout);
    opacityTimeout = setTimeout(() => {
      idea.opacity = parseFloat(e.target.value);
      requestDraw();
    }, 100);
  });
};

window.showNoteEditor = function(note) {
  // Простая версия для быстрого создания
  const modal = document.getElementById('modal');
  if (!modal) return;
  
  modal.innerHTML = `
    <div class="box note-editor">
      <div class="title">🪨 Редактировать заметку</div>
      <div class="body">
        <div class="form-group">
          <label>Название заметки:</label>
          <input type="text" id="noteTitle" value="${note.title}" placeholder="Введите название заметки" class="form-input">
        </div>
        <div class="form-group">
          <label>Содержание:</label>
          <textarea id="noteContent" placeholder="Опишите содержимое заметки..." class="form-textarea">${note.content}</textarea>
        </div>
        <div class="form-group">
          <label>Цвет:</label>
          <div class="color-picker">
            <input type="color" id="noteColor" value="${note.color}" class="color-input">
            <div class="color-presets">
              <div class="color-preset" data-color="#8b7355" style="background: #8b7355;"></div>
              <div class="color-preset" data-color="#a0a0a0" style="background: #a0a0a0;"></div>
              <div class="color-preset" data-color="#6c757d" style="background: #6c757d;"></div>
              <div class="color-preset" data-color="#495057" style="background: #495057;"></div>
              <div class="color-preset" data-color="#343a40" style="background: #343a40;"></div>
              <div class="color-preset" data-color="#212529" style="background: #212529;"></div>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Размер:</label>
          <input type="range" id="noteSize" min="5" max="20" value="${note.r}" class="form-range">
          <span class="size-value">${note.r}px</span>
        </div>
        <div class="form-group">
          <label>Прозрачность:</label>
          <input type="range" id="noteOpacity" min="0.1" max="1" step="0.1" value="${note.opacity}" class="form-range">
          <span class="opacity-value">${Math.round(note.opacity * 100)}%</span>
        </div>
      </div>
      <div class="buttons">
        <button class="btn" onclick="closeModal()">Отмена</button>
        <button class="btn primary" onclick="saveNote('${note.id}')">💾 Сохранить</button>
        <button class="btn danger" onclick="deleteNote('${note.id}')">🗑️ Удалить</button>
      </div>
    </div>
    <div class="backdrop"></div>
  `;
  modal.style.display = 'flex';
  
  // Добавляем обработчики для цветовых пресетов
  modal.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const color = preset.dataset.color;
      modal.querySelector('#noteColor').value = color;
    });
  });
  
  // Добавляем обработчики для слайдеров с дебаунсингом
  let sizeTimeout, opacityTimeout;
  
  modal.querySelector('#noteSize').addEventListener('input', (e) => {
    modal.querySelector('.size-value').textContent = e.target.value + 'px';
    
    // Дебаунсинг для обновления размера
    clearTimeout(sizeTimeout);
    sizeTimeout = setTimeout(() => {
      note.r = parseInt(e.target.value);
      requestDraw();
    }, 100);
  });
  
  modal.querySelector('#noteOpacity').addEventListener('input', (e) => {
    modal.querySelector('.opacity-value').textContent = Math.round(e.target.value * 100) + '%';
    
    // Дебаунсинг для обновления прозрачности
    clearTimeout(opacityTimeout);
    opacityTimeout = setTimeout(() => {
      note.opacity = parseFloat(e.target.value);
      requestDraw();
    }, 100);
  });
};

// Расширенный редактор задач
window.showTaskEditor = function(task) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  
  modal.innerHTML = `
    <div class="box task-editor">
      <div class="title">➕ Редактировать задачу</div>
      <div class="body">
        <div class="form-group">
          <label>Название задачи:</label>
          <input type="text" id="taskTitle" value="${task.title}" placeholder="Введите название задачи" class="form-input">
        </div>
        <div class="form-group">
          <label>Описание:</label>
          <textarea id="taskDescription" placeholder="Опишите задачу подробнее..." class="form-textarea">${task.description || ''}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Статус:</label>
            <select id="taskStatus" class="form-select">
              <option value="backlog" ${task.status === 'backlog' ? 'selected' : ''}>Backlog</option>
              <option value="today" ${task.status === 'today' ? 'selected' : ''}>Сегодня</option>
              <option value="doing" ${task.status === 'doing' ? 'selected' : ''}>В работе</option>
              <option value="done" ${task.status === 'done' ? 'selected' : ''}>Готово</option>
            </select>
          </div>
          <div class="form-group">
            <label>Приоритет:</label>
            <select id="taskPriority" class="form-select">
              <option value="p1" ${task.priority === 'p1' ? 'selected' : ''}>P1 - Критический</option>
              <option value="p2" ${task.priority === 'p2' ? 'selected' : ''}>P2 - Высокий</option>
              <option value="p3" ${task.priority === 'p3' ? 'selected' : ''}>P3 - Средний</option>
              <option value="p4" ${task.priority === 'p4' ? 'selected' : ''}>P4 - Низкий</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Теги (через запятую):</label>
          <input type="text" id="taskTags" value="${(task.tags || []).join(', ')}" placeholder="важное, срочное, проект" class="form-input">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Срок выполнения:</label>
            <input type="date" id="taskDueDate" value="${task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''}" class="form-input">
          </div>
          <div class="form-group">
            <label>Оценка времени:</label>
            <input type="text" id="taskEstimatedTime" value="${task.estimatedTime || ''}" placeholder="2ч, 30м, 1д" class="form-input">
          </div>
        </div>
      </div>
      <div class="buttons">
        <button class="btn" onclick="closeModal()">Отмена</button>
        <button class="btn primary" onclick="saveTask('${task.id}')">💾 Сохранить</button>
        <button class="btn danger" onclick="deleteTask('${task.id}')">🗑️ Удалить</button>
      </div>
    </div>
    <div class="backdrop"></div>
  `;
  modal.style.display = 'flex';
};

// Расширенный редактор проектов
window.showProjectEditor = function(project) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  
  const domainOptions = state.domains.map(domain => 
    `<option value="${domain.id}" ${project.domainId === domain.id ? 'selected' : ''}>${domain.title}</option>`
  ).join('');
  
  modal.innerHTML = `
    <div class="box project-editor">
      <div class="title">🎯 Редактировать проект</div>
      <div class="body">
        <div class="form-group">
          <label>Название проекта:</label>
          <input type="text" id="projectTitle" value="${project.title}" placeholder="Введите название проекта" class="form-input">
        </div>
        <div class="form-group">
          <label>Описание:</label>
          <textarea id="projectDescription" placeholder="Опишите проект подробнее..." class="form-textarea">${project.description || ''}</textarea>
        </div>
        <div class="form-group">
          <label>Домен:</label>
          <select id="projectDomain" class="form-select">
            ${domainOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Цвет проекта:</label>
          <div class="color-picker">
            <input type="color" id="projectColor" value="${project.color || '#4CAF50'}" class="color-input">
            <div class="color-presets">
              <div class="color-preset" data-color="#4CAF50" style="background: #4CAF50;"></div>
              <div class="color-preset" data-color="#2196F3" style="background: #2196F3;"></div>
              <div class="color-preset" data-color="#FF9800" style="background: #FF9800;"></div>
              <div class="color-preset" data-color="#9C27B0" style="background: #9C27B0;"></div>
              <div class="color-preset" data-color="#F44336" style="background: #F44336;"></div>
              <div class="color-preset" data-color="#00BCD4" style="background: #00BCD4;"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="buttons">
        <button class="btn" onclick="closeModal()">Отмена</button>
        <button class="btn primary" onclick="saveProject('${project.id}')">💾 Сохранить</button>
        <button class="btn danger" onclick="deleteProject('${project.id}')">🗑️ Удалить</button>
      </div>
    </div>
    <div class="backdrop"></div>
  `;
  modal.style.display = 'flex';
  
  // Добавляем обработчики для цветовых пресетов
  modal.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const color = preset.dataset.color;
      modal.querySelector('#projectColor').value = color;
    });
  });
};

window.showDomainEditor = function(domain) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  
  const moodOptions = [
    { value: 'balance', label: 'Баланс', emoji: '⚖️' },
    { value: 'energy', label: 'Энергия', emoji: '⚡' },
    { value: 'focus', label: 'Фокус', emoji: '🎯' },
    { value: 'creativity', label: 'Творчество', emoji: '🎨' },
    { value: 'growth', label: 'Рост', emoji: '🌱' },
    { value: 'rest', label: 'Отдых', emoji: '😴' }
  ];
  
  const moodSelect = moodOptions.map(mood => 
    `<option value="${mood.value}" ${domain.mood === mood.value ? 'selected' : ''}>${mood.emoji} ${mood.label}</option>`
  ).join('');
  
  modal.innerHTML = `
    <div class="modal-content">
      <h2>🌍 Редактировать домен</h2>
      <div class="form-group">
        <label for="domainTitle">Название домена:</label>
        <input type="text" id="domainTitle" value="${domain.title}" placeholder="Введите название домена" autofocus>
      </div>
      <div class="form-group">
        <label for="domainDescription">Описание:</label>
        <textarea id="domainDescription" rows="3" placeholder="Опишите домен подробнее...">${domain.description || ''}</textarea>
      </div>
      <div class="form-group">
        <label for="domainMood">Настроение домена:</label>
        <select id="domainMood">
          ${moodSelect}
        </select>
      </div>
      <div class="form-group">
        <label for="domainColor">Цвет домена:</label>
        <div class="color-picker">
          <input type="color" id="domainColor" value="${domain.color || '#6366F1'}">
          <div class="color-presets">
            <div class="color-preset" data-color="#6366F1" style="background: #6366F1;"></div>
            <div class="color-preset" data-color="#8B5CF6" style="background: #8B5CF6;"></div>
            <div class="color-preset" data-color="#EC4899" style="background: #EC4899;"></div>
            <div class="color-preset" data-color="#F59E0B" style="background: #F59E0B;"></div>
            <div class="color-preset" data-color="#10B981" style="background: #10B981;"></div>
            <div class="color-preset" data-color="#3B82F6" style="background: #3B82F6;"></div>
            <div class="color-preset" data-color="#2dd4bf" style="background: #2dd4bf;"></div>
            <div class="color-preset" data-color="#ef4444" style="background: #ef4444;"></div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="cancelDomainEdit">Отмена</button>
        <button class="btn primary" id="saveDomainEdit">💾 Сохранить</button>
        <button class="btn danger" id="deleteDomainEdit">🗑️ Удалить</button>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  
  // Добавляем обработчики для цветовых пресетов
  modal.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const color = preset.dataset.color;
      modal.querySelector('#domainColor').value = color;
      // Обновляем визуальное выделение
      modal.querySelectorAll('.color-preset').forEach(p => p.classList.remove('selected'));
      preset.classList.add('selected');
    });
  });
  
  // Выделяем текущий цвет
  const currentColor = domain.color || '#6366F1';
  const currentPreset = modal.querySelector(`.color-preset[data-color="${currentColor}"]`);
  if (currentPreset) {
    currentPreset.classList.add('selected');
  }
  
  // Обработчики кнопок
  document.getElementById('cancelDomainEdit').onclick = () => {
    closeModal();
  };
  
  document.getElementById('saveDomainEdit').onclick = () => {
    const title = document.getElementById('domainTitle').value.trim();
    const description = document.getElementById('domainDescription').value.trim();
    const mood = document.getElementById('domainMood').value;
    const color = document.getElementById('domainColor').value;
    
    if (!title) {
      showToast('Введите название домена', 'error');
      return;
    }
    
    domain.title = title;
    domain.description = description;
    domain.mood = mood;
    domain.color = color;
    domain.updatedAt = Date.now();
    
    saveState();
    if (window.layoutMap) window.layoutMap();
    if (window.drawMap) window.drawMap();
    if (window.renderSidebar) window.renderSidebar();
    
    closeModal();
    showToast('Домен обновлен', 'ok');
  };
  
  document.getElementById('deleteDomainEdit').onclick = () => {
    if (confirm(`Удалить домен "${domain.title}"? Все проекты и задачи в нем будут также удалены.`)) {
      state.domains = state.domains.filter(d => d.id !== domain.id);
      state.projects = state.projects.filter(p => p.domainId !== domain.id);
      state.tasks = state.tasks.filter(t => t.domainId !== domain.id);
      state.ideas = state.ideas.filter(i => i.domainId !== domain.id);
      state.notes = state.notes.filter(n => n.domainId !== domain.id);
      
      if (state.activeDomain === domain.id) {
        state.activeDomain = state.domains[0]?.id || null;
      }
      
      saveState();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
      if (window.renderSidebar) window.renderSidebar();
      
      closeModal();
      showToast('Домен удален', 'ok');
    }
  };
  
  // Enter для сохранения
  document.getElementById('domainTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('saveDomainEdit').click();
    }
  });
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
      
      // Calculate mood for this domain
      let mood, moodColor, moodEmoji;
      try {
        mood = getDomainMood(d.id);
        moodColor = getMoodColor(mood);
        moodEmoji = {
          crisis: '🚨',
          pressure: '⚠️', 
          growth: '📈',
          balance: '⚖️'
        }[mood] || '⚖️';
      } catch (e) {
        mood = 'balance';
        moodColor = '#3b82f6';
        moodEmoji = '⚖️';
      }
      
      return `<div class="row" data-domain="${d.id}" ${act}>
      <div class="dot" style="background:${moodColor};box-shadow: 0 0 8px ${moodColor}40"></div>
      <div style="flex:1;min-width:0">
        <div class="title" style="font-weight:500;margin-bottom:2px">
          ${moodEmoji} ${d.title}
        </div>
        <div style="display:flex;gap:8px;font-size:10px;color:var(--muted)">
          <span>${projectCount} проектов</span>
          <span>${taskCount} задач</span>
          <span style="color:${moodColor}">${mood}</span>
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
        <span style="font-size:9px;color:var(--muted);background:rgba(157,177,201,0.1);padding:2px 4px;border-radius:3px">map ${state.settings.mapVersion || 'v2'}</span>
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
      showDomainCreationModal();
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
  const searchInput = document.getElementById("searchInput");
  const searchButton = document.getElementById("searchButton");
  
  if (searchInput && searchButton) {
    // Store current value to prevent it from being cleared
    const currentValue = searchInput.value;
    
    // Search function
    const performSearch = () => {
      const query = searchInput.value.trim();
      if (query) {
        console.log('🔍 Searching for:', query);
        if (window.mapApi && window.mapApi.searchObjects) {
          window.mapApi.searchObjects(query);
        }
      }
    };
    
    // Search button click
    searchButton.addEventListener("click", performSearch);
    
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
    
    // Handle search input
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.target.value = "";
        state.searchQuery = null;
        state.searchResults = null;
        updateDomainsList();
        updateStatistics();
        if (window.layoutMap) window.layoutMap();
        if (window.drawMap) window.drawMap();
      } else if (e.key === "Enter") {
      e.preventDefault();
        performSearch();
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
          `<div><a href="ideas/IDEAS.md" target="_blank" rel="noopener">🚀 Открыть IDEAS</a></div>` +
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
  
  // Установка темной темы по умолчанию
  document.documentElement.setAttribute('data-theme', 'dark');
  
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
          case 'display':
            openDisplayModal();
            break;
          case 'hierarchy':
            openHierarchySettingsModal();
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

// Show idea editor modal
function showIdeaEditor(idea) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  
  modal.innerHTML = `
    <div class="modal-content">
      <h2>Редактировать идею</h2>
      <div class="form-group">
        <label for="ideaTitle">Название:</label>
        <input type="text" id="ideaTitle" value="${idea.title}" placeholder="Название идеи">
      </div>
      <div class="form-group">
        <label for="ideaContent">Содержание:</label>
        <textarea id="ideaContent" rows="4" placeholder="Описание идеи...">${idea.content || ''}</textarea>
      </div>
      <div class="form-group">
        <label for="ideaColor">Цвет:</label>
        <input type="color" id="ideaColor" value="${idea.color || '#8b5cf6'}">
      </div>
      <div class="modal-actions">
        <button class="btn primary" id="saveIdea">Сохранить</button>
        <button class="btn" id="cancelIdea">Отмена</button>
        <button class="btn danger" id="deleteIdea">Удалить</button>
      </div>
    </div>
  `;
  
  modal.style.display = 'flex';
  
  // Event handlers
  document.getElementById('saveIdea').onclick = () => {
    idea.title = document.getElementById('ideaTitle').value;
    idea.content = document.getElementById('ideaContent').value;
    idea.color = document.getElementById('ideaColor').value;
    idea.updatedAt = Date.now();
    saveState();
    if (window.layoutMap) window.layoutMap();
    if (window.drawMap) window.drawMap();
    closeModal();
    showToast('Идея сохранена', 'ok');
  };
  
  document.getElementById('cancelIdea').onclick = () => {
    closeModal();
  };
  
  document.getElementById('deleteIdea').onclick = () => {
    if (confirm('Удалить идею?')) {
      state.ideas = state.ideas.filter(i => i.id !== idea.id);
      saveState();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
      closeModal();
      showToast('Идея удалена', 'ok');
    }
  };
}

// Show domain creation modal
function showDomainCreationModal() {
  const modal = document.getElementById('modal');
  if (!modal) return;
  
  const moodOptions = [
    { value: 'balance', label: 'Баланс', emoji: '⚖️' },
    { value: 'energy', label: 'Энергия', emoji: '⚡' },
    { value: 'focus', label: 'Фокус', emoji: '🎯' },
    { value: 'creativity', label: 'Творчество', emoji: '🎨' },
    { value: 'growth', label: 'Рост', emoji: '🌱' },
    { value: 'rest', label: 'Отдых', emoji: '😴' }
  ];
  
  const moodSelect = moodOptions.map(mood => 
    `<option value="${mood.value}">${mood.emoji} ${mood.label}</option>`
  ).join('');
  
  modal.innerHTML = `
    <div class="modal-content">
      <h2>🌍 Создать домен</h2>
      <div class="form-group">
        <label for="domainTitle">Название домена:</label>
        <input type="text" id="domainTitle" placeholder="Введите название домена" autofocus>
      </div>
      <div class="form-group">
        <label for="domainDescription">Описание (необязательно):</label>
        <textarea id="domainDescription" rows="3" placeholder="Краткое описание домена..."></textarea>
      </div>
      <div class="form-group">
        <label for="domainMood">Настроение домена:</label>
        <select id="domainMood">
          ${moodSelect}
        </select>
      </div>
      <div class="form-group">
        <label for="domainColor">Цвет домена:</label>
        <div class="color-picker">
          <input type="color" id="domainColor" value="#2dd4bf">
          <div class="color-presets">
            <div class="color-preset" data-color="#2dd4bf" style="background: #2dd4bf"></div>
            <div class="color-preset" data-color="#3b82f6" style="background: #3b82f6"></div>
            <div class="color-preset" data-color="#8b5cf6" style="background: #8b5cf6"></div>
            <div class="color-preset" data-color="#f59e0b" style="background: #f59e0b"></div>
            <div class="color-preset" data-color="#ef4444" style="background: #ef4444"></div>
            <div class="color-preset" data-color="#10b981" style="background: #10b981"></div>
            <div class="color-preset" data-color="#f97316" style="background: #f97316"></div>
            <div class="color-preset" data-color="#06b6d4" style="background: #06b6d4"></div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="cancelDomainBtn">Отмена</button>
        <button class="btn primary" id="createDomainBtn">🌍 Создать домен</button>
      </div>
    </div>
  `;
  
  modal.style.display = 'flex';
  
  // Event handlers
  document.getElementById('createDomainBtn').onclick = () => {
    const title = document.getElementById('domainTitle').value.trim();
    const description = document.getElementById('domainDescription').value.trim();
    const mood = document.getElementById('domainMood').value;
    const color = document.getElementById('domainColor').value;
    
    if (!title) {
      showToast('Введите название домена', 'error');
      return;
    }
    
    // Create domain
    const domain = {
      id: generateId(),
      title: title,
      description: description,
      mood: mood,
      color: color,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    state.domains.push(domain);
    state.activeDomain = domain.id;
    saveState();
    
    if (window.layoutMap) window.layoutMap();
    if (window.drawMap) window.drawMap();
    if (window.renderSidebar) window.renderSidebar();
    
    closeModal();
    showToast(`Домен "${title}" создан`, 'ok');
  };
  
  document.getElementById('cancelDomainBtn').onclick = () => {
    closeModal();
  };
  
  // Color preset handlers
  document.querySelectorAll('.color-preset').forEach(preset => {
    preset.onclick = () => {
      const color = preset.dataset.color;
      document.getElementById('domainColor').value = color;
      // Update visual feedback
      document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('selected'));
      preset.classList.add('selected');
    };
  });
  
  // Set initial selected color
  document.querySelector('.color-preset[data-color="#2dd4bf"]').classList.add('selected');
  
  // Enter key to create
  document.getElementById('domainTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('createDomainBtn').click();
    }
  });
}

// Show note editor modal
function showNoteEditor(note) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  
  modal.innerHTML = `
    <div class="modal-content">
      <h2>Редактировать заметку</h2>
      <div class="form-group">
        <label for="noteTitle">Название:</label>
        <input type="text" id="noteTitle" value="${note.title}" placeholder="Название заметки">
      </div>
      <div class="form-group">
        <label for="noteContent">Содержание:</label>
        <textarea id="noteContent" rows="4" placeholder="Содержание заметки...">${note.content || ''}</textarea>
      </div>
      <div class="form-group">
        <label for="noteColor">Цвет:</label>
        <input type="color" id="noteColor" value="${note.color || '#10b981'}">
      </div>
      <div class="modal-actions">
        <button class="btn primary" id="saveNote">Сохранить</button>
        <button class="btn" id="cancelNote">Отмена</button>
        <button class="btn danger" id="deleteNote">Удалить</button>
      </div>
    </div>
  `;
  
  modal.style.display = 'flex';
  
  // Event handlers
  document.getElementById('saveNote').onclick = () => {
    note.title = document.getElementById('noteTitle').value;
    note.content = document.getElementById('noteContent').value;
    note.color = document.getElementById('noteColor').value;
    note.updatedAt = Date.now();
    saveState();
    if (window.layoutMap) window.layoutMap();
    if (window.drawMap) window.drawMap();
    closeModal();
    showToast('Заметка сохранена', 'ok');
  };
  
  document.getElementById('cancelNote').onclick = () => {
    closeModal();
  };
  
  document.getElementById('deleteNote').onclick = () => {
    if (confirm('Удалить заметку?')) {
      state.notes = state.notes.filter(n => n.id !== note.id);
      saveState();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
      closeModal();
      showToast('Заметка удалена', 'ok');
    }
  };
}




const escapeChecklistHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[ch] || ch));

// Убрана сложная система попапов - теперь используется простой быстрый просмотр


// Убрана функция toggleChecklistItemInPopup - больше не нужна

function showChecklistEditor(checklist) {
  const modal = document.getElementById('modal');
  if (!modal || !checklist) return;

  // Закрываем возможные всплывающие окна чек-листа, чтобы не было дублирующихся крестиков
  try { if (typeof window.hideChecklistToggleView === 'function') window.hideChecklistToggleView(); } catch(_) {}
  try { if (typeof window.closeChecklistWindow === 'function') window.closeChecklistWindow(); } catch(_) {}

  // Помечаем, что открыт редактор чек-листа (блокируем всплывающие окна)
  try { window.isChecklistEditorOpen = true; } catch(_) {}

  const originalItems = new Map((checklist.items || []).map((item) => [item.id, item]));

  const renderRow = (item) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'checklist-editor-item';
    wrapper.dataset.itemId = item.id || `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    wrapper.innerHTML = `
      <div class="checklist-item-content">
        <label class="checklist-editor-check">
          <input type="checkbox" class="checklist-editor-item-check" ${item.completed ? 'checked' : ''}>
          <span class="checkmark"></span>
        </label>
        <input type="text" class="checklist-editor-item-text" value="${escapeChecklistHtml(item.text || '')}" placeholder="Введите текст элемента">
        <div class="item-actions">
          <button type="button" class="btn-icon item-move-up" title="Переместить вверх">↑</button>
          <button type="button" class="btn-icon item-move-down" title="Переместить вниз">↓</button>
          <button type="button" class="btn-icon checklist-editor-remove" title="Удалить элемент">×</button>
        </div>
      </div>
    `;
    // drag & drop поддержка
    wrapper.setAttribute('draggable', 'true');
    return wrapper;
  };

  const safeColor = /^#[0-9a-fA-F]{6}$/.test(checklist.color || '') ? checklist.color : '#3b82f6';

  modal.innerHTML = `
    <div class="modal-content checklist-editor">
      <div class="modal-header">
        <h2>Редактор чек-листа</h2>
        <div id="editorProgress" style="position:absolute; right:56px; top:24px; font-size:12px; color:#9ca3af;"></div>
        <button class="btn-icon" id="closeChecklistEditor" title="Закрыть">×</button>
      </div>
      
      <div class="checklist-editor-body">
        <div class="form-group">
          <label for="checklistTitle">Название чек-листа</label>
          <div class="input-group">
            <input type="text" id="checklistTitle" value="${escapeChecklistHtml(checklist.title || '')}" placeholder="Введите название чек-листа" class="form-input">
            <button type="button" class="btn-icon input-clear" id="clearTitle" title="Очистить">×</button>
          </div>
        </div>
        
        <div class="form-group">
          <label for="checklistColor">Цвет чек-листа</label>
          <div class="color-picker-group">
            <input type="color" id="checklistColor" value="${safeColor}" class="color-input">
            <div class="color-presets">
              <div class="color-preset" data-color="#3b82f6" style="background: #3b82f6" title="Синий"></div>
              <div class="color-preset" data-color="#10b981" style="background: #10b981" title="Зеленый"></div>
              <div class="color-preset" data-color="#f59e0b" style="background: #f59e0b" title="Оранжевый"></div>
              <div class="color-preset" data-color="#ef4444" style="background: #ef4444" title="Красный"></div>
              <div class="color-preset" data-color="#8b5cf6" style="background: #8b5cf6" title="Фиолетовый"></div>
              <div class="color-preset" data-color="#06b6d4" style="background: #06b6d4" title="Голубой"></div>
            </div>
          </div>
        </div>
        
        <div class="form-group">
          <label>Элементы чек-листа</label>
          <div class="checklist-items-container">
            <div class="checklist-items-editor" id="checklistItemsEditor"></div>
            <div class="add-item-section">
              <input type="text" id="newItemInput" placeholder="Введите новый элемент и нажмите Enter" class="form-input">
              <button class="btn secondary" type="button" id="addChecklistItem">+ Добавить</button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="modal-actions">
        <button class="btn primary" id="saveChecklist">💾 Сохранить</button>
        <button class="btn" id="cancelChecklist">❌ Отмена</button>
        <button class="btn danger" id="deleteChecklist">🗑️ Удалить</button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  const itemsEditor = document.getElementById('checklistItemsEditor');
  const addBtn = document.getElementById('addChecklistItem');
  const newItemInput = document.getElementById('newItemInput');
  const saveBtn = document.getElementById('saveChecklist');
  const cancelBtn = document.getElementById('cancelChecklist');
  const deleteBtn = document.getElementById('deleteChecklist');
  const closeBtn = document.getElementById('closeChecklistEditor');
  const titleInput = document.getElementById('checklistTitle');
  const colorInput = document.getElementById('checklistColor');
  const clearTitleBtn = document.getElementById('clearTitle');
  const editorProgress = document.getElementById('editorProgress');

  // Глобальный Esc для редактора (работает во всех полях)
  const onEditorKeyDownGlobal = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      try { if (typeof window.hideChecklistToggleView === 'function') window.hideChecklistToggleView(); } catch(_) {}
      try { window.isChecklistEditorOpen = false; } catch(_) {}
      document.removeEventListener('keydown', onEditorKeyDownGlobal, true);
      closeModal();
    }
  };
  document.addEventListener('keydown', onEditorKeyDownGlobal, true);

  // Инициализация элементов
  (checklist.items || []).forEach((item) => {
    itemsEditor.appendChild(renderRow(item));
  });
  if (!itemsEditor.children.length) {
    itemsEditor.appendChild(renderRow({ text: '', completed: false }));
  }

  // Обновление прогресса в шапке
  const updateProgress = () => {
    try {
      const rows = Array.from(itemsEditor.querySelectorAll('.checklist-editor-item'));
      const validRows = rows.filter(r => (r.querySelector('.checklist-editor-item-text')?.value || '').trim().length > 0);
      const total = validRows.length;
      const completed = validRows.filter(r => r.querySelector('.checklist-editor-item-check')?.checked).length;
      if (editorProgress) editorProgress.textContent = `Прогресс: ${completed}/${total}`;
    } catch(_) {}
  };
  updateProgress();

  // Обработчики для элементов чек-листа
  itemsEditor.addEventListener('click', (event) => {
    const row = event.target.closest('div.checklist-editor-item');
    if (!row) return;

    if (event.target.classList.contains('checklist-editor-remove')) {
      row.remove();
      if (!itemsEditor.children.length) {
        itemsEditor.appendChild(renderRow({ text: '', completed: false }));
      }
      updateProgress();
    } else if (event.target.classList.contains('item-move-up')) {
      const prevRow = row.previousElementSibling;
      if (prevRow) {
        itemsEditor.insertBefore(row, prevRow);
      }
    } else if (event.target.classList.contains('item-move-down')) {
      const nextRow = row.nextElementSibling;
      if (nextRow) {
        itemsEditor.insertBefore(nextRow, row);
      }
    }
  });

  // Обновлять прогресс при изменениях
  itemsEditor.addEventListener('change', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('checklist-editor-item-check')) {
      updateProgress();
    }
  });
  itemsEditor.addEventListener('input', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('checklist-editor-item-text')) {
      updateProgress();
    }
  });

  // Drag & Drop сортировка
  let draggedRow = null;
  itemsEditor.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.checklist-editor-item');
    if (!row) return;
    draggedRow = row;
    row.classList.add('dragging');
    try { e.dataTransfer.effectAllowed = 'move'; } catch(_) {}
  });
  itemsEditor.addEventListener('dragend', () => {
    if (draggedRow) draggedRow.classList.remove('dragging');
    draggedRow = null;
    updateProgress();
  });
  itemsEditor.addEventListener('dragover', (e) => {
    if (!draggedRow) return;
    e.preventDefault();
    const target = e.target.closest('.checklist-editor-item');
    if (!target || target === draggedRow) return;
    const rect = target.getBoundingClientRect();
    const next = (e.clientY - rect.top) > rect.height / 2;
    itemsEditor.insertBefore(draggedRow, next ? target.nextSibling : target);
  });

  // Обработчик для добавления элементов через Enter
  newItemInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNewItem();
    }
  });

  // Функция добавления нового элемента
  const addNewItem = () => {
    const text = newItemInput.value.trim();
    if (!text) return;
    
    const row = renderRow({ text, completed: false });
    itemsEditor.appendChild(row);
    newItemInput.value = '';
    newItemInput.focus();
    
    // Фокус на новый элемент
    const input = row.querySelector('.checklist-editor-item-text');
    if (input) {
      input.focus();
      input.select();
    }
    updateProgress();
  };

  addBtn.onclick = addNewItem;

  // Очистка названия
  clearTitleBtn.onclick = () => {
    titleInput.value = '';
    titleInput.focus();
  };

  // Обработчики цветовых пресетов
  document.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const color = preset.dataset.color;
      colorInput.value = color;
      // Визуальная обратная связь
      preset.style.transform = 'scale(1.1)';
      setTimeout(() => preset.style.transform = 'scale(1)', 150);
    });
  });

  const finalizeChecklist = () => {
    console.log('💾 Saving checklist:', checklist.id); // Debug
    const updatedItems = [];
    itemsEditor.querySelectorAll('.checklist-editor-item').forEach((row) => {
      const textInput = row.querySelector('.checklist-editor-item-text');
      if (!textInput) return;
      const value = textInput.value.trim();
      if (!value) return;
      const checkbox = row.querySelector('.checklist-editor-item-check');
      let itemId = row.dataset.itemId;
      if (!itemId || itemId.startsWith('new-')) {
        itemId = generateId();
      }
      const original = originalItems.get(itemId);
      updatedItems.push({
        id: itemId,
        text: value,
        completed: checkbox ? checkbox.checked : false,
        createdAt: original?.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
    });

    console.log('💾 Updated items:', updatedItems); // Debug
    
    checklist.title = titleInput.value.trim() || checklist.title || 'Checklist';
    checklist.color = colorInput.value || '#3b82f6';
    checklist.items = updatedItems;
    checklist.updatedAt = Date.now();

    console.log('💾 Final checklist:', checklist); // Debug

    try {
      saveState();
      console.log('💾 State saved successfully'); // Debug
    } catch (error) {
      console.error('💾 Error saving state:', error); // Debug
    }
    if (window.layoutMap) window.layoutMap();
    if (window.drawMap) window.drawMap();
    if (window.renderSidebar) window.renderSidebar();
    try { window.isChecklistEditorOpen = false; } catch(_) {}
    try { document.removeEventListener('keydown', onEditorKeyDownGlobal, true); } catch(_) {}
    closeModal();
    showToast('Чек-лист сохранен', 'ok');
  };

  saveBtn.onclick = finalizeChecklist;
  titleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      finalizeChecklist();
    }
  });

  cancelBtn.onclick = () => { try { window.isChecklistEditorOpen = false; } catch(_) {} try { document.removeEventListener('keydown', onEditorKeyDownGlobal, true); } catch(_) {} closeModal(); };
  closeBtn.onclick = () => { try { window.isChecklistEditorOpen = false; } catch(_) {} try { document.removeEventListener('keydown', onEditorKeyDownGlobal, true); } catch(_) {} closeModal(); };

  deleteBtn.onclick = () => {
    if (!confirm('Удалить чек-лист?')) return;
    state.checklists = state.checklists.filter((item) => item.id !== checklist.id);
    try {
      saveState();
    } catch (_) {}
    if (window.layoutMap) window.layoutMap();
    if (window.drawMap) window.drawMap();
    if (window.renderSidebar) window.renderSidebar();
    try { window.isChecklistEditorOpen = false; } catch(_) {}
    try { document.removeEventListener('keydown', onEditorKeyDownGlobal, true); } catch(_) {}
    closeModal();
    showToast('Checklist deleted', 'ok');
  };

  // Горячие клавиши в редакторе: Esc — закрыть, Enter в строке — подтвердить
  const onKeyDown = (e) => {
    // Esc закрывает редактор (если фокус не в поле подтверждения системного диалога)
    if (e.key === 'Escape') {
      e.preventDefault();
      try { if (typeof window.hideChecklistToggleView === 'function') window.hideChecklistToggleView(); } catch(_) {}
      try { window.isChecklistEditorOpen = false; } catch(_) {}
      closeModal();
      return;
    }
    // Enter в поле элемента — подтверждает ввод и переходит к следующей строке / добавляет новую
    if (e.key === 'Enter') {
      const inputEl = e.target && e.target.classList && e.target.classList.contains('checklist-editor-item-text') ? e.target : null;
      if (inputEl) {
        e.preventDefault();
        inputEl.blur();
        // если это последняя строка и не пустая — добавим новую
        const row = inputEl.closest('.checklist-editor-item');
        if (row && row.nextElementSibling == null && inputEl.value.trim()) {
          const rowNew = renderRow({ text: '', completed: false });
          itemsEditor.appendChild(rowNew);
          const nextInput = rowNew.querySelector('.checklist-editor-item-text');
          if (nextInput) nextInput.focus();
        } else if (row && row.nextElementSibling) {
          const nextInput = row.nextElementSibling.querySelector('.checklist-editor-item-text');
          if (nextInput) nextInput.focus();
        }
      }
    }
  };
  itemsEditor.addEventListener('keydown', onKeyDown, true);

  // При закрытии окна — снять обработчик
  const _origClose = closeBtn.onclick;
  closeBtn.onclick = () => { itemsEditor.removeEventListener('keydown', onKeyDown, true); if (_origClose) _origClose(); };
  const _origCancel = cancelBtn.onclick;
  cancelBtn.onclick = () => { itemsEditor.removeEventListener('keydown', onKeyDown, true); if (_origCancel) _origCancel(); };
}

// Убраны экспорты неиспользуемых функций попапов
window.showChecklistEditor = showChecklistEditor;
// Убраны неиспользуемые функции



// Setup creation panel buttons
function setupCreationPanel() {
  console.log('🔧 setupCreationPanel called');
  // Create Task button
  const createTaskBtn = document.getElementById('createTaskBtn');
  if (createTaskBtn) {
    createTaskBtn.addEventListener('click', () => {
      const newTask = {
        id: generateId(),
        title: 'Новая задача',
        description: '',
        projectId: null,
        status: 'backlog',
        priority: 'p3',
        dueDate: null,
        estimatedTime: null,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      state.tasks.push(newTask);
      saveState();
      requestLayout(); // Update map layout with new task
      showTaskEditor(newTask);
    });
  }
  
  // Create Project button
  const createProjectBtn = document.getElementById('createProjectBtn');
  if (createProjectBtn) {
    createProjectBtn.addEventListener('click', () => {
      const domainId = state.activeDomain || state.domains[0]?.id || null;
      if (!domainId) {
        showToast("Сначала выберите домен", "warn");
        return;
      }
      
      const newProject = {
        id: generateId(),
        domainId: domainId,
        title: 'Новый проект',
        description: '',
        color: getRandomProjectColor(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      state.projects.push(newProject);
      saveState();
      requestLayout(); // Update map layout with new project
      showProjectEditor(newProject);
    });
  }
  
  // Create Idea button
  const createIdeaBtn = document.getElementById('createIdeaBtn');
  if (createIdeaBtn) {
    createIdeaBtn.addEventListener('click', () => {
      const idea = createIdea();
      showIdeaEditor(idea);
    });
  }
  
  // Create Note button
  const createNoteBtn = document.getElementById('createNoteBtn');
  if (createNoteBtn) {
    createNoteBtn.addEventListener('click', () => {
      const note = createNote();
      showNoteEditor(note);
    });
  }
  
  // Create Checklist button
  const btnAddChecklist = document.getElementById('btnAddChecklist');
  if (btnAddChecklist) {
    btnAddChecklist.addEventListener('click', () => {
      try {
        // Закрываем возможные всплывающие окна чек-листа
        try { if (typeof window.hideChecklistToggleView === 'function') window.hideChecklistToggleView(); } catch(_) {}
        try { if (typeof window.closeChecklistWindow === 'function') window.closeChecklistWindow(); } catch(_) {}
        const checklist = createChecklist('Новый чек-лист');
        showChecklistEditor(checklist);
      } catch (error) {
        console.error('❌ Error creating checklist:', error);
      }
    });
  } else {
    console.error('❌ btnAddChecklist not found!');
  }

  // Inbox Capture button
  const btnInboxCapture = document.getElementById('btnInboxCapture');
  if (btnInboxCapture) {
    btnInboxCapture.addEventListener('click', () => {
      if (window.openInboxCapture) {
        window.openInboxCapture();
      } else {
        showToast('Инбокс не инициализирован', 'warn');
      }
    });
  }

  // Inbox List button
  const btnInboxList = document.getElementById('btnInboxList');
  if (btnInboxList) {
    btnInboxList.addEventListener('click', () => {
      if (window.openInboxList) {
        window.openInboxList();
      } else {
        showToast('Инбокс не инициализирован', 'warn');
      }
    });
  }
}

function submitQuick(text) {
  if (!text) return;
  
  // Проверяем, не создаем ли мы идею или заметку
  if (text.startsWith('#идея ') || text.startsWith('#idea ')) {
    const title = text.replace(/^#(идея|idea)\s+/, '').trim();
    if (title) {
      const idea = createIdea();
      idea.title = title;
      showIdeaEditor(idea);
      $("#quickAdd").value = "";
      $("#qaChips").innerHTML = "";
      return;
    }
  }
  
  if (text.startsWith('#заметка ') || text.startsWith('#note ')) {
    const title = text.replace(/^#(заметка|note)\s+/, '').trim();
    if (title) {
      const note = createNote();
      note.title = title;
      showNoteEditor(note);
      $("#quickAdd").value = "";
      $("#qaChips").innerHTML = "";
      return;
    }
  }
  
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
  
  // Expose eventBus globally for inter-module communication
  window.eventBus = eventBus;
  
  // Check URL parameter for map version override
  const urlParams = new URLSearchParams(window.location.search);
  const mapVersion = urlParams.get('map');
  if (mapVersion === 'v1' || mapVersion === 'v2') {
    if (!state.settings) state.settings = {};
    state.settings.mapVersion = mapVersion;
    console.log(`Map version overridden to ${mapVersion} via URL parameter`);
  }
  
  // Normal initialization for all browsers (including Edge)
  const ok = loadState();
  if (!ok) initDemoData();
  
  // Аудит иерархии после загрузки
  try {
    console.log('🔍 Запуск аудита иерархии...');
    const { validateHierarchy, index } = await import('./hierarchy/index.js');
    
    // Строим индексы
    const indices = index(state);
    console.log(`📊 Индексы построены: ${indices.byId.size} объектов, ${indices.childrenById.size} родителей`);
    
    // Валидируем иерархию
    const problems = validateHierarchy(state);
    if (problems.length > 0) {
      console.warn(`⚠️ Найдено ${problems.length} проблем в иерархии:`);
      problems.forEach((problem, index) => {
        console.warn(`  ${index + 1}. ${problem.message} (${problem.code}) - ID: ${problem.id}`);
      });
      
      // Автоисправление простых случаев
      let fixed = 0;
      problems.forEach(problem => {
        if (problem.code === 'missing_parent') {
          const obj = state.domains.find(d => d.id === problem.id) ||
                     state.projects.find(p => p.id === problem.id) ||
                     state.tasks.find(t => t.id === problem.id) ||
                     state.ideas.find(i => i.id === problem.id) ||
                     state.notes.find(n => n.id === problem.id) ||
                     state.checklists.find(c => c.id === problem.id);
          
          if (obj) {
            obj.parentId = null;
            obj.projectId = null;
            obj.domainId = null;
            fixed++;
            console.log(`🔧 Автоисправлено: ${problem.id} (несуществующий родитель)`);
          }
        }
      });
      
      if (fixed > 0) {
        console.log(`✅ Автоисправлено ${fixed} ошибок связей`);
        saveState();
      }
    } else {
      console.log('✅ Иерархия валидна');
    }
  } catch (error) {
    console.warn('⚠️ Ошибка аудита иерархии:', error);
  }
  
  // Initialize hotkeys
  initializeHotkeys();
  // Ensure DnD hints are off by default, Inbox is ON by default, tooltip delay is 500ms
  try { 
    if (!state.settings) state.settings = {}; 
    if (typeof state.settings.showDndHints==='undefined') state.settings.showDndHints = true;
    if (typeof state.settings.showInbox==='undefined') state.settings.showInbox = true; // ON by default
    if (typeof state.settings.tooltipDelay==='undefined') state.settings.tooltipDelay = 500; // 500ms by default
  } catch(_){}
  
  // Initialize autocomplete
  console.log('About to initialize autocomplete...');
  initAutocomplete();
  
  // Принудительная очистка дубликатов при загрузке (с задержкой)
  setTimeout(() => {
    console.log('🧹 Принудительная очистка дубликатов при загрузке...');
    if (window.cleanupDuplicates) {
      window.cleanupDuplicates();
    }
  }, 1000); // Задержка 1 секунда для полной инициализации
  
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
  
  // Initialize inbox system (after everything else is loaded)
  setTimeout(() => {
    try {
      // Wait for map to be fully initialized
      if (window.drawMap && document.getElementById('canvas')) {
        initInbox();
        console.log('Inbox system initialized');
      } else {
        console.warn('Map not ready, retrying inbox initialization...');
        setTimeout(() => {
          try {
            initInbox();
            console.log('Inbox system initialized (retry)');
          } catch (error) {
            console.error('Failed to initialize inbox (retry):', error);
          }
        }, 500);
      }
    } catch (error) {
      console.error('Failed to initialize inbox:', error);
    }
  }, 200);
  
  // Initialize info panel tooltips
  setupInfoPanelTooltips();
  
  // Initialize checklist context menu handler
  setupChecklistContextMenu();
  
  // set version in brand + document title
  const brandEl = document.querySelector("header .brand");
  // Don't override APP_VERSION from CHANGELOG - use the hardcoded version
  if (brandEl) brandEl.textContent = APP_VERSION;
  document.title = APP_VERSION + " (modular)";
  
  // Проверяем флаг системы иерархии v2 (отключено для стабильности)
  // if (isHierarchyV2Enabled()) {
  //   console.log('✅ Система иерархии v2 включена');
  //   // Здесь будет инициализация системы иерархии v2
  // } else {
    console.log('🚫 Система иерархии v2 отключена (по умолчанию)');
    console.log('✅ Приложение работает в режиме совместимости');
  // }
  
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
    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const ok = undoLastMove && undoLastMove();
      if (ok) showToast("Отменено", "ok");
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.key && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setShowFps();
      return;
    }
    if (e.target && e.target.id === "quickAdd") return;
    if (!e.key) return; // Защита от undefined key
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
    if (k === "b") {
      e.preventDefault();
      // Toggle focus mode "Black Hole"
      if (window.toggleFocusMode) {
        window.toggleFocusMode();
      }
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
    // Feature gate for future map v2 (currently legacy only)
    const useV2 = (() => {
      try {
        const q = new URLSearchParams(location.search);
        return state?.ui?.features?.modularMap === true || q.get('map') === 'v2';
      } catch (_) { return false; }
    })();
    // For now always run legacy implementation to keep behavior unchanged.
    // When v2 is ready: if (useV2) createMapV2(...) else initMap(...)
  initMap(canvas, tooltip);
  }
  updateWip();
  
  // Setup creation panel buttons
  setupCreationPanel();
  
  // Принудительно скрываем модальное окно при инициализации
  const modal = document.getElementById('modal');
  if (modal) {
    modal.style.display = 'none';
  }
}
init();


// Setup checklist context menu handler
function setupChecklistContextMenu() {
  // Проверяем фичефлаг
  if (!state.ui?.features?.checklist) {
    return;
  }
  
  // Делаем функции доступными глобально
  window.openChecklist = openChecklist;
  window.closeChecklist = closeChecklist;
  window.openChecklistWindow = openChecklistWindow;
  window.closeChecklistWindow = closeChecklistWindow;
  
  console.log('🔧 Checklist system initialized:', {
    featureFlag: state.ui?.features?.checklist,
    openChecklist: typeof openChecklist,
    closeChecklist: typeof closeChecklist
  });
  
  // Старый обработчик contextmenu убран - теперь используется только в view_map.js
}

// Вспомогательные функции для работы с координатами
function screenToWorld(screenX, screenY) {
  // Получаем состояние камеры из view_map.js
  if (window.mapApi && window.mapApi.getViewState) {
    const viewState = window.mapApi.getViewState();
    const inv = 1 / Math.max(0.0001, viewState.scale);
    return {
      x: (screenX - viewState.tx) * inv,
      y: (screenY - viewState.ty) * inv
    };
  }
  return { x: screenX, y: screenY };
}

function findNodeAt(x, y) {
  // Получаем узлы из view_map.js
  if (window.mapApi && window.mapApi.getMapNodes) {
    const nodes = window.mapApi.getMapNodes();
    const DPR = window.devicePixelRatio || 1;
    
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = x - n.x;
      const dy = y - n.y;
      const rr = n._type === "task" ? n.r + 6 * DPR :
                 n._type === "project" ? n.r + 10 * DPR :
                 n._type === "domain" ? n.r + 15 * DPR : n.r;
      
      if (dx * dx + dy * dy < rr * rr) {
        return n;
      }
    }
  }
  return null;
}

// expose renderers for external refresh (storage, addons)
try { window.renderSidebar = renderSidebar; } catch(_) {}
try { window.renderToday = renderToday; } catch(_) {}
try { window.openInspectorFor = openInspectorFor; } catch(_) {}

// Toggle all tags visibility
window.toggleAllTags = function() {
  state.showAllTags = !state.showAllTags;
  renderSidebar();
};



