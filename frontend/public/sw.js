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

// ---- Web Push -------------------------------------------------------------
// Payload (from the backend): { title, body, url, tag?, icon?, badge? }.
// iOS revokes the subscription if a push doesn't show a notification, so we
// always show one, even for an unreadable payload.
const PUSH_ICON = '/icon-192.png';
const PUSH_BADGE = '/brand/stinky/badge-96.png';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Miaurmario';
  const options = {
    body: data.body || '',
    icon: data.icon || PUSH_ICON,
    badge: data.badge || PUSH_BADGE,
    data: { url: data.url || '/dashboard' },
  };
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/dashboard';
  // Only ever navigate inside our own origin.
  let target = new URL('/dashboard', self.location.origin);
  try {
    const candidate = new URL(raw, self.location.origin);
    if (candidate.origin === self.location.origin) target = candidate;
  } catch (_) { /* keep /dashboard */ }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer a window already on that page, then any app window we can steer.
    const exact = windows.find((c) => c.url === target.href);
    if (exact) return exact.focus();
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        const focused = await client.focus();
        if ('navigate' in focused) return await focused.navigate(target.href);
        return focused;
      } catch (_) { /* try the next one */ }
    }
    return self.clients.openWindow(target.href);
  })());
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
