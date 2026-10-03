// Cache is versioned per build: sw-register loads /sw.js?v=<NEXT_PUBLIC_BUILD_ID>,
// so every deploy installs a new worker and drops the previous cache.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `miaurmario-${VERSION}`;
const OFFLINE_URL = '/offline.html';
// How long a navigation waits for the network before a saved copy of the screen is used.
const NAVIGATION_TIMEOUT_MS = 3000;
const CORE = ['/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', OFFLINE_URL, '/brand/stinky/head/stinky-head-512.png', '/brand/stinky/head/stinky-head-dark-512.png'];

// Offline wardrobe, for the installed app (home-screen PWA or Android/iOS):
// the page asks with WARM_OFFLINE, and then the screens worth opening without
// internet and every script/stylesheet of the build are kept, so they open
// offline even if they were never visited. Their data comes from the copy
// React Query keeps in IndexedDB (app/providers.tsx). A browser tab never asks,
// so a visitor doesn't download the whole app.
const OFFLINE_ROUTES = ['/dashboard', '/dashboard/wardrobe', '/dashboard/outfits', '/dashboard/history'];
// /_next/static files are content-hashed, so they live in their own cache that
// survives deploys: each new version only downloads what actually changed.
const STATIC_CACHE = 'miaurmario-static';
const PRECACHE_LIST = '/sw-precache.json';

// Garment photos, kept across deploys (they don't change with the build) and
// keyed by path: the ?expires=&sig= on them changes every few hours.
const IMAGE_CACHE = 'miaurmario-images';
const IMAGE_PREFIX = '/api/v1/images/';
const IMAGE_CACHE_MAX = 800;

// Web Share Target: the system share sheet POSTs here (Android/Chromium and an
// installed desktop PWA; iOS has no share target). We stash the payload in its
// own cache — which survives the version sweep in `activate` — and redirect to
// the wardrobe, where the page reads it once and opens the add dialog.
const SHARE_CACHE = 'miaurmario-share';
const SHARE_META_URL = '/__shared__/payload.json';
const SHARE_FILE_URL = '/__shared__/image';
const SHARE_TARGET_PATH = '/share-target';
const SHARE_LANDING = '/dashboard/wardrobe?add=1&shared=1';

async function stashSharedPayload(request) {
  const form = await request.formData();
  const file = form.get('image');
  const meta = {
    title: String(form.get('title') || ''),
    text: String(form.get('text') || ''),
    url: String(form.get('url') || ''),
    hasImage: false,
    at: Date.now(),
  };

  const cache = await caches.open(SHARE_CACHE);
  await cache.delete(SHARE_FILE_URL);
  if (file && typeof file === 'object' && 'size' in file && file.size > 0) {
    meta.hasImage = true;
    meta.name = file.name || 'compartida.jpg';
    meta.type = file.type || 'image/jpeg';
    await cache.put(SHARE_FILE_URL, new Response(file, { headers: { 'Content-Type': meta.type } }));
  }
  await cache.put(
    SHARE_META_URL,
    new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } })
  );
}

self.addEventListener('install', (e) => {
  // First install: take over right away. Updates wait until the page asks
  // (SKIP_WAITING from the "Actualizar" toast) so we never swap code mid-use.
  if (!self.registration.active) self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'WARM_OFFLINE') e.waitUntil(warmOffline());
});

const KEEP_CACHES = [CACHE, SHARE_CACHE, IMAGE_CACHE, STATIC_CACHE];

/** Keep a screen's HTML (by path) for offline opening. */
async function warmRoute(cache, path) {
  const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  const type = res.headers.get('content-type') || '';
  if (res.ok && !res.redirected && type.includes('text/html')) await cache.put(path, res);
}

/** Download this build's scripts/styles not kept yet; drop the ones it no longer uses. */
async function precacheStatic() {
  const res = await fetch(PRECACHE_LIST, { cache: 'no-store' });
  if (!res.ok) return;
  const { files, posters } = await res.json();
  if (Array.isArray(posters)) await precachePosters(posters);
  if (!Array.isArray(files) || files.length === 0) return;
  const cache = await caches.open(STATIC_CACHE);
  const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  const todo = files.filter((f) => !have.has(f));
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(
      todo.slice(i, i + 6).map((f) =>
        fetch(f)
          .then((r) => (r.ok ? cache.put(f, r) : undefined))
          .catch(() => {})
      )
    );
  }
  const keep = new Set(files);
  for (const req of await cache.keys()) {
    if (!keep.has(new URL(req.url).pathname)) await cache.delete(req);
  }
}

/**
 * Stinky's still frames, under the exact URL the page asks for (it adds
 * ?v=<build id>, the same one this worker was registered with).
 */
