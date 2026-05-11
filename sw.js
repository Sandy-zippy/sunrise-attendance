/* =========================================================
   Sunrise Drivers Check-In  ·  sw.js
   Network-first for app shell so updates land on every reload.
   Cache is only an offline fallback.
   ========================================================= */

const CACHE_NAME = 'sunrise-ci-v3';
const APP_SHELL = [
  './',
  'index.html',
  'app.js',
  'styles.css',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return;

  const path = url.pathname.split('/').pop() || 'index.html';
  const isShell = APP_SHELL.includes(path) || url.pathname.endsWith('/');
  if (!isShell) return;

  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((c) => c || caches.match('index.html')))
  );
});
