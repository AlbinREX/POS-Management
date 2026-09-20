// FastFood Riza waiter service worker.
//
// Scope is deliberately narrow: it precaches the application shell so the installed
// PWA launches without a network round trip, and it never touches `/api/`. Every
// authenticated response - sessions, orders, menu, tables, payments - is branch scoped
// and must not be stored on a shared device or replayed from cache at order time.
// This is not an offline ordering queue: without the local server the app reports an
// explicit connection failure instead of accepting work it cannot commit.
// The cache name must change whenever the build changes.
//
// Registration happens from the origin root, so this worker controls the whole admin
// application, not only /waiter. Its build assets are served cache-first, which is
// correct only while the cache name is unique per deployment: with a fixed name, a
// browser that visited an earlier build keeps serving that build's JavaScript forever
// and never sees new screens, even after the server has been rebuilt.
//
// The build replaces this placeholder with Next's BUILD_ID, which changes every build.
// The literal is the development fallback, where no build step runs.
const BUILD = 'nXr-4EsvGxKrZaj5uSgEr';
const VERSION = `riza-shell-${BUILD}`;
const SHELL = ['/waiter', '/manifest.webmanifest', '/icons/waiter-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // A missing shell entry must not abort installation of the whole worker.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Authenticated application data is never cached or served from cache.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  // Navigations: serve the network, falling back to the cached shell so a cold
  // launch works, and refresh the stored shell when the network succeeds.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(VERSION).then((cache) => cache.put('/waiter', copy));
          return response;
        })
        .catch(() => caches.match('/waiter').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Build assets are immutable within one deployment, and the cache name carries the
  // build id, so a new deployment can never be served an old asset.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
