// js/types/hierarchy.js
// TypeScript-подобные типы для системы иерархии v2

/**
 * @typedef {Object} HierarchyObject
 * @property {string} id - Уникальный идентификатор объекта
 * @property {string|null} parentId - ID родительского объекта
 * @property {ChildObjects} children - Дочерние объекты по типам
 * @property {ObjectLocks} locks - Блокировки объекта
 * @property {ObjectConstraints} constraints - Ограничения объекта
 */

/**
 * @typedef {Object} ChildObjects
 * @property {string[]} projects - ID дочерних проектов
 * @property {string[]} tasks - ID дочерних задач
 * @property {string[]} ideas - ID дочерних идей
 * @property {string[]} notes - ID дочерних заметок
 */

/**
 * @typedef {Object} ObjectLocks
 * @property {boolean} move - Блокировка перемещения
 * @property {boolean} hierarchy - Блокировка смены связей
 */

/**
 * @typedef {Object} ObjectConstraints
 * @property {number} maxRadius - Максимальный радиус объекта
 * @property {number} orbitRadius - Радиус орбиты для детей
 * @property {boolean} autoLayout - Автоматическое размещение детей
 */

/**
 * @typedef {'domain'|'project'|'task'|'idea'|'note'} ObjectType
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} type - Тип ошибки
 * @property {string} message - Сообщение об ошибке
 * @property {string} objectId - ID проблемного объекта
 * @property {string} [parentId] - ID родительского объекта
 * @property {string} [childId] - ID дочернего объекта
 */

/**
 * @typedef {Object} HierarchyStats
 * @property {number} totalConnections - Общее количество связей
 * @property {number} maxDepth - Максимальная глубина иерархии
 * @property {number} orphanedObjects - Количество независимых объектов
 * @property {number} lockedObjects - Количество заблокированных объектов
 */

/**
 * @typedef {Object} MigrationResult
 * @property {boolean} success - Успешность миграции
 * @property {number} processedObjects - Количество обработанных объектов
 * @property {number} createdConnections - Количество созданных связей
 * @property {ValidationError[]} errors - Ошибки миграции
 * @property {string[]} warnings - Предупреждения
 */

/**
 * @typedef {Object} HierarchyConfig
 * @property {boolean} enableHierarchyV2 - Включение системы иерархии
 * @property {boolean} autoMigrate - Автоматическая миграция
 * @property {boolean} strictValidation - Строгая валидация
 * @property {boolean} performanceMode - Режим оптимизации
 * @property {Object} constraints - Ограничения по типам объектов
 */

// Константы для типов объектов
export const OBJECT_TYPES = {
  DOMAIN: 'domain',
  PROJECT: 'project', 
  TASK: 'task',
  IDEA: 'idea',
  NOTE: 'note'
};

// Константы для типов блокировок
export const LOCK_TYPES = {
  MOVE: 'move',
  HIERARCHY: 'hierarchy'
};

// Константы для типов ошибок валидации
export const VALIDATION_ERROR_TYPES = {
  CYCLIC_DEPENDENCY: 'cyclic_dependency',
  INVALID_PARENT_TYPE: 'invalid_parent_type',
  INVALID_CHILD_TYPE: 'invalid_child_type',
  ORPHANED_OBJECT: 'orphaned_object',
  MISSING_OBJECT: 'missing_object',
  LOCK_VIOLATION: 'lock_violation'
};

// Конфигурация по умолчанию
export const DEFAULT_HIERARCHY_CONFIG = {
  enableHierarchyV2: false,
  autoMigrate: true,
  strictValidation: true,
  performanceMode: false,
  constraints: {
    domain: { maxRadius: 200, orbitRadius: 150, autoLayout: true },
    project: { maxRadius: 100, orbitRadius: 80, autoLayout: true },
    task: { maxRadius: 50, orbitRadius: 30, autoLayout: false },
    idea: { maxRadius: 40, orbitRadius: 25, autoLayout: false },
    note: { maxRadius: 35, orbitRadius: 20, autoLayout: false }
  }
};

