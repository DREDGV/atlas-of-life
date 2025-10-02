// js/hierarchy/index.js
// Минимальный, но цельный слой иерархии: разрешения, индексы, attach/detach/move, аудит
// Без внешних зависимостей. Все функции чистые относительно переданного state.

// Разрешённые связи (матрица)
export const ALLOWED = {
  domain: new Set(['project', 'idea', 'note', 'checklist']),
  project: new Set(['task', 'idea', 'note', 'checklist']),
  task: new Set(['idea', 'note', 'checklist'])
};

export function isLinkAllowed(parentType, childType) {
  return !!ALLOWED[parentType]?.has(childType);
}

// Быстрый поиск по id среди всех коллекций
export function byId(state, id) {
  if (!id) return null;
  return (
    state.domains.find((x) => x.id === id) ||
    state.projects.find((x) => x.id === id) ||
    state.tasks.find((x) => x.id === id) ||
    state.ideas.find((x) => x.id === id) ||
    state.notes.find((x) => x.id === id) ||
    state.checklists.find?.((x) => x.id === id) ||
    null
  );
}

export function getType(obj) {
  if (!obj) return 'unknown';
  if (obj.id?.startsWith('d')) return 'domain';
  if (obj.id?.startsWith('p')) return 'project';
  if (obj.id?.startsWith('t')) return 'task';
  if (obj.id?.startsWith('i')) return 'idea';
  if (obj.id?.startsWith('n')) return 'note';
  if (obj.id?.startsWith('c')) return 'checklist';
  return 'object';
}

// Индексация связей по parentId (лёгкая)
export function index(state) {
  const byIdMap = new Map();
  const childrenById = new Map();

  const all = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes,
    ...(state.checklists || [])
  ];

  for (const obj of all) {
    byIdMap.set(obj.id, obj);
  }

  for (const obj of all) {
    const pid = obj.parentId || obj.projectId || obj.domainId || null;
    if (!pid) continue;
    if (!childrenById.has(pid)) childrenById.set(pid, []);
    childrenById.get(pid).push(obj.id);
  }

  return { byId: byIdMap, childrenById };
}

export function getAncestors(obj, state) {
  const result = [];
  let cur = obj;
  const guard = new Set();
  while (cur) {
    if (guard.has(cur.id)) break;
    guard.add(cur.id);
    const pid = cur.parentId || cur.projectId || cur.domainId || null;
    const p = byId(state, pid);
    if (!p) break;
    result.push(p);
    cur = p;
  }
  return result;
}

export function wouldCreateCycle(parent, child, state) {
  if (!parent || !child) return false;
  if (parent.id === child.id) return true;
  // поднимаемся от parent вверх; если наткнёмся на child → цикл
  for (let cur = parent; cur; ) {
    if (cur.id === child.id) return true;
    const pid = cur.parentId || cur.projectId || cur.domainId || null;
    cur = byId(state, pid);
  }
  return false;
}

// Инициализация полей на объекте (мягкая)
export function initHierarchyFields(obj, type) {
  if (!obj) return;
  if (!('parentId' in obj)) obj.parentId = obj.parentId ?? (obj.projectId || obj.domainId || null);
  if (!('locks' in obj)) obj.locks = obj.locks || { move: false, hierarchy: false };
}

export function getParentObject(child, state) {
  const pid = child?.parentId ?? child?.projectId ?? child?.domainId ?? null;
  return pid ? byId(state, pid) : null;
}

export function getChildObjects(parent, state) {
  if (!parent) return [];
  const { childrenById } = index(state);
  const ids = childrenById.get(parent.id) || [];
  return ids.map((id) => byId(state, id)).filter(Boolean);
}

// Валидатор целостности (минимальный)
export function validateHierarchy(state) {
  const problems = [];
  const { byId: mapById } = index(state);

  const all = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes,
    ...(state.checklists || [])
  ];

  for (const obj of all) {
    const type = getType(obj);
    const pid = obj.parentId || obj.projectId || obj.domainId || null;
    if (!pid) continue;
    const parent = mapById.get(pid);
    if (!parent) {
      problems.push({ code: 'missing_parent', id: obj.id, type, parentId: pid });
      continue;
    }
    const pType = getType(parent);
    if (!isLinkAllowed(pType, type)) {
      problems.push({ code: 'disallowed', id: obj.id, type, parentId: pid, parentType: pType });
    }
    if (wouldCreateCycle(parent, obj, state)) {
      problems.push({ code: 'cycle', id: obj.id, type, parentId: pid });
    }
  }
  return problems;
}

