// js/hierarchy/cache.js
// Система кэширования для иерархических запросов

/**
 * Кэш для иерархических запросов
 */
class HierarchyCache {
  constructor(maxSize = 1000, ttl = 300000) { // 5 минут TTL по умолчанию
    this.cache = new Map();
    this.timestamps = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl; // Time To Live в миллисекундах
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Генерирует ключ кэша для запроса
   */
  generateKey(operation, ...params) {
    return `${operation}:${params.map(p => 
      typeof p === 'object' ? JSON.stringify(p) : String(p)
    ).join(':')}`;
  }

  /**
   * Проверяет, действителен ли кэш
   */
  isValid(key) {
    const timestamp = this.timestamps.get(key);
    if (!timestamp) return false;
    
    return (Date.now() - timestamp) < this.ttl;
  }

  /**
   * Получает значение из кэша
   */
  get(key) {
    if (!this.isValid(key)) {
      this.delete(key);
      this.misses++;
      return null;
    }
    
    this.hits++;
    return this.cache.get(key);
  }

  /**
   * Сохраняет значение в кэш
   */
  set(key, value) {
    // Очищаем старые записи если кэш переполнен
    if (this.cache.size >= this.maxSize) {
      this.cleanup();
    }
    
    this.cache.set(key, value);
    this.timestamps.set(key, Date.now());
  }

  /**
   * Удаляет запись из кэша
   */
  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
  }

  /**
   * Очищает устаревшие записи
   */
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, timestamp] of this.timestamps) {
      if ((now - timestamp) >= this.ttl) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.delete(key));
    
    // Если все еще переполнен, удаляем самые старые записи
    if (this.cache.size >= this.maxSize) {
      const sortedKeys = Array.from(this.timestamps.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, Math.floor(this.maxSize / 2))
        .map(([key]) => key);
      
      sortedKeys.forEach(key => this.delete(key));
    }
  }

  /**
   * Очищает весь кэш
   */
  clear() {
    this.cache.clear();
    this.timestamps.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Получает статистику кэша
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : '0%',
      maxSize: this.maxSize,
      ttl: this.ttl
    };
  }

  /**
   * Инвалидирует кэш для конкретного объекта
   */
  invalidateObject(objectId) {
    const keysToDelete = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(objectId)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.delete(key));
  }

  /**
   * Инвалидирует весь кэш при изменении иерархии
   */
  invalidateHierarchy() {
    this.clear();
  }
}

// Глобальный экземпляр кэша
const hierarchyCache = new HierarchyCache();

/**
 * Функция поиска объекта по ID (нужна для кэширования)
 */
function findObjectById(objectId, state) {
  if (!state || !objectId) return null;
  
  // Ищем во всех типах объектов
  const allObjects = [
    ...(state.domains || []),
    ...(state.projects || []),
    ...(state.tasks || []),
    ...(state.ideas || []),
    ...(state.notes || []),
    ...(state.checklists || [])
  ];
  
  return allObjects.find(obj => obj.id === objectId) || null;
}

/**
 * Кэшированная функция поиска родителя
 */
export function getCachedParent(childId, state) {
  const key = hierarchyCache.generateKey('parent', childId);
  let result = hierarchyCache.get(key);
  
  if (result === null) {
    // Ищем родителя напрямую
    const child = findObjectById(childId, state);
    if (!child || !child.parentId) {
      result = null;
    } else {
      result = findObjectById(child.parentId, state);
    }
    hierarchyCache.set(key, result);
  }
  
  return result;
}

/**
 * Кэшированная функция поиска детей
 */
export function getCachedChildren(parentId, state) {
  const key = hierarchyCache.generateKey('children', parentId);
  let result = hierarchyCache.get(key);
  
  if (result === null) {
    // Ищем детей напрямую
    const parent = findObjectById(parentId, state);
    if (!parent || !parent.children) {
      result = {};
    } else {
      result = parent.children;
    }
    hierarchyCache.set(key, result);
  }
  
  return result;
}

/**
 * Кэшированная функция поиска предков
 */
export function getCachedAncestors(objectId, state) {
  const key = hierarchyCache.generateKey('ancestors', objectId);
  let result = hierarchyCache.get(key);
  
  if (result === null) {
    // Ищем предков напрямую
    const ancestors = [];
    let current = findObjectById(objectId, state);
    
    while (current && current.parentId) {
      const parent = findObjectById(current.parentId, state);
      if (parent) {
        ancestors.push(parent);
        current = parent;
      } else {
        break;
      }
    }
    
    result = ancestors;
    hierarchyCache.set(key, result);
  }
  
  return result;
}

/**
 * Инвалидирует кэш при изменении объекта
 */
export function invalidateObjectCache(objectId) {
  hierarchyCache.invalidateObject(objectId);
}

/**
 * Инвалидирует весь кэш при изменении иерархии
 */
export function invalidateHierarchyCache() {
  hierarchyCache.invalidateHierarchy();
}

/**
 * Получает статистику кэша
 */
export function getCacheStats() {
  return hierarchyCache.getStats();
}

/**
 * Очищает кэш
 */
export function clearCache() {
  hierarchyCache.clear();
}

export { hierarchyCache };
