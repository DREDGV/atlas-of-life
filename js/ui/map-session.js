// Session-only map preferences. They are intentionally excluded from storage.
let initialized = false;
const visibleDomainIds = new Set();
const knownDomainIds = new Set();

export function syncVisibleDomains(domains = []){
  const ids = domains.map(domain => domain.id);
  const current = new Set(ids);
  for (const id of [...visibleDomainIds]) {
    if (!current.has(id)) visibleDomainIds.delete(id);
  }
  for (const id of [...knownDomainIds]) {
    if (!current.has(id)) knownDomainIds.delete(id);
  }
  ids.forEach(id => {
    if (!initialized || !knownDomainIds.has(id)) visibleDomainIds.add(id);
    knownDomainIds.add(id);
  });
  // A Core command may remove the only visible domain (for example a
  // cascade delete) while other, previously hidden domains still exist.
  // Keep the session invariant used by the sidebar: a non-empty Atlas always
  // has at least one visible domain.
  if (ids.length && visibleDomainIds.size === 0) {
    visibleDomainIds.add(ids[0]);
  }
  initialized = true;
  return new Set(visibleDomainIds);
}

export function getVisibleDomainIds(domains = []){
  return syncVisibleDomains(domains);
}

export function isDomainVisible(id, domains = []){
  syncVisibleDomains(domains);
  return visibleDomainIds.has(id);
}

export function setDomainVisible(id, visible, domains = []){
  syncVisibleDomains(domains);
  if (visible) {
    visibleDomainIds.add(id);
    return true;
  }
  if (!visibleDomainIds.has(id)) return true;
  if (visibleDomainIds.size <= 1) return false;
  visibleDomainIds.delete(id);
  return true;
}

export function showAllDomains(domains = []){
  domains.forEach(domain => visibleDomainIds.add(domain.id));
  syncVisibleDomains(domains);
}

// ── Lenses and search ────────────────────────────────────────────────
// A lens answers one question about the whole map ("what is due", "what has
// gone quiet"). Like the visible-domain set, it is a way of LOOKING at the map,
// not a change to it: the selection lives for the session, is never persisted
// and never becomes a Core command. Filtering also never moves an object — a
// hidden task would leave a hole where the user remembers an orb, so a
// non-matching task stays drawn but recedes.
export const MAP_LENSES = ['all', 'due', 'focus', 'stale', 'done'];

let currentLens = 'all';
let currentQuery = '';

export function getMapLens(){
  return currentLens;
}

export function setMapLens(lens){
  currentLens = MAP_LENSES.includes(lens) ? lens : 'all';
  return currentLens;
}

export function getMapQuery(){
  return currentQuery;
}

export function setMapQuery(query){
  currentQuery = String(query ?? '').trim();
  return currentQuery;
}

export function isMapFilterActive(){
  return currentLens !== 'all' || currentQuery.length > 0;
}

// The day a lens compares against. Injected instead of read from the clock so a
// filtered view is reproducible in tests.
export function matchesMapLens(task, { today = null, staleDays = 30 } = {}){
  if (!task) return false;
  // "All" means all: a finished task is still part of the map, and the 'done'
  // lens exists precisely to single those out. Treating 'done' as if it belonged
  // to no lens made the "Все" chip quietly hide finished work.
  if (currentLens === 'all') return true;
  if (currentLens === 'done') return task.status === 'done';
  // Every other lens describes work that is still open.
  if (task.status === 'done') return false;
  if (currentLens === 'focus') return task.focus === true;
  if (currentLens === 'due') {
    const planned = task.plannedDay || null;
    const due = task.due?.date ?? null;
    if (!planned && !due) return false;
    if (!today) return true;
    return (planned && planned <= today) || (due && due <= today);
  }
  if (currentLens === 'stale') {
    if (!task.updatedAt) return false;
    const days = (Date.now() - task.updatedAt) / 86400000;
    return days >= staleDays;
  }
  return true;
}

// Free-text match over the fields a person would search by: what the task is
// called, its tags and the project it belongs to.
export function matchesMapQuery(task, projectTitle = ''){
  if (!currentQuery) return true;
  const haystack = `${task.title || ''} ${(task.tags || []).join(' ')} ${projectTitle || ''}`
    .toLocaleLowerCase('ru-RU');
  return currentQuery.toLocaleLowerCase('ru-RU')
    .split(/\s+/)
    .filter(Boolean)
    .every(term => haystack.includes(term));
}

// One place that decides whether a task is part of what the user asked to see.
export function matchesMapView(task, { projectTitle = '', today = null, staleDays = 30 } = {}){
  return matchesMapLens(task, { today, staleDays }) && matchesMapQuery(task, projectTitle);
}

