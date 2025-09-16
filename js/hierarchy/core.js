// js/hierarchy/core.js
// Основные функции CRUD для системы иерархии v2

import { 
  OBJECT_TYPES, 
  ALLOWED_CONNECTIONS, 
  DEFAULT_HIERARCHY_CONFIG,
  HierarchyUtils 
} from '../types/hierarchy.js';

/**
 * Инициализация полей иерархии для объекта
 * @param {Object} obj - Объект для инициализации
 * @param {string} type - Тип объекта (domain, project, task, idea, note)
 * @returns {Object} Объект с инициализированными полями иерархии
 */
export function initHierarchyFields(obj, type) {
  if (!obj) return obj;
  
  // Базовые поля иерархии
  if (!obj.parentId) obj.parentId = null;
  if (!obj.children) {
    obj.children = {
      projects: [],
      tasks: [],
      ideas: [],
      notes: []
    };
  }
  if (!obj.locks) {
    obj.locks = {
      move: false,        // Блокировка перемещения
      hierarchy: false    // Блокировка смены связей
    };
  }
  if (!obj.constraints) {
    obj.constraints = {
      maxRadius: getDefaultMaxRadius(type),
      orbitRadius: getDefaultOrbitRadius(type),
      autoLayout: getDefaultAutoLayout(type)
    };
  }
  
  return obj;
}

/**
 * Получение максимального радиуса по типу объекта
 * @param {string} type - Тип объекта
 * @returns {number} Максимальный радиус
 */
function getDefaultMaxRadius(type) {
  const config = DEFAULT_HIERARCHY_CONFIG.constraints[type];
  return config ? config.maxRadius : 50;
}

/**
 * Получение радиуса орбиты по типу объекта
 * @param {string} type - Тип объекта
 * @returns {number} Радиус орбиты
 */
function getDefaultOrbitRadius(type) {
  const config = DEFAULT_HIERARCHY_CONFIG.constraints[type];
  return config ? config.orbitRadius : 30;
}

/**
 * Получение настройки авторазмещения по типу объекта
 * @param {string} type - Тип объекта
 * @returns {boolean} Авторазмещение
 */
function getDefaultAutoLayout(type) {
  const config = DEFAULT_HIERARCHY_CONFIG.constraints[type];
  return config ? config.autoLayout : false;
}

/**
 * Установка связи родитель-ребенок
 * @param {string} parentId - ID родительского объекта
 * @param {string} childId - ID дочернего объекта
 * @param {string} childType - Тип дочернего объекта
 * @returns {boolean} Успешность операции
 */
export function setParentChild(parentId, childId, childType) {
  try {
    // Валидация входных параметров
    if (!parentId || !childId || !childType) {
      console.warn('❌ setParentChild: Недостаточно параметров');
      return false;
    }

    // Проверка, что связь разрешена
    if (!HierarchyUtils.isConnectionAllowed(parentId, childType)) {
      console.warn(`❌ setParentChild: Связь ${parentId} → ${childId} (${childType}) не разрешена`);
      return false;
    }

    // Получение объектов (здесь нужно будет интегрировать с state.js)
    const parent = getObjectById(parentId);
    const child = getObjectById(childId);
    
    if (!parent || !child) {
      console.warn('❌ setParentChild: Объект не найден');
      return false;
    }

    // Инициализация полей иерархии если нужно
    initHierarchyFields(parent, getObjectType(parentId));
    initHierarchyFields(child, childType);

    // Установка связи
    child.parentId = parentId;
    
    // Добавление в список детей родителя
    if (!parent.children[childType + 's']) {
      parent.children[childType + 's'] = [];
    }
    if (!parent.children[childType + 's'].includes(childId)) {
      parent.children[childType + 's'].push(childId);
    }

    console.log(`✅ setParentChild: Связь ${parentId} → ${childId} (${childType}) установлена`);
    return true;

  } catch (error) {
    console.error('❌ setParentChild: Ошибка установки связи:', error);
    return false;
  }
}

/**
 * Удаление связи родитель-ребенок
 * @param {string} parentId - ID родительского объекта
 * @param {string} childId - ID дочернего объекта
 * @param {string} childType - Тип дочернего объекта
 * @returns {boolean} Успешность операции
 */
