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
  byTypeAndId,
  canChangeHierarchy,
  attachObjectToParent,
  detachObjectFromParent,
  getAvailableParents,
  createChecklist,
  getChecklistsOfProject,
  getChecklistProgress,
  createProject,
  createTask
} from "./state.js";
import { saveState } from "./storage.js";
import { normalizeType, normalizeId } from "./utils/normalize.js";
import { getParentObjectFallback } from "./inspector/utils.js";

// view_map helpers are accessed via window.mapApi to avoid circular import issues
function drawMap() {
  return window.mapApi && window.mapApi.drawMap && window.mapApi.drawMap();
}
function requestLayout() {
  return window.mapApi && window.mapApi.requestLayout && window.mapApi.requestLayout();
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

// Fallback функции для работы с иерархией
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

// Построение полного пути (хлебные крошки) для объекта
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
    return '<div class="hierarchy-actions disabled">🔒 Изменения иерархии заблокированы</div>';
  }
  
  let html = '<div class="hierarchy-actions">';
  
  // Кнопка отвязки от родителя
  if (parent) {
    html += `
      <button class="btn small danger" id="detachFromParent">
        🔗 Отвязать от "${parent.title}"
      </button>
    `;
  }
  
  // Кнопка привязки к новому родителю
  const availableParents = getAvailableParents(obj);
  if (availableParents.length > 0) {
    html += `
      <button class="btn small primary" id="attachToParent">
        🔗 Привязать к родителю
      </button>
    `;
  }
  
  html += '</div>';
  return html;
}

// Настройка обработчиков действий иерархии
function setupHierarchyActionHandlers(obj) {
  const detachBtn = document.getElementById('detachFromParent');
  if (detachBtn) {
    detachBtn.onclick = () => {
      const parent = getParentObjectFallback(obj);
      if (parent && confirm(`Отвязать "${obj.title}" от "${parent.title}"?`)) {
        detachObjectFromParent(obj);
        saveState();
        refreshMap();
        openInspectorFor(obj);
      }
    };
  }
  
  const attachBtn = document.getElementById('attachToParent');
  if (attachBtn) {
    attachBtn.onclick = () => {
      const availableParents = getAvailableParents(obj);
      if (availableParents.length === 0) return;
      
      const options = availableParents.map(p => `${p._type === 'domain' ? 'Домен' : 'Проект'}: ${p.title}`).join('\n');
      const choice = prompt(`Выберите родителя (введите номер):\n${availableParents.map((p, i) => `${i + 1}. ${p._type === 'domain' ? 'Домен' : 'Проект'}: ${p.title}`).join('\n')}`);
      
      if (choice) {
        const index = parseInt(choice) - 1;
        if (index >= 0 && index < availableParents.length) {
          const selectedParent = availableParents[index];
          attachObjectToParent(obj, selectedParent);
          saveState();
          refreshMap();
          openInspectorFor(obj);
        }
      }
    };
  }
}

export function openInspectorFor(objOrSel, state = window.state) {
  if (!objOrSel) return showPlaceholder();

  // objOrSel может быть как объект, так и {type,id}
  const type = normalizeType(objOrSel._type ?? objOrSel.type ?? objOrSel.kind);
  const id = normalizeId(objOrSel.id ?? objOrSel._id);
  const obj = (objOrSel.title || objOrSel.name)
    ? objOrSel
    : byTypeAndId(type, id) ?? objOrSel;

  console.debug('[inspector:open]', { type, id, hasObj: !!(obj && (obj.title||obj.name)) });

  if (!obj) return showPlaceholder();

  const ins = document.getElementById("inspector");
  if (!ins) return;

  switch (type) {
    case 'domain':   return showDomainInspector(obj, ins);
    case 'project':  return showProjectInspector(obj, ins);
    case 'task':     return showTaskInspector(obj, ins);
    case 'idea':     return showIdeaInspector(obj, ins);
    case 'note':     return showNoteInspector(obj, ins);
    case 'checklist': return showChecklistInspector(obj, ins);
    default: {
      // fallback: попробовать открыть родителя по parentId
      const parent = getParentObjectFallback(obj, state);
      if (parent) return openInspectorFor(parent, state);
      return showPlaceholder();
    }
  }
}

function showPlaceholder() {
  const ins = document.getElementById("inspector");
  if (ins) {
    ins.innerHTML = `<div class="hint">Выберите объект на карте, чтобы увидеть детали.</div>`;
  }
}