// Правила разрешенных связей
export const ALLOWED_CONNECTIONS = {
  [OBJECT_TYPES.DOMAIN]: [OBJECT_TYPES.PROJECT, OBJECT_TYPES.TASK, OBJECT_TYPES.IDEA, OBJECT_TYPES.NOTE],
  [OBJECT_TYPES.PROJECT]: [OBJECT_TYPES.TASK, OBJECT_TYPES.IDEA, OBJECT_TYPES.NOTE],
  [OBJECT_TYPES.TASK]: [OBJECT_TYPES.IDEA, OBJECT_TYPES.NOTE],
  [OBJECT_TYPES.IDEA]: [OBJECT_TYPES.NOTE],
  [OBJECT_TYPES.NOTE]: [] // Заметки не могут быть родителями
};

// Ограничения производительности
export const PERFORMANCE_LIMITS = {
  MAX_CHILDREN_PER_PARENT: 1000,
  MAX_HIERARCHY_DEPTH: 5,
  MAX_CACHE_SIZE: 10000,
  MAX_OPERATION_TIME_MS: 100
};

// Сообщения об ошибках
export const ERROR_MESSAGES = {
  [VALIDATION_ERROR_TYPES.CYCLIC_DEPENDENCY]: 'Обнаружена циклическая зависимость',
  [VALIDATION_ERROR_TYPES.INVALID_PARENT_TYPE]: 'Недопустимый тип родительского объекта',
  [VALIDATION_ERROR_TYPES.INVALID_CHILD_TYPE]: 'Недопустимый тип дочернего объекта',
  [VALIDATION_ERROR_TYPES.ORPHANED_OBJECT]: 'Объект не имеет родителя',
  [VALIDATION_ERROR_TYPES.MISSING_OBJECT]: 'Объект не найден',
  [VALIDATION_ERROR_TYPES.LOCK_VIOLATION]: 'Операция заблокирована'
};

// Утилиты для работы с типами
export const HierarchyUtils = {
  /**
   * Проверяет, является ли связь разрешенной
   * @param {ObjectType} parentType - Тип родительского объекта
   * @param {ObjectType} childType - Тип дочернего объекта
   * @returns {boolean}
   */
  isConnectionAllowed(parentType, childType) {
    return ALLOWED_CONNECTIONS[parentType]?.includes(childType) || false;
  },

  /**
   * Получает максимальную глубину для типа объекта
   * @param {ObjectType} type - Тип объекта
   * @returns {number}
   */
  getMaxDepthForType(type) {
    const depthMap = {
      [OBJECT_TYPES.DOMAIN]: 4,
      [OBJECT_TYPES.PROJECT]: 3,
      [OBJECT_TYPES.TASK]: 2,
      [OBJECT_TYPES.IDEA]: 1,
      [OBJECT_TYPES.NOTE]: 0
    };
    return depthMap[type] || 0;
  },

  /**
   * Проверяет, может ли объект быть родителем
   * @param {ObjectType} type - Тип объекта
   * @returns {boolean}
   */
  canBeParent(type) {
    return ALLOWED_CONNECTIONS[type]?.length > 0;
  },

  /**
   * Получает иконку для типа объекта
   * @param {ObjectType} type - Тип объекта
   * @returns {string}
   */
  getIconForType(type) {
    const iconMap = {
      [OBJECT_TYPES.DOMAIN]: '🌍',
      [OBJECT_TYPES.PROJECT]: '🎯',
      [OBJECT_TYPES.TASK]: '✅',
      [OBJECT_TYPES.IDEA]: '🌌',
      [OBJECT_TYPES.NOTE]: '📝'
    };
    return iconMap[type] || '❓';
  },

  /**
   * Получает название типа объекта
   * @param {ObjectType} type - Тип объекта
   * @returns {string}
   */
  getTypeName(type) {
    const nameMap = {
      [OBJECT_TYPES.DOMAIN]: 'Домен',
      [OBJECT_TYPES.PROJECT]: 'Проект',
      [OBJECT_TYPES.TASK]: 'Задача',
      [OBJECT_TYPES.IDEA]: 'Идея',
      [OBJECT_TYPES.NOTE]: 'Заметка'
    };
    return nameMap[type] || 'Неизвестный';
  }
};

// Экспорт для использования в других модулях
export default {
  OBJECT_TYPES,
  LOCK_TYPES,
  VALIDATION_ERROR_TYPES,
  DEFAULT_HIERARCHY_CONFIG,
  ALLOWED_CONNECTIONS,
  PERFORMANCE_LIMITS,
  ERROR_MESSAGES,
  HierarchyUtils
};
