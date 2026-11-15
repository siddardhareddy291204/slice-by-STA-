import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const code = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker({ cached, network = async () => ({ ok: true, text: 'new', clone() { return this; } }), clients = [] } = {}) {
  const events = {}, puts = [], removed = [], navigated = [];
  const context = {
    URL, Promise, setTimeout, clearTimeout, Response,
    location: { origin: 'https://slice.test' }, fetch: network,
    caches: {
      keys: async () => ['slice-v16', 'slice-v18', 'other-app-cache'],
      delete: async (key) => { removed.push(key); },
      open: async () => ({ match: async () => cached, put: async (key, response) => puts.push([key, response]) }),
    },
    self: {
      addEventListener: (name, fn) => { events[name] = fn; },
      clients: {
        claim: async () => {},
        matchAll: async () => clients.map((url) => ({ url, navigate: async (target) => navigated.push(target) })),
      },
    },
  };
  vm.runInNewContext(code, context);
  return { events, puts, removed, navigated };
}
function fetchEvent(url, mode = 'cors') {
  const tasks = [];
  return { request: { url, method: 'GET', mode }, waitUntil: (p) => tasks.push(p), respondWith(p) { this.response = p; }, tasks };
}
test('online app files prefer the current version over a stale cached copy', async () => {
  const w = worker({ cached: { text: 'old' } });
  const event = fetchEvent('https://slice.test/app.js');
  w.events.fetch(event);
  assert.equal((await event.response).text, 'new');
  await Promise.all(event.tasks);
  assert.equal(w.puts.length, 1);
});
test('offline and failed responses keep the saved app available', async () => {
  for (const network of [async () => { throw new Error('offline'); }, async () => ({ ok: false, clone() { return this; } })]) {
    const cached = { text: 'saved' };
    const w = worker({ cached, network });
    const event = fetchEvent('https://slice.test/', 'navigate');
    w.events.fetch(event);
    assert.equal(await event.response, cached);
    await Promise.all(event.tasks);
    assert.equal(w.puts.length, 0);
  }
});
test('refresh page bypasses cached index and APIs are never intercepted', async () => {
  const w = worker({ cached: { text: 'old-index' } });
  const refresh = fetchEvent('https://slice.test/update.html', 'navigate');
  w.events.fetch(refresh);
  assert.equal((await refresh.response).text, 'new');
  assert.equal(w.puts.length, 0);
  const api = fetchEvent('https://slice.test/api/players');
  w.events.fetch(api);
  assert.equal(api.response, undefined);
});
test('activation reloads legacy refresh windows and preserves unrelated caches', async () => {
  const w = worker({ clients: ['https://slice.test/update.html', 'https://slice.test/#/day/1'] });
  let completion;
  w.events.activate({ waitUntil: (p) => { completion = p; } });
  await completion;
  assert.deepEqual(w.removed, ['slice-v16']);
  assert.deepEqual(w.navigated, ['https://slice.test/update.html']);
});
