// Slice by STA service worker: makes the app installable and keeps it opening on a
// patchy courtside connection. API calls always go to the network.
const VERSION = 'slice-v13';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/shared/scoring.js', '/shared/standings.js', '/shared/scheduler.js', '/shared/names.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Photos rarely change: cache first.
  if (url.pathname.startsWith('/img/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }

  // App shell: answer from the cache at once and refresh it in the background
  // (stale-while-revalidate), so opening Slice never waits on the network.
  const key = e.request.mode === 'navigate' ? '/index.html' : e.request;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(key);
    const update = fetch(e.request).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    if (hit) {
      e.waitUntil(update.catch(() => {}));
      return hit;
    }
    return update.catch(() => Response.error());
  }));
});
