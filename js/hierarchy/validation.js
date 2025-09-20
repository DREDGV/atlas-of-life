// js/hierarchy/validation.js
// Валидация и проверки для системы иерархии v2

import { 
  OBJECT_TYPES, 
  VALIDATION_ERROR_TYPES,
  ERROR_MESSAGES,
  PERFORMANCE_LIMITS,
  HierarchyUtils 
} from '../types/hierarchy.js';

/**
 * Класс ошибки валидации иерархии
 */
export class HierarchyValidationError extends Error {
  constructor(type, message, objectId, parentId = null, childId = null) {
    super(message);
    this.name = 'HierarchyValidationError';
    this.type = type;
    this.objectId = objectId;
    this.parentId = parentId;
    this.childId = childId;
    this.timestamp = Date.now();
  }
}

/**
 * Проверка корректности всей иерархии
 * @param {Object} state - Состояние приложения
 * @returns {Array} Массив ошибок валидации
 */
export function validateHierarchy(state) {
  const errors = [];
  
  try {
    console.log('🔍 Начинаем валидацию иерархии...');
    
    // Проверяем все объекты
    const allObjects = [
      ...(state.domains || []),
      ...(state.projects || []),
      ...(state.tasks || []),
      ...(state.ideas || []),
      ...(state.notes || [])
    ];

    // Проверяем каждый объект
    allObjects.forEach(obj => {
      if (!obj.id) {
        errors.push(new HierarchyValidationError(
          VALIDATION_ERROR_TYPES.MISSING_OBJECT,
          'Объект не имеет ID',
          'unknown'
        ));
        return;
      }

      // Проверяем поля иерархии
      const objErrors = validateObject(obj, state);
      errors.push(...objErrors);
    });

    // Проверяем циклические зависимости
    const cyclicErrors = findCyclicDependencies(allObjects);
    errors.push(...cyclicErrors);

    // Проверяем ограничения производительности
    const performanceErrors = validatePerformanceLimits(allObjects);
    errors.push(...performanceErrors);

    console.log(`✅ Валидация завершена. Найдено ошибок: ${errors.length}`);
    return errors;

  } catch (error) {
    console.error('❌ validateHierarchy: Критическая ошибка валидации:', error);
    errors.push(new HierarchyValidationError(
      VALIDATION_ERROR_TYPES.MISSING_OBJECT,
      'Критическая ошибка валидации: ' + error.message,
      'system'
    ));
    return errors;
  }
}

/**
 * Валидация отдельного объекта
 * @param {Object} obj - Объект для валидации
 * @param {Object} state - Состояние приложения
 * @returns {Array} Массив ошибок валидации
 */