// Примитивные замки
export function isObjectLocked(obj) {
  return !!(obj?.locks?.move || obj?.locks?.hierarchy);
}
export function setObjectLock(obj, kind, value) {
  if (!obj.locks) obj.locks = {};
  obj.locks[kind] = !!value;
}
export function canMoveObject(obj) {
  return !obj?.locks?.move;
}
export function canChangeHierarchy(obj) {
  return !obj?.locks?.hierarchy;
}

// Атомарные операции
export function attach(params, state) {
  const { parentType, parentId, childType, childId } = params;
  const parent = byId(state, parentId);
  const child = byId(state, childId);
  if (!parent || !child) return { ok: false, error: 'not_found' };

  if (!isLinkAllowed(parentType, childType)) {
    return { ok: false, error: 'disallowed' };
  }
  if (wouldCreateCycle(parent, child, state)) {
    return { ok: false, error: 'cycle' };
  }
  if (!canChangeHierarchy(child)) {
    return { ok: false, error: 'locked' };
  }

  // Проставляем поля в зависимости от типов
  if (childType === 'project') {
    child.parentId = parent.id;
    child.domainId = parentType === 'domain' ? parent.id : child.domainId ?? null;
  } else if (childType === 'task') {
    child.parentId = parent.id;
    if (parentType === 'project') {
      child.projectId = parent.id;
      child.domainId = parent.domainId ?? null;
    } else if (parentType === 'domain') {
      // Поддержка legacy-кейса: разрешаем существование, но не поощряем
      child.projectId = null;
      child.domainId = parent.id;
    }
  } else {
    // idea | note | checklist
    child.parentId = parent.id;
    if (parentType === 'task') {
      child.projectId = byId(state, parent.projectId || parent.parentId)?.id || null;
      child.domainId = parent.domainId || byId(state, child.projectId)?.domainId || null;
    } else if (parentType === 'project') {
      child.projectId = parent.id;
      child.domainId = parent.domainId || null;
    } else if (parentType === 'domain') {
      child.projectId = null;
      child.domainId = parent.id;
    }
  }
  child.updatedAt = Date.now();
  return { ok: true, child };
}

export function detach(params, state) {
  const { childType, childId } = params;
  const child = byId(state, childId);
  if (!child) return { ok: false, error: 'not_found' };
  if (!canChangeHierarchy(child)) return { ok: false, error: 'locked' };

  child.parentId = null;
  if (childType === 'project') {
    child.domainId = null;
  } else if (childType === 'task') {
    child.projectId = null;
    child.domainId = null;
  } else {
    // idea | note | checklist
    child.projectId = null;
    child.domainId = null;
  }
  child.updatedAt = Date.now();
  return { ok: true, child };
}

export function move(params, state) {
  const { toParentType, toParentId, childType, childId } = params;
  const child = byId(state, childId);
  const toParent = byId(state, toParentId);
  if (!child || !toParent) return { ok: false, error: 'not_found' };
  const fromParent = getParentObject(child, state);
  if (fromParent?.id === toParent.id) return { ok: true, child };

  // Валидация до изменения
  if (!isLinkAllowed(getType(toParent), childType)) return { ok: false, error: 'disallowed' };
  if (wouldCreateCycle(toParent, child, state)) return { ok: false, error: 'cycle' };
  if (!canChangeHierarchy(child)) return { ok: false, error: 'locked' };

  // Применяем
  const det = detach({ childType, childId }, state);
  if (!det.ok) return det;
  const att = attach({ parentType: getType(toParent), parentId: toParent.id, childType, childId }, state);
  if (!att.ok) return att;
  return { ok: true, child, from: fromParent || null, to: toParent };
}

// Простая проверка возможностей (место для расширения)
export function canMoveTo(parentType, childType) {
  return isLinkAllowed(parentType, childType);
}

// Пустышки для совместимости с текущими импортами (минимум логики)
export { initHierarchyFields };

// Старые названия из state.js (совместимость):
export function setParentChild(parentId, childId, childType, state) {
  const parent = byId(state, parentId);
  const child = byId(state, childId);
  if (!parent || !child) return false;
  const res = attach({ parentType: getType(parent), parentId: parent.id, childType, childId }, state);
  return !!res.ok;
}
export function removeParentChild(parentId, childId, childType, state) {
  const child = byId(state, childId);
  if (!child) return false;
  const res = detach({ childType, childId }, state);
  return !!res.ok;
}

// Утилиты проверки
export { getParentObject };

// Базовые проверки доступа
export { isObjectLocked, setObjectLock, canMoveObject, canChangeHierarchy, validateHierarchy };

// js/hierarchy/index.js
// Главный модуль системы иерархии v2

// Простой реэкспорт всех функций
export * from './core.js';
export * from './validation.js';
export * from './locks.js';
export * from './migration.js';