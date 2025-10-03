// js/state.js
import { saveState } from "./storage.js";
import { 
  initHierarchyFields,
  setParentChild,
  removeParentChild,
  getParentObject,
  getChildObjects,
  validateHierarchy,
  isObjectLocked,
  setObjectLock,
  canMoveObject,
  canChangeHierarchy,
  attach as _hAttach,
  detach as _hDetach,
  move as _hMove,
  getType as _hGetType,
  getParentObject as _hGetParentObject
} from "./hierarchy/index.js";

export const state = {
  view:'map',
  showLinks:true, showAging:true, showGlow:true,
  activeDomain:null,
  filterTag:null,
  wipLimit:3,
  // Журнал изменений иерархии (кольцевой буфер)
  hierarchyLog: [],
  settings: {
    layoutMode: 'auto',
    wipTodayLimit: 5,
    enableHierarchyV2: false, // Флаг для включения новой системы иерархии
    mapVersion: 'v2', // 'v1' (legacy) | 'v2' (modular) - по умолчанию v2
    checklistIconMode: 'hybrid', // 'hybrid' | 'title' | 'minimal' | 'preview2' | 'preview3'
    hotkeys: {
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
    }
  },
  ui: {
    features: {
      checklist: true, // Фичефлаг для системы чек-листов
      modularMap: false // Фичефлаг новой модульной карты (v2)
    }
  },
  inbox: [], // Inbox items for quick capture
  domains:[],
  projects:[],
  tasks:[],
  ideas:[],
  notes:[],
  checklists:[],
  maxEdges:300
};

// Цветовые палитры для проектов
export const PROJECT_COLOR_PRESETS = [
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#ef4444', '#f97316', '#84cc16', '#06b6d4', '#8b5cf6', '#ec4899'
];

// Функция для поиска объекта по ID в массиве
export function byId(array, id) {
  return array.find(item => item.id === id);
}

// Функция для получения проекта по ID
export function project(projectId) {
  return state.projects.find(p => p.id === projectId);
}

// Функция для получения домена объекта
export function domainOf(obj) {
  if (obj.domainId) {
    return state.domains.find(d => d.id === obj.domainId);
  }
  return null;
}

// Функция для получения задач проекта
export function tasksOfProject(projectId) {
  return state.tasks.filter(t => t.projectId === projectId);
}

// Функция для подсчета дней с даты
export function daysSince(timestamp) {
  if (!timestamp || isNaN(timestamp)) {
    return 0; // Если дата не задана, считаем что обновлено сегодня
  }
  return Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
}

// Функция для получения контрастного цвета
export function getContrastColor(hexColor) {
  // Удаляем # если есть
  const hex = hexColor.replace('#', '');
  
  // Конвертируем в RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Вычисляем яркость
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  
  // Возвращаем черный или белый в зависимости от яркости
  return brightness > 128 ? '#000000' : '#ffffff';
}

// Функция для ограничения значения в диапазоне
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// DOM утилиты
export function $(selector) {
  return document.querySelector(selector);
}

export function $$(selector) {
  return document.querySelectorAll(selector);
}

// Функция для привязки объекта к родителю
export function attachObjectToParent(childArg, childTypeArg, parentArg, parentTypeArg) {
  try {
    // Универсальная нормализация аргументов (совместимость со старыми и новыми вызовами)
    // Поддерживаем формы:
    // 1) (childId, childType, parentId, parentType)
    // 2) (childObj, parentObj)
    // 3) (childObj, childType, parentObj, parentType)
    let childObj, parentObj, childType, parentType;
    if (typeof childArg === 'object' && typeof childTypeArg === 'object' && parentArg == null) {
      // форма (childObj, parentObj)
      childObj = childArg; parentObj = childTypeArg;
      childType = _hGetType(childObj); parentType = _hGetType(parentObj);
    } else {
      childObj = typeof childArg === 'object' ? childArg : findObjectById(childArg);
      parentObj = typeof parentArg === 'object' ? parentArg : findObjectById(parentArg);
      childType = typeof childTypeArg === 'string' ? childTypeArg : _hGetType(childObj);
      parentType = typeof parentTypeArg === 'string' ? parentTypeArg : _hGetType(parentObj);
    }

    const child = childObj;
    const parent = parentObj;
    
    if (!child) {
      console.error(`Объект ${childId} не найден`);
      return false;
    }
    
    if (!parent) {
      console.error(`Родитель ${parentId} не найден`);
      return false;
    }
    
    // Устанавливаем связь через новый слой (с обратной совместимостью)
    const res = _hAttach({ parentType, parentId: parent.id, childType, childId: child.id }, state);
    const success = !!res.ok || setParentChild(parent.id, child.id, childType, state);
    
    if (success) {
      console.log(`✅ Объект ${child.id} привязан к ${parent.id}`);
      saveState();
      return true;
    } else {
      console.error(`❌ Не удалось привязать ${child?.id} к ${parent?.id}`);
      return false;
    }
    
  } catch (error) {
    console.error('Ошибка привязки объекта:', error);
    return false;
  }
}

// Функция для отвязки объекта от родителя
export function detachObjectFromParent(childArg, childTypeArg) {
  try {
    const child = typeof childArg === 'object' ? childArg : findObjectById(childArg);
    const childType = typeof childTypeArg === 'string' ? childTypeArg : _hGetType(child);
    if (!child) {
      console.error(`Объект не найден`);
      return false;
    }
    
    // Отвязываем от родителя
    const res = _hDetach({ childType, childId: child.id }, state);
    const success = !!res.ok || removeParentChild(child.parentId, child.id, childType, state);
    
    if (success) {
      // Очищаем поля связи в зависимости от типа
      if (childType === 'project') {
        child.domainId = null;
      } else if (childType === 'task') {
        child.projectId = null;
        child.domainId = null;
      } else if (childType === 'idea' || childType === 'note') {
        child.domainId = null;
      }
      
      console.log(`✅ Объект ${child.id} отвязан от родителя`);
      saveState();
      return true;
    } else {
      console.error(`❌ Не удалось отвязать ${child.id} от родителя`);
      return false;
    }
    
  } catch (error) {
    console.error('Ошибка отвязки объекта:', error);
    return false;
  }
}

