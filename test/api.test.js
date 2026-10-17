import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('organizer flow end to end, and the player link is read-only', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slice-'));
  const { handler, store } = await createApp({ dbFile: path.join(dir, 'test.db'), rootDir });
  const server = http.createServer(handler).listen(0);
  t.after(() => {
    server.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, { auth = true } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Slice': '1', ...(auth && cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };

  assert.equal((await call('GET', '/api/me')).data.setupNeeded, true);
  assert.equal((await call('POST', '/api/setup', { password: 'game-set-match' })).status, 200);
  assert.equal((await call('POST', '/api/setup', { password: 'other-pass' })).status, 409);

  const names = ['Asha Rao', 'Vikram Iyer', 'Meera Nair', 'Arjun Reddy'];
  const ids = [];
  for (const n of names) ids.push((await call('POST', '/api/players', { name: n })).data.id);
  const dup = await call('POST', '/api/players', { name: '  asha   RAO ' });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /already on the list/);

  const day = (await call('POST', '/api/days', { date: '2026-10-17', format: 'set', courts: 2, playerIds: ids })).data;
  const [m] = (await call('POST', `/api/days/${day.id}/matches`, { matches: [{ court: 1, kind: 'doubles', teamA: [ids[0], ids[1]], teamB: [ids[2], ids[3]] }] })).data;

  // Play 6–0 point by point, with a stale-device conflict check and an undo.
  let at = 0;
  for (let i = 0; i < 23; i += 1) assert.equal((await call('POST', `/api/matches/${m.id}/point`, { side: 'A', at: at++ })).status, 200);
  assert.equal((await call('POST', `/api/matches/${m.id}/point`, { side: 'A', at: 3 })).status, 409);
  await call('POST', `/api/matches/${m.id}/undo`, { at: at-- });
  await call('POST', `/api/matches/${m.id}/point`, { side: 'A', at: at++ });
  const last = await call('POST', `/api/matches/${m.id}/point`, { side: 'A', at: at++ });
  assert.equal(last.data.status, 'completed');
  assert.deepEqual(last.data.score, { a: 6, b: 0, tb: null });

  let view = (await call('GET', `/api/days/${day.id}`)).data;
  assert.deepEqual(view.standings.filter((r) => r.wins === 1).map((r) => r.playerId).sort(), [ids[0], ids[1]].sort());
  assert.equal(view.potd.status, 'pending');

  // The day's scorer is recorded, shown, and stamped on later result changes.
  await call('PATCH', `/api/days/${day.id}`, { scorer: 'Coach Sridhar' });
  view = (await call('GET', `/api/days/${day.id}`)).data;
  assert.equal(view.day.scorer, 'Coach Sridhar');

  // Invalid manual score rejected; correction accepted and logged.
  assert.equal((await call('POST', `/api/matches/${m.id}/result`, { score: { a: 6, b: 5 } })).status, 400);
  await call('POST', `/api/matches/${m.id}/result`, { score: { a: 4, b: 6 }, note: 'Wrong team credited' });
  view = (await call('GET', `/api/days/${day.id}`)).data;
  assert.equal(view.standings.find((r) => r.playerId === ids[2]).wins, 1);
  assert.equal(view.activity[0].action, 'corrected');
  assert.match(view.activity[0].summary, /6–0 → 4–6/);
  assert.equal(view.activity[0].by, 'Coach Sridhar');

  // A saved player who wasn't ticked as here can still be put in a match, and joins the session.
  const late = (await call('POST', '/api/players', { name: 'Rohan Das' })).data;
  const made = await call('POST', `/api/days/${day.id}/matches`, { matches: [{ court: 1, kind: 'singles', teamA: [ids[0]], teamB: [late.id] }] });
  assert.equal(made.status, 200);
  view = (await call('GET', `/api/days/${day.id}`)).data;
  assert.ok(view.present.some((p) => p.id === late.id));
  assert.ok(view.roster.some((p) => p.id === late.id));

  // Player link: read-only, no activity, mutations refused without the organizer cookie.
  const pub = await fetch(`${base}/api/public/${day.shareToken}`).then((r) => r.json());
  assert.equal(pub.matches.length, 2);
  assert.equal(pub.roster, undefined);
  assert.equal(pub.activity, undefined);
  assert.equal(pub.day.scorer, 'Coach Sridhar');
  assert.equal((await call('POST', `/api/matches/${m.id}/result`, { score: { a: 6, b: 0 } }, { auth: false })).status, 401);
  assert.equal((await call('GET', '/api/players', null, { auth: false })).status, 401);
});
