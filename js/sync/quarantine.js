// js/sync/quarantine.js — durable store for incoming operations that could not
// be applied (conflict / invalid / unsupported).
//
// A quarantined operation is recorded BEFORE the cursor advances, so a restart
// still shows what was refused and why. Cursor is advanced after the durable
// write so a single bad operation never blocks the stream. This is a bounded
// diagnostic log, not a conflict-resolution system (C1+).
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

export function recordConflict({ operation, serverSequence, reason, status }){
  const list = read();
  list.push({
    operation,
    serverSequence,
    reason: reason || null,
    status: status || 'invalid',
    detectedAt: Date.now(),
  });
  // Only terminal diagnostic records are trimmed, bounded by LIMIT.
  if (list.length > LIMIT) list.splice(0, list.length - LIMIT);
  write(list);
}

export function listConflicts(){
  return read();
}

export function clearConflicts(){
  write([]);
}