export function validateObject(obj, state) {
  const errors = [];
  
  try {
    // Проверяем наличие обязательных полей
    if (!obj.id) {
      errors.push(new HierarchyValidationError(
        VALIDATION_ERROR_TYPES.MISSING_OBJECT,
        'Объект не имеет ID',
        'unknown'
      ));
      return errors;
    }

    // Проверяем parentId
    if (obj.parentId) {
      const parent = findObjectById(state, obj.parentId);
      if (!parent) {
        errors.push(new HierarchyValidationError(
          VALIDATION_ERROR_TYPES.MISSING_OBJECT,
          `Родительский объект ${obj.parentId} не найден`,
          obj.id,
          obj.parentId
        ));
      } else {
        // Проверяем, что связь разрешена
        const objType = getObjectType(obj);
        const parentType = getObjectType(parent);
        
        if (!HierarchyUtils.isConnectionAllowed(parentType, objType)) {
          errors.push(new HierarchyValidationError(
            VALIDATION_ERROR_TYPES.INVALID_PARENT_TYPE,
            `Связь ${parentType} → ${objType} не разрешена`,
            obj.id,
            obj.parentId
          ));
        }
      }
    }

    // Проверяем children
    if (obj.children) {
      Object.entries(obj.children).forEach(([childType, childIds]) => {
        if (!Array.isArray(childIds)) {
          errors.push(new HierarchyValidationError(
            VALIDATION_ERROR_TYPES.MISSING_OBJECT,
            `Поле children.${childType} должно быть массивом`,
            obj.id
          ));
          return;
        }

        childIds.forEach(childId => {
          const child = findObjectById(state, childId);
          if (!child) {
            errors.push(new HierarchyValidationError(
              VALIDATION_ERROR_TYPES.MISSING_OBJECT,
              `Дочерний объект ${childId} не найден`,
              obj.id,
              obj.id,
              childId
            ));
          } else if (child.parentId !== obj.id) {
            errors.push(new HierarchyValidationError(
              VALIDATION_ERROR_TYPES.ORPHANED_OBJECT,
              `Дочерний объект ${childId} не ссылается на родителя ${obj.id}`,
              obj.id,
              obj.id,
              childId
            ));
          }
        });
      });
    }

    // Проверяем locks
    if (obj.locks) {
      if (typeof obj.locks.move !== 'boolean') {
        errors.push(new HierarchyValidationError(
          VALIDATION_ERROR_TYPES.MISSING_OBJECT,
          'Поле locks.move должно быть boolean',
          obj.id
        ));
      }
      if (typeof obj.locks.hierarchy !== 'boolean') {
        errors.push(new HierarchyValidationError(
          VALIDATION_ERROR_TYPES.MISSING_OBJECT,
          'Поле locks.hierarchy должно быть boolean',
          obj.id
        ));
      }
    }

    // Проверяем constraints
    if (obj.constraints) {
      if (typeof obj.constraints.maxRadius !== 'number' || obj.constraints.maxRadius <= 0) {
        errors.push(new HierarchyValidationError(
          VALIDATION_ERROR_TYPES.MISSING_OBJECT,
          'Поле constraints.maxRadius должно быть положительным числом',
          obj.id
        ));
      }
      if (typeof obj.constraints.orbitRadius !== 'number' || obj.constraints.orbitRadius <= 0) {
        errors.push(new HierarchyValidationError(
          VALIDATION_ERROR_TYPES.MISSING_OBJECT,
          'Поле constraints.orbitRadius должно быть положительным числом',
          obj.id
        ));
      }
      if (typeof obj.constraints.autoLayout !== 'boolean') {
        errors.push(new HierarchyValidationError(
          VALIDATION_ERROR_TYPES.MISSING_OBJECT,
          'Поле constraints.autoLayout должно быть boolean',
          obj.id
        ));
      }
    }

  } catch (error) {
    console.error('❌ validateObject: Ошибка валидации объекта:', error);
    errors.push(new HierarchyValidationError(
      VALIDATION_ERROR_TYPES.MISSING_OBJECT,
      'Ошибка валидации объекта: ' + error.message,
      obj.id
    ));
  }

  return errors;
}

/**
 * Проверка возможности установки связи
 * @param {string} parentId - ID родительского объекта
 * @param {string} childId - ID дочернего объекта
 * @param {string} childType - Тип дочернего объекта
 * @param {Object} state - Состояние приложения
 * @returns {boolean} Можно ли установить связь
 */
export function canSetParentChild(parentId, childId, childType, state) {
  try {
    // Проверяем, что объекты существуют
    const parent = findObjectById(state, parentId);
    const child = findObjectById(state, childId);
    
    if (!parent || !child) {
      console.warn('❌ canSetParentChild: Объект не найден');
      return false;
    }

    // Проверяем, что связь разрешена
    const parentType = getObjectType(parent);
    if (!HierarchyUtils.isConnectionAllowed(parentType, childType)) {
      console.warn('❌ canSetParentChild: Связь не разрешена');
      return false;
    }

    // Проверяем, что не создается циклическая зависимость
    if (hasCyclicDependency(parentId, childId, state)) {
      console.warn('❌ canSetParentChild: Циклическая зависимость');
      return false;
    }

    // Проверяем блокировки
    if (isObjectLocked(child, 'hierarchy')) {
      console.warn('❌ canSetParentChild: Объект заблокирован для изменения иерархии');
      return false;
    }

    return true;

  } catch (error) {
    console.error('❌ canSetParentChild: Ошибка проверки связи:', error);
    return false;
  }
}

/**
 * Проверка циклических зависимостей
 * @param {string} parentId - ID родительского объекта
 * @param {string} childId - ID дочернего объекта
 * @param {Object} state - Состояние приложения
 * @returns {boolean} Есть ли циклическая зависимость
 */
export function hasCyclicDependency(parentId, childId, state) {
  try {
    // Если пытаемся установить родителя как ребенка его потомка
    const descendants = getAllDescendants(childId, state);
    return descendants.includes(parentId);

  } catch (error) {
    console.error('❌ hasCyclicDependency: Ошибка проверки циклических зависимостей:', error);
    return true; // В случае ошибки считаем, что есть циклическая зависимость
  }
}

