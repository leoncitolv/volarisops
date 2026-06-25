/* Volaris Apps PWA compartido - GitHub Pages
   Este sw.js controla la carpeta completa.
   Sirve para VolarisOps.html y reports.html sin crear conflicto.
   Abre sin datos después de la primera carga y actualiza cuando vuelve internet. */

const CACHE_PREFIX = 'volaris-apps-shared';
const APP_CACHE = `${CACHE_PREFIX}-app-auto`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-auto`;

const APP_SHELL = [
  './',
  './VolarisOps.html',
  './reports.html',
  './manifest.json',
  './manifest-reports.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);

    // Cachea lo que exista; si un archivo todavía no está en GitHub, no rompe la instalación.
    await Promise.allSettled(
      APP_SHELL.map((url) =>
        cache.add(new Request(url, { cache: 'reload' }))
      )
    );

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

function pathnameOf(value) {
  return new URL(value, self.location.href).pathname;
}

function isAppShellPath(pathname) {
  return APP_SHELL.some((url) => pathnameOf(url) === pathname);
}

async function notifyClients(message) {
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientsList) {
    client.postMessage(message);
  }
}

async function putIfChanged(cacheName, request, response) {
  if (!response || !response.ok) return response;

  const cache = await caches.open(cacheName);
  const oldResponse = await cache.match(request, { ignoreSearch: true });

  let changed = !oldResponse;

  if (oldResponse) {
    try {
      const contentType = response.headers.get('content-type') || '';
      if (
        contentType.includes('text') ||
        contentType.includes('javascript') ||
        contentType.includes('json') ||
        contentType.includes('html') ||
        contentType.includes('css')
      ) {
        const oldText = await oldResponse.clone().text();
        const newText = await response.clone().text();
        changed = oldText !== newText;
      } else {
        changed = false;
      }
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

async function networkFirst(request, fallbackHtml) {
  const cache = await caches.open(APP_CACHE);

  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    await putIfChanged(APP_CACHE, request, fresh.clone());
    return fresh;
  } catch (_) {
    return (
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match(fallbackHtml)) ||
      (await cache.match('./VolarisOps.html')) ||
      (await cache.match('./reports.html'))
    );
  }
}

async function staleWhileRevalidate(request) {
  const appCache = await caches.open(APP_CACHE);
  const runtimeCache = await caches.open(RUNTIME_CACHE);

  const cached =
    (await appCache.match(request, { ignoreSearch: true })) ||
    (await runtimeCache.match(request, { ignoreSearch: true }));

  const updatePromise = fetch(request, { cache: 'no-store' })
    .then((fresh) => {
      const cacheName = isAppShellPath(new URL(request.url).pathname) ? APP_CACHE : RUNTIME_CACHE;
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
  const path = url.pathname;

  if (request.mode === 'navigate' || path.endsWith('/VolarisOps.html') || path.endsWith('/reports.html')) {
    const fallback = path.endsWith('/reports.html') ? './reports.html' : './VolarisOps.html';
    event.respondWith(networkFirst(request, fallback));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
