// js/hierarchy/locks.js
// Система блокировок для иерархии v2

import { LOCK_TYPES } from '../types/hierarchy.js';

/**
 * Проверка блокировки объекта
 * @param {Object} obj - Объект для проверки
 * @param {string} lockType - Тип блокировки ('move' или 'hierarchy')
 * @returns {boolean} Заблокирован ли объект
 */
export function isObjectLocked(obj, lockType) {
  if (!obj || !obj.locks) {
    return false;
  }

  if (lockType === LOCK_TYPES.MOVE) {
    return obj.locks.move === true;
  }

  if (lockType === LOCK_TYPES.HIERARCHY) {
    return obj.locks.hierarchy === true;
  }

  console.warn(`⚠️ isObjectLocked: Неизвестный тип блокировки: ${lockType}`);
  return false;
}

/**
 * Установка блокировки объекта
 * @param {Object} obj - Объект для блокировки
 * @param {string} lockType - Тип блокировки ('move' или 'hierarchy')
 * @param {boolean} locked - Заблокировать или разблокировать
 * @returns {boolean} Успешность операции
 */
export function setObjectLock(obj, lockType, locked) {
  try {
    if (!obj) {
      console.warn('❌ setObjectLock: Объект не передан');
      return false;
    }

    // Инициализируем поля locks если нужно
    if (!obj.locks) {
      obj.locks = {
        move: false,
        hierarchy: false
      };
    }

    if (lockType === LOCK_TYPES.MOVE) {
      obj.locks.move = locked === true;
      console.log(`🔒 setObjectLock: Блокировка перемещения ${locked ? 'установлена' : 'снята'} для ${obj.id}`);
      return true;
    }

    if (lockType === LOCK_TYPES.HIERARCHY) {
      obj.locks.hierarchy = locked === true;
      console.log(`🔒 setObjectLock: Блокировка иерархии ${locked ? 'установлена' : 'снята'} для ${obj.id}`);
      return true;
    }

    console.warn(`❌ setObjectLock: Неизвестный тип блокировки: ${lockType}`);
    return false;

  } catch (error) {
    console.error('❌ setObjectLock: Ошибка установки блокировки:', error);
    return false;
  }
}

/**
 * Проверка возможности перемещения объекта
 * @param {Object} obj - Объект для проверки
 * @returns {boolean} Можно ли перемещать объект
 */
export function canMoveObject(obj) {
  if (!obj) {
    return false;
  }

  // Проверяем блокировку перемещения
  if (isObjectLocked(obj, LOCK_TYPES.MOVE)) {
    console.log(`🔒 canMoveObject: Объект ${obj.id} заблокирован для перемещения`);
    return false;
  }

  return true;
}

/**
 * Проверка возможности изменения иерархии объекта
 * @param {Object} obj - Объект для проверки
 * @returns {boolean} Можно ли изменять иерархию объекта
 */
export function canChangeHierarchy(obj) {
  if (!obj) {
    return false;
  }

  // Проверяем блокировку иерархии
  if (isObjectLocked(obj, LOCK_TYPES.HIERARCHY)) {
    console.log(`🔒 canChangeHierarchy: Объект ${obj.id} заблокирован для изменения иерархии`);
    return false;
  }

  return true;
}

/**
 * Получение всех заблокированных объектов
 * @param {Object} state - Состояние приложения
 * @param {string} lockType - Тип блокировки (опционально)
 * @returns {Array} Массив заблокированных объектов
 */
export function getLockedObjects(state, lockType = null) {
  try {
    const allObjects = [
      ...(state.domains || []),
      ...(state.projects || []),
      ...(state.tasks || []),
      ...(state.ideas || []),
      ...(state.notes || [])
    ];

    if (lockType) {
      // Возвращаем объекты с конкретным типом блокировки
      return allObjects.filter(obj => isObjectLocked(obj, lockType));
    } else {
      // Возвращаем все заблокированные объекты
      return allObjects.filter(obj => 
        isObjectLocked(obj, LOCK_TYPES.MOVE) || 
        isObjectLocked(obj, LOCK_TYPES.HIERARCHY)
      );
    }

  } catch (error) {
    console.error('❌ getLockedObjects: Ошибка получения заблокированных объектов:', error);
    return [];
  }
}

/**
 * Получение статистики блокировок
 * @param {Object} state - Состояние приложения
 * @returns {Object} Статистика блокировок
 */