function showDomainInspector(obj, ins) {
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
    <div class="kv">Настроение: ${obj.mood || 'нейтральное'}</div>
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
  
  // Обработчики событий
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
  
  document.getElementById("delDomain").onclick = () => {
    if (confirm(`Удалить домен "${obj.title}" и все его проекты и задачи?`)) {
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
  
  setupHierarchyActionHandlers(obj);
}

function showProjectInspector(obj, ins) {
  const tks = tasksOfProject(obj.id);
  
  // Инициализируем поля блокировок если их нет
  if (!obj.locks) {
    obj.locks = { move: false, hierarchy: false };
  }
  
  ins.innerHTML = `
    <h2>Проект: ${obj.title}</h2>
    <div class="kv">Домен: ${domainOf(obj)?.title || 'Независимый'}</div>
    <div class="kv">Теги: #${(obj.tags || []).join(" #")}</div>
    <div class="kv">Задач: ${tks.length}</div>
    <div class="kv">Создан: ${daysSince(obj.createdAt)} дн. назад</div>
    
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
      <button class="btn danger" id="delProject">🗑️ Удалить проект</button>
    </div>
  `;
  
  // Обработчики событий
  document.getElementById("addTask").onclick = () => {
    const title = prompt("Название задачи:");
    if (title) {
      const task = createTask(title, obj.id);
      requestLayout();
      openInspectorFor(task);
    }
  };
  
  document.getElementById("addChecklist").onclick = () => {
    const title = prompt("Название чек-листа:");
    if (title) {
      const checklist = createChecklist(title, obj.id);
      requestLayout();
      openInspectorFor(checklist);
    }
  };
  
  document.getElementById("delProject").onclick = () => {
    if (confirm(`Удалить проект "${obj.title}" и все его задачи?`)) {
      state.projects = state.projects.filter(p => p.id !== obj.id);
      state.tasks = state.tasks.filter(t => t.projectId !== obj.id);
      saveState();
      drawMap();
      showPlaceholder();
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
  
  setupHierarchyActionHandlers(obj);
}

function showTaskInspector(obj, ins) {
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
      if (window.renderToday) window.renderToday();
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
    if (window.renderToday) window.renderToday();
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
    if (confirm(`Удалить задачу "${obj.title}"?`)) {
      state.tasks = state.tasks.filter(t => t.id !== obj.id);
      saveState();
      drawMap();
      if (window.renderToday) window.renderToday();
      showPlaceholder();
    }
  };
  
  // Handle "Make project" button
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
      obj.updatedAt = Date.now();
      saveState();
      drawMap();
      if (window.renderToday) window.renderToday();
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
  
  setupHierarchyActionHandlers(obj);
}

function showIdeaInspector(obj, ins) {
  const parent = getParentObjectFallback(obj, state);
  const parentInfo = parent ? `${parent._type === 'domain' ? 'Домен' : parent._type === 'project' ? 'Проект' : 'Объект'}: ${parent.title}` : 'Независимая';
  
  ins.innerHTML = `
    <h2>Идея: ${obj.title || 'Без названия'}</h2>
    
    <!-- Content editing -->
    <div class="kv">
      <label>Описание:</label>
      <div class="content-edit-container" style="margin-top: 4px;">
        <textarea id="ideaContent" placeholder="Опишите вашу идею подробнее..." style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel-1); color: var(--text); resize: vertical;">${obj.content || ''}</textarea>
      </div>
    </div>
    
    <!-- Visual properties -->
    <div class="kv">
      <label>Цвет:</label>
      <div class="color-picker" style="margin-top: 4px;">
        <input type="color" id="ideaColor" value="${obj.color}" style="width: 40px; height: 30px; border: none; border-radius: 4px; cursor: pointer;">
        <div class="color-presets" style="display: flex; gap: 4px; margin-left: 8px;">
          <div class="color-preset" data-color="#ff6b6b" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Красный"></div>
          <div class="color-preset" data-color="#4ecdc4" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Бирюзовый"></div>
          <div class="color-preset" data-color="#45b7d1" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Синий"></div>
          <div class="color-preset" data-color="#96ceb4" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Зеленый"></div>
          <div class="color-preset" data-color="#feca57" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Желтый"></div>
          <div class="color-preset" data-color="#ff9ff3" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Розовый"></div>
        </div>
      </div>
    </div>
    
    <div class="kv">
      <label>Размер:</label>
      <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
        <input type="range" id="ideaSize" min="10" max="40" value="${obj.r}" style="flex: 1;">
        <span id="ideaSizeValue" style="min-width: 40px; font-size: 12px;">${obj.r}px</span>
      </div>
    </div>
    
    <div class="kv">
      <label>Прозрачность:</label>
      <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
        <input type="range" id="ideaOpacity" min="0.1" max="1" step="0.1" value="${obj.opacity}" style="flex: 1;">
        <span id="ideaOpacityValue" style="min-width: 40px; font-size: 12px;">${Math.round(obj.opacity * 100)}%</span>
      </div>
    </div>
    
    <div class="kv">Родитель: ${parentInfo}</div>
    <div class="kv">Создано: ${daysSince(obj.createdAt)} дн. назад</div>
    <div class="kv">Обновлено: ${daysSince(obj.updatedAt)} дн. назад</div>
    
    ${renderHierarchySection(obj)}
    
    <div class="btns">
      <button class="btn primary" id="saveIdea">💾 Сохранить</button>
      <button class="btn" id="editIdeaAdvanced">✏️ Расширенное редактирование</button>
      <button class="btn danger" id="delIdea">🗑️ Удалить</button>
    </div>
  `;
  
  // Обработчики событий
  document.getElementById("saveIdea").onclick = () => {
    const content = document.getElementById("ideaContent").value.trim();
    const color = document.getElementById("ideaColor").value;
    const size = parseInt(document.getElementById("ideaSize").value);
    const opacity = parseFloat(document.getElementById("ideaOpacity").value);
    
    obj.content = content;
    obj.color = color;
    obj.r = size;
    obj.opacity = opacity;
    obj.updatedAt = Date.now();
    
    saveState();
    drawMap();
    openInspectorFor(obj);
  };
  
  document.getElementById("editIdeaAdvanced").onclick = () => {
    if (window.showIdeaEditor) {
      window.showIdeaEditor(obj);
    }
  };
  
  document.getElementById("delIdea").onclick = () => {
    if (confirm(`Удалить идею "${obj.title}"?`)) {
      state.ideas = state.ideas.filter(i => i.id !== obj.id);
      saveState();
      drawMap();
      showPlaceholder();
    }
  };
  
  // Обработчики цветовых пресетов
  document.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const color = preset.dataset.color;
      document.getElementById('ideaColor').value = color;
    });
  });
  
  // Обработчики слайдеров
  document.getElementById('ideaSize').addEventListener('input', (e) => {
    document.getElementById('ideaSizeValue').textContent = e.target.value + 'px';
  });
  
  document.getElementById('ideaOpacity').addEventListener('input', (e) => {
    document.getElementById('ideaOpacityValue').textContent = Math.round(e.target.value * 100) + '%';
  });
  
  setupHierarchyActionHandlers(obj);
}