export function removeParentChild(parentId, childId, childType) {
  try {
    // Валидация входных параметров
    if (!parentId || !childId || !childType) {
      console.warn('❌ removeParentChild: Недостаточно параметров');
      return false;
    }

    // Получение объектов
    const parent = getObjectById(parentId);
    const child = getObjectById(childId);
    
    if (!parent || !child) {
      console.warn('❌ removeParentChild: Объект не найден');
      return false;
    }

    // Удаление связи
    child.parentId = null;
    
    // Удаление из списка детей родителя
    if (parent.children[childType + 's']) {
      const index = parent.children[childType + 's'].indexOf(childId);
      if (index > -1) {
        parent.children[childType + 's'].splice(index, 1);
      }
    }

    console.log(`✅ removeParentChild: Связь ${parentId} → ${childId} (${childType}) удалена`);
    return true;

  } catch (error) {
    console.error('❌ removeParentChild: Ошибка удаления связи:', error);
    return false;
  }
}

/**
 * Получение родительского объекта
 * @param {string} childId - ID дочернего объекта
 * @returns {Object|null} Родительский объект или null
 */
export function getParentObject(childId) {
  try {
    const child = getObjectById(childId);
    if (!child || !child.parentId) {
      return null;
    }
    
    return getObjectById(child.parentId);
  } catch (error) {
    console.error('❌ getParentObject: Ошибка получения родителя:', error);
    return null;
  }
}

/**
 * Получение дочерних объектов
 * @param {string} parentId - ID родительского объекта
 * @returns {Object} Объект с массивами дочерних объектов по типам
 */
export function getChildObjects(parentId) {
  try {
    const parent = getObjectById(parentId);
    if (!parent || !parent.children) {
      return {
        projects: [],
        tasks: [],
        ideas: [],
        notes: []
      };
    }

    return {
      projects: parent.children.projects || [],
      tasks: parent.children.tasks || [],
      ideas: parent.children.ideas || [],
      notes: parent.children.notes || []
    };
  } catch (error) {
    console.error('❌ getChildObjects: Ошибка получения детей:', error);
    return {
      projects: [],
      tasks: [],
      ideas: [],
      notes: []
    };
  }
}

/**
 * Получение всех потомков (рекурсивно)
 * @param {string} parentId - ID родительского объекта
 * @returns {Array} Массив всех потомков
 */
export function getAllDescendants(parentId) {
  try {
    const descendants = [];
    const children = getChildObjects(parentId);
    
    // Добавляем прямых детей
    Object.values(children).forEach(childIds => {
      childIds.forEach(childId => {
        descendants.push(childId);
        // Рекурсивно добавляем потомков
        descendants.push(...getAllDescendants(childId));
      });
    });

    return descendants;
  } catch (error) {
    console.error('❌ getAllDescendants: Ошибка получения потомков:', error);
    return [];
  }
}

/**
 * Получение корневого объекта (самого верхнего в иерархии)
 * @param {string} objId - ID объекта
 * @returns {Object|null} Корневой объект или null
 */
export function getRootObject(objId) {
  try {
    let current = getObjectById(objId);
    if (!current) return null;

    while (current.parentId) {
      current = getObjectById(current.parentId);
      if (!current) break;
    }

    return current;
  } catch (error) {
    console.error('❌ getRootObject: Ошибка получения корня:', error);
    return null;
  }
}

/**
 * Получение глубины объекта в иерархии
 * @param {string} objId - ID объекта
 * @returns {number} Глубина (0 для корневых объектов)
 */
export function getObjectDepth(objId) {
  try {
    let depth = 0;
    let current = getObjectById(objId);
    
    while (current && current.parentId) {
      depth++;
      current = getObjectById(current.parentId);
    }

    return depth;
  } catch (error) {
    console.error('❌ getObjectDepth: Ошибка получения глубины:', error);
    return 0;
  }
}

/**
 * Получение пути к объекту (массив ID от корня до объекта)
 * @param {string} objId - ID объекта
 * @returns {Array} Массив ID пути
 */
export function getObjectPath(objId) {
  try {
    const path = [];
    let current = getObjectById(objId);
    
    while (current) {
      path.unshift(current.id);
      current = current.parentId ? getObjectById(current.parentId) : null;
    }

    return path;
  } catch (error) {
    console.error('❌ getObjectPath: Ошибка получения пути:', error);
    return [];
  }
}

// Импорт функций из state.js
import { findObjectById, getObjectType } from '../state.js';

// Экспорт для использования в других модулях
export default {
  initHierarchyFields,
  setParentChild,
  removeParentChild,
  getParentObject,
  getChildObjects,
  getAllDescendants,
  getRootObject,
  getObjectDepth,
  getObjectPath
};