// Функция для получения доступных родителей для объекта
export function getAvailableParents(childType) {
  const parents = [];
  
  // Домены могут быть родителями для всех типов
  if (childType === 'project' || childType === 'task' || childType === 'idea' || childType === 'note') {
    parents.push(...state.domains.map(d => ({ ...d, _type: 'domain' })));
  }
  
  // Проекты могут быть родителями для задач
  if (childType === 'task') {
    parents.push(...state.projects.map(p => ({ ...p, _type: 'project' })));
  }
  
  return parents;
}

// Журнал изменений иерархии
export function logHierarchyChange(action, child, fromParent, toParent) {
  if (!state.hierarchyLog) state.hierarchyLog = [];
  
  const entry = {
    ts: Date.now(),
    action: action, // 'attach', 'detach', 'move'
    child: { type: _hGetType(child), id: child.id, title: child.title },
    from: fromParent ? { type: _hGetType(fromParent), id: fromParent.id, title: fromParent.title } : null,
    to: toParent ? { type: _hGetType(toParent), id: toParent.id, title: toParent.title } : null
  };
  
  // Кольцевой буфер (максимум 300 записей)
  state.hierarchyLog.unshift(entry);
  if (state.hierarchyLog.length > 300) {
    state.hierarchyLog = state.hierarchyLog.slice(0, 300);
  }
  
  // Записываем историю в сам объект
  const historyDetails = {
    fromParentId: fromParent?.id || null,
    toParentId: toParent?.id || null,
    parentType: toParent ? _hGetType(toParent) : null,
    childType: _hGetType(child),
    fromParentTitle: fromParent?.title || null,
    toParentTitle: toParent?.title || null
  };
  
  addHierarchyHistory(child.id, action, historyDetails);
}

// Обёртки над новым иерархическим API (единая точка входа из UI/DnD)
export function attachChild({ parentType, parentId, childType, childId }) {
  const res = _hAttach({ parentType, parentId, childType, childId }, state);
  if (!res.ok) {
    console.warn(`⚠️ attachChild failed: ${res.error}`, { parentType, parentId, childType, childId });
    return res;
  }
  
  // Логируем изменение (даже если есть проблемы с валидацией)
  const child = byId(state, childId);
  const parent = byId(state, parentId);
  if (child && parent) {
    try {
      logHierarchyChange('attach', child, null, parent);
      console.log(`📝 История: записано прикрепление ${child.id} к ${parent.id}`);
    } catch (error) {
      console.warn('⚠️ Ошибка записи истории при attach:', error);
    }
  } else {
    console.warn('⚠️ Не удалось найти объекты для записи истории:', { child: !!child, parent: !!parent });
  }
  
  try { saveState(); } catch(_) {}
  try { if (window.layoutMap) window.layoutMap(); if (window.drawMap) window.drawMap(); } catch(_) {}
  return res;
}

export function detachChild({ childType, childId }) {
  const child = byId(state, childId);
  const fromParent = child ? _hGetParentObject(child, state) : null;
  
  const res = _hDetach({ childType, childId }, state);
  if (!res.ok) {
    console.warn(`⚠️ detachChild failed: ${res.error}`, { childType, childId });
    return res;
  }
  
  // Логируем изменение (даже если есть проблемы с валидацией)
  if (child && fromParent) {
    try {
      logHierarchyChange('detach', child, fromParent, null);
      console.log(`📝 История: записано открепление ${child.id} от ${fromParent.id}`);
    } catch (error) {
      console.warn('⚠️ Ошибка записи истории при detach:', error);
    }
  } else {
    console.warn('⚠️ Не удалось найти объекты для записи истории detach:', { child: !!child, fromParent: !!fromParent });
  }
  
  try { saveState(); } catch(_) {}
  try { if (window.layoutMap) window.layoutMap(); if (window.drawMap) window.drawMap(); } catch(_) {}
  return res;
}

export function moveChild({ toParentType, toParentId, childType, childId }) {
  const child = byId(state, childId);
  const fromParent = child ? _hGetParentObject(child, state) : null;
  const toParent = byId(state, toParentId);
  
  const res = _hMove({ toParentType, toParentId, childType, childId }, state);
  if (!res.ok) {
    console.warn(`⚠️ moveChild failed: ${res.error}`, { toParentType, toParentId, childType, childId });
    return res;
  }
  
  // Логируем изменение (даже если есть проблемы с валидацией)
  if (child && toParent) {
    try {
      logHierarchyChange('move', child, fromParent, toParent);
      console.log(`📝 История: записано перемещение ${child.id} из ${fromParent?.id || 'null'} в ${toParent.id}`);
    } catch (error) {
      console.warn('⚠️ Ошибка записи истории при move:', error);
    }
  } else {
    console.warn('⚠️ Не удалось найти объекты для записи истории move:', { child: !!child, toParent: !!toParent });
  }
  
  try { saveState(); } catch(_) {}
  try { if (window.layoutMap) window.layoutMap(); if (window.drawMap) window.drawMap(); } catch(_) {}
  return res;
}

// Реэкспорт функций из модуля hierarchy/index.js
export {
  canChangeHierarchy,
  getChildObjects,
  getParentObject,
  initHierarchyFields,
  setParentChild,
  removeParentChild,
  isObjectLocked,
  setObjectLock,
  canMoveObject
};

// Дополнительные функции для совместимости
export function clearHierarchy() {
  // Очистка иерархии - сброс всех связей
  state.domains.forEach(domain => {
    domain.parentId = null;
    domain.children = { projects: [], tasks: [], ideas: [], notes: [] };
  });
  state.projects.forEach(project => {
    project.parentId = null;
    project.children = { tasks: [], ideas: [], notes: [] };
  });
  state.tasks.forEach(task => {
    task.parentId = null;
    task.children = { ideas: [], notes: [] };
  });
  state.ideas.forEach(idea => {
    idea.parentId = null;
    idea.children = { ideas: [], notes: [] };
  });
  state.notes.forEach(note => {
    note.parentId = null;
    note.children = { ideas: [], notes: [] };
  });
}

