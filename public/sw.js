// OrderFlow service worker.
// Caches the app shell so the PWA opens instantly and survives brief WiFi
// drops. API calls and Socket.IO are always network-only (never cached) so
// orders are never stale.
const CACHE = 'orderflow-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/waiter.html',
  '/css/styles.css',
  '/js/common.js',
  '/js/waiter.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
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
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Never cache the API or socket traffic.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;

  // Stale-while-revalidate for the shell.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
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
