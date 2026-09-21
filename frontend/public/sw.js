// Bump on every visual/asset change so installed PWAs drop stale icons and shell.
const CACHE = 'miaurmario-shell-v2-stinky-pop';
const CORE = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API or Next data — always network for freshness.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/data/')) return;
  // Cache-first for static assets, network-first for HTML/routes.
  const isStatic = url.pathname.startsWith('/_next/static/') || /\.(png|jpg|jpeg|svg|webp|ico|webmanifest|woff2?)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }
  event.respondWith(
    fetch(req).then((res) => res).catch(() => caches.match(req))
  );
});