export function getLockedObjects() {
  const locked = [];
  [...state.domains, ...state.projects, ...state.tasks, ...state.ideas, ...state.notes].forEach(obj => {
    if (obj.locks && (obj.locks.move || obj.locks.hierarchy)) {
      locked.push(obj);
    }
  });
  return locked;
}

export function isHierarchyV2Enabled() {
  return state.hierarchyV2Enabled || false;
}

export function setHierarchyV2Enabled(enabled) {
  state.hierarchyV2Enabled = enabled;
}

// Дублированная функция удалена - используется версия ниже


// Дублированная функция удалена - используется версия ниже

export const now = Date.now();

export const days = d => now - d*24*3600*1000;

export function initDemoData(){
  // Demo domains
  state.domains = [
    {id: 'd1', title: 'Работа', mood: 'productive', x: -200, y: -100, r: 80, color: '#2dd4bf', opacity: 1.0, createdAt: days(30)},
    {id: 'd2', title: 'Дом', mood: 'cozy', x: 200, y: -100, r: 80, color: '#f59e0b', opacity: 1.0, createdAt: days(25)},
    {id: 'd3', title: 'Хобби', mood: 'creative', x: 0, y: 150, r: 80, color: '#8b5cf6', opacity: 1.0, createdAt: days(20)}
  ];

  // Demo projects
  state.projects = [
    {id: 'p1', title: 'Веб-сайт', domainId: 'd1', x: -300, y: -200, r: 40, color: '#06b6d4', opacity: 1.0, createdAt: days(15)},
    {id: 'p2', title: 'Ремонт', domainId: 'd2', x: 300, y: -200, r: 40, color: '#f97316', opacity: 1.0, createdAt: days(10)},
    {id: 'p3', title: 'Рисование', domainId: 'd3', x: 0, y: 50, r: 40, color: '#a855f7', opacity: 1.0, createdAt: days(5)}
  ];

  // Demo tasks
  state.tasks = [
    {id: 't1', title: 'Дизайн главной страницы', projectId: 'p1', status: 'doing', priority: 1, x: -400, y: -300, r: 20, color: '#0891b2', opacity: 1.0, createdAt: days(3)},
    {id: 't2', title: 'Настроить сервер', projectId: 'p1', status: 'today', priority: 2, x: -200, y: -300, r: 20, color: '#0e7490', opacity: 1.0, createdAt: days(2)},
    {id: 't3', title: 'Купить краску', projectId: 'p2', status: 'backlog', priority: 3, x: 400, y: -300, r: 20, color: '#ea580c', opacity: 1.0, createdAt: days(1)},
    {id: 't4', title: 'Нарисовать пейзаж', projectId: 'p3', status: 'done', priority: 4, x: 0, y: -50, r: 20, color: '#9333ea', opacity: 1.0, createdAt: days(0)}
  ];

  // Demo ideas
  state.ideas = [
    {id: 'i1', title: 'Идея для нового проекта', content: 'Создать мобильное приложение для управления задачами', domainId: 'd1', x: -100, y: 100, r: 15, color: '#ec4899', opacity: 1.0, createdAt: days(1)},
    {id: 'i2', title: 'Творческая идея', content: 'Написать книгу о путешествиях', domainId: 'd3', x: 100, y: 100, r: 15, color: '#be185d', opacity: 1.0, createdAt: days(0)}
  ];

  // Demo notes
  state.notes = [
    {id: 'n1', title: 'Важная заметка', text: 'Не забыть про встречу завтра в 10:00', domainId: 'd1', x: -100, y: 200, r: 12, color: '#6b7280', opacity: 1.0, createdAt: days(1)},
    {id: 'n2', title: 'Полезная информация', text: 'Рецепт борща: мясо, свекла, капуста, морковь', domainId: 'd2', x: 100, y: 200, r: 12, color: '#4b5563', opacity: 1.0, createdAt: days(0)}
  ];
}

export function generateId() {
  return Math.random().toString(36).slice(2, 8);
}

export function colorByAging(ts){
  const age = now - ts;
  const days = age / (24 * 3600 * 1000);
  if (days < 1) return '#10b981'; // green
  if (days < 7) return '#f59e0b'; // yellow
  if (days < 30) return '#f97316'; // orange
  return '#ef4444'; // red
}

export function sizeByImportance(item){
  // Задачи должны быть меньше и помещаться в проекты
  return Math.max(12, Math.min(24, 12 + (item.priority || 1) * 4));
}

export function statusPill(s){
  const pills = {
    'backlog': {text: 'План', color: '#6b7280'},
    'today': {text: 'Сегодня', color: '#3b82f6'},
    'doing': {text: 'Делаю', color: '#f59e0b'},
    'done': {text: 'Готово', color: '#10b981'}
  };
  return pills[s] || pills['backlog'];
}

export function getRandomProjectColor() {
  const colors = ['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function getProjectColor(project) {
  return project.color || getRandomProjectColor();
}

export function getDomainMood(domain) {
  return domain.mood || 'balance';
}

export function getMoodColor(mood) {
  const moodColors = {
    'productive': '#10b981',
    'cozy': '#f59e0b', 
    'creative': '#8b5cf6',
    'balance': '#3b82f6',
    'focused': '#ef4444',
    'relaxed': '#06b6d4'
  };
  return moodColors[mood] || moodColors.balance;
}

export function getMoodDescription(mood) {
  const descriptions = {
    'productive': 'Продуктивный - высокая эффективность и концентрация',
    'cozy': 'Уютный - комфорт и расслабление',
    'creative': 'Творческий - вдохновение и креативность',
    'balance': 'Сбалансированный - гармония между разными аспектами',
    'focused': 'Сфокусированный - глубокое погружение в задачу',
    'relaxed': 'Расслабленный - спокойствие и отдых'
  };

  return descriptions[mood] || descriptions.balance;
}

// ===== СИСТЕМА ИЕРАРХИИ V2 =====

/**
 * Получение объекта по ID
 * @param {string} id - ID объекта
 * @returns {Object|null} Объект или null
 */
export function findObjectById(id) {
  const allObjects = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes,
    ...state.checklists            // добавить чек-листы
  ];
  return allObjects.find(obj => obj.id === id) || null;
}

