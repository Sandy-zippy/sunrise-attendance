/* =========================================================
   Sunrise Drivers Check-In  ·  sw.js
   Minimal service worker: cache-first for app shell,
   network-only for everything else (incl. the webhook).
   ========================================================= */

const CACHE_NAME = 'sunrise-ci-v2';
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return;  // network-only for cross-origin (fonts, webhook, maps)

  const path = url.pathname.split('/').pop() || 'index.html';
  const isShell = APP_SHELL.includes(path) || url.pathname.endsWith('/');

  if (!isShell) return;  // network-only for non-shell same-origin requests

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Best-effort: refresh cache with successful responses.
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('index.html'));
    })
  );
});
