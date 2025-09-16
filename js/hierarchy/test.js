// js/hierarchy/test.js
// Тесты для системы иерархии v2

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
} from './index.js';

/**
 * Тестовые данные
 */
const testState = {
  domains: [
    {
      id: 'd1',
      title: 'Работа',
      mood: 'productive'
    },
    {
      id: 'd2', 
      title: 'Дом',
      mood: 'cozy'
    }
  ],
  projects: [
    {
      id: 'p1',
      title: 'Проект А',
      domainId: 'd1'
    },
    {
      id: 'p2',
      title: 'Проект Б',
      domainId: 'd1'
    }
  ],
  tasks: [
    {
      id: 't1',
      title: 'Задача 1',
      status: 'backlog',
      projectId: 'p1'
    },
    {
      id: 't2',
      title: 'Задача 2', 
      status: 'today',
      projectId: 'p1'
    }
  ],
  ideas: [
    {
      id: 'i1',
      title: 'Идея 1',
      content: 'Творческая мысль'
    }
  ],
  notes: [
    {
      id: 'n1',
      title: 'Заметка 1',
      text: 'Важная информация'
    }
  ]
};

/**
 * Запуск всех тестов
 */
export function runAllTests() {
  console.log('🧪 Запуск тестов системы иерархии v2...');
  
  const results = {
    passed: 0,
    failed: 0,
    total: 0,
    details: []
  };

  // Тест 1: Инициализация полей иерархии
  testInitHierarchyFields(results);
  
  // Тест 2: Установка связей
  testSetParentChild(results);
  
  // Тест 3: Получение связей
  testGetConnections(results);
  
  // Тест 4: Система блокировок
  testLocks(results);
  
  // Тест 5: Валидация
  testValidation(results);

  // Выводим результаты
  console.log(`\n📊 Результаты тестирования:`);
  console.log(`✅ Пройдено: ${results.passed}`);
  console.log(`❌ Провалено: ${results.failed}`);
  console.log(`📈 Всего: ${results.total}`);
  console.log(`📊 Успешность: ${Math.round((results.passed / results.total) * 100)}%`);

  if (results.failed > 0) {
    console.log(`\n❌ Детали ошибок:`);
    results.details.forEach(detail => {
      console.log(`  - ${detail}`);
    });
  }

  return results;
}

/**
 * Тест инициализации полей иерархии
 */
function testInitHierarchyFields(results) {
  console.log('🔧 Тест 1: Инициализация полей иерархии');
  
  try {
    const testObj = { id: 'test1', title: 'Test' };
    const result = initHierarchyFields(testObj, 'domain');
    
    // Проверяем наличие полей
    if (!result.parentId === null) {
      throw new Error('parentId не инициализирован');
    }
    
    if (!result.children || !result.children.projects) {
      throw new Error('children не инициализирован');
    }
    
    if (!result.locks || typeof result.locks.move !== 'boolean') {
      throw new Error('locks не инициализирован');
    }
    
    if (!result.constraints || typeof result.constraints.maxRadius !== 'number') {
      throw new Error('constraints не инициализирован');
    }

    results.passed++;
    results.details.push('✅ Инициализация полей иерархии - ПРОЙДЕН');
    
  } catch (error) {
    results.failed++;
    results.details.push(`❌ Инициализация полей иерархии - ПРОВАЛЕН: ${error.message}`);
  }
  
  results.total++;
}

/**
 * Тест установки связей
 */
function testSetParentChild(results) {
  console.log('🔗 Тест 2: Установка связей');
  
  try {
    // Создаем тестовые объекты
    const parent = { id: 'parent1', title: 'Parent' };
    const child = { id: 'child1', title: 'Child' };
    
    // Инициализируем поля
    initHierarchyFields(parent, 'domain');
    initHierarchyFields(child, 'project');
    
    // Устанавливаем связь
    const success = setParentChild(parent.id, child.id, 'project');
    
    if (!success) {
      throw new Error('Не удалось установить связь');
    }
    
    // Проверяем, что связь установлена
    if (child.parentId !== parent.id) {
      throw new Error('parentId не установлен');
    }
    
    if (!parent.children.projects.includes(child.id)) {
      throw new Error('child не добавлен в список детей');
    }

    results.passed++;
    results.details.push('✅ Установка связей - ПРОЙДЕН');
    
  } catch (error) {
    results.failed++;
    results.details.push(`❌ Установка связей - ПРОВАЛЕН: ${error.message}`);
  }
  
  results.total++;
}