/**
 * Поиск всех циклических зависимостей в иерархии
 * @param {Array} allObjects - Все объекты
 * @returns {Array} Массив ошибок циклических зависимостей
 */
export function findCyclicDependencies(allObjects) {
  const errors = [];
  
  try {
    allObjects.forEach(obj => {
      if (obj.parentId) {
        const path = getObjectPath(obj.id, allObjects);
        if (path.includes(obj.id)) {
          errors.push(new HierarchyValidationError(
            VALIDATION_ERROR_TYPES.CYCLIC_DEPENDENCY,
            `Обнаружена циклическая зависимость в пути: ${path.join(' → ')}`,
            obj.id
          ));
        }
      }
    });

  } catch (error) {
    console.error('❌ findCyclicDependencies: Ошибка поиска циклических зависимостей:', error);
  }

  return errors;
}

/**
 * Валидация ограничений производительности
 * @param {Array} allObjects - Все объекты
 * @returns {Array} Массив ошибок производительности
 */
export function validatePerformanceLimits(allObjects) {
  const errors = [];
  
  try {
    // Проверяем количество детей у каждого родителя
    allObjects.forEach(obj => {
      if (obj.children) {
        const totalChildren = Object.values(obj.children).reduce((sum, arr) => sum + arr.length, 0);
        if (totalChildren > PERFORMANCE_LIMITS.MAX_CHILDREN_PER_PARENT) {
          errors.push(new HierarchyValidationError(
            VALIDATION_ERROR_TYPES.MISSING_OBJECT,
            `Превышено максимальное количество детей: ${totalChildren} > ${PERFORMANCE_LIMITS.MAX_CHILDREN_PER_PARENT}`,
            obj.id
          ));
        }
      }
    });

    // Проверяем глубину иерархии
    allObjects.forEach(obj => {
      const depth = getObjectDepth(obj.id, allObjects);
      if (depth > PERFORMANCE_LIMITS.MAX_HIERARCHY_DEPTH) {
        errors.push(new HierarchyValidationError(
          VALIDATION_ERROR_TYPES.MISSING_OBJECT,
          `Превышена максимальная глубина иерархии: ${depth} > ${PERFORMANCE_LIMITS.MAX_HIERARCHY_DEPTH}`,
          obj.id
        ));
      }
    });

  } catch (error) {
    console.error('❌ validatePerformanceLimits: Ошибка валидации производительности:', error);
  }

  return errors;
}

/**
 * Исправление ошибок валидации
 * @param {Array} errors - Массив ошибок
 * @param {Object} state - Состояние приложения
 * @returns {Object} Результат исправления
 */
export function fixValidationErrors(errors, state) {
  const result = {
    fixed: 0,
    failed: 0,
    details: []
  };

  try {
    console.log(`🔧 Начинаем исправление ${errors.length} ошибок...`);

    errors.forEach(error => {
      try {
        switch (error.type) {
          case VALIDATION_ERROR_TYPES.CYCLIC_DEPENDENCY:
            // Удаляем циклическую связь
            if (error.objectId) {
              const obj = findObjectById(state, error.objectId);
              if (obj) {
                obj.parentId = null;
                result.fixed++;
                result.details.push(`Удалена циклическая связь для ${error.objectId}`);
              }
            }
            break;

          case VALIDATION_ERROR_TYPES.ORPHANED_OBJECT:
            // Удаляем некорректную связь
            if (error.childId) {
              const child = findObjectById(state, error.childId);
              if (child) {
                child.parentId = null;
                result.fixed++;
                result.details.push(`Удалена некорректная связь для ${error.childId}`);
              }
            }
            break;

          case VALIDATION_ERROR_TYPES.MISSING_OBJECT:
            // Инициализируем недостающие поля
            if (error.objectId) {
              const obj = findObjectById(state, error.objectId);
              if (obj) {
                const objType = getObjectType(obj);
                initHierarchyFields(obj, objType);
                result.fixed++;
                result.details.push(`Инициализированы поля иерархии для ${error.objectId}`);
              }
            }
            break;

          default:
            result.failed++;
            result.details.push(`Не удалось исправить ошибку: ${error.type}`);
        }
      } catch (fixError) {
        result.failed++;
        result.details.push(`Ошибка исправления: ${fixError.message}`);
      }
    });

    console.log(`✅ Исправление завершено. Исправлено: ${result.fixed}, Не удалось: ${result.failed}`);

  } catch (error) {
    console.error('❌ fixValidationErrors: Критическая ошибка исправления:', error);
    result.failed = errors.length;
    result.details.push(`Критическая ошибка: ${error.message}`);
  }

  return result;
}

