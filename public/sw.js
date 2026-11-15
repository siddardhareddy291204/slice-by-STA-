// Slice by STA service worker: makes the app installable and keeps it opening on a
// patchy courtside connection. API calls always go to the network.
const VERSION = 'slice-v18';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/shared/scoring.js', '/shared/standings.js', '/shared/scheduler.js', '/shared/names.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('slice-v') && k !== VERSION).map((k) => caches.delete(k)))).then(async () => {
    await self.clients.claim();
    // Older workers served cached index.html even for /update.html. Once the
    // new worker takes over, load the actual refresh page for those windows.
    const windows = await self.clients.matchAll({ type: 'window' });
    // Do not await navigation: its fetch needs this activation to finish first.
    windows.filter((client) => new URL(client.url).pathname === '/update.html').forEach((client) => { client.navigate(client.url).catch(() => {}); });
  }));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/update.html') {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  // Photos rarely change: cache first.
  if (url.pathname.startsWith('/img/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }

  // Prefer the current app when online. Fall back to the saved shell after
  // four seconds on a slow connection, or immediately when offline.
  const key = e.request.mode === 'navigate' ? '/index.html' : e.request;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(key);
    const update = fetch(e.request).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    e.waitUntil(update.catch(() => {}));
    if (!hit) return update.catch(() => Response.error());
    let timer;
    try {
      return await Promise.race([
        update.then((res) => res.ok ? res : hit).catch(() => hit),
        new Promise((resolve) => { timer = setTimeout(() => resolve(hit), 4000); }),
      ]);
    } finally { clearTimeout(timer); }
  }));
});