async function precachePosters(paths) {
  const cache = await caches.open(CACHE);
  const suffix = VERSION === 'dev' ? '' : `?v=${encodeURIComponent(VERSION)}`;
  for (let i = 0; i < paths.length; i += 6) {
    await Promise.all(
      paths.slice(i, i + 6).map(async (p) => {
        const url = p + suffix;
        if (await cache.match(url)) return;
        const r = await fetch(url).catch(() => null);
        if (r && r.ok) await cache.put(url, r);
      })
    );
  }
}

let warming = null;
function warmOffline() {
  warming =
    warming ||
    caches
      .open(CACHE)
      .then((cache) => Promise.all(OFFLINE_ROUTES.map((r) => warmRoute(cache, r).catch(() => {}))))
      .then(() => precacheStatic())
      .catch(() => {})
      .finally(() => {
        warming = null;
      });
  return warming;
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Keep the photo cache bounded: drop the oldest entries past the cap. */
async function trimImages() {
  const cache = await caches.open(IMAGE_CACHE);
  const keys = await cache.keys();
  const extra = keys.length - IMAGE_CACHE_MAX;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

/**
 * Network first, so an edited photo (rotated, background removed) is never
 * shown stale; the cached copy only answers when the network can't.
 */
function imageResponse(event, req, url) {
  const key = url.origin + url.pathname;
  return fetch(req)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        event.waitUntil(
          caches.open(IMAGE_CACHE).then((c) => c.put(key, copy)).then(trimImages).catch(() => {})
        );
      }
      return res;
    })
    .catch(() =>
      caches.open(IMAGE_CACHE).then((c) => c.match(key)).then((hit) => hit || Response.error())
    );
}

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
  const url = new URL(req.url);

  // A share from the system sheet: keep the payload, then hand the user to the
  // add-garment flow. Never save anything on its own.
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith((async () => {
      try {
        await stashSharedPayload(req.clone());
      } catch (_) { /* fall through: the dialog just opens empty */ }
      return Response.redirect(SHARE_LANDING, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(IMAGE_PREFIX)) {
    event.respondWith(imageResponse(event, req, url));
    return;
  }
  // Never cache API or Next data — always network for freshness.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/data/')) return;

  // Hashed build output never changes under the same URL: cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    const key = url.origin + url.pathname;
    event.respondWith(
      caches.match(key).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.put(key, copy)).catch(() => {}));
        }
        return res;
      }))
    );
    return;
  }

  // Other static files keep their name across versions (icons, Stinky clips):
  // stale-while-revalidate so a changed file shows up on the next view. A URL
  // stamped with the build (?v=, all Stinky assets) can't change under it, so
  // a cached copy is simply used, without downloading it again in the background.
  if (/\.(png|jpg|jpeg|svg|webp|gif|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    const versioned = url.searchParams.has('v');
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          if (hit && versioned) return hit;
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

  // Opening a screen: network first. Each one opened is kept (by path) so it
  // opens again offline; one never seen gets the offline page instead. On a weak
  // signal the saved copy wins after NAVIGATION_TIMEOUT_MS (the network answer
  // still refreshes it for next time), so the app never sits on a blank screen.
  if (req.mode === 'navigate') {
    const offlineCopy = async () => {
      const cache = await caches.open(CACHE);
      // The installed app starts at "/" (the landing page): offline, go
      // straight to the saved wardrobe instead.
      if (url.pathname === '/' && (await cache.match('/dashboard'))) {
        return Response.redirect('/dashboard', 302);
      }
      return (await cache.match(url.pathname)) || (await cache.match(OFFLINE_URL)) || Response.error();
    };
    const network = fetch(req).then((res) => {
      const type = res.headers.get('content-type') || '';
      if (res.ok && res.type === 'basic' && type.includes('text/html')) {
        const copy = res.clone();
        event.waitUntil(caches.open(CACHE).then((c) => c.put(url.pathname, copy)).catch(() => {}));
      }
      return res;
    });
    event.waitUntil(network.catch(() => {}));
    event.respondWith(
      new Promise((resolve) => {
        let done = false;
        const settle = (res) => {
          if (done) return;
          done = true;
          resolve(res);
        };
        network.then(settle, () => offlineCopy().then(settle));
        setTimeout(async () => {
          if (done) return;
          const saved = await caches.open(CACHE).then((c) => c.match(url.pathname));
          if (saved) settle(saved);
        }, NAVIGATION_TIMEOUT_MS);
      })
    );
    return;
  }

  // Other same-origin GETs (RSC payloads…): network, with any cached copy as fallback.
  event.respondWith(fetch(req).catch(() => caches.match(req).then((hit) => hit || Response.error())));
});
