/* Volaris Ops PWA - actualización automática para GitHub Pages
   Objetivo: abrir con pocos datos/sin datos y actualizar sola cuando haya internet.
   Ya no necesitas cambiar VERSION desde el iPhone. */

const CACHE_PREFIX = 'volaris-ops';
const APP_CACHE = `${CACHE_PREFIX}-app-auto`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-auto`;

const APP_SHELL = [
  './',
  './VolarisOps.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && ![APP_CACHE, RUNTIME_CACHE].includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

async function notifyClients(message) {
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientsList) client.postMessage(message);
}

async function putIfChanged(cacheName, request, response) {
  if (!response || !response.ok) return response;

  const cache = await caches.open(cacheName);
  const oldResponse = await cache.match(request, { ignoreSearch: true });

  let changed = !oldResponse;
  if (oldResponse) {
    try {
      const oldText = await oldResponse.clone().text();
      const newText = await response.clone().text();
      changed = oldText !== newText;
    } catch (_) {
      changed = true;
    }
  }

  await cache.put(request, response.clone());

  if (changed) {
    await notifyClients({ type: 'VOL_APP_UPDATED', url: request.url });
  }

  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    await putIfChanged(APP_CACHE, request, fresh.clone());
    return fresh;
  } catch (_) {
    return (await cache.match(request, { ignoreSearch: true })) || (await cache.match('./VolarisOps.html'));
  }
}

async function staleWhileRevalidate(request) {
  const appCache = await caches.open(APP_CACHE);
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  const cached = await appCache.match(request, { ignoreSearch: true }) || await runtimeCache.match(request, { ignoreSearch: true });

  const updatePromise = fetch(request, { cache: 'no-store' })
    .then((fresh) => {
      const cacheName = APP_SHELL.some((url) => new URL(url, self.location.href).pathname === new URL(request.url).pathname)
        ? APP_CACHE
        : RUNTIME_CACHE;
      return putIfChanged(cacheName, request, fresh.clone());
    })
    .catch(() => null);

  return cached || updatePromise || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!isSameOrigin(request)) return;

  const url = new URL(request.url);

  if (request.mode === 'navigate' || url.pathname.endsWith('/VolarisOps.html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
