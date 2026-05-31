// Minimal service worker for CicadaFinScape PWA.
// Purpose: (1) satisfy the installability requirement (a fetch handler), and
// (2) cache the app shell for offline use. App *data* lives in OPFS/SQLite and
// is never fetched over HTTP, so the SW never touches it.
const CACHE = 'cicada-shell-v1';

self.addEventListener('install', () => {
  // Activate this SW immediately on first load instead of waiting for a reload.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GETs: serve from cache instantly when
// available, refresh the cache in the background. Cross-origin and non-GET
// requests are left untouched (important for cross-origin isolation / COEP).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
