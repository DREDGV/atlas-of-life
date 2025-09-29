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
  getChildObjects,
  getParentObject,
  findObjectById,
  getObjectType,
  canChangeHierarchy,
  attachObjectToParent,
  detachObjectFromParent,
  getAvailableParents,
  createChecklist,
  getChecklistsOfProject,
  getChecklistProgress
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

// Fallback функции для работы с иерархией когда система отключена
function getParentObjectFallback(obj) {
  if (!obj) return null;
  
  // Приоритет: parentId для всех типов объектов
  if (obj.parentId) {
    const parent = findObjectById(obj.parentId);
    if (parent) {
      return { ...parent, _type: getObjectType(parent) };
    }
  }
  
  // Запасной путь: старые поля для обратной совместимости
  if (obj._type === 'project' && obj.domainId) {
    const domain = state.domains.find(d => d.id === obj.domainId);
    return domain ? {...domain, _type: 'domain'} : null;
  }
  
  if (obj._type === 'task' && obj.projectId) {
    const project = state.projects.find(p => p.id === obj.projectId);
    return project ? {...project, _type: 'project'} : null;
  }
  
  if (obj._type === 'task' && obj.domainId) {
    const domain = state.domains.find(d => d.id === obj.domainId);
    return domain ? {...domain, _type: 'domain'} : null;
  }
  
  if (obj._type === 'idea' && obj.domainId) {
    const domain = state.domains.find(d => d.id === obj.domainId);
    return domain ? {...domain, _type: 'domain'} : null;
  }
  
  if (obj._type === 'idea' && obj.projectId) {
    const project = state.projects.find(p => p.id === obj.projectId);
    return project ? {...project, _type: 'project'} : null;
  }
  
  if (obj._type === 'note' && obj.domainId) {
    const domain = state.domains.find(d => d.id === obj.domainId);
    return domain ? {...domain, _type: 'domain'} : null;
  }
  
  if (obj._type === 'note' && obj.projectId) {
    const project = state.projects.find(p => p.id === obj.projectId);
    return project ? {...project, _type: 'project'} : null;
  }
  
  if (obj._type === 'checklist' && obj.projectId) {
    const project = state.projects.find(p => p.id === obj.projectId);
    return project ? {...project, _type: 'project'} : null;
  }
  
  if (obj._type === 'checklist' && obj.domainId) {
    const domain = state.domains.find(d => d.id === obj.domainId);
    return domain ? {...domain, _type: 'domain'} : null;
  }
  
  return null;
}

function getChildObjectsFallback(obj) {
  if (!obj) return { projects: [], tasks: [], ideas: [], notes: [], checklists: [] };
  
  const children = { projects: [], tasks: [], ideas: [], notes: [], checklists: [] };
  
  if (obj._type === 'domain') {
    // Проекты в домене
    children.projects = state.projects.filter(p => p.domainId === obj.id);
    
    // Задачи в домене (включая все задачи в проектах домена)
    const domainProjectIds = children.projects.map(p => p.id);
    children.tasks = state.tasks.filter(t => 
      t.domainId === obj.id || 
      (t.projectId && domainProjectIds.includes(t.projectId))
    );
    
    // Идеи в домене (включая все идеи в проектах домена)
    children.ideas = state.ideas.filter(i => 
      i.domainId === obj.id || 
      (i.projectId && domainProjectIds.includes(i.projectId))
    );
    
    // Заметки в домене (включая все заметки в проектах домена)
    children.notes = state.notes.filter(n => 
      n.domainId === obj.id || 
      (n.projectId && domainProjectIds.includes(n.projectId))
    );
    
    // Чек-листы в домене (включая все чек-листы в проектах домена)
    children.checklists = state.checklists.filter(c => 
      c.domainId === obj.id || 
      (c.projectId && domainProjectIds.includes(c.projectId))
    );
  }
  
  if (obj._type === 'project') {
    // Задачи в проекте
    children.tasks = state.tasks.filter(t => t.projectId === obj.id);
    
    // Идеи в проекте
    children.ideas = state.ideas.filter(i => i.projectId === obj.id);
    
    // Заметки в проекте
    children.notes = state.notes.filter(n => n.projectId === obj.id);
    
    // Чек-листы в проекте
    children.checklists = state.checklists.filter(c => c.projectId === obj.id);
  }
  
  return children;
}