function showNoteInspector(obj, ins) {
  const parent = getParentObjectFallback(obj, state);
  const parentInfo = parent ? `${parent._type === 'domain' ? 'Домен' : parent._type === 'project' ? 'Проект' : parent._type === 'task' ? 'Задача' : 'Объект'}: ${parent.title}` : 'Независимая';
  
  ins.innerHTML = `
    <h2>Заметка: ${obj.title || 'Без названия'}</h2>
    
    <!-- Content editing -->
    <div class="kv">
      <label>Содержание:</label>
      <div class="content-edit-container" style="margin-top: 4px;">
        <textarea id="noteText" placeholder="Введите текст заметки..." style="width: 100%; min-height: 80px; padding: 8px; border: 1px solid var(--panel-2); border-radius: 4px; background: var(--panel-1); color: var(--text); resize: vertical;">${obj.text || ''}</textarea>
      </div>
    </div>
    
    <!-- Visual properties -->
    <div class="kv">
      <label>Цвет:</label>
      <div class="color-picker" style="margin-top: 4px;">
        <input type="color" id="noteColor" value="${obj.color}" style="width: 40px; height: 30px; border: none; border-radius: 4px; cursor: pointer;">
        <div class="color-presets" style="display: flex; gap: 4px; margin-left: 8px;">
          <div class="color-preset" data-color="#6b7280" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Серый"></div>
          <div class="color-preset" data-color="#4b5563" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Темно-серый"></div>
          <div class="color-preset" data-color="#374151" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Очень темно-серый"></div>
          <div class="color-preset" data-color="#1f2937" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Почти черный"></div>
          <div class="color-preset" data-color="#059669" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Зеленый"></div>
          <div class="color-preset" data-color="#dc2626" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Красный"></div>
        </div>
      </div>
    </div>
    
    <div class="kv">
      <label>Размер:</label>
      <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
        <input type="range" id="noteSize" min="8" max="30" value="${obj.r}" style="flex: 1;">
        <span id="noteSizeValue" style="min-width: 40px; font-size: 12px;">${obj.r}px</span>
      </div>
    </div>
    
    <div class="kv">
      <label>Прозрачность:</label>
      <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
        <input type="range" id="noteOpacity" min="0.1" max="1" step="0.1" value="${obj.opacity}" style="flex: 1;">
        <span id="noteOpacityValue" style="min-width: 40px; font-size: 12px;">${Math.round(obj.opacity * 100)}%</span>
      </div>
    </div>
    
    <div class="kv">Родитель: ${parentInfo}</div>
    <div class="kv">Создано: ${daysSince(obj.createdAt)} дн. назад</div>
    <div class="kv">Обновлено: ${daysSince(obj.updatedAt)} дн. назад</div>
    
    ${renderHierarchySection(obj)}
    
    <div class="btns">
      <button class="btn primary" id="saveNote">💾 Сохранить</button>
      <button class="btn" id="editNoteAdvanced">✏️ Расширенное редактирование</button>
      <button class="btn danger" id="delNote">🗑️ Удалить</button>
    </div>
  `;
  
  // Обработчики событий
  document.getElementById("saveNote").onclick = () => {
    const text = document.getElementById("noteText").value.trim();
    const color = document.getElementById("noteColor").value;
    const size = parseInt(document.getElementById("noteSize").value);
    const opacity = parseFloat(document.getElementById("noteOpacity").value);
    
    obj.text = text;
    obj.color = color;
    obj.r = size;
    obj.opacity = opacity;
    obj.updatedAt = Date.now();
    
    saveState();
    drawMap();
    openInspectorFor(obj);
  };
  
  document.getElementById("editNoteAdvanced").onclick = () => {
    if (window.showNoteEditor) {
      window.showNoteEditor(obj);
    }
  };
  
  document.getElementById("delNote").onclick = () => {
    if (confirm(`Удалить заметку "${obj.title}"?`)) {
      state.notes = state.notes.filter(n => n.id !== obj.id);
      saveState();
      drawMap();
      showPlaceholder();
    }
  };
  
  // Обработчики цветовых пресетов
  document.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const color = preset.dataset.color;
      document.getElementById('noteColor').value = color;
    });
  });
  
  // Обработчики слайдеров
  document.getElementById('noteSize').addEventListener('input', (e) => {
    document.getElementById('noteSizeValue').textContent = e.target.value + 'px';
  });
  
  document.getElementById('noteOpacity').addEventListener('input', (e) => {
    document.getElementById('noteOpacityValue').textContent = Math.round(e.target.value * 100) + '%';
  });
  
  setupHierarchyActionHandlers(obj);
}

