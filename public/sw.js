// Slice service worker: makes the app installable and keeps it opening on a
// patchy courtside connection. API calls always go to the network.
const VERSION = 'slice-v2';
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

  // Everything else: fresh when online, cached when not. Page routes fall back to the app shell.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error()))));
});