// Построение полного пути (хлебные крошки) для объекта без зависимости от включенности v2
function buildHierarchyPath(obj) {
  if (!obj) return [];
  const parts = [];
  try {
    if (obj._type === 'task') {
      const proj = obj.projectId ? state.projects.find(p => p.id === obj.projectId) : null;
      const dom = obj.domainId
        ? state.domains.find(d => d.id === obj.domainId)
        : (proj ? state.domains.find(d => d.id === proj.domainId) : null);
      if (dom) parts.push({ type: 'domain', title: dom.title });
      if (proj) parts.push({ type: 'project', title: proj.title });
      parts.push({ type: 'task', title: obj.title });
      return parts;
    }
    if (obj._type === 'project') {
      const dom = obj.domainId ? state.domains.find(d => d.id === obj.domainId) : null;
      if (dom) parts.push({ type: 'domain', title: dom.title });
      parts.push({ type: 'project', title: obj.title });
      return parts;
    }
    if (obj._type === 'idea' || obj._type === 'note') {
      const proj = obj.projectId ? state.projects.find(p => p.id === obj.projectId) : null;
      const dom = obj.domainId
        ? state.domains.find(d => d.id === obj.domainId)
        : (proj ? state.domains.find(d => d.id === proj.domainId) : null);
      if (dom) parts.push({ type: 'domain', title: dom.title });
      if (proj) parts.push({ type: 'project', title: proj.title });
      parts.push({ type: obj._type, title: obj.title });
      return parts;
    }
    if (obj._type === 'domain') {
      parts.push({ type: 'domain', title: obj.title });
      return parts;
    }
  } catch (_) {}
  return [{ type: obj._type || 'object', title: obj.title || 'Объект' }];
}

function renderPathBreadcrumb(obj) {
  const path = buildHierarchyPath(obj);
  if (!path || path.length === 0) return '';
  const label = path
    .map(p => {
      const t = p.type === 'domain' ? 'Домен'
              : p.type === 'project' ? 'Проект'
              : p.type === 'task' ? 'Задача'
              : p.type === 'idea' ? 'Идея'
              : p.type === 'note' ? 'Заметка' : 'Объект';
      return `${t} "${p.title}"`;
    })
    .join(' → ');
  return `
    <div class="hierarchy-item path">
      <span class="hierarchy-icon">🧭</span>
      <span class="hierarchy-label">Путь:</span>
      <span class="hierarchy-value">${label}</span>
    </div>
  `;
}

// Функция для отображения иерархии объекта
function renderHierarchySection(obj) {
  if (!obj) return '';
  
  // Fallback для случая когда система иерархии отключена
  const children = getChildObjectsFallback(obj);
  const parent = getParentObjectFallback(obj);
  
  let html = `
    <div class="section">
      <h3>🌐 Иерархия</h3>
      <div class="hierarchy-info">
  `;
  
  // Полный путь (хлебные крошки)
  html += renderPathBreadcrumb(obj);
  
  // Показываем родителя
  if (parent) {
    const parentType = parent._type === 'domain' ? 'Домен' : 
                      parent._type === 'project' ? 'Проект' : 
                      parent._type === 'idea' ? 'Идея' : 
                      parent._type === 'note' ? 'Заметка' : 'Объект';
    html += `
      <div class="hierarchy-item parent">
        <span class="hierarchy-icon">⬆️</span>
        <span class="hierarchy-label">Родитель:</span>
        <span class="hierarchy-value">${parentType} "${parent.title}"</span>
      </div>
    `;
  } else {
    html += `
      <div class="hierarchy-item parent">
        <span class="hierarchy-icon">🌌</span>
        <span class="hierarchy-label">Статус:</span>
        <span class="hierarchy-value">Независимый объект</span>
      </div>
    `;
  }
  
  // Показываем детей
  if (children && Object.keys(children).length > 0) {
    html += `
      <div class="hierarchy-item children">
        <span class="hierarchy-icon">⬇️</span>
        <span class="hierarchy-label">Дети:</span>
        <div class="children-list">
    `;
    
    Object.keys(children).forEach(childType => {
      const childIds = children[childType] || [];
      if (childIds.length > 0) {
        const typeLabel = childType === 'projects' ? 'Проекты' :
                         childType === 'tasks' ? 'Задачи' :
                         childType === 'ideas' ? 'Идеи' :
                         childType === 'notes' ? 'Заметки' :
                         childType === 'checklists' ? 'Чек-листы' : childType;
        html += `
          <div class="child-type">
            <span class="child-count">${childIds.length}</span>
            <span class="child-label">${typeLabel}</span>
          </div>
        `;
      }
    });
    
    html += `
        </div>
      </div>
    `;
  } else {
    html += `
      <div class="hierarchy-item children">
        <span class="hierarchy-icon">🌱</span>
        <span class="hierarchy-label">Дети:</span>
        <span class="hierarchy-value">Нет дочерних объектов</span>
      </div>
    `;
  }
  
  html += `
      </div>
      
      ${renderHierarchyActions(obj)}
    </div>
  `;
  
  return html;
}

