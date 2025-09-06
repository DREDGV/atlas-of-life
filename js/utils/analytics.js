// utils/analytics.js
// Lightweight local analytics: ring buffer in localStorage (max 100 items)
const LOG_KEY = 'atlas-logs';

export function logEvent(name, payload = {}) {
  try {
    const now = Date.now();
    const rec = { name: String(name), payload, time: now };
    const raw = localStorage.getItem(LOG_KEY);
    const arr = Array.isArray(JSON.parse(raw || 'null')) ? JSON.parse(raw) : [];
    arr.push(rec);
    // cap buffer
    while (arr.length > 100) arr.shift();
    localStorage.setItem(LOG_KEY, JSON.stringify(arr));
  } catch (_) {
    // ignore logging errors
  }
}

export function clearLogs(){
  try { localStorage.removeItem(LOG_KEY); } catch(_){}
}

export function getLogs(){
  try { return JSON.parse(localStorage.getItem(LOG_KEY)||'[]') } catch(_) { return [] }
}

