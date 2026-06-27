// Service Worker actualizado para Reportes
// Cambia esta versión cada vez que subas cambios importantes.
const CACHE_NAME = 'reportes-v2026-06-27-glosario-edit-02';
const APP_SHELL = [
  './',
  './reports.html',
  './manifest-reports.json',
  './icon-192.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL).catch(() => null))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
      await self.clients.claim();
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsList) {
        client.postMessage({ type: 'VOL_APP_UPDATED', url: client.url });
      }
    })()
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isHtml = request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');

  if (isHtml) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./reports.html')))
    );
    return;
  }

  if (isSameOrigin) {
    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
