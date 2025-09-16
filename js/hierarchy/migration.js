// js/hierarchy/migration.js
// Миграция данных для системы иерархии v2

import { 
  OBJECT_TYPES, 
  VALIDATION_ERROR_TYPES,
  ERROR_MESSAGES 
} from '../types/hierarchy.js';

/**
 * Анализ существующих данных для миграции
 * @param {Object} state - Состояние приложения
 * @returns {Object} Результат анализа
 */
export function analyzeExistingData(state) {
  try {
    console.log('🔍 Анализ существующих данных для миграции...');
    
    const analysis = {
      totalObjects: 0,
      objectsWithHierarchy: 0,
      objectsWithoutHierarchy: 0,
      existingConnections: 0,
      potentialConnections: 0,
      byType: {
        domains: { total: 0, withHierarchy: 0, withoutHierarchy: 0 },
        projects: { total: 0, withHierarchy: 0, withoutHierarchy: 0 },
        tasks: { total: 0, withHierarchy: 0, withoutHierarchy: 0 },
        ideas: { total: 0, withHierarchy: 0, withoutHierarchy: 0 },
        notes: { total: 0, withHierarchy: 0, withoutHierarchy: 0 }
      },
      issues: [],
      recommendations: []
    };

    // Анализируем все объекты
    const allObjects = [
      ...(state.domains || []),
      ...(state.projects || []),
      ...(state.tasks || []),
      ...(state.ideas || []),
      ...(state.notes || [])
    ];

    analysis.totalObjects = allObjects.length;

    allObjects.forEach(obj => {
      const objType = getObjectType(obj);
      const typeKey = objType + 's';
      
      if (analysis.byType[typeKey]) {
        analysis.byType[typeKey].total++;
        
        // Проверяем наличие полей иерархии
        const hasHierarchy = obj.parentId !== undefined || obj.children !== undefined || obj.locks !== undefined;
        
        if (hasHierarchy) {
          analysis.objectsWithHierarchy++;
          analysis.byType[typeKey].withHierarchy++;
        } else {
          analysis.objectsWithoutHierarchy++;
          analysis.byType[typeKey].withoutHierarchy++;
        }

        // Подсчитываем существующие связи
        if (obj.parentId) {
          analysis.existingConnections++;
        }

        // Подсчитываем потенциальные связи
        if (obj.domainId && objType !== 'domain') {
          analysis.potentialConnections++;
        }
        if (obj.projectId && objType === 'task') {
          analysis.potentialConnections++;
        }
      }
    });

    // Анализируем проблемы
    if (analysis.objectsWithoutHierarchy > 0) {
      analysis.issues.push(`${analysis.objectsWithoutHierarchy} объектов не имеют полей иерархии`);
      analysis.recommendations.push('Инициализировать поля иерархии для всех объектов');
    }

    if (analysis.potentialConnections > 0) {
      analysis.issues.push(`Найдено ${analysis.potentialConnections} потенциальных связей для восстановления`);
      analysis.recommendations.push('Восстановить связи на основе существующих полей domainId/projectId');
    }

    if (analysis.existingConnections > 0) {
      analysis.issues.push(`Найдено ${analysis.existingConnections} существующих связей`);
      analysis.recommendations.push('Проверить корректность существующих связей');
    }

    console.log(`✅ Анализ завершен. Объектов: ${analysis.totalObjects}, Связей: ${analysis.existingConnections}`);
    return analysis;

  } catch (error) {
    console.error('❌ analyzeExistingData: Ошибка анализа данных:', error);
    return {
      totalObjects: 0,
      objectsWithHierarchy: 0,
      objectsWithoutHierarchy: 0,
      existingConnections: 0,
      potentialConnections: 0,
      byType: {},
      issues: [`Критическая ошибка: ${error.message}`],
      recommendations: ['Обратитесь к разработчику']
    };
  }
}

/**
 * Предпросмотр миграции
 * @param {Object} state - Состояние приложения
 * @returns {Object} Предпросмотр изменений
 */
