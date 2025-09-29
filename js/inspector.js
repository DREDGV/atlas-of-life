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
  
  ins.innerHTML = `
    <h2>Домен: ${obj.title}</h2>
    <div class="kv">Настроение: ${obj.mood || 'нейтральное'}</div>
    <div class="kv">Проектов: ${prjs.length}</div>
    <div class="kv">Задач: ${totalTasks}</div>
    <div class="kv">Создан: ${daysSince(obj.createdAt)} дн. назад</div>
    
    ${renderHierarchySection(obj)}
    
    <div class="btns">
      <button class="btn primary" id="addProject">+ Проект</button>
      <button class="btn danger" id="delDomain">🗑️ Удалить домен</button>
    </div>
  `;
  
  // Обработчики событий
  document.getElementById("addProject").onclick = () => {
    const title = prompt("Название проекта:");
    if (title) {
      const project = createProject(title, obj.id);
      requestLayout();
      openInspectorFor(project);
    }
  };
  
  document.getElementById("delDomain").onclick = () => {
    if (confirm(`Удалить домен "${obj.title}" и все его проекты?`)) {
      state.domains = state.domains.filter(d => d.id !== obj.id);
      state.projects = state.projects.filter(p => p.domainId !== obj.id);
      saveState();
      drawMap();
      showPlaceholder();
    }
  };
  
  setupHierarchyActionHandlers(obj);
}

function showProjectInspector(obj, ins) {
  const tks = tasksOfProject(obj.id);
  
  ins.innerHTML = `
    <h2>Проект: ${obj.title}</h2>
    <div class="kv">Домен: ${domainOf(obj)?.title || 'Независимый'}</div>
    <div class="kv">Теги: #${(obj.tags || []).join(" #")}</div>
    <div class="kv">Задач: ${tks.length}</div>
    <div class="kv">Создан: ${daysSince(obj.createdAt)} дн. назад</div>
    
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
  
  setupHierarchyActionHandlers(obj);
}

function showTaskInspector(obj, ins) {
  ins.innerHTML = `
    <h2>Задача: ${obj.title}</h2>
    <div class="kv">Статус: ${statusPill(obj.status)}</div>
    <div class="kv">Приоритет: ${obj.priority || 'обычный'}</div>
    <div class="kv">Проект: ${project(obj.projectId)?.title || 'Без проекта'}</div>
    <div class="kv">Домен: ${obj.domainId ? byId(state.domains, obj.domainId)?.title || 'Неизвестный домен' : 'Без домена'}</div>
    <div class="kv">Обновлено: ${daysSince(obj.updatedAt)} дн. назад</div>
    
    ${renderHierarchySection(obj)}
    
    <div class="btns">
      <button class="btn primary" id="editTask">✏️ Редактировать</button>
      <button class="btn danger" id="delTask">🗑️ Удалить</button>
    </div>
  `;
  
  // Обработчики событий
  document.getElementById("editTask").onclick = () => {
    const newTitle = prompt("Название задачи:", obj.title);
    if (newTitle && newTitle !== obj.title) {
      obj.title = newTitle;
      obj.updatedAt = Date.now();
      saveState();
      drawMap();
      openInspectorFor(obj);
    }
  };
  
  document.getElementById("delTask").onclick = () => {
    if (confirm(`Удалить задачу "${obj.title}"?`)) {
      state.tasks = state.tasks.filter(t => t.id !== obj.id);
      saveState();
      drawMap();
      showPlaceholder();
    }
  };
  
  setupHierarchyActionHandlers(obj);
}

function showIdeaInspector(obj, ins) {
  const parent = getParentObjectFallback(obj, state);
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
  
  // Обработчики событий
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
      showPlaceholder();
    }
  };
  
  setupHierarchyActionHandlers(obj);
}

function showNoteInspector(obj, ins) {
  const parent = getParentObjectFallback(obj, state);
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
  
  // Обработчики событий
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
      showPlaceholder();
    }
  };
  
  setupHierarchyActionHandlers(obj);
}

function showChecklistInspector(obj, ins) {
  const parent = getParentObjectFallback(obj, state);
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
    
    ${renderHierarchySection(obj)}
    
    <div class="btns">
      <button class="btn primary" id="editChecklist">✏️ Редактировать</button>
      <button class="btn danger" id="delChecklist">🗑️ Удалить</button>
    </div>
  `;
  
  // Обработчики событий
  document.getElementById("editChecklist").onclick = () => {
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
  
  setupHierarchyActionHandlers(obj);
}