// Функция для отображения кнопок действий иерархии
function renderHierarchyActions(obj) {
  if (!obj) return '';
  
  const parent = getParentObjectFallback(obj);
  const canChange = canChangeHierarchy(obj);
  
  if (!canChange) {
    return `
      <div class="hierarchy-actions">
        <div class="hint">🔒 Изменение связей заблокировано</div>
      </div>
    `;
  }
  
  let html = `
    <div class="hierarchy-actions">
      <h4>Действия</h4>
      <div class="action-buttons">
  `;
  
  if (parent) {
    // Есть родитель - показываем кнопку отвязки
    html += `
      <button class="btn-small danger" id="detachFromParent" title="Отвязать от родителя">
        🔓 Отвязать
      </button>
    `;
  } else {
    // Нет родителя - показываем кнопку привязки
    const availableParents = getAvailableParents(obj._type);
    if (availableParents.length > 0) {
      html += `
        <button class="btn-small primary" id="attachToParent" title="Привязать к родителю">
          🔗 Привязать
        </button>
      `;
    }
  }
  
  html += `
      </div>
    </div>
  `;
  
  return html;
}

// Функция для настройки обработчиков действий иерархии
function setupHierarchyActionHandlers(obj) {
  // Обработчик отвязки от родителя
  const detachBtn = document.getElementById('detachFromParent');
  if (detachBtn) {
    detachBtn.onclick = () => {
      if (confirm(`Отвязать "${obj.title}" от родителя?`)) {
        const success = detachObjectFromParent(obj.id, obj._type);
        if (success) {
          saveState();
          refreshMap();
          openInspectorFor(obj); // Обновляем инспектор
          showToast('Объект отвязан от родителя', 'ok');
        } else {
          showToast('Не удалось отвязать объект', 'error');
        }
      }
    };
  }
  
  // Обработчик привязки к родителю
  const attachBtn = document.getElementById('attachToParent');
  if (attachBtn) {
    attachBtn.onclick = () => {
      showParentSelectionModal(obj);
    };
  }
}

