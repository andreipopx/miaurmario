// Cache is versioned per build: sw-register loads /sw.js?v=<NEXT_PUBLIC_BUILD_ID>,
// so every deploy installs a new worker and drops the previous cache.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `miaurmario-${VERSION}`;
const CORE = ['/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // First install: take over right away. Updates wait until the page asks
  // (SKIP_WAITING from the "Actualizar" toast) so we never swap code mid-use.
  if (!self.registration.active) self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API or Next data — always network for freshness.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/data/')) return;

  // Hashed build output never changes under the same URL: cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  // Other static files keep their name across versions (icons, Stinky clips):
  // stale-while-revalidate so a changed file shows up on the next view.
  if (/\.(png|jpg|jpeg|svg|webp|gif|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          const refresh = fetch(req).then((res) => {
            if (res.ok) cache.put(req, res.clone()).catch(() => {});
            return res;
          });
          if (hit) {
            event.waitUntil(refresh.catch(() => {}));
            return hit;
          }
          return refresh;
        })
      )
    );
    return;
  }

  // HTML/routes: network-first, cache only as offline fallback.
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});