// Импорт функций из state.js
import { findObjectById, getObjectType } from '../state.js';

/**
 * Получение всех потомков (заглушка)
 * @param {string} parentId - ID родительского объекта
 * @param {Array} allObjects - Все объекты
 * @returns {Array} Массив ID потомков
 */
function getAllDescendants(parentId, stateOrAll) {
  try {
    const isState = !!(stateOrAll && (Array.isArray(stateOrAll.domains) || Array.isArray(stateOrAll.projects)));
    const allObjects = isState
      ? [
          ...(stateOrAll.domains || []),
          ...(stateOrAll.projects || []),
          ...(stateOrAll.tasks || []),
          ...(stateOrAll.ideas || []),
          ...(stateOrAll.notes || [])
        ]
      : (Array.isArray(stateOrAll) ? stateOrAll : []);

    const byId = new Map(allObjects.map(o => [o.id, o]));
    const start = isState ? findObjectById(stateOrAll, parentId) : byId.get(parentId);
    if (!start) return [];

    const result = [];
    const queue = [parentId];
    const seen = new Set([parentId]);

    while (queue.length) {
      const curId = queue.shift();
      const cur = isState ? findObjectById(stateOrAll, curId) : byId.get(curId);
      if (!cur || !cur.children) continue;
      const childIds = Object.values(cur.children).reduce((sum, arr) => sum.concat(arr), []);
      for (const cid of childIds) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        result.push(cid);
        queue.push(cid);
      }
    }

    return result;
  } catch (_) {
    return [];
  }
}

/**
 * Получение пути к объекту (заглушка)
 * @param {string} objId - ID объекта
 * @param {Array} allObjects - Все объекты
 * @returns {Array} Массив ID пути
 */
function getObjectPath(objId, allObjects) {
  try {
    const byId = new Map((allObjects || []).map(o => [o.id, o]));
    const path = [objId];
    let cur = byId.get(objId);
    const visited = new Set([objId]);
    while (cur && cur.parentId) {
      path.push(cur.parentId);
      if (visited.has(cur.parentId)) break; // цикл
      visited.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return path;
  } catch (_) {
    return [objId];
  }
}

/**
 * Получение глубины объекта (заглушка)
 * @param {string} objId - ID объекта
 * @param {Array} allObjects - Все объекты
 * @returns {number} Глубина
 */
function getObjectDepth(objId, allObjects) {
  try {
    const byId = new Map((allObjects || []).map(o => [o.id, o]));
    let depth = 0;
    let cur = byId.get(objId);
    const visited = new Set();
    while (cur && cur.parentId) {
      if (visited.has(cur.id)) break; // защита от циклов
      visited.add(cur.id);
      depth++;
      cur = byId.get(cur.parentId);
    }
    return depth;
  } catch (_) {
    return 0;
  }
}

/**
 * Проверка блокировки объекта (заглушка)
 * @param {Object} obj - Объект
 * @param {string} lockType - Тип блокировки
 * @returns {boolean} Заблокирован ли объект
 */
function isObjectLocked(obj, lockType) {
  // TODO: Интегрировать с state.js
  return obj.locks && obj.locks[lockType] === true;
}

/**
 * Инициализация полей иерархии (заглушка)
 * @param {Object} obj - Объект
 * @param {string} type - Тип объекта
 * @returns {Object} Объект с инициализированными полями
 */
function initHierarchyFields(obj, type) {
  // TODO: Интегрировать с core.js
  if (!obj.parentId) obj.parentId = null;
  if (!obj.children) obj.children = { projects: [], tasks: [], ideas: [], notes: [] };
  if (!obj.locks) obj.locks = { move: false, hierarchy: false };
  if (!obj.constraints) obj.constraints = { maxRadius: 50, orbitRadius: 30, autoLayout: false };
  return obj;
}

// Все функции уже экспортированы по отдельности выше
