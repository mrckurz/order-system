// OrderFlow service worker.
// Caches the app shell so the PWA opens instantly and survives brief WiFi
// drops. API calls and Socket.IO are always network-only (never cached) so
// orders are never stale. Paths are relative so the same SW works whether the
// app is served at the domain root (backend) or a subpath (GitHub Pages).
const CACHE = 'orderflow-shell-v11';
const SHELL = [
  './',
  'index.html',
  'waiter.html',
  'config.js',
  'css/styles.css',
  'css/landing.css',
  'js/common.js',
  'js/index.js',
  'js/waiter.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Only handle same-origin GETs. The API / websocket live on another origin
  // in hybrid mode and must never be cached.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/socket.io/')) return;

  // Stale-while-revalidate for the shell.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
