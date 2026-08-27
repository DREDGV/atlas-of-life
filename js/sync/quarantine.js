// js/sync/quarantine.js — durable store for incoming operations that could not
// be applied (conflict / invalid / unsupported).
//
// A quarantined operation is recorded BEFORE the cursor advances, so a restart
// still shows what was refused and why. Cursor is advanced after the durable
// write so a single bad operation never blocks the stream.
//
// C3 adds a resolution layer: every entry carries a `conflictStatus`
// (base_version | deleted_race | unsupported | invalid), a `resolution`
// (pending | resolved), the chosen `resolutionAction` and `resolvedAt`.
// Entries survive reload; the Sync panel lets the user resolve pending ones
// (keep local / accept remote / keep both / keep deleted / dismiss).
const CONFLICTS_KEY = 'atlas-sync-conflicts-v1';
const LIMIT = 200;

function read(){
  try {
    const raw = globalThis.localStorage?.getItem(CONFLICTS_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (_) {}
  return [];
}

function write(list){
  globalThis.localStorage?.setItem(CONFLICTS_KEY, JSON.stringify(list));
}

export function recordConflict({ operation, serverSequence, reason, status, conflictStatus }){
  const list = read();
  list.push({
    operation,
    serverSequence,
    reason: reason || null,
    status: status || 'invalid',
    conflictStatus: conflictStatus || null,
    resolution: 'pending',
    resolutionAction: null,
    resolvedAt: null,
    detectedAt: Date.now(),
  });
  // Only terminal diagnostic records are trimmed, bounded by LIMIT.
  if (list.length > LIMIT) list.splice(0, list.length - LIMIT);
  write(list);
}

export function listConflicts(){
  return read();
}

export function listUnresolvedConflicts(){
  return read().filter(entry => entry.resolution !== 'resolved');
}

// Mark one quarantined operation as resolved (after the user acted on it).
// Returns the updated entry or null when not found.
export function resolveConflictEntry(operationId, action){
  const list = read();
  const entry = list.find(item => item.operation?.id === operationId);
  if (!entry) return null;
  entry.resolution = 'resolved';
  entry.resolutionAction = action || 'dismiss';
  entry.resolvedAt = Date.now();
  write(list);
  return entry;
}

export function clearConflicts(){
  write([]);
}
