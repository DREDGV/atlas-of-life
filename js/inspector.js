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
  createTask,
  saveState
} from "./state.js";
import { normalizeType, normalizeId } from "./utils/normalize.js";
import { getParentObjectFallback } from "./inspector/utils.js";

// view_map helpers are accessed via window.mapApi to avoid circular import issues
function drawMap() {
  return window.mapApi && window.mapApi.drawMap && window.mapApi.drawMap();
}
function requestLayout() {
  return window.mapApi && window.mapApi.requestLayout && window.mapApi.requestLayout();
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
}

function showProjectInspector(obj, ins) {
  const tks = tasksOfProject(obj.id);
  
  ins.innerHTML = `
    <h2>Проект: ${obj.title}</h2>
    <div class="kv">Домен: ${domainOf(obj)?.title || 'Независимый'}</div>
    <div class="kv">Теги: #${(obj.tags || []).join(" #")}</div>
    <div class="kv">Задач: ${tks.length}</div>
    <div class="kv">Создан: ${daysSince(obj.createdAt)} дн. назад</div>
    
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
}

function showTaskInspector(obj, ins) {
  ins.innerHTML = `
    <h2>Задача: ${obj.title}</h2>
    <div class="kv">Статус: ${statusPill(obj.status)}</div>
    <div class="kv">Приоритет: ${obj.priority || 'обычный'}</div>
    <div class="kv">Проект: ${project(obj.projectId)?.title || 'Без проекта'}</div>
    <div class="kv">Домен: ${obj.domainId ? byId(state.domains, obj.domainId)?.title || 'Неизвестный домен' : 'Без домена'}</div>
    <div class="kv">Обновлено: ${daysSince(obj.updatedAt)} дн. назад</div>
    
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
}

function showIdeaInspector(obj, ins) {
  const parent = getParentObjectFallback(obj, state);
  const parentInfo = parent ? `${parent._type === 'domain' ? 'Домен' : parent._type === 'project' ? 'Проект' : 'Объект'}: ${parent.title}` : 'Независимая';
  
  ins.innerHTML = `
    <h2>Идея: ${obj.title || 'Без названия'}</h2>
    <div class="kv">Содержание: ${obj.content || 'Нет описания'}</div>
    <div class="kv">Родитель: ${parentInfo}</div>
    <div class="kv">Создано: ${daysSince(obj.createdAt)} дн. назад</div>
    
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
}

function showNoteInspector(obj, ins) {
  const parent = getParentObjectFallback(obj, state);
  const parentInfo = parent ? `${parent._type === 'domain' ? 'Домен' : parent._type === 'project' ? 'Проект' : parent._type === 'task' ? 'Задача' : 'Объект'}: ${parent.title}` : 'Независимая';
  
  ins.innerHTML = `
    <h2>Заметка: ${obj.title || 'Без названия'}</h2>
    <div class="kv">Содержание: ${obj.text || 'Нет описания'}</div>
    <div class="kv">Родитель: ${parentInfo}</div>
    <div class="kv">Создано: ${daysSince(obj.createdAt)} дн. назад</div>
    
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
}
