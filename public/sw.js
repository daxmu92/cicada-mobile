// Minimal service worker for CicadaFinScape PWA.
// Purpose: (1) satisfy the installability requirement (a fetch handler), and
// (2) cache the app shell for offline use. App *data* lives in OPFS/SQLite and
// is never fetched over HTTP, so the SW never touches it.
//
// Caching strategy:
//   - Navigations / HTML  -> network-first (fall back to cache when offline).
//     This guarantees a fresh shell after every redeploy, so the page always
//     references the latest content-hashed JS bundle instead of a stale one.
//   - Other same-origin GETs (hashed JS/CSS, icons) -> stale-while-revalidate.
// Bumping CACHE purges the previous shell on activate.
const CACHE = 'cicada-shell-v2';

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

// Cross-origin and non-GET requests are left untouched (important for
// cross-origin isolation / COEP).
const isNavigation = (req) =>
  req.mode === 'navigate' ||
  (req.headers.get('accept') || '').includes('text/html');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Network-first for the HTML shell so a redeploy is picked up immediately;
  // fall back to the cached shell only when the network is unavailable.
  if (isNavigation(req)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const res = await fetch(req);
          if (res && res.status === 200 && res.type === 'basic') {
            cache.put(req, res.clone());
          }
          return res;
        } catch {
          return cache.match(req);
        }
      })
    );
    return;
  }

  // Stale-while-revalidate for everything else (content-hashed assets): serve
  // from cache instantly when available, refresh the cache in the background.
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