export function previewMigration(state) {
  try {
    console.log('👁️ Предпросмотр миграции...');
    
    const preview = {
      willBeCreated: [],
      willBeRestored: [],
      willBeValidated: [],
      willBeCleared: [],
      warnings: [],
      estimatedTime: 0
    };

    const allObjects = [
      ...(state.domains || []),
      ...(state.projects || []),
      ...(state.tasks || []),
      ...(state.ideas || []),
      ...(state.notes || [])
    ];

    allObjects.forEach(obj => {
      const objType = getObjectType(obj);
      
      // Проверяем, что будет создано
      if (!obj.parentId && !obj.children && !obj.locks && !obj.constraints) {
        preview.willBeCreated.push({
          id: obj.id,
          type: objType,
          action: 'Инициализация полей иерархии'
        });
      }

      // Проверяем, что будет восстановлено
      if (obj.domainId && objType !== 'domain') {
        preview.willBeRestored.push({
          id: obj.id,
          type: objType,
          parentId: obj.domainId,
          action: 'Восстановление связи с доменом'
        });
      }

      if (obj.projectId && objType === 'task') {
        preview.willBeRestored.push({
          id: obj.id,
          type: objType,
          parentId: obj.projectId,
          action: 'Восстановление связи с проектом'
        });
      }

      // Проверяем, что будет валидировано
      if (obj.parentId || obj.children) {
        preview.willBeValidated.push({
          id: obj.id,
          type: objType,
          action: 'Валидация существующих связей'
        });
      }
    });

    // Оценка времени
    preview.estimatedTime = Math.ceil(
      (preview.willBeCreated.length * 0.1) +
      (preview.willBeRestored.length * 0.2) +
      (preview.willBeValidated.length * 0.05)
    );

    console.log(`✅ Предпросмотр завершен. Изменений: ${preview.willBeCreated.length + preview.willBeRestored.length}`);
    return preview;

  } catch (error) {
    console.error('❌ previewMigration: Ошибка предпросмотра:', error);
    return {
      willBeCreated: [],
      willBeRestored: [],
      willBeValidated: [],
      willBeCleared: [],
      warnings: [`Критическая ошибка: ${error.message}`],
      estimatedTime: 0
    };
  }
}

/**
 * Выполнение миграции к системе иерархии v2
 * @param {Object} state - Состояние приложения
 * @param {Object} options - Опции миграции
 * @returns {Object} Результат миграции
 */
export function migrateToHierarchyV2(state, options = {}) {
  try {
    console.log('🚀 Начинаем миграцию к системе иерархии v2...');
    
    const result = {
      success: false,
      processedObjects: 0,
      createdConnections: 0,
      restoredConnections: 0,
      validatedConnections: 0,
      errors: [],
      warnings: [],
      details: []
    };

    const {
      clearExisting = false,
      restoreConnections = true,
      validateConnections = true,
      dryRun = false
    } = options;

    // Очищаем существующие связи если нужно
    if (clearExisting) {
      console.log('🧹 Очищаем существующие связи...');
      clearExistingHierarchy(state);
      result.details.push('Существующие связи очищены');
    }

    // Инициализируем поля иерархии для всех объектов
    const allObjects = [
      ...(state.domains || []),
      ...(state.projects || []),
      ...(state.tasks || []),
      ...(state.ideas || []),
      ...(state.notes || [])
    ];

    allObjects.forEach(obj => {
      try {
        const objType = getObjectType(obj);
        
        // Инициализируем поля иерархии
        if (!dryRun) {
          initHierarchyFields(obj, objType);
        }
        
        result.processedObjects++;
        result.details.push(`Инициализирован ${objType}: ${obj.id}`);

        // Восстанавливаем связи если нужно
        if (restoreConnections && !dryRun) {
          if (obj.domainId && objType !== 'domain') {
            if (setParentChild(obj.domainId, obj.id, objType)) {
              result.restoredConnections++;
              result.details.push(`Восстановлена связь: ${obj.domainId} → ${obj.id}`);
            }
          }

          if (obj.projectId && objType === 'task') {
            if (setParentChild(obj.projectId, obj.id, objType)) {
              result.restoredConnections++;
              result.details.push(`Восстановлена связь: ${obj.projectId} → ${obj.id}`);
            }
          }
        }

      } catch (error) {
        result.errors.push(`Ошибка обработки ${obj.id}: ${error.message}`);
      }
    });

    // Валидируем связи если нужно
    if (validateConnections && !dryRun) {
      console.log('🔍 Валидация связей...');
      const validationErrors = validateHierarchy(state);
      if (validationErrors.length > 0) {
        result.warnings.push(`Найдено ${validationErrors.length} ошибок валидации`);
        result.errors.push(...validationErrors.map(e => e.message));
      } else {
        result.validatedConnections = result.restoredConnections;
        result.details.push('Все связи прошли валидацию');
      }
    }

    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log(`✅ Миграция завершена успешно. Обработано: ${result.processedObjects}, Связей: ${result.restoredConnections}`);
    } else {
      console.warn(`⚠️ Миграция завершена с ошибками. Ошибок: ${result.errors.length}`);
    }

    return result;

  } catch (error) {
    console.error('❌ migrateToHierarchyV2: Критическая ошибка миграции:', error);
    return {
      success: false,
      processedObjects: 0,
      createdConnections: 0,
      restoredConnections: 0,
      validatedConnections: 0,
      errors: [`Критическая ошибка: ${error.message}`],
      warnings: [],
      details: []
    };
  }
}

