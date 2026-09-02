const CACHE_NAME = 'atlas-capture-0.11.0-alpha.5';
// Correction revision: changes the worker bytes without inventing alpha.6,
// so installed alpha.5 PWAs discover the per-record delivery-marker update.
const CACHE_REVISION = 'sync-record-delivery-markers-2';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  '../styles/capture.css',
  '../js/capture/app.js',
  '../js/capture/draft.js',
  '../js/capture/pwa.js',
  '../js/capture/share-target.js',
  '../js/capture/voice.js',
  '../js/state.js',
  '../js/storage.js',
  '../js/storageAdapter.js',
  '../js/utils/analytics.js',
  '../js/core/commands.js',
  '../js/core/device.js',
  '../js/core/operations.js',
  '../js/sync/device.js',
  '../js/sync/outbox.js',
  '../js/sync/apply.js',
  '../js/sync/quarantine.js',
  '../js/sync/engine.js',
  '../js/sync/config.js',
  '../js/sync/http-transport.js',
  '../js/sync/runtime.js',
  '../js/sync/ui.js',
  '../js/sync/capabilities.js',
  '../js/features/inbox/model.js',
  '../js/version.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

let precacheUrls = null;

function getPrecacheUrls() {
  if (!precacheUrls) {
    precacheUrls = new Set(
      PRECACHE_ASSETS.map(
        path => new URL(path, self.registration.scope).href
      )
    );
  }
  return precacheUrls;
}

self.addEventListener('install', (event) => {
  void CACHE_REVISION;
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name.startsWith('atlas-capture-') && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  if (request.method !== 'GET') return;
  
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const scope = self.registration.scope;
    if (url.href.startsWith(scope)) {
      event.respondWith(
        fetch(request)
          .then(response => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
            return response;
          })
          .catch(() => caches.match(new URL('./index.html', scope).href))
      );
    }
    return;
  }

  const allowedUrls = getPrecacheUrls();
  if (allowedUrls.has(url.href)) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