export function getLockStatistics(state) {
  try {
    const allObjects = [
      ...(state.domains || []),
      ...(state.projects || []),
      ...(state.tasks || []),
      ...(state.ideas || []),
      ...(state.notes || [])
    ];

    const stats = {
      total: allObjects.length,
      moveLocked: 0,
      hierarchyLocked: 0,
      bothLocked: 0,
      unlocked: 0,
      byType: {
        domains: { total: 0, moveLocked: 0, hierarchyLocked: 0 },
        projects: { total: 0, moveLocked: 0, hierarchyLocked: 0 },
        tasks: { total: 0, moveLocked: 0, hierarchyLocked: 0 },
        ideas: { total: 0, moveLocked: 0, hierarchyLocked: 0 },
        notes: { total: 0, moveLocked: 0, hierarchyLocked: 0 }
      }
    };

    allObjects.forEach(obj => {
      const objType = getObjectType(obj);
      const moveLocked = isObjectLocked(obj, LOCK_TYPES.MOVE);
      const hierarchyLocked = isObjectLocked(obj, LOCK_TYPES.HIERARCHY);

      // Общая статистика
      if (moveLocked) stats.moveLocked++;
      if (hierarchyLocked) stats.hierarchyLocked++;
      if (moveLocked && hierarchyLocked) stats.bothLocked++;
      if (!moveLocked && !hierarchyLocked) stats.unlocked++;

      // Статистика по типам
      if (stats.byType[objType + 's']) {
        stats.byType[objType + 's'].total++;
        if (moveLocked) stats.byType[objType + 's'].moveLocked++;
        if (hierarchyLocked) stats.byType[objType + 's'].hierarchyLocked++;
      }
    });

    return stats;

  } catch (error) {
    console.error('❌ getLockStatistics: Ошибка получения статистики блокировок:', error);
    return {
      total: 0,
      moveLocked: 0,
      hierarchyLocked: 0,
      bothLocked: 0,
      unlocked: 0,
      byType: {}
    };
  }
}

/**
 * Массовая установка блокировок
 * @param {Array} objectIds - Массив ID объектов
 * @param {string} lockType - Тип блокировки
 * @param {boolean} locked - Заблокировать или разблокировать
 * @param {Object} state - Состояние приложения
 * @returns {Object} Результат операции
 */
export function batchSetLocks(objectIds, lockType, locked, state) {
  const result = {
    success: 0,
    failed: 0,
    details: []
  };

  try {
    console.log(`🔒 batchSetLocks: ${locked ? 'Блокируем' : 'Разблокируем'} ${objectIds.length} объектов`);

    objectIds.forEach(objId => {
      try {
        const obj = findObjectById(state, objId);
        if (!obj) {
          result.failed++;
          result.details.push(`Объект ${objId} не найден`);
          return;
        }

        if (setObjectLock(obj, lockType, locked)) {
          result.success++;
          result.details.push(`Объект ${objId} ${locked ? 'заблокирован' : 'разблокирован'}`);
        } else {
          result.failed++;
          result.details.push(`Не удалось ${locked ? 'заблокировать' : 'разблокировать'} ${objId}`);
        }
      } catch (error) {
        result.failed++;
        result.details.push(`Ошибка для ${objId}: ${error.message}`);
      }
    });

    console.log(`✅ batchSetLocks: Успешно: ${result.success}, Ошибок: ${result.failed}`);

  } catch (error) {
    console.error('❌ batchSetLocks: Критическая ошибка:', error);
    result.failed = objectIds.length;
    result.details.push(`Критическая ошибка: ${error.message}`);
  }

  return result;
}

/**
 * Проверка блокировок для операции перемещения
 * @param {string} objId - ID объекта
 * @param {Object} state - Состояние приложения
 * @returns {Object} Результат проверки
 */
export function checkMovePermissions(objId, state) {
  try {
    const obj = findObjectById(state, objId);
    if (!obj) {
      return {
        canMove: false,
        reason: 'Объект не найден',
        locks: []
      };
    }

    const locks = [];
    let canMove = true;
    let reason = '';

    // Проверяем блокировку перемещения
    if (isObjectLocked(obj, LOCK_TYPES.MOVE)) {
      canMove = false;
      locks.push('move');
      reason = 'Объект заблокирован для перемещения';
    }

    // Проверяем блокировку иерархии (если объект имеет родителя)
    if (obj.parentId && isObjectLocked(obj, LOCK_TYPES.HIERARCHY)) {
      canMove = false;
      locks.push('hierarchy');
      reason = 'Объект заблокирован для изменения иерархии';
    }

    return {
      canMove,
      reason,
      locks,
      objectId: objId
    };

  } catch (error) {
    console.error('❌ checkMovePermissions: Ошибка проверки разрешений:', error);
    return {
      canMove: false,
      reason: 'Ошибка проверки разрешений',
      locks: [],
      objectId: objId
    };
  }
}

/**
 * Проверка блокировок для операции изменения иерархии
 * @param {string} objId - ID объекта
 * @param {Object} state - Состояние приложения
 * @returns {Object} Результат проверки
 */
export function checkHierarchyPermissions(objId, state) {
  try {
    const obj = findObjectById(state, objId);
    if (!obj) {
      return {
        canChange: false,
        reason: 'Объект не найден',
        locks: []
      };
    }

    const locks = [];
    let canChange = true;
    let reason = '';

    // Проверяем блокировку иерархии
    if (isObjectLocked(obj, LOCK_TYPES.HIERARCHY)) {
      canChange = false;
      locks.push('hierarchy');
      reason = 'Объект заблокирован для изменения иерархии';
    }

    return {
      canChange,
      reason,
      locks,
      objectId: objId
    };

  } catch (error) {
    console.error('❌ checkHierarchyPermissions: Ошибка проверки разрешений:', error);
    return {
      canChange: false,
      reason: 'Ошибка проверки разрешений',
      locks: [],
      objectId: objId
    };
  }
}

// Импорт функций из state.js
import { findObjectById, getObjectType } from '../state.js';

// Экспорт для использования в других модулях
export default {
  isObjectLocked,
  setObjectLock,
  canMoveObject,
  canChangeHierarchy,
  getLockedObjects,
  getLockStatistics,
  batchSetLocks,
  checkMovePermissions,
  checkHierarchyPermissions
};