// @ts-check
export function byTypeAndId(type, id) {
  switch (type) {
    case 'domain':    return state.domains?.find?.(d => d.id === id)   ?? null;
    case 'project':   return state.projects?.find?.(p => p.id === id)  ?? null;
    case 'task':      return state.tasks?.find?.(t => t.id === id)     ?? null;
    case 'idea':      return state.ideas?.find?.(i => i.id === id)     ?? null;
    case 'note':      return state.notes?.find?.(n => n.id === id)     ?? null;
    case 'checklist': return state.checklists?.find?.(c => c.id === id)?? null;
    default:          return null;
  }
}

/**
 * Получение типа объекта
 * @param {Object} obj - Объект
 * @returns {string} Тип объекта
 */
export function getObjectType(obj) {
  if (obj.title && obj.mood) return 'domain';
  if (obj.title && obj.domainId) return 'project';
  if (obj.title && obj.status) return 'task';
  if (obj.title && obj.content) return 'idea';
  if (obj.title && obj.text) return 'note';
  return 'unknown';
}

/**
 * Инициализация системы иерархии для всех объектов
 * @returns {Object} Результат инициализации
 */
export function initializeHierarchySystem() {
  try {
    console.log('🚀 Инициализация системы иерархии v2...');
    
    const result = {
      success: false,
      processedObjects: 0,
      errors: [],
      warnings: []
    };

    // Инициализируем поля иерархии для всех объектов
    const allObjects = [
      ...state.domains,
      ...state.projects,
      ...state.tasks,
      ...state.ideas,
      ...state.notes
    ];

    allObjects.forEach(obj => {
      try {
        const objType = getObjectType(obj);
        initHierarchyFields(obj, objType);
        result.processedObjects++;
      } catch (error) {
        result.errors.push(`Ошибка инициализации ${obj.id}: ${error.message}`);
      }
    });

    // Валидируем иерархию
    const validationErrors = validateHierarchy(state);
    if (validationErrors.length > 0) {
      result.warnings.push(`Найдено ${validationErrors.length} ошибок валидации`);
    }

    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log(`✅ Система иерархии инициализирована. Обработано объектов: ${result.processedObjects}`);
    } else {
      console.warn(`⚠️ Инициализация завершена с ошибками. Ошибок: ${result.errors.length}`);
    }

    return result;

  } catch (error) {
    console.error('❌ initializeHierarchySystem: Критическая ошибка инициализации:', error);
    return {
      success: false,
      processedObjects: 0,
      errors: [`Критическая ошибка: ${error.message}`],
      warnings: []
    };
  }
}

/**
 * Восстановление связей на основе существующих полей
 * @returns {Object} Результат восстановления
 */