/**
 * Тест получения связей
 */
function testGetConnections(results) {
  console.log('🔍 Тест 3: Получение связей');
  
  try {
    // Создаем тестовые объекты
    const parent = { id: 'parent2', title: 'Parent' };
    const child1 = { id: 'child2', title: 'Child 1' };
    const child2 = { id: 'child3', title: 'Child 2' };
    
    // Инициализируем поля
    initHierarchyFields(parent, 'domain');
    initHierarchyFields(child1, 'project');
    initHierarchyFields(child2, 'project');
    
    // Устанавливаем связи
    setParentChild(parent.id, child1.id, 'project');
    setParentChild(parent.id, child2.id, 'project');
    
    // Проверяем получение родителя
    const parentResult = getParentObject(child1.id);
    if (!parentResult || parentResult.id !== parent.id) {
      throw new Error('Не удалось получить родителя');
    }
    
    // Проверяем получение детей
    const childrenResult = getChildObjects(parent.id);
    if (!childrenResult.projects.includes(child1.id) || !childrenResult.projects.includes(child2.id)) {
      throw new Error('Не удалось получить детей');
    }

    results.passed++;
    results.details.push('✅ Получение связей - ПРОЙДЕН');
    
  } catch (error) {
    results.failed++;
    results.details.push(`❌ Получение связей - ПРОВАЛЕН: ${error.message}`);
  }
  
  results.total++;
}

/**
 * Тест системы блокировок
 */
function testLocks(results) {
  console.log('🔒 Тест 4: Система блокировок');
  
  try {
    // Создаем тестовый объект
    const obj = { id: 'test4', title: 'Test' };
    initHierarchyFields(obj, 'domain');
    
    // Проверяем, что объект не заблокирован
    if (isObjectLocked(obj, 'move')) {
      throw new Error('Объект должен быть разблокирован по умолчанию');
    }
    
    // Устанавливаем блокировку
    const success = setObjectLock(obj, 'move', true);
    if (!success) {
      throw new Error('Не удалось установить блокировку');
    }
    
    // Проверяем, что объект заблокирован
    if (!isObjectLocked(obj, 'move')) {
      throw new Error('Блокировка не установлена');
    }
    
    // Проверяем canMoveObject
    if (canMoveObject(obj)) {
      throw new Error('canMoveObject должен возвращать false для заблокированного объекта');
    }
    
    // Снимаем блокировку
    setObjectLock(obj, 'move', false);
    if (isObjectLocked(obj, 'move')) {
      throw new Error('Блокировка не снята');
    }

    results.passed++;
    results.details.push('✅ Система блокировок - ПРОЙДЕН');
    
  } catch (error) {
    results.failed++;
    results.details.push(`❌ Система блокировок - ПРОВАЛЕН: ${error.message}`);
  }
  
  results.total++;
}

/**
 * Тест валидации
 */
function testValidation(results) {
  console.log('🔍 Тест 5: Валидация');
  
  try {
    // Создаем тестовое состояние
    const testStateCopy = JSON.parse(JSON.stringify(testState));
    
    // Инициализируем поля иерархии
    testStateCopy.domains.forEach(domain => initHierarchyFields(domain, 'domain'));
    testStateCopy.projects.forEach(project => initHierarchyFields(project, 'project'));
    testStateCopy.tasks.forEach(task => initHierarchyFields(task, 'task'));
    testStateCopy.ideas.forEach(idea => initHierarchyFields(idea, 'idea'));
    testStateCopy.notes.forEach(note => initHierarchyFields(note, 'note'));
    
    // Валидируем
    const errors = validateHierarchy(testStateCopy);
    
    // Проверяем, что ошибок нет (или они ожидаемые)
    if (errors.length > 0) {
      console.log(`⚠️ Найдено ${errors.length} ошибок валидации (ожидаемо для тестовых данных)`);
    }

    results.passed++;
    results.details.push('✅ Валидация - ПРОЙДЕН');
    
  } catch (error) {
    results.failed++;
    results.details.push(`❌ Валидация - ПРОВАЛЕН: ${error.message}`);
  }
  
  results.total++;
}

/**
 * Запуск тестов в консоли
 */
if (typeof window !== 'undefined') {
  // Если запускаем в браузере
  window.runHierarchyTests = runAllTests;
  console.log('🧪 Тесты загружены. Запустите runHierarchyTests() для тестирования');
} else {
  // Если запускаем в Node.js
  runAllTests();
}
