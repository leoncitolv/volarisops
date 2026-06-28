/* AppVol PWA compartido final
   Un solo sw.js para toda la carpeta de GitHub Pages.
   Controla: index + VolarisOps + Reports + Paint + NP + Horarios. */
const CACHE_PREFIX = 'volaris-suite';
const APP_CACHE = `${CACHE_PREFIX}-app-v10`; // v10 fuerza limpieza de caché para VolarisOps 5.0
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-v10`; // v10

const APP_SHELL = [
  './',
  './index.html',
  './VolarisOps.html',
  './reports.html',
  './paint.html',
  './np.html',
  './horarios.html',
  './manifest.json',
  './manifest-reports.json',
  './manifest-paint.json',
  './manifest-np.json',
  './manifest-horarios.json',
  './icon-192.png',
  './icon-512.png',
  './icon-paint-192.png',
  './icon-paint-512.png',
  './icon-np-192.png',
  './icon-np-512.png',
  './icon-horarios-192.png',
  './icon-horarios-512.png',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@800;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&display=swap'
];

const APP_HTML = [
  './index.html',
  './VolarisOps.html',
  './reports.html',
  './paint.html',
  './np.html',
  './horarios.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        const req = new Request(url, { cache: 'reload' });
        const res = await fetch(req);
        if (res && res.status < 400) await cache.put(url, res.clone());
      } catch (e) {
        // Si algún archivo todavía no está subido, no se rompe la instalación.
      }
    }));
  })());
  self.skipWaiting();
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

function normalizeAppFile(pathname) {
  const file = pathname.split('/').pop() || 'index.html';
  if (file === '' || file === 'index.html') return './index.html';
  const found = APP_HTML.find((f) => f.endsWith(file));
  return found || './index.html';
}

function isFirebaseRequest(url) {
  return url.hostname.includes('firebaseio.com') ||
         url.hostname.includes('firestore.googleapis.com') ||
         url.hostname.includes('firebasestorage.googleapis.com') ||
         url.hostname.includes('identitytoolkit.googleapis.com') ||
         url.hostname.includes('securetoken.googleapis.com') ||
         url.hostname.includes('googleapis.com') ||
         (url.hostname.includes('gstatic.com') && url.pathname.includes('firebasejs'));
}

function isExternalWrite(request, url) {
  return request.method !== 'GET' || url.hostname.includes('api.cloudinary.com');
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const cache = await caches.open(RUNTIME_CACHE);
  const fresh = await fetch(request);
  if (request.method === 'GET' && fresh && fresh.status < 400) cache.put(request, fresh.clone());
  return fresh;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const fresh = await fetch(request);
    if (request.method === 'GET' && fresh && fresh.status < 400) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function fetchAndUpdate(file, notifyClientId) {
  const cache = await caches.open(APP_CACHE);
  const url = file.startsWith('./') ? file : `./${file}`;
  try {
    const req = new Request(url, { cache: 'no-store' });
    const fresh = await fetch(req);
    if (!fresh || fresh.status >= 400) return false;

    const old = await cache.match(url);
    let changed = false;

    const type = fresh.headers.get('content-type') || '';
    const canCompareText = type.includes('text') ||
                           type.includes('javascript') ||
                           type.includes('json') ||
                           url.endsWith('.html') ||
                           url.endsWith('.js') ||
                           url.endsWith('.css') ||
                           url.endsWith('.json') ||
                           url.endsWith('.webmanifest');

    if (old && canCompareText) {
      const oldText = await old.clone().text();
      const freshText = await fresh.clone().text();
      changed = oldText !== freshText;
    }

    await cache.put(url, fresh.clone());

    if (changed && notifyClientId) {
      const client = await self.clients.get(notifyClientId);
      if (client) client.postMessage({ type: 'APP_UPDATED', file: url });
      client.postMessage({ type: 'VOL_APP_UPDATED', file: url });
    }
    return changed;
  } catch (e) {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isExternalWrite(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const appFile = normalizeAppFile(url.pathname);
      const cached = await caches.match(appFile);
      const networkPromise = fetch(request).then(async (response) => {
        if (response && response.status < 400) {
          const cache = await caches.open(APP_CACHE);
          await cache.put(appFile, response.clone());
        }
        return response;
      }).catch(() => null);

      return await networkPromise || cached || caches.match('./index.html');
    })());
    return;
  }

  if (isFirebaseRequest(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CACHE_APP' && data.file) event.waitUntil(fetchAndUpdate(data.file, null));
  if (data.type === 'CHECK_UPDATE') {
    const file = data.file || './index.html';
    event.waitUntil(fetchAndUpdate(file, event.source && event.source.id));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'refresh-apps') {
    event.waitUntil(Promise.all(APP_HTML.map((file) => fetchAndUpdate(file, null))));
  }
});