function showChecklistInspector(obj, ins) {
  const parent = getParentObjectFallback(obj, state);
  const parentInfo = parent ? `${parent._type === 'domain' ? 'Домен' : parent._type === 'project' ? 'Проект' : parent._type === 'task' ? 'Задача' : 'Объект'}: ${parent.title}` : 'Независимый';
  
  // Подсчитываем прогресс
  const totalItems = obj.items?.length || 0;
  const completedItems = obj.items?.filter(item => item.completed) || [];
  const progress = totalItems > 0 ? Math.round((completedItems.length / totalItems) * 100) : 0;
  
  // Показываем элементы чек-листа
  const itemsHtml = obj.items && obj.items.length > 0 ? 
    obj.items.map(item => `
      <div class="checklist-item-preview" style="display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--panel-2);">
        <input type="checkbox" ${item.completed ? 'checked' : ''} disabled style="margin: 0;">
        <span style="flex: 1; ${item.completed ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${item.text || 'Пустой элемент'}</span>
      </div>
    `).join('') : 
    '<div style="color: var(--muted); font-style: italic; padding: 8px 0;">Нет элементов</div>';
  
  ins.innerHTML = `
    <h2>Чек-лист: ${obj.title || 'Без названия'}</h2>
    
    <!-- Progress -->
    <div class="kv">
      <label>Прогресс:</label>
      <div style="margin-top: 4px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="flex: 1; height: 8px; background: var(--panel-2); border-radius: 4px; overflow: hidden;">
            <div style="height: 100%; background: var(--ok); width: ${progress}%; transition: width 0.3s ease;"></div>
          </div>
          <span style="min-width: 60px; font-size: 12px; font-weight: bold;">${progress}%</span>
        </div>
        <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">${completedItems.length} из ${totalItems} выполнено</div>
      </div>
    </div>
    
    <!-- Items preview -->
    <div class="kv">
      <label>Элементы:</label>
      <div class="checklist-items-preview" style="margin-top: 4px; max-height: 120px; overflow-y: auto; border: 1px solid var(--panel-2); border-radius: 4px; padding: 8px;">
        ${itemsHtml}
      </div>
    </div>
    
    <!-- Visual properties -->
    <div class="kv">
      <label>Цвет:</label>
      <div class="color-picker" style="margin-top: 4px;">
        <input type="color" id="checklistColor" value="${obj.color}" style="width: 40px; height: 30px; border: none; border-radius: 4px; cursor: pointer;">
        <div class="color-presets" style="display: flex; gap: 4px; margin-left: 8px;">
          <div class="color-preset" data-color="#3b82f6" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Синий"></div>
          <div class="color-preset" data-color="#10b981" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Зеленый"></div>
          <div class="color-preset" data-color="#f59e0b" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Оранжевый"></div>
          <div class="color-preset" data-color="#ef4444" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Красный"></div>
          <div class="color-preset" data-color="#8b5cf6" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Фиолетовый"></div>
          <div class="color-preset" data-color="#06b6d4" style="width: 20px; height: 20px; border-radius: 50%; cursor: pointer; border: 2px solid transparent;" title="Голубой"></div>
        </div>
      </div>
    </div>
    
    <div class="kv">
      <label>Размер:</label>
      <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
        <input type="range" id="checklistSize" min="15" max="35" value="${obj.r}" style="flex: 1;">
        <span id="checklistSizeValue" style="min-width: 40px; font-size: 12px;">${obj.r}px</span>
      </div>
    </div>
    
    <div class="kv">
      <label>Прозрачность:</label>
      <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
        <input type="range" id="checklistOpacity" min="0.1" max="1" step="0.1" value="${obj.opacity}" style="flex: 1;">
        <span id="checklistOpacityValue" style="min-width: 40px; font-size: 12px;">${Math.round(obj.opacity * 100)}%</span>
      </div>
    </div>
    
    <div class="kv">Родитель: ${parentInfo}</div>
    <div class="kv">Создан: ${daysSince(obj.createdAt)} дн. назад</div>
    <div class="kv">Обновлен: ${daysSince(obj.updatedAt)} дн. назад</div>
    
    ${renderHierarchySection(obj)}
    
    <div class="btns">
      <button class="btn primary" id="saveChecklist">💾 Сохранить</button>
      <button class="btn" id="editChecklistAdvanced">✏️ Редактировать элементы</button>
      <button class="btn danger" id="delChecklist">🗑️ Удалить</button>
    </div>
  `;
  
  // Обработчики событий
  document.getElementById("saveChecklist").onclick = () => {
    const color = document.getElementById("checklistColor").value;
    const size = parseInt(document.getElementById("checklistSize").value);
    const opacity = parseFloat(document.getElementById("checklistOpacity").value);
    
    obj.color = color;
    obj.r = size;
    obj.opacity = opacity;
    obj.updatedAt = Date.now();
    
    saveState();
    drawMap();
    openInspectorFor(obj);
  };
  
  document.getElementById("editChecklistAdvanced").onclick = () => {
    if (window.showChecklistEditor) {
      window.showChecklistEditor(obj);
    }
  };
  
  document.getElementById("delChecklist").onclick = () => {
    if (confirm(`Удалить чек-лист "${obj.title}"?`)) {
      state.checklists = state.checklists.filter(c => c.id !== obj.id);
      saveState();
      drawMap();
      showPlaceholder();
    }
  };
  
  // Обработчики цветовых пресетов
  document.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const color = preset.dataset.color;
      document.getElementById('checklistColor').value = color;
    });
  });
  
  // Обработчики слайдеров
  document.getElementById('checklistSize').addEventListener('input', (e) => {
    document.getElementById('checklistSizeValue').textContent = e.target.value + 'px';
  });
  
  document.getElementById('checklistOpacity').addEventListener('input', (e) => {
    document.getElementById('checklistOpacityValue').textContent = Math.round(e.target.value * 100) + '%';
  });
  
  setupHierarchyActionHandlers(obj);
}
