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
