// js/inspector.js
import {
  state,
  byId,
  project,
  domainOf,
  tasksOfProject,
  daysSince,
  statusPill,
  getProjectColor,
  getRandomProjectColor,
  getContrastColor,
  PROJECT_COLOR_PRESETS,
} from "./state.js";
// view_map helpers are accessed via window.mapApi to avoid circular import issues
function drawMap() {
  return window.mapApi && window.mapApi.drawMap && window.mapApi.drawMap();
}
function refreshMap(opts){
  return window.mapApi && window.mapApi.refresh && window.mapApi.refresh(opts||{});
}
function getPendingAttach() {
  return (
    window.mapApi &&
    window.mapApi.getPendingAttach &&
    window.mapApi.getPendingAttach()
  );
}
function confirmAttach() {
  return (
    window.mapApi &&
    window.mapApi.confirmAttach &&
    window.mapApi.confirmAttach()
  );
}
function cancelAttach() {
  return (
    window.mapApi && window.mapApi.cancelAttach && window.mapApi.cancelAttach()
  );
}
import { saveState } from "./storage.js";
import { renderToday } from "./view_today.js";

export function openInspectorFor(obj) {
  const ins = document.getElementById("inspector");
  if (!obj) {
    ins.innerHTML = `<div class="hint">Выберите объект на карте, чтобы увидеть детали.</div>`;
    return;
  }
  const type = obj._type;
  if (type === "domain") {
    const prjs = state.projects.filter((p) => p.domainId === obj.id);
    const totalTasks = prjs.reduce(
      (a, p) => a + tasksOfProject(p.id).length,
      0
    );
    ins.innerHTML = `
      <h2>Домен: ${obj.title}</h2>
      <div class="kv">Проектов: ${prjs.length} · Задач: ${totalTasks}</div>
      <div class="btns">
        <button class="btn primary" id="addProject">+ Проект</button>
        <button class="btn" id="changeDomainColor">🎨 Изменить цвет</button>
        <button class="btn danger" id="delDomain">🗑️ Удалить домен</button>
      </div>
      <div class="list">${prjs
        .map(
          (p) => `
        <div class="card">
          <div><strong>${p.title}</strong></div>
          <div class="meta">#${(p.tags || []).join(" #")}</div>
          <div class="meta">Задач: ${tasksOfProject(p.id).length}</div>
        </div>
      `
        )
        .join("")}</div>
    `;
    document.getElementById("addProject").onclick = () => {
      const title = prompt("Название проекта:", "Новый проект");
      if (!title) return;
      const id = "p" + Math.random().toString(36).slice(2, 8);
      state.projects.push({
        id,
        domainId: obj.id,
        title,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      saveState();
      refreshMap({ layout: true });
      openInspectorFor(obj);
    };
    
    // Handle domain deletion
    document.getElementById("delDomain").onclick = () => {
      if (confirm(`Удалить домен "${obj.title}" и все его проекты и задачи?`)) {
        // Trigger cosmic explosion for domain
        if (window.cosmicAnimations) {
          window.cosmicAnimations.animateDomainPulse(obj.x, obj.y, obj.r, obj.color);
        }
        
        // Remove all projects and tasks in this domain
        const projIds = state.projects.filter((p) => p.domainId === obj.id).map((p) => p.id);
        state.tasks = state.tasks.filter((t) => !projIds.includes(t.projectId));
        state.projects = state.projects.filter((p) => p.domainId !== obj.id);
        state.domains = state.domains.filter((d) => d.id !== obj.id);
        
        // Clear active domain to show entire project instead of focusing on remaining domain
        state.activeDomain = null;
        
        saveState();
        
        // Force layout and redraw
        if (window.layoutMap) window.layoutMap();
        if (window.drawMap) window.drawMap();
        
        openInspectorFor(null);
        
        // Update UI
        if (window.updateDomainsList) window.updateDomainsList();
        if (window.updateStatistics) window.updateStatistics();
        if (window.renderToday) window.renderToday();
        if (window.renderSidebar) window.renderSidebar();
      }
    };
    
    // Handle domain color change
    document.getElementById("changeDomainColor").onclick = () => {
      const currentColor = obj.color || "#2dd4bf";
      const newColor = prompt("Введите новый цвет домена (hex код, например #ff6b6b):", currentColor);
      if (newColor && newColor !== currentColor) {
        // Validate hex color
        if (/^#[0-9A-F]{6}$/i.test(newColor)) {
          obj.color = newColor;
          obj.updatedAt = Date.now();
          saveState();
          drawMap();
          openInspectorFor(obj); // Refresh inspector
        } else {
          alert("Неверный формат цвета. Используйте hex код (например: #ff6b6b)");
        }
      }
    };
  }
  if (type === "project") {
    const tks = tasksOfProject(obj.id);
    ins.innerHTML = `
      <h2>Проект: ${obj.title}</h2>
      <div class="kv">Домен: ${domainOf(obj)?.title || 'Независимый'}</div>
      <div class="kv">Теги: #${(obj.tags || []).join(" #")}</div>
      <div class="btns">
        <button class="btn primary" id="addTask">+ Задача</button>
        <button class="btn" id="toToday">Взять 3 задачи в Сегодня</button>
        <button class="btn" id="changeProjectColor">🎨 Изменить цвет</button>
        <button class="btn" id="editProjectTitle">✏️ Переименовать</button>
        <button class="btn" id="changeProjectDomain">🏠 Изменить домен</button>
        <button class="btn" id="makeProjectIndependent">🔓 Сделать независимым</button>
        <button class="btn danger" id="delProject">🗑️ Удалить проект</button>
      </div>
      <div class="list">${tks
        .map(
          (t) => `
        <div class="card">
          <div>${statusPill(t.status)} <strong>${t.title}</strong></div>
          <div class="meta">#${t.tags.join(" #")} · обновл. ${daysSince(
            t.updatedAt
          )} дн.</div>
        </div>
      `
        )
        .join("")}</div>
    `;
    document.getElementById("addTask").onclick = () => {
      const title = prompt("Название задачи:", "Новая задача");
      if (!title) return;
      const id = "t" + Math.random().toString(36).slice(2, 8);
      state.tasks.push({
        id,
        projectId: obj.id,
        title,
        tags: [],
        status: "backlog",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      saveState();
      refreshMap({ layout: true });
      openInspectorFor(obj);
    };
    // add button to create independent task in this project's domain
    try{
      const btns = document.querySelector('#inspector .btns');
      if(btns){
        const b = document.createElement('button');
        b.className = 'btn';
        b.id = 'addIndep';
        b.textContent = '+ Независимая задача (в домене)';
        btns.appendChild(b);
        b.onclick = () => {
          const title = prompt('Название независимой задачи:', 'Новая задача');
          if(!title) return;
          const id = 't'+Math.random().toString(36).slice(2,8);
          state.tasks.push({ id, projectId:null, domainId: obj.domainId, title, tags:[], status:'backlog', createdAt:Date.now(), updatedAt:Date.now() });
          saveState();
          refreshMap({ layout: true });
          openInspectorFor(obj);
        };
      }
    }catch(_){ }
    document.getElementById("toToday").onclick = () => {
      const candidates = tks.filter((t) => t.status !== "done").slice(0, 3);
      candidates.forEach((t) => {
        t.status = "today";
        t.updatedAt = Date.now();
      });
      try {
        saveState();
      } catch (_) {}
      drawMap();
      renderToday();
    };
    
    // Handle project deletion
    document.getElementById("delProject").onclick = () => {
      if (confirm(`Удалить проект "${obj.title}" и все его задачи?`)) {
        // Trigger cosmic explosion for project
        if (window.cosmicAnimations) {
          window.cosmicAnimations.animateTaskDeletion(obj.x, obj.y, 'project');
        }
        
        // Remove all tasks in this project
        state.tasks = state.tasks.filter((t) => t.projectId !== obj.id);
        state.projects = state.projects.filter((p) => p.id !== obj.id);
        
        saveState();
        
        // Force layout and redraw
        if (window.layoutMap) window.layoutMap();
        if (window.drawMap) window.drawMap();
        
        openInspectorFor(null);
        
        // Update UI
        if (window.updateDomainsList) window.updateDomainsList();
        if (window.updateStatistics) window.updateStatistics();
        if (window.renderToday) window.renderToday();
        if (window.renderSidebar) window.renderSidebar();
      }
    };
    
    // Handle project color change
    document.getElementById("changeProjectColor").onclick = () => {
      showColorPicker(obj);
    };
    
    // Handle project title editing
    document.getElementById("editProjectTitle").onclick = () => {
      const newTitle = prompt("Введите новое название проекта:", obj.title);
      if (newTitle && newTitle !== obj.title) {
        obj.title = newTitle;
        obj.updatedAt = Date.now();
        saveState();
        drawMap();
        openInspectorFor(obj); // Refresh inspector
      }
    };
    
    // Handle project domain change
    document.getElementById("changeProjectDomain").onclick = () => {
      const currentDomain = state.domains.find(d => d.id === obj.domainId);
      const availableDomains = state.domains.filter(d => d.id !== obj.domainId);
      
      if (availableDomains.length === 0) {
        alert("Нет других доменов для перемещения");
        return;
      }
      
      const domainList = availableDomains.map((d, i) => `${i + 1}. ${d.title}`).join('\n');
      const choice = prompt(`Выберите домен для перемещения проекта:\n\n${domainList}\n\nВведите номер домена:`, "1");
      
      if (choice) {
        const domainIndex = parseInt(choice) - 1;
        if (domainIndex >= 0 && domainIndex < availableDomains.length) {
          const newDomain = availableDomains[domainIndex];
          const oldDomain = currentDomain?.title || "независимый";
          
          if (confirm(`Переместить проект "${obj.title}" из домена "${oldDomain}" в домен "${newDomain.title}"?`)) {
            obj.domainId = newDomain.id;
            obj.updatedAt = Date.now();
            saveState();
            drawMap();
            openInspectorFor(obj); // Refresh inspector
          }
        } else {
          alert("Неверный номер домена");
        }
      }
    };
    
    // Handle making project independent
    document.getElementById("makeProjectIndependent").onclick = () => {
      const currentDomain = state.domains.find(d => d.id === obj.domainId);
      const domainName = currentDomain?.title || "неизвестный";
      
      if (confirm(`Сделать проект "${obj.title}" независимым (извлечь из домена "${domainName}")?`)) {
        obj.domainId = null;
        obj.updatedAt = Date.now();
        saveState();
        drawMap();
        openInspectorFor(obj); // Refresh inspector
      }
    };
  }
  if (type === "task") {
    const pending = getPendingAttach();
    const pendForThis = pending && pending.taskId === obj.id;
    const task = state.tasks.find(t => t.id === obj.id);
    
    ins.innerHTML = `
      <h2>Задача</h2>
      
      <!-- Title editing -->
      <div class="kv">
        <label>Название:</label>
        <div class="title-edit-container" style="display: flex; gap: 4px; margin-top: 4px; align-items: center;">
          <input type="text" id="taskTitle" value="${obj.title}" style="flex: 1; padding: 4px 8px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel-1); color: var(--text);">
          <button id="editTitle" class="btn-small" title="Редактировать" style="padding: 4px 8px; background: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">✏️</button>
          <button id="saveTitle" class="btn-small" title="Сохранить" style="padding: 4px 8px; background: var(--ok); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: none;">💾</button>
          <button id="cancelTitle" class="btn-small" title="Отменить" style="padding: 4px 8px; background: var(--muted); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: none;">❌</button>
        </div>
      </div>
      
      <!-- Status -->
      <div class="kv">
        <label>Статус:</label>
        <div class="status-buttons" style="margin-top: 4px;">
          <button class="btn ${obj.status === 'backlog' ? 'active' : ''}" data-st="backlog">План</button>
          <button class="btn ${obj.status === 'today' ? 'active' : ''}" data-st="today">Сегодня</button>
          <button class="btn ${obj.status === 'doing' ? 'active' : ''}" data-st="doing">В работе</button>
          <button class="btn ok ${obj.status === 'done' ? 'active' : ''}" data-st="done">Готово</button>
        </div>
      </div>
      
      <!-- Priority -->
      <div class="kv">
        <label>Приоритет:</label>
        <select id="taskPriority" style="margin-top: 4px; padding: 4px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel-1); color: var(--text);">
          <option value="1" ${task?.priority === 1 ? 'selected' : ''}>1 - Критический</option>
          <option value="2" ${task?.priority === 2 ? 'selected' : ''}>2 - Высокий</option>
          <option value="3" ${task?.priority === 3 ? 'selected' : ''}>3 - Средний</option>
          <option value="4" ${task?.priority === 4 ? 'selected' : ''}>4 - Низкий</option>
        </select>
      </div>
      
      <!-- Estimate -->
      <div class="kv">
        <label>Время выполнения:</label>
        <input type="text" id="taskEstimate" value="${task?.estimateMin || ''}" placeholder="30м, 1ч, 2ч 30м" style="width: 100%; margin-top: 4px; padding: 4px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel-1); color: var(--text);">
      </div>
      
      <!-- Tags -->
      <div class="kv">
        <label>Теги:</label>
        <input type="text" id="taskTags" value="${(task?.tags || []).join(', ')}" placeholder="работа, срочно, важное" style="width: 100%; margin-top: 4px; padding: 4px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel-1); color: var(--text);">
      </div>
      
      <!-- Project and Domain info -->
      <div class="kv">Проект: ${project(obj.projectId)?.title || 'Без проекта'}</div>
      <div class="kv">Домен: ${obj.domainId ? byId(state.domains, obj.domainId)?.title || 'Неизвестный домен' : 'Без домена'}</div>
      <div class="kv">Обновлено: ${daysSince(obj.updatedAt)} дн. назад</div>
      
      ${
        pendForThis
          ? `<div class="kv hint">Ожидает привязки к проекту: ${
              project(pending.toProjectId).title
            }</div>`
          : ""
      }
      
      <div class="btns">
        <button class="btn primary" id="saveTask">Сохранить</button>
        <button class="btn" id="mkProject">Сделать проектом</button>
        <button class="btn warn" id="delTask">Удалить</button>
        ${
          pendForThis
            ? `<button class="btn" id="confirmAttach">Привязать</button><button class="btn" id="cancelAttach">Отменить привязку</button>`
            : ""
        }
      </div>
    `;
    if (pendForThis) {
      document.getElementById("confirmAttach").onclick = () => {
        confirmAttach();
        openInspectorFor(obj);
      };
      document.getElementById("cancelAttach").onclick = () => {
        cancelAttach();
        openInspectorFor(obj);
      };
    }
    
    // Status buttons
    ins.querySelectorAll(".btn[data-st]").forEach((b) => {
      b.onclick = () => {
        obj.status = b.dataset.st;
        obj.updatedAt = Date.now();
        saveState();
        drawMap();
        renderToday();
        openInspectorFor(obj);
      };
    });
    
    // Save task button
    document.getElementById("saveTask").onclick = () => {
      const title = document.getElementById("taskTitle").value.trim();
      const priority = parseInt(document.getElementById("taskPriority").value);
      const estimate = document.getElementById("taskEstimate").value.trim();
      const tagsText = document.getElementById("taskTags").value.trim();
      
      if (!title) {
        alert("Название задачи не может быть пустым");
        return;
      }
      
      // Update task
      obj.title = title;
      task.priority = priority;
      task.estimateMin = estimate ? parseEstimate(estimate) : null;
      task.tags = tagsText ? tagsText.split(',').map(t => t.trim()).filter(t => t) : [];
      task.updatedAt = Date.now();
      
      saveState();
      drawMap();
      renderToday();
      openInspectorFor(obj);
    };
    
    // Parse estimate helper
    function parseEstimate(text) {
      const match = text.match(/(\d+)\s*(ч|м|мин|min|h|hour)/i);
      if (!match) return null;
      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      if (unit === 'ч' || unit === 'h' || unit === 'hour') {
        return value * 60;
      } else {
        return value;
      }
    }
    document.getElementById("delTask").onclick = () => {
      // Create backup of task for undo
      const taskBackup = { ...obj };
      
      // Trigger cosmic explosion before deletion
      if (window.cosmicAnimations) {
        // Find task position on map for explosion effect
        // Get nodes from the map module
        const mapNodes = window.getMapNodes ? window.getMapNodes() : null;
        const taskNode = mapNodes?.find(n => n.id === obj.id);
        if (taskNode) {
          window.cosmicAnimations.animateTaskDeletion(taskNode.x, taskNode.y, obj.status);
        }
      }
      
      // Remove task from state
        state.tasks = state.tasks.filter((t) => t.id !== obj.id);
      saveState();
      drawMap();
      renderToday();
      openInspectorFor(null);
      
      // Show undo toast
      showUndoToast("Задача удалена", () => {
        // Restore task
        state.tasks.push(taskBackup);
        saveState();
        drawMap();
        renderToday();
        
        // Show success message
        showToast("Задача восстановлена", "ok");
      });
    };
    // Handle "Make project" button (already in HTML)
    document.getElementById("mkProject").onclick = () => {
          const domId = obj.projectId ? (state.projects.find(p=>p.id===obj.projectId)?.domainId) : (obj.domainId||state.activeDomain||state.domains[0]?.id);
          if(!domId) return;
          const pid = 'p'+Math.random().toString(36).slice(2,8);
          state.projects.push({ id:pid, domainId:domId, title: obj.title, tags:[...(obj.tags||[])], priority: obj.priority||2, createdAt:Date.now(), updatedAt:Date.now() });
          obj.projectId = pid;
          try{ if(state.settings && state.settings.layoutMode==='auto'){ delete obj.pos; } }catch(_){}
          obj.updatedAt = Date.now();
          saveState();
          refreshMap({ layout: true });
          openInspectorFor(state.projects.find(p=>p.id===pid));
        };
    
    // Handle title editing
    let originalTitle = obj.title;
    const titleInput = document.getElementById("taskTitle");
    const editBtn = document.getElementById("editTitle");
    const saveBtn = document.getElementById("saveTitle");
    const cancelBtn = document.getElementById("cancelTitle");
    
    // Initially disable input
    titleInput.disabled = true;
    
    editBtn.onclick = () => {
      originalTitle = titleInput.value;
      titleInput.disabled = false;
      titleInput.focus();
      titleInput.select();
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-block';
      cancelBtn.style.display = 'inline-block';
    };
    
    saveBtn.onclick = () => {
      const newTitle = titleInput.value.trim();
      if (newTitle && newTitle !== obj.title) {
        obj.title = newTitle;
        task.title = newTitle;
        task.updatedAt = Date.now();
        saveState();
        drawMap();
        renderToday();
        showToast(`Название изменено на "${newTitle}"`, "ok");
      }
      titleInput.disabled = true;
      editBtn.style.display = 'inline-block';
      saveBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
    };
    
    cancelBtn.onclick = () => {
      titleInput.value = originalTitle;
      titleInput.disabled = true;
      editBtn.style.display = 'inline-block';
      saveBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
    };
    
    // Save on Enter, cancel on Escape
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveBtn.click();
      } else if (e.key === 'Escape') {
        cancelBtn.click();
      }
    });
  }
}

