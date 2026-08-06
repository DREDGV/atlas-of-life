const CACHE_NAME = 'atlas-capture-0.9.0-alpha.2';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  '../styles/capture.css',
  '../js/capture/app.js',
  '../js/capture/draft.js',
  '../js/capture/pwa.js',
  '../js/capture/share-target.js',
  '../js/state.js',
  '../js/storage.js',
  '../js/storageAdapter.js',
  '../js/core/commands.js',
  '../js/core/device.js',
  '../js/core/operations.js',
  '../js/features/inbox/model.js',
  '../js/features/inbox/index.js',
  '../js/version.js',
  './icons/icon-192.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
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
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith('/capture/') || url.pathname.endsWith('/capture/index.html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (url.pathname.startsWith('/js/capture/') || 
      url.pathname.startsWith('/styles/') ||
      url.pathname.startsWith('/capture/icons/')) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
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