export function restoreHierarchyConnections() {
  try {
    console.log('🔗 Восстановление связей иерархии...');
    
    const result = {
      success: false,
      restoredConnections: 0,
      errors: [],
      details: []
    };

    // Восстанавливаем связи проектов с доменами
    state.projects.forEach(project => {
      if (project.domainId) {
        try {
          if (setParentChild(project.domainId, project.id, 'project', state)) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${project.domainId} → ${project.id} (project)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи проекта ${project.id}: ${error.message}`);
        }
      }
    });

    // Восстанавливаем связи задач с проектами или доменами
    state.tasks.forEach(task => {
      if (task.projectId) {
        try {
          if (setParentChild(task.projectId, task.id, 'task', state)) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${task.projectId} → ${task.id} (task)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи задачи ${task.id}: ${error.message}`);
        }
      } else if (task.domainId) {
        try {
          if (setParentChild(task.domainId, task.id, 'task', state)) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${task.domainId} → ${task.id} (task)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи задачи ${task.id}: ${error.message}`);
        }
      }
    });

    // Восстанавливаем связи идей с доменами
    state.ideas.forEach(idea => {
      if (idea.domainId) {
        try {
          if (setParentChild(idea.domainId, idea.id, 'idea', state)) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${idea.domainId} → ${idea.id} (idea)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи идеи ${idea.id}: ${error.message}`);
        }
      }
    });

    // Восстанавливаем связи заметок с доменами
    state.notes.forEach(note => {
      if (note.domainId) {
        try {
          if (setParentChild(note.domainId, note.id, 'note', state)) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${note.domainId} → ${note.id} (note)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи заметки ${note.id}: ${error.message}`);
        }
      }
    });

    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log(`✅ Связи восстановлены. Восстановлено связей: ${result.restoredConnections}`);
    } else {
      console.warn(`⚠️ Восстановление завершено с ошибками. Ошибок: ${result.errors.length}`);
    }

    return result;

  } catch (error) {
    console.error('❌ restoreHierarchyConnections: Критическая ошибка восстановления:', error);
    return {
      success: false,
      restoredConnections: 0,
      errors: [`Критическая ошибка: ${error.message}`],
      details: []
    };
  }
}

/**
 * Полная миграция к системе иерархии v2
 * @param {Object} options - Опции миграции
 * @returns {Object} Результат миграции
 */
export function migrateToHierarchyV2(options = {}) {
  try {
    console.log('🚀 Начинаем полную миграцию к системе иерархии v2...');
    
    const result = {
      success: false,
      steps: [],
      errors: [],
      warnings: []
    };

    // Шаг 1: Инициализация системы
    console.log('📋 Шаг 1: Инициализация системы...');
    const initResult = initializeHierarchySystem();
    result.steps.push({
      step: 1,
      name: 'Инициализация системы',
      success: initResult.success,
      details: initResult
    });

    if (!initResult.success) {
      result.errors.push(...initResult.errors);
      return result;
    }

    // Шаг 2: Восстановление связей
    console.log('🔗 Шаг 2: Восстановление связей...');
    const restoreResult = restoreHierarchyConnections();
    result.steps.push({
      step: 2,
      name: 'Восстановление связей',
      success: restoreResult.success,
      details: restoreResult
    });

    if (!restoreResult.success) {
      result.warnings.push(...restoreResult.errors);
    }

    // Шаг 3: Валидация
    console.log('🔍 Шаг 3: Валидация иерархии...');
    const validationErrors = validateHierarchy(state);
    result.steps.push({
      step: 3,
      name: 'Валидация иерархии',
      success: validationErrors.length === 0,
      details: { errors: validationErrors }
    });

    if (validationErrors.length > 0) {
      result.warnings.push(`Найдено ${validationErrors.length} ошибок валидации`);
    }

    // Шаг 4: Сохранение
    console.log('💾 Шаг 4: Сохранение состояния...');
    try {
      saveState();
      result.steps.push({
        step: 4,
        name: 'Сохранение состояния',
        success: true,
        details: { message: 'Состояние успешно сохранено' }
      });
    } catch (error) {
      result.errors.push(`Ошибка сохранения: ${error.message}`);
      result.steps.push({
        step: 4,
        name: 'Сохранение состояния',
        success: false,
        details: { error: error.message }
      });
    }

    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log('✅ Миграция завершена успешно!');
    } else {
      console.warn(`⚠️ Миграция завершена с ошибками. Ошибок: ${result.errors.length}`);
    }

    return result;

  } catch (error) {
    console.error('❌ migrateToHierarchyV2: Критическая ошибка миграции:', error);
    return {
      success: false,
      steps: [],
      errors: [`Критическая ошибка: ${error.message}`],
      warnings: []
    };
  }
}

/**
 * Откат миграции
 * @returns {Object} Результат отката
 */
export function rollbackHierarchyMigration() {
  try {
    console.log('⏪ Откат миграции иерархии...');
    
    const result = {
      success: false,
      clearedObjects: 0,
      errors: [],
      details: []
    };

    const allObjects = [
      ...state.domains,
      ...state.projects,
      ...state.tasks,
      ...state.ideas,
      ...state.notes
    ];

    allObjects.forEach(obj => {
      try {
        let cleared = false;
        
        // Удаляем поля иерархии
        if (obj.parentId) {
          obj.parentId = null;
          cleared = true;
        }
        
        if (obj.children) {
          obj.children = {
            projects: [],
            tasks: [],
            ideas: [],
            notes: []
          };
          cleared = true;
        }
        
        if (obj.locks) {
          delete obj.locks;
          cleared = true;
        }
        
        if (obj.constraints) {
          delete obj.constraints;
          cleared = true;
        }

        if (cleared) {
          result.clearedObjects++;
          result.details.push(`Очищен объект: ${obj.id}`);
        }

      } catch (error) {
        result.errors.push(`Ошибка очистки ${obj.id}: ${error.message}`);
      }
    });

    // Сохраняем очищенное состояние
    try {
      saveState();
      result.details.push('Очищенное состояние сохранено');
    } catch (error) {
      result.errors.push(`Ошибка сохранения: ${error.message}`);
    }

    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log(`✅ Откат завершен. Очищено объектов: ${result.clearedObjects}`);
    } else {
      console.warn(`⚠️ Откат завершен с ошибками. Ошибок: ${result.errors.length}`);
    }

    return result;

  } catch (error) {
    console.error('❌ rollbackHierarchyMigration: Критическая ошибка отката:', error);
    return {
      success: false,
      clearedObjects: 0,
      errors: [`Критическая ошибка: ${error.message}`],
      details: []
    };
  }
}

/**
 * Получение статистики иерархии
 * @returns {Object} Статистика иерархии
 */
export function getHierarchyStatistics() {
  try {
    const allObjects = [
      ...state.domains,
      ...state.projects,
      ...state.tasks,
      ...state.ideas,
      ...state.notes
    ];

    const stats = {
      total: allObjects.length,
      withParent: 0,
      withoutParent: 0,
      totalConnections: 0,
      byType: {
        domains: { total: 0, withParent: 0, children: 0 },
        projects: { total: 0, withParent: 0, children: 0 },
        tasks: { total: 0, withParent: 0, children: 0 },
        ideas: { total: 0, withParent: 0, children: 0 },
        notes: { total: 0, withParent: 0, children: 0 }
      }
    };

    allObjects.forEach(obj => {
      const objType = getObjectType(obj);
      const typeKey = objType + 's';
      
      if (stats.byType[typeKey]) {
        stats.byType[typeKey].total++;
        
        if (obj.parentId) {
          stats.withParent++;
          stats.byType[typeKey].withParent++;
        } else {
          stats.withoutParent++;
        }

        // Подсчитываем детей
        if (obj.children) {
          const childrenCount = Object.values(obj.children).reduce((sum, arr) => sum + arr.length, 0);
          stats.totalConnections += childrenCount;
          stats.byType[typeKey].children += childrenCount;
        }
      }
    });

    return stats;

  } catch (error) {
    console.error('❌ getHierarchyStatistics: Ошибка получения статистики:', error);
    return {
      total: 0,
      withParent: 0,
      withoutParent: 0,
      totalConnections: 0,
      byType: {}
    };
  }
}

// Цветовые палитры
export function getRandomIdeaColor() {
  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3'];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function getRandomNoteColor() {
  const colors = ['#8b7355', '#a0a0a0', '#6c757d', '#495057', '#343a40'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Создание объектов
export function createDomain(title, mood = 'balance') {
  const domain = {
    id: 'd' + generateId(),
    title: title,
    mood: mood,
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
    r: 80,
    color: getMoodColor(mood),
    opacity: 1.0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: []
  };
  state.domains.push(domain);
  
  // Emit event for domain creation
  eventBus.emit('domain:created', domain);
  eventBus.emit('objects:changed', { type: 'domain', action: 'created', object: domain });
  
  return domain;
}

export function createProject(title, domainId = null) {
  const project = {
    id: 'p' + generateId(),
    title: title,
    domainId: domainId,
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
    r: 40,
    color: getRandomProjectColor(),
    opacity: 1.0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: []
  };
  state.projects.push(project);
  
  // Emit event for project creation
  eventBus.emit('project:created', project);
  eventBus.emit('objects:changed', { type: 'project', action: 'created', object: project });
  
  return project;
}

export function createTask(title, projectId = null, domainId = null) {
  const task = {
    id: 't' + generateId(),
    title: title,
    projectId: projectId,
    domainId: domainId,
    status: 'backlog',
    priority: 2,
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
    r: 16,
    color: '#3b82f6',
    opacity: 1.0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: []
  };
  state.tasks.push(task);
  
  // Emit event for task creation
  eventBus.emit('task:created', task);
  eventBus.emit('objects:changed', { type: 'task', action: 'created', object: task });
  
  return task;
}

export function createIdea(title, content = '', domainId = null) {
  const idea = {
    id: 'i' + generateId(),
    title: title,
    content: content,
    domainId: domainId,
    parentId: domainId, // Добавляем parentId для совместимости
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
    r: 15,
    color: getRandomIdeaColor(),
    opacity: 1.0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: []
  };
  state.ideas.push(idea);
  return idea;
}

export function createNote(title, text = '', domainId = null) {
  const note = {
    id: 'n' + generateId(),
    title: title,
    text: text,
    domainId: domainId,
    parentId: domainId, // Добавляем parentId для совместимости
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
    r: 12,
    color: getRandomNoteColor(),
    opacity: 1.0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: []
  };
  state.notes.push(note);
  return note;
}

export function createChecklist(title, projectId = null, domainId = null) {
  const checklist = {
    id: 'c' + generateId(),
    title: title,
    projectId: projectId,
    domainId: domainId,
    parentId: projectId || domainId, // Добавляем parentId для совместимости
    x: 0, // Центр экрана по X
    y: 0, // Центр экрана по Y
    r: 20, // Увеличиваем размер для лучшей видимости
    color: getRandomProjectColor(),
    opacity: 0.9,
    items: [], // Массив элементов чек-листа
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: []
  };
  state.checklists.push(checklist);
  console.log('✅ Checklist created:', checklist.title, 'ID:', checklist.id, 'Total checklists:', state.checklists.length); // Debug
  
  // Сохраняем состояние и обновляем карту
  saveState();
  if (window.layoutMap) window.layoutMap();
  if (window.drawMap) window.drawMap();
  
  return checklist;
}

// Миграция для добавления поля history к существующим объектам
function migrateObjectsToHistory() {
  console.log('🔄 Миграция: добавление поля history к существующим объектам...');
  
  let migrated = 0;
  
  // Мигрируем все типы объектов
  const allObjects = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes,
    ...state.checklists
  ];
  
  allObjects.forEach(obj => {
    if (!obj.history) {
      obj.history = [];
      migrated++;
    }
  });
  
  if (migrated > 0) {
    console.log(`✅ Миграция завершена: добавлено поле history к ${migrated} объектам`);
    saveState();
  }
}

// Миграция для очистки некорректных ссылок parentId
function migrateObjectsCleanupParentId() {
  console.log('🔄 Миграция: очистка некорректных ссылок parentId...');
  
  let cleaned = 0;
  
  // Собираем все существующие ID
  const existingIds = new Set([
    ...state.domains.map(d => d.id),
    ...state.projects.map(p => p.id),
    ...state.tasks.map(t => t.id),
    ...state.ideas.map(i => i.id),
    ...state.notes.map(n => n.id),
    ...state.checklists.map(c => c.id)
  ]);
  
  // Проверяем все объекты на некорректные parentId
  const allObjects = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes,
    ...state.checklists
  ];
  
  allObjects.forEach(obj => {
    if (obj.parentId && !existingIds.has(obj.parentId)) {
      console.log(`🧹 Очищаем некорректный parentId ${obj.parentId} у объекта ${obj.id}`);
      obj.parentId = null;
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`✅ Миграция завершена: очищено ${cleaned} некорректных ссылок parentId`);
    saveState();
  }
}

// Функция для создания тестовых записей истории (для демонстрации)
export function createTestHistoryEntries() {
  console.log('🧪 Создаем тестовые записи истории для демонстрации...');
  
  const allObjects = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes,
    ...state.checklists
  ];
  
  let created = 0;
  
  // Добавляем тестовые записи истории ко всем объектам
  allObjects.forEach(obj => {
    if (!obj.history) {
      obj.history = [];
    }
    
    // Создаем несколько тестовых записей
    const testEntries = [
      {
        timestamp: Date.now() - 3600000, // 1 час назад
        action: 'attach',
        details: {
          fromParentId: null,
          toParentId: obj.parentId || 'test-parent',
          parentType: 'domain',
          childType: getObjectType(obj),
          fromParentTitle: null,
          toParentTitle: 'Тестовый домен'
        },
        id: 'h' + generateId()
      },
      {
        timestamp: Date.now() - 1800000, // 30 минут назад
        action: 'move',
        details: {
          fromParentId: 'test-parent',
          toParentId: obj.parentId || 'test-project',
          parentType: 'project',
          childType: getObjectType(obj),
          fromParentTitle: 'Тестовый домен',
          toParentTitle: 'Тестовый проект'
        },
        id: 'h' + generateId()
      }
    ];
    
    obj.history = [...testEntries, ...obj.history];
    created += testEntries.length;
  });
  
  if (created > 0) {
    console.log(`✅ Создано ${created} тестовых записей истории`);
    saveState();
  }
  
  return created;
}

// Функция для принудительной очистки всех проблем иерархии
export function forceCleanupHierarchy() {
  console.log('🧹 Принудительная очистка всех проблем иерархии...');
  
  let cleaned = 0;
  
  // Собираем все существующие ID
  const existingIds = new Set([
    ...state.domains.map(d => d.id),
    ...state.projects.map(p => p.id),
    ...state.tasks.map(t => t.id),
    ...state.ideas.map(i => i.id),
    ...state.notes.map(n => n.id),
    ...state.checklists.map(c => c.id)
  ]);
  
  console.log(`📊 Найдено ${existingIds.size} существующих объектов`);
  
  // Исправляем все объекты
  const allObjects = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes,
    ...state.checklists
  ];
  
  allObjects.forEach(obj => {
    // Очищаем некорректные parentId
    if (obj.parentId && !existingIds.has(obj.parentId)) {
      console.log(`🧹 Очищаем parentId ${obj.parentId} у объекта ${obj.id}`);
      obj.parentId = null;
      cleaned++;
    }
    
    // Очищаем некорректные children
    if (obj.children) {
      Object.entries(obj.children).forEach(([childType, childIds]) => {
        if (Array.isArray(childIds)) {
          const validChildIds = childIds.filter(childId => existingIds.has(childId));
          if (validChildIds.length !== childIds.length) {
            console.log(`🧹 Очищаем некорректные children у объекта ${obj.id}`);
            obj.children[childType] = validChildIds;
            cleaned++;
          }
        }
      });
    }
    
    // Очищаем некорректные domainId и projectId
    if (obj.domainId && !existingIds.has(obj.domainId)) {
      console.log(`🧹 Очищаем domainId ${obj.domainId} у объекта ${obj.id}`);
      obj.domainId = null;
      cleaned++;
    }
    
    if (obj.projectId && !existingIds.has(obj.projectId)) {
      console.log(`🧹 Очищаем projectId ${obj.projectId} у объекта ${obj.id}`);
      obj.projectId = null;
      cleaned++;
    }
    
    // Принудительно очищаем null и undefined ссылки
    if (obj.parentId === null || obj.parentId === undefined) {
      obj.parentId = null;
    }
    if (obj.domainId === null || obj.domainId === undefined) {
      obj.domainId = null;
    }
    if (obj.projectId === null || obj.projectId === undefined) {
      obj.projectId = null;
    }
  });
  
  if (cleaned > 0) {
    console.log(`✅ Очищено ${cleaned} проблем. Сохраняем состояние...`);
    saveState();
  } else {
    console.log('ℹ️ Проблем не найдено');
  }
  
  return cleaned;
}

// Функция для проверки истории конкретного объекта
export function checkObjectHistory(objectId) {
  const obj = findObjectById(objectId);
  if (!obj) {
    console.warn(`⚠️ Объект ${objectId} не найден`);
    return null;
  }
  
  console.log(`🔍 Проверяем историю объекта: ${obj.title || obj.id} (${getObjectType(obj)})`);
  
  if (!obj.history || obj.history.length === 0) {
    console.log(`📝 История пуста для объекта ${obj.id}`);
    return { object: obj, history: [], hasHistory: false };
  }
  
  console.log(`📝 Найдено ${obj.history.length} записей истории:`);
  obj.history.forEach((entry, index) => {
    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleString('ru-RU', { 
      day: '2-digit', 
      month: '2-digit', 
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    console.log(`  ${index + 1}. ${entry.action} в ${timeStr} - ${entry.details.fromParentTitle || 'null'} → ${entry.details.toParentTitle || 'null'}`);
  });
  
  return { object: obj, history: obj.history, hasHistory: true };
}

// Функция для проверки истории всех объектов (для отладки)
export function checkAllObjectsHistory() {
  console.log('🔍 Проверяем историю всех объектов...');
  
  const allObjects = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes,
    ...state.checklists
  ];
  
  let totalHistoryEntries = 0;
  let objectsWithHistory = 0;
  
  allObjects.forEach(obj => {
    if (obj.history && obj.history.length > 0) {
      objectsWithHistory++;
      totalHistoryEntries += obj.history.length;
      console.log(`📝 ${obj.title || obj.id}: ${obj.history.length} записей истории`);
      
      // Показываем последние 2 записи
      obj.history.slice(0, 2).forEach((entry, index) => {
        const date = new Date(entry.timestamp);
        const timeStr = date.toLocaleString('ru-RU', { 
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        console.log(`  ${index + 1}. ${entry.action} в ${timeStr} - ${entry.details.fromParentTitle || 'null'} → ${entry.details.toParentTitle || 'null'}`);
      });
    }
  });
  
  console.log(`📊 Итого: ${objectsWithHistory} объектов с историей, ${totalHistoryEntries} записей`);
  return { objectsWithHistory, totalHistoryEntries };
}

// Функции для работы с историей связей
export function addHierarchyHistory(objectId, action, details) {
  const obj = findObjectById(objectId);
  if (!obj) {
    console.warn('⚠️ addHierarchyHistory: объект не найден', objectId);
    return false;
  }
  
  if (!obj.history) {
    obj.history = [];
  }
  
  const historyEntry = {
    timestamp: Date.now(),
    action: action, // 'attach', 'detach', 'move'
    details: details, // { fromParentId, toParentId, parentType, childType }
    id: 'h' + generateId()
  };
  
  // Добавляем запись в начало массива (новые сверху)
  obj.history.unshift(historyEntry);
  
  // Ограничиваем историю последними 10 записями
  if (obj.history.length > 10) {
    obj.history = obj.history.slice(0, 10);
  }
  
  console.log(`📝 История: ${action} для ${objectId}`, details);
  return true;
}

export function getHierarchyHistory(objectId) {
  const obj = findObjectById(objectId);
  return obj?.history || [];
}

export function clearHierarchyHistory(objectId) {
  const obj = findObjectById(objectId);
  if (obj) {
    obj.history = [];
    console.log(`🗑️ История очищена для ${objectId}`);
    return true;
  }
  return false;
}

// Функция отката изменений связей
export function rollbackHierarchyChange(objectId, historyEntryId) {
  const obj = findObjectById(objectId);
  if (!obj || !obj.history) {
    console.warn('⚠️ rollbackHierarchyChange: объект или история не найдены', objectId);
    return false;
  }
  
  const historyEntry = obj.history.find(entry => entry.id === historyEntryId);
  if (!historyEntry) {
    console.warn('⚠️ rollbackHierarchyChange: запись истории не найдена', historyEntryId);
    return false;
  }
  
  try {
    // Выполняем обратное действие
    switch (historyEntry.action) {
      case 'attach':
        // Отвязываем от родителя
        if (historyEntry.details.toParentId) {
          const detachResult = detachChild({ 
            childType: historyEntry.details.childType, 
            childId: objectId 
          });
          if (detachResult.ok) {
            console.log(`🔄 Откат: отвязан от ${historyEntry.details.toParentId}`);
          }
        }
        break;
        
      case 'detach':
        // Привязываем обратно к родителю
        if (historyEntry.details.fromParentId) {
          const attachResult = attachChild({
            parentType: historyEntry.details.parentType,
            parentId: historyEntry.details.fromParentId,
            childType: historyEntry.details.childType,
            childId: objectId
          });
          if (attachResult.ok) {
            console.log(`🔄 Откат: привязан обратно к ${historyEntry.details.fromParentId}`);
          }
        }
        break;
        
      case 'move':
        // Возвращаем к предыдущему родителю
        if (historyEntry.details.fromParentId) {
          const attachResult = attachChild({
            parentType: historyEntry.details.parentType,
            parentId: historyEntry.details.fromParentId,
            childType: historyEntry.details.childType,
            childId: objectId
          });
          if (attachResult.ok) {
            console.log(`🔄 Откат: возвращен к ${historyEntry.details.fromParentId}`);
          }
        }
        break;
        
      default:
        console.warn('⚠️ rollbackHierarchyChange: неизвестное действие', historyEntry.action);
        return false;
    }
    
    // Удаляем запись из истории после успешного отката
    obj.history = obj.history.filter(entry => entry.id !== historyEntryId);
    
    console.log(`✅ Откат выполнен для ${objectId}`);
    return true;
    
  } catch (error) {
    console.error('❌ Ошибка при откате изменений:', error);
    return false;
  }
}

// Функции для работы с элементами чек-листа
export function addChecklistItem(checklistId, text) {
  const checklist = byId(state.checklists, checklistId);
  if (!checklist) return null;
  
  const item = {
    id: generateId(),
    text: text,
    completed: false,
    createdAt: Date.now()
  };
  
  checklist.items.push(item);
  checklist.updatedAt = Date.now();
  return item;
}

export function toggleChecklistItem(checklistId, itemId) {
  const checklist = byId(state.checklists, checklistId);
  if (!checklist) return false;
  
  const item = checklist.items.find(i => i.id === itemId);
  if (!item) return false;
  
  item.completed = !item.completed;
  checklist.updatedAt = Date.now();
  return item.completed;
}

export function removeChecklistItem(checklistId, itemId) {
  const checklist = byId(state.checklists, checklistId);
  if (!checklist) return false;
  
  const index = checklist.items.findIndex(i => i.id === itemId);
  if (index === -1) return false;
  
  checklist.items.splice(index, 1);
  checklist.updatedAt = Date.now();
  return true;
}

export function getChecklistProgress(checklistId) {
  const checklist = byId(state.checklists, checklistId);
  if (!checklist || !checklist.items.length) return 0;
  
  const completed = checklist.items.filter(item => item.completed).length;
  return Math.round((completed / checklist.items.length) * 100);
}

export function getChecklistsOfProject(projectId) {
  return state.checklists.filter(c => c.projectId === projectId);
}

// Миграция: добавляем parentId к существующим объектам
function migrateObjectsToParentId() {
  console.log("🔄 Migrating objects to use parentId...");
  console.log("🔄 Before migration - ideas:", state.ideas.length, "notes:", state.notes.length, "checklists:", state.checklists.length);
  
  // Миграция идей
  state.ideas.forEach(idea => {
    console.log("🔄 Checking idea:", idea.id, "parentId:", idea.parentId, "domainId:", idea.domainId);
    if (!idea.parentId && idea.domainId) {
      idea.parentId = idea.domainId;
      console.log("✅ Migrated idea:", idea.title, "parentId:", idea.parentId);
    }
  });
  
  // Миграция заметок
  state.notes.forEach(note => {
    console.log("🔄 Checking note:", note.id, "parentId:", note.parentId, "domainId:", note.domainId);
    if (!note.parentId && note.domainId) {
      note.parentId = note.domainId;
      console.log("✅ Migrated note:", note.title, "parentId:", note.parentId);
    }
  });
  
  // Миграция чек-листов
  state.checklists.forEach(checklist => {
    console.log("🔄 Checking checklist:", checklist.id, "parentId:", checklist.parentId, "projectId:", checklist.projectId, "domainId:", checklist.domainId);
    if (!checklist.parentId) {
      checklist.parentId = checklist.projectId || checklist.domainId;
      console.log("✅ Migrated checklist:", checklist.title, "parentId:", checklist.parentId);
    }
  });
  
  console.log("🔄 Migration completed");
}

// Вызываем миграции при загрузке
migrateObjectsToParentId();
migrateObjectsToHistory();
migrateObjectsCleanupParentId();

// Делаем saveState доступным глобально для автоисправлений
if (typeof window !== 'undefined') {
  window.saveState = saveState;
}

// Lightweight event bus for inter-module communication
const eventBus = {
  listeners: new Map(),
  
  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    
    // Return unsubscribe function
    return () => {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.delete(callback);
        if (eventListeners.size === 0) {
          this.listeners.delete(event);
        }
      }
    };
  },
  
  /**
   * Emit an event to all subscribers
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const callback of eventListeners) {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      }
    }
  },
  
  /**
   * Remove all listeners for an event
   * @param {string} event - Event name
   */
  off(event) {
    this.listeners.delete(event);
  },
  
  /**
   * Remove all listeners
   */
  clear() {
    this.listeners.clear();
  }
};

// Export event bus
export { eventBus };