// Функция для показа цветового пикера
function showColorPicker(project) {
  const currentColor = getProjectColor(project);
  
  // Создаем модальное окно
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const picker = document.createElement('div');
  picker.style.cssText = `
    background: var(--panel);
    border: 1px solid var(--panel-2);
    border-radius: 12px;
    padding: 20px;
    max-width: 400px;
    width: 90%;
    color: var(--text);
  `;
  
  picker.innerHTML = `
    <h3 style="margin: 0 0 15px 0; color: var(--text);">🎨 Выберите цвет проекта</h3>
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 8px; color: var(--muted);">Текущий цвет:</label>
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 30px; height: 30px; border-radius: 6px; background: ${currentColor}; border: 2px solid var(--panel-2);"></div>
        <span style="font-family: monospace; color: var(--text);">${currentColor}</span>
      </div>
    </div>
    
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 8px; color: var(--muted);">Пресеты цветов:</label>
      <div id="colorPresets" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 10px;"></div>
    </div>
    
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 8px; color: var(--muted);">Или выберите произвольный цвет:</label>
      <input type="color" id="customColor" value="${currentColor}" style="width: 100%; height: 40px; border: none; border-radius: 6px; cursor: pointer;">
    </div>
    
    <div style="margin-bottom: 15px;">
      <button id="randomColor" style="width: 100%; padding: 8px; background: var(--panel-2); color: var(--text); border: 1px solid var(--panel-2); border-radius: 6px; cursor: pointer; margin-bottom: 10px;">🎲 Случайный цвет</button>
    </div>
    
    <div style="display: flex; gap: 10px; justify-content: flex-end;">
      <button id="cancelColor" style="padding: 8px 16px; background: var(--panel-2); color: var(--text); border: 1px solid var(--panel-2); border-radius: 6px; cursor: pointer;">Отмена</button>
      <button id="applyColor" style="padding: 8px 16px; background: var(--accent); color: var(--bg); border: 1px solid var(--accent); border-radius: 6px; cursor: pointer;">Применить</button>
    </div>
  `;
  
  modal.appendChild(picker);
  document.body.appendChild(modal);
  
  // Заполняем пресеты
  const presetsContainer = picker.querySelector('#colorPresets');
  PROJECT_COLOR_PRESETS.forEach(color => {
    const preset = document.createElement('div');
    preset.style.cssText = `
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: ${color};
      cursor: pointer;
      border: 2px solid transparent;
      transition: all 0.2s ease;
    `;
    
    if (color === currentColor) {
      preset.style.borderColor = 'var(--accent)';
      preset.style.transform = 'scale(1.1)';
    }
    
    preset.addEventListener('click', () => {
      // Убираем выделение с других пресетов
      presetsContainer.querySelectorAll('div').forEach(p => {
        p.style.borderColor = 'transparent';
        p.style.transform = 'scale(1)';
      });
      
      // Выделяем выбранный
      preset.style.borderColor = 'var(--accent)';
      preset.style.transform = 'scale(1.1)';
      
      // Обновляем выбранный цвет и цветовой инпут
      selectedColor = color;
      picker.querySelector('#customColor').value = color;
      console.log(`🎨 Preset color selected: ${color}`);
    });
    
    presetsContainer.appendChild(preset);
  });
  
  let selectedColor = currentColor;
  
  // Обработчики событий
  picker.querySelector('#customColor').addEventListener('change', (e) => {
    selectedColor = e.target.value;
    // Убираем выделение с пресетов
    presetsContainer.querySelectorAll('div').forEach(p => {
      p.style.borderColor = 'transparent';
      p.style.transform = 'scale(1)';
    });
  });
  
  picker.querySelector('#randomColor').addEventListener('click', () => {
    selectedColor = getRandomProjectColor();
    picker.querySelector('#customColor').value = selectedColor;
    // Убираем выделение с пресетов
    presetsContainer.querySelectorAll('div').forEach(p => {
      p.style.borderColor = 'transparent';
      p.style.transform = 'scale(1)';
    });
  });
  
  picker.querySelector('#cancelColor').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  picker.querySelector('#applyColor').addEventListener('click', () => {
    if (selectedColor && selectedColor !== currentColor) {
      console.log(`🎨 Changing project color from ${currentColor} to ${selectedColor}`);
      project.color = selectedColor;
      project.updatedAt = Date.now();
      saveState();
      drawMap();
      openInspectorFor(project); // Обновляем инспектор
    }
    document.body.removeChild(modal);
  });
  
  // Закрытие по клику вне модального окна
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
}
