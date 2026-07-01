// Hearth PWA service worker
const VERSION = 'hearth-2026-07-01T04:16Z'; // Must match <meta name="version"> in index.html
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './assets/textures/plaster.webp',
  './assets/textures/clay.webp',
  './assets/textures/linen.webp',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/og-image.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/sheets.js',
  './js/home.js',
  './js/trends.js',
  './js/sleep.js',
  './js/growth.js',
  './js/profile.js',
  './js/reminders.js',
  './js/onboarding.js',
  './js/sync.js',
  './js/join.js',
  './js/fx.js',
  './js/log.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
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

  // App navigations: network-first, fall back to cached shell (offline).
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

  // API requests must always hit the network — never serve from cache.
  if (url.pathname.startsWith('/api/')) return;

  // Same-origin assets: cache-first.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => hit))
  );
});