// Функция для показа модального окна выбора родителя
function showParentSelectionModal(obj) {
  const availableParents = getAvailableParents(obj._type);
  
  if (availableParents.length === 0) {
    showToast('Нет доступных родителей для привязки', 'warn');
    return;
  }
  
  // Создаем модальное окно
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Выберите родителя для "${obj.title}"</h3>
      <div class="parent-list">
        ${availableParents.map(parent => `
          <div class="parent-item" data-parent-id="${parent.id}" data-parent-type="${parent._type}">
            <span class="parent-icon">${parent._type === 'domain' ? '🌌' : '🎯'}</span>
            <span class="parent-title">${parent.title}</span>
            <span class="parent-type">${parent._type === 'domain' ? 'Домен' : 'Проект'}</span>
          </div>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn" id="cancelParentSelection">Отмена</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Обработчики кликов по родителям
  modal.querySelectorAll('.parent-item').forEach(item => {
    item.onclick = () => {
      const parentId = item.dataset.parentId;
      const parentType = item.dataset.parentType;
      
      if (confirm(`Привязать "${obj.title}" к "${item.querySelector('.parent-title').textContent}"?`)) {
        const success = attachObjectToParent(obj.id, obj._type, parentId, parentType);
        if (success) {
          saveState();
          refreshMap();
          openInspectorFor(obj); // Обновляем инспектор
          showToast('Объект привязан к родителю', 'ok');
        } else {
          showToast('Не удалось привязать объект', 'error');
        }
      }
      
      document.body.removeChild(modal);
    };
  });
  
  // Обработчик отмены
  document.getElementById('cancelParentSelection').onclick = () => {
    document.body.removeChild(modal);
  };
  
  // Закрытие по клику вне модального окна
  modal.onclick = (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  };
}

export function openInspectorFor(obj) {
  console.log("🔍 Inspector: openInspectorFor called with", obj?._type, obj?.id);
  
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
    // Инициализируем поля блокировок если их нет
    if (!obj.locks) {
      obj.locks = { move: false, hierarchy: false };
    }
    
    ins.innerHTML = `
      <h2>Домен: ${obj.title}</h2>
      <div class="kv">Проектов: ${prjs.length} · Задач: ${totalTasks}</div>
      
      <div class="section">
        <h3>🔒 Блокировки</h3>
        <div class="locks">
          <label class="lock-item">
            <input type="checkbox" id="lockMove" ${obj.locks.move ? 'checked' : ''}>
            <span>Блокировка перемещения</span>
          </label>
          <label class="lock-item">
            <input type="checkbox" id="lockHierarchy" ${obj.locks.hierarchy ? 'checked' : ''}>
            <span>Блокировка смены связей</span>
          </label>
        </div>
      </div>
      
      ${renderHierarchySection(obj)}
      
      <div class="btns">
        <button class="btn primary" id="addProject">+ Проект</button>
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
    
    // Обработчики блокировок
    document.getElementById("lockMove").onchange = (e) => {
      obj.locks.move = e.target.checked;
      saveState();
      refreshMap();
    };
    
    document.getElementById("lockHierarchy").onchange = (e) => {
      obj.locks.hierarchy = e.target.checked;
      saveState();
      refreshMap();
    };
    
    // Обработчики действий иерархии
    setupHierarchyActionHandlers(obj);
    
    // Domain color is now automatically determined by mood - no manual change needed
  }
  if (type === "project") {
    const tks = tasksOfProject(obj.id);
    
    // Инициализируем поля блокировок если их нет
    if (!obj.locks) {
      obj.locks = { move: false, hierarchy: false };
    }
    
    ins.innerHTML = `
      <h2>Проект: ${obj.title}</h2>
      <div class="kv">Домен: ${domainOf(obj)?.title || 'Независимый'}</div>
      <div class="kv">Теги: #${(obj.tags || []).join(" #")}</div>
      
      <div class="section">
        <h3>🔒 Блокировки</h3>
        <div class="locks">
          <label class="lock-item">
            <input type="checkbox" id="lockMove" ${obj.locks.move ? 'checked' : ''}>
            <span>Блокировка перемещения</span>
          </label>
          <label class="lock-item">
            <input type="checkbox" id="lockHierarchy" ${obj.locks.hierarchy ? 'checked' : ''}>
            <span>Блокировка смены связей</span>
          </label>
        </div>
      </div>
      
      ${renderHierarchySection(obj)}
      
      <div class="btns">
        <button class="btn primary" id="addTask">+ Задача</button>
        <button class="btn" id="addChecklist">✓ Чек-лист</button>
        <button class="btn" id="toToday">Взять 3 задачи в Сегодня</button>
        <button class="btn" id="changeProjectColor">🎨 Изменить цвет</button>
        <button class="btn" id="editProjectTitle">✏️ Переименовать</button>
        <button class="btn" id="changeProjectDomain">🏠 Изменить домен</button>
        <button class="btn" id="makeProjectIndependent">🔓 Сделать независимым</button>
        <button class="btn danger" id="delProject">🗑️ Удалить проект</button>
      </div>
      <div class="list">
        <h4>Задачи (${tks.length})</h4>
        ${tks
        .map(
          (t) => `
        <div class="card">
            <div>${statusPill(t.status).text} <strong>${t.title}</strong></div>
            <div class="meta">#${(t.tags || []).join(" #")} · обновл. ${daysSince(
            t.updatedAt
          )} дн.</div>
        </div>
      `
        )
          .join("")}
        
        <h4>Чек-листы (${getChecklistsOfProject(obj.id).length})</h4>
        ${getChecklistsOfProject(obj.id)
          .map(
            (c) => `
          <div class="card checklist-card">
            <div class="checklist-header">
              <span class="checklist-icon">✓</span>
              <strong>${c.title}</strong>
              <span class="checklist-progress">${getChecklistProgress(c.id)}%</span>
            </div>
            <div class="checklist-progress-bar">
              <div class="checklist-progress-fill" style="width: ${getChecklistProgress(c.id)}%"></div>
            </div>
            <div class="meta">${c.items.length} элементов · обновл. ${daysSince(c.updatedAt)} дн.</div>
          </div>
        `
          )
          .join("")}
      </div>
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
    
    document.getElementById("addChecklist").onclick = () => {
      const title = prompt("Название чек-листа:", "Новый чек-лист");
      if (!title) return;
      const checklist = createChecklist(title, obj.id, obj.domainId);
      window.showChecklistEditor(checklist);
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
    
    // Обработчики блокировок для проектов
    document.getElementById("lockMove").onchange = (e) => {
      obj.locks.move = e.target.checked;
      saveState();
      refreshMap();
    };
    
    document.getElementById("lockHierarchy").onchange = (e) => {
      obj.locks.hierarchy = e.target.checked;
      saveState();
      refreshMap();
    };
    
    // Обработчики действий иерархии
    setupHierarchyActionHandlers(obj);
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
      
      ${renderHierarchySection(obj)}
      
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
    
    // Обработчики действий иерархии
    setupHierarchyActionHandlers(obj);
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
  
  // Обработка идей
  if (type === "idea") {
    console.log("🔍 Inspector: Processing idea", obj);
    console.log("🔍 Inspector: Idea parentId:", obj.parentId);
    console.log("🔍 Inspector: Idea domainId:", obj.domainId);
    
    const parent = getParentObjectFallback(obj);
    console.log("🔍 Inspector: Found parent:", parent);
    
    const parentInfo = parent ? `${parent._type === 'domain' ? 'Домен' : parent._type === 'project' ? 'Проект' : 'Объект'}: ${parent.title}` : 'Независимая';
    
    ins.innerHTML = `
      <h2>Идея: ${obj.title || 'Без названия'}</h2>
      <div class="kv">Содержание: ${obj.content || 'Нет описания'}</div>
      <div class="kv">Родитель: ${parentInfo}</div>
      <div class="kv">Создано: ${daysSince(obj.createdAt)} дн. назад</div>
      
      ${renderHierarchySection(obj)}
      
      <div class="btns">
        <button class="btn primary" id="editIdea">✏️ Редактировать</button>
        <button class="btn danger" id="delIdea">🗑️ Удалить</button>
      </div>
    `;
    
    document.getElementById("editIdea").onclick = () => {
      const newTitle = prompt("Название идеи:", obj.title);
      if (newTitle && newTitle !== obj.title) {
        obj.title = newTitle;
        obj.updatedAt = Date.now();
        saveState();
        drawMap();
        openInspectorFor(obj);
      }
    };
    
    document.getElementById("delIdea").onclick = () => {
      if (confirm(`Удалить идею "${obj.title}"?`)) {
        state.ideas = state.ideas.filter(i => i.id !== obj.id);
        saveState();
        drawMap();
        openInspectorFor(null);
      }
    };
    
    // Обработчики действий иерархии
    setupHierarchyActionHandlers(obj);
  }
  
  // Обработка заметок
  if (type === "note") {
    console.log("🔍 Inspector: Processing note", obj);
    console.log("🔍 Inspector: Note parentId:", obj.parentId);
    console.log("🔍 Inspector: Note domainId:", obj.domainId);
    
    const parent = getParentObjectFallback(obj);
    console.log("🔍 Inspector: Found parent:", parent);
    
    const parentInfo = parent ? `${parent._type === 'domain' ? 'Домен' : parent._type === 'project' ? 'Проект' : parent._type === 'task' ? 'Задача' : 'Объект'}: ${parent.title}` : 'Независимая';
    
    ins.innerHTML = `
      <h2>Заметка: ${obj.title || 'Без названия'}</h2>
      <div class="kv">Содержание: ${obj.text || 'Нет описания'}</div>
      <div class="kv">Родитель: ${parentInfo}</div>
      <div class="kv">Создано: ${daysSince(obj.createdAt)} дн. назад</div>
      
      ${renderHierarchySection(obj)}
      
      <div class="btns">
        <button class="btn primary" id="editNote">✏️ Редактировать</button>
        <button class="btn danger" id="delNote">🗑️ Удалить</button>
      </div>
    `;
    
    document.getElementById("editNote").onclick = () => {
      const newTitle = prompt("Название заметки:", obj.title);
      if (newTitle && newTitle !== obj.title) {
        obj.title = newTitle;
        obj.updatedAt = Date.now();
        saveState();
        drawMap();
        openInspectorFor(obj);
      }
    };
    
    document.getElementById("delNote").onclick = () => {
      if (confirm(`Удалить заметку "${obj.title}"?`)) {
        state.notes = state.notes.filter(n => n.id !== obj.id);
        saveState();
        drawMap();
        openInspectorFor(null);
      }
    };
    
    // Обработчики действий иерархии
    setupHierarchyActionHandlers(obj);
  }
  
  // Обработка чек-листов
  if (type === "checklist") {
    console.log("🔍 Inspector: Processing checklist", obj.id);
    
    const parent = getParentObjectFallback(obj);
    const parentInfo = parent ? `${parent._type === 'domain' ? 'Домен' : parent._type === 'project' ? 'Проект' : parent._type === 'task' ? 'Задача' : 'Объект'}: ${parent.title}` : 'Независимый';
    
    // Подсчитываем прогресс
    const totalItems = obj.items?.length || 0;
    const completedItems = obj.items?.filter(item => item.completed) || [];
    const progress = totalItems > 0 ? Math.round((completedItems.length / totalItems) * 100) : 0;
    
    ins.innerHTML = `
      <h2>Чек-лист: ${obj.title || 'Без названия'}</h2>
      <div class="kv">Прогресс: ${progress}% (${completedItems.length}/${totalItems})</div>
      <div class="kv">Родитель: ${parentInfo}</div>
      <div class="kv">Создан: ${daysSince(obj.createdAt)} дн. назад</div>
      
      <div class="btns">
        <button class="btn primary" id="editChecklist">✏️ Редактировать</button>
        <button class="btn danger" id="delChecklist">🗑️ Удалить</button>
      </div>
    `;
    
    console.log("🔍 Inspector: Checklist inspector set successfully");
    
    document.getElementById("editChecklist").onclick = () => {
      // Закрываем возможные всплывающие окна, затем открываем редактор
      try { if (typeof window.hideChecklistToggleView === 'function') window.hideChecklistToggleView(); } catch(_) {}
      try { if (typeof window.closeChecklistWindow === 'function') window.closeChecklistWindow(); } catch(_) {}
      window.showChecklistEditor(obj);
    };
    
    document.getElementById("delChecklist").onclick = () => {
      if (confirm(`Удалить чек-лист "${obj.title}"?`)) {
        state.checklists = state.checklists.filter(c => c.id !== obj.id);
        saveState();
        drawMap();
        openInspectorFor(null);
      }
    };
    
    // Обработчики действий иерархии
    setupHierarchyActionHandlers(obj);
  }
}
