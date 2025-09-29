// js/inspector/utils.js
// @ts-check
import { normalizeId } from '../utils/normalize.js';
import { findObjectById } from '../state.js';

export function getParentObjectFallback(obj, state) {
  const pid = normalizeId(
    obj.parentId ?? obj.parentID ?? obj.projectId ?? obj.taskId ?? null
  );
  if (!pid) return null;

  // Используем findObjectById для поиска во всех коллекциях
  const parent = findObjectById(pid);
  if (parent) {
    return { ...parent, _type: getObjectType(parent) };
  }

  return null;
}

function getObjectType(obj) {
  if (obj._type) return obj._type;
  if (obj.id?.startsWith('d')) return 'domain';
  if (obj.id?.startsWith('p')) return 'project';
  if (obj.id?.startsWith('t')) return 'task';
  if (obj.id?.startsWith('i')) return 'idea';
  if (obj.id?.startsWith('n')) return 'note';
  if (obj.id?.startsWith('c')) return 'checklist';
  return 'unknown';
}
