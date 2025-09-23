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
  canChangeHierarchy
} from "./hierarchy/index.js";

export const state = {
  view:'map',
  showLinks:true, showAging:true, showGlow:true,
  activeDomain:null,
  filterTag:null,
  wipLimit:3,
  settings: {
    layoutMode: 'auto',
    wipTodayLimit: 5,
    enableHierarchyV2: false, // Флаг для включения новой системы иерархии
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
export function attachObjectToParent(childId, childType, parentId, parentType) {
  try {
    // Находим объекты
    const child = findObjectById(childId);
    const parent = findObjectById(parentId);
    
    if (!child) {
      console.error(`Объект ${childId} не найден`);
      return false;
    }
    
    if (!parent) {
      console.error(`Родитель ${parentId} не найден`);
      return false;
    }
    
    // Устанавливаем связь
    const success = setParentChild(parentId, childId, childType);
    
    if (success) {
      console.log(`✅ Объект ${childId} привязан к ${parentId}`);
      return true;
    } else {
      console.error(`❌ Не удалось привязать ${childId} к ${parentId}`);
      return false;
    }
    
  } catch (error) {
    console.error('Ошибка привязки объекта:', error);
    return false;
  }
}

// Функция для отвязки объекта от родителя
export function detachObjectFromParent(childId, childType) {
  try {
    const child = findObjectById(childId);
    if (!child) {
      console.error(`Объект ${childId} не найден`);
      return false;
    }
    
    // Отвязываем от родителя
    const success = removeParentChild(child.parentId, childId, childType);
    
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
      
      console.log(`✅ Объект ${childId} отвязан от родителя`);
      return true;
    } else {
      console.error(`❌ Не удалось отвязать ${childId} от родителя`);
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

// Реэкспорт функций из модуля hierarchy/index.js
export {
  canChangeHierarchy,
  getChildObjects,
  getParentObject,
  initHierarchyFields,
  setParentChild,
  removeParentChild,
  validateHierarchy,
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
    ...state.notes
  ];
  return allObjects.find(obj => obj.id === id) || null;
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
          if (setParentChild(project.domainId, project.id, 'project')) {
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
          if (setParentChild(task.projectId, task.id, 'task')) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${task.projectId} → ${task.id} (task)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи задачи ${task.id}: ${error.message}`);
        }
      } else if (task.domainId) {
        try {
          if (setParentChild(task.domainId, task.id, 'task')) {
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
          if (setParentChild(idea.domainId, idea.id, 'idea')) {
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
          if (setParentChild(note.domainId, note.id, 'note')) {
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
    updatedAt: Date.now()
  };
  state.domains.push(domain);
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
    updatedAt: Date.now()
  };
  state.projects.push(project);
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
    updatedAt: Date.now()
  };
  state.tasks.push(task);
  return task;
}

export function createIdea(title, content = '', domainId = null) {
  const idea = {
    id: 'i' + generateId(),
    title: title,
    content: content,
    domainId: domainId,
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
    r: 15,
    color: getRandomIdeaColor(),
    opacity: 1.0,
    createdAt: Date.now(),
    updatedAt: Date.now()
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
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
    r: 12,
    color: getRandomNoteColor(),
    opacity: 1.0,
    createdAt: Date.now(),
    updatedAt: Date.now()
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
    x: 0, // Центр экрана по X
    y: 0, // Центр экрана по Y
    r: 20, // Увеличиваем размер для лучшей видимости
    color: getRandomProjectColor(),
    opacity: 0.9,
    items: [], // Массив элементов чек-листа
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.checklists.push(checklist);
  console.log('✅ Checklist created:', checklist.title, 'ID:', checklist.id, 'Total checklists:', state.checklists.length); // Debug
  
  // Сохраняем состояние и обновляем карту
  saveState();
  if (window.layoutMap) window.layoutMap();
  if (window.drawMap) window.drawMap();
  
  return checklist;
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