/**
 * Откат миграции
 * @param {Object} state - Состояние приложения
 * @returns {Object} Результат отката
 */
export function rollbackMigration(state) {
  try {
    console.log('⏪ Откат миграции...');
    
    const result = {
      success: false,
      clearedObjects: 0,
      clearedConnections: 0,
      errors: [],
      details: []
    };

    const allObjects = [
      ...(state.domains || []),
      ...(state.projects || []),
      ...(state.tasks || []),
      ...(state.ideas || []),
      ...(state.notes || [])
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

    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log(`✅ Откат завершен. Очищено объектов: ${result.clearedObjects}`);
    } else {
      console.warn(`⚠️ Откат завершен с ошибками. Ошибок: ${result.errors.length}`);
    }

    return result;

  } catch (error) {
    console.error('❌ rollbackMigration: Критическая ошибка отката:', error);
    return {
      success: false,
      clearedObjects: 0,
      clearedConnections: 0,
      errors: [`Критическая ошибка: ${error.message}`],
      details: []
    };
  }
}

/**
 * Очистка существующей иерархии
 * @param {Object} state - Состояние приложения
 * @returns {boolean} Успешность операции
 */
function clearExistingHierarchy(state) {
  try {
    const allObjects = [
      ...(state.domains || []),
      ...(state.projects || []),
      ...(state.tasks || []),
      ...(state.ideas || []),
      ...(state.notes || [])
    ];

    allObjects.forEach(obj => {
      if (obj.parentId) obj.parentId = null;
      if (obj.children) {
        obj.children = {
          projects: [],
          tasks: [],
          ideas: [],
          notes: []
        };
      }
    });

    return true;

  } catch (error) {
    console.error('❌ clearExistingHierarchy: Ошибка очистки:', error);
    return false;
  }
}

// Вспомогательные функции (будут интегрированы с другими модулями)
// TODO: Заменить на реальные функции

/**
 * Получение типа объекта (заглушка)
 * @param {Object} obj - Объект
 * @returns {string} Тип объекта
 */
function getObjectType(obj) {
  if (obj.title && obj.mood) return OBJECT_TYPES.DOMAIN;
  if (obj.title && obj.domainId) return OBJECT_TYPES.PROJECT;
  if (obj.title && obj.status) return OBJECT_TYPES.TASK;
  if (obj.title && obj.content) return OBJECT_TYPES.IDEA;
  if (obj.title && obj.text) return OBJECT_TYPES.NOTE;
  return 'unknown';
}

/**
 * Инициализация полей иерархии (заглушка)
 * @param {Object} obj - Объект
 * @param {string} type - Тип объекта
 * @returns {Object} Объект с инициализированными полями
 */
function initHierarchyFields(obj, type) {
  if (!obj.parentId) obj.parentId = null;
  if (!obj.children) obj.children = { projects: [], tasks: [], ideas: [], notes: [] };
  if (!obj.locks) obj.locks = { move: false, hierarchy: false };
  if (!obj.constraints) obj.constraints = { maxRadius: 50, orbitRadius: 30, autoLayout: false };
  return obj;
}

/**
 * Установка связи родитель-ребенок (заглушка)
 * @param {string} parentId - ID родительского объекта
 * @param {string} childId - ID дочернего объекта
 * @param {string} childType - Тип дочернего объекта
 * @returns {boolean} Успешность операции
 */
function setParentChild(parentId, childId, childType) {
  // TODO: Интегрировать с core.js
  console.log(`🔗 setParentChild: ${parentId} → ${childId} (${childType})`);
  return true;
}

/**
 * Валидация иерархии (заглушка)
 * @param {Object} state - Состояние приложения
 * @returns {Array} Массив ошибок валидации
 */
function validateHierarchy(state) {
  // TODO: Интегрировать с validation.js
  return [];
}

// Все функции уже экспортированы по отдельности выше
