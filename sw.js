// Hearth PWA service worker
const VERSION = 'hearth-2026-08-17T01:03Z'; // Must match <meta name="version"> in index.html
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './assets/textures/plaster.webp',
  './assets/textures/clay.webp',
  './assets/textures/linen.webp',
  './assets/sky/moon.webp',
  './assets/sky/cloud-tower.webp',
  './assets/sky/cloud-classic.webp',
  './assets/sky/cloud-hazybank.webp',
  './assets/sky/sun-starburst.webp',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/og-image.png',
  './icons/apple-touch-icon.png',
  // Shell JS, only the modules Home actually needs on first paint are
  // precached eagerly. Sleep/Insights and their deps (growth, trends,
  // growth-percentiles, growth-percentiles-data) are lazy `import()`ed
  // from app.js, so they are fetched on demand + prefetched on idle rather
  // than parsed eagerly on Home. Why this still matters after Vite:
  // Rollup absorbs every statically-imported shell module (app.js +
  // store.js + ui.js + ...) into one entry chunk at build time, so all
  // of those source paths below resolve to the same hashed entry URL.
  // Native ESM has no cross-file tree-shaking, dynamic import() is the
  // only way to keep the per-tab code out of the first-paint parse. The
  // SHELL list is the SW's own offline cache; keeping it small keeps
  // that install fast. Files in this section are rewritten to their
  // hashed output paths by scripts/patch-sw.mjs after `vite build` —
  // do not hand-edit the resolved './static/<hash>.js' URLs.
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/sheets.js',
  './js/home.js',
  './js/sky.js',
  './js/prediction-source.js',
  './js/profile.js',
  './js/changelog.js',
  './js/reminders.js',
  './js/onboarding.js',
  './js/sync.js',
  './js/join.js',
  './js/fx.js',
  './js/log.js',
  // Lazy tabs, NOT precached. Fetched via native dynamic import() when
  // the user first visits the tab (and prefetched on idle from app.js).
  // They live in their own hashed chunks under dist/static/ at runtime
  // (./static/sleep-<hash>.js, ./static/insights-<hash>.js,
  // ./static/growth-<hash>.js) — emitted by Vite's dynamic-import code
  // splitting. Kept listed here as documentation of what is intentionally
  // excluded and why; they are runtime dependencies of the app, not
  // shell assets.
  //   './js/sleep.js',
  //   './js/trends.js',
  //   './js/growth.js',
  //   './js/insights.js',
  //   './js/growth-percentiles.js',
  //   './js/growth-percentiles-data.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Developer mode bypasses every cache layer: always go to the network.
  // Activate via `?dev=1` (survives the next reload even before JS runs),
  // or via localStorage `hearth.devMode` checked after the first load.
  // Without this, a hot iteration loop (edit → refresh) would still read
  // stale JS from Cache Storage / HTTP cache. Normal users never send dev=1.
  const isDevBypass = url.searchParams.has('dev') || req.headers.get('X-Hearth-Dev') === '1';
  if (isDevBypass) return;

  // App navigations: network-first, fall back to cached shell (offline).
  // No `immutable` here, these are unhashed filenames (index.html). The
  // update signal is the VERSION string bump + server's Cache-Control:
  // no-store on index.html/sw.js. `immutable` only makes sense for
  // content-hashed filenames (app.a1b2c3.js) whose bytes never change;
  // slapping it on unhashed files would let the browser's HTTP cache pin a
  // stale copy for a year and ignore the VERSION bump.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;

  }

  // Fonts & icons (cross-origin CDN): cache-first, stored in shell cache.
  if (url.origin !== location.origin) {
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          cache.put(req, res.clone());
          return res;
        } catch (err) {
          return hit || Response.error();
        }
      })
    );
    return;
  }

  // API requests must always hit the network, never serve from cache.
  if (url.pathname.startsWith('/api/')) return;

  // Same-origin assets: cache-first.
  // Tabs that were lazy-imported (sleep/insights/growth/...) still get
  // cached after their first fetch via the put() below, offline still
  // works, we just don't precache them on install. Only the SHELL list
  // above is precached eagerly.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => hit))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = {}; }
  const title = data.title || 'Hearth';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { key: data.key || '' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      if ('focus' in client) return client.focus();
    }
    return clients.openWindow('/');
  }));
});
