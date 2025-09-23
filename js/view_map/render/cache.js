// view_map/render/cache.js
// Simple cache scaffold for future use (offscreen canvases, metrics, etc.)

export function createCache() {
  const map = new Map();
  return {
    get(key) { return map.get(key); },
    set(key, val) { map.set(key, val); },
    has(key) { return map.has(key); },
    clear() { map.clear(); }
  };
}


