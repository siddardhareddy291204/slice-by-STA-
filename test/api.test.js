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

  // History can browse a month without mixing in sessions from other dates.
  const sameDate = (await call('POST', '/api/days', { date: '2026-10-17', format: 'mtb', courts: 1, playerIds: ids })).data;
  const past = (await call('POST', '/api/days', { date: '2026-09-30', format: 'mtb', courts: 1, playerIds: ids })).data;
  const [pastMatch] = (await call('POST', `/api/days/${past.id}/matches`, { matches: [{ court: 1, kind: 'singles', teamA: [ids[0]], teamB: [ids[1]] }] })).data;
  await call('POST', `/api/matches/${pastMatch.id}/result`, { score: { a: 10, b: 8 } });
  const october = (await call('GET', '/api/days?month=2026-10')).data;
  const september = (await call('GET', '/api/days?month=2026-09')).data;
  assert.deepEqual(october.map((d) => d.id).sort(), [day.id, sameDate.id].sort());
  assert.deepEqual(september.map((d) => d.id), [past.id]);
  assert.equal(september[0].completedCount, 1);
  assert.equal((await call('GET', '/api/days?month=2026-13')).status, 400);
  const monthly = await call('GET', '/api/monthly?month=2026-10');
  assert.equal(monthly.status, 200);
  assert.equal(monthly.data.month, '2026-10');
  assert.equal(monthly.data.awards.games.status, 'pending');

  // Period dates include both endpoints and all players; tiebreak points aren't games.
  const period = await call('GET', '/api/statistics?start=2026-09-30&end=2026-10-17');
  assert.equal(period.status, 200);
  assert.equal(period.data.sessionCount, 3);
  assert.equal(period.data.completedMatches, 2);
  assert.equal(period.data.standings.length, 5);
  const asha = period.data.standings.find((r) => r.playerId === ids[0]);
  assert.deepEqual([asha.matchesPlayed, asha.matchWins, asha.matchLosses, asha.gamesWon, asha.gamesLost], [2, 1, 1, 4, 6]);
  assert.equal(period.data.standings.find((r) => r.playerId === late.id).rank, null);
  const singleDate = (await call('GET', '/api/statistics?start=2026-09-30&end=2026-09-30')).data;
  assert.equal(singleDate.completedMatches, 1);
  assert.ok(singleDate.standings.every((r) => r.gamesWon === 0));
  const emptyPeriod = (await call('GET', '/api/statistics?start=2026-11-01&end=2026-11-30')).data;
  assert.equal(emptyPeriod.completedMatches, 0);
  assert.ok(emptyPeriod.standings.every((r) => r.rank === null));
  assert.equal((await call('GET', '/api/statistics?start=2026-02-30&end=2026-10-17')).status, 400);
  assert.equal((await call('GET', '/api/statistics?start=2026-10-17&end=2026-09-30')).status, 400);
  assert.equal((await call('GET', '/api/statistics?start=2026-09-30')).status, 400);
  assert.equal((await call('GET', '/api/statistics?end=2026-10-17')).status, 400);
  const historic = (await call('POST', '/api/days', { date: '2024-01-01', format: 'set', courts: 1, playerIds: ids })).data;
  const [historicMatch] = (await call('POST', `/api/days/${historic.id}/matches`, { matches: [{ court: 1, kind: 'singles', teamA: [ids[0]], teamB: [ids[1]] }] })).data;
  await call('POST', `/api/matches/${historicMatch.id}/result`, { score: { a: 6, b: 2 } });
  const allTime = (await call('GET', '/api/statistics')).data;
  assert.equal(allTime.allTime, true);
  assert.equal(allTime.start, '2024-01-01');
  assert.equal(allTime.end, '2026-10-17');
  assert.equal(allTime.completedMatches, 3);
  assert.equal(allTime.standings.length, 5);
  const lifetimeAsha = allTime.standings.find((r) => r.playerId === ids[0]);
  assert.deepEqual([lifetimeAsha.matchesPlayed, lifetimeAsha.matchWins, lifetimeAsha.matchLosses, lifetimeAsha.gamesWon, lifetimeAsha.gamesLost], [3, 2, 1, 10, 8]);
  assert.equal((await call('GET', '/api/statistics', null, { auth: false })).status, 401);
  assert.equal(allTime.minimumMatches, 15);
  assert.equal(allTime.ranking, 'percentage');
  assert.ok(allTime.standings.every((r) => r.rank === null && !r.eligible));
  assert.equal((await call('GET', '/api/statistics?ranking=wins')).data.ranking, 'wins');
  assert.equal((await call('GET', '/api/statistics?ranking=unknown')).status, 400);

  // Sharing creates a read-only report, not an organizer session or profile edit link.
  assert.equal((await call('POST', '/api/statistics/share', null, { auth: false })).status, 401);
  const reportToken = (await call('POST', '/api/statistics/share')).data.token;
  assert.equal((await call('GET', '/api/reports/invalid', null, { auth: false })).status, 404);
  const shared = await call('GET', `/api/reports/${reportToken}?ranking=wins`, null, { auth: false });
  assert.equal(shared.status, 200);
  assert.equal(shared.data.ranking, 'wins');
  assert.equal(shared.data.completedMatches, allTime.completedMatches);
  assert.ok(shared.data.standings.every((r) => !('profile_token' in r)));
  assert.equal((await call('POST', `/api/reports/${reportToken}`, { name: 'Changed' }, { auth: false })).status, 404);
  const sharedPeriod = (await call('GET', `/api/reports/${reportToken}?start=2026-09-30&end=2026-09-30`, null, { auth: false })).data;
  assert.equal(sharedPeriod.completedMatches, 1);
  for (const url of ['/api/statistics/report.pdf', `/api/reports/${reportToken}/report.pdf?start=2026-09-30&end=2026-09-30`]) {
    const res = await fetch(base + url, { headers: url.startsWith('/api/statistics') ? { Cookie: cookie } : {} });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  }
  assert.equal((await fetch(`${base}/api/statistics/report.pdf`)).status, 401);
  assert.equal((await fetch(`${base}/api/reports/invalid/report.pdf`)).status, 404);

  // Photo links allow only the selected player's photo; organizer-only actions stay protected.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwWQAAAAASUVORK5CYII=';
  assert.equal((await call('POST', `/api/players/${ids[0]}/photo`, { photo: png }, { auth: false })).status, 401);
  assert.equal((await call('POST', `/api/players/${ids[0]}/profile-link`, null, { auth: false })).status, 401);
  const profileToken = (await call('POST', `/api/players/${ids[0]}/profile-link`)).data.token;
  assert.equal((await call('POST', `/api/players/${ids[0]}/profile-link`)).data.token, profileToken);
  assert.equal((await call('GET', '/api/profile/invalid', null, { auth: false })).status, 404);
  assert.equal((await call('POST', `/api/profile/${profileToken}`, { photo: 'data:image/svg+xml;base64,PHN2Zz4=' }, { auth: false })).status, 400);
  assert.equal((await call('POST', `/api/profile/${profileToken}`, { photo: 'data:image/png;base64,aW52YWxpZA==' }, { auth: false })).status, 400);
  const savedPhoto = await call('POST', `/api/profile/${profileToken}`, { photo: png, name: 'Not allowed', id: ids[1] }, { auth: false });
  assert.equal(savedPhoto.status, 200);
  assert.equal(savedPhoto.data.name, names[0]);
  assert.ok(savedPhoto.data.photoUrl);
  assert.equal((await call('GET', `/api/profile/${profileToken}`, null, { auth: false })).data.photoUrl, savedPhoto.data.photoUrl);
  const image = await fetch(base + savedPhoto.data.photoUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const playersWithPhoto = (await call('GET', '/api/players')).data;
  assert.equal(playersWithPhoto.find((p) => p.id === ids[1]).photoUrl, null);
  assert.equal((await call('PATCH', `/api/players/${ids[0]}`, { name: names[0] })).data.photoUrl, savedPhoto.data.photoUrl);
  assert.equal((await call('GET', `/api/reports/${reportToken}`, null, { auth: false })).data.standings.find((r) => r.playerId === ids[0]).photoUrl, savedPhoto.data.photoUrl);
  assert.equal((await call('POST', `/api/profile/${profileToken}`, { photo: null }, { auth: false })).status, 200);
  assert.equal((await fetch(base + savedPhoto.data.photoUrl)).status, 404);
  assert.equal((await call('GET', '/api/statistics?start=2026-09-30&end=2026-10-17', null, { auth: false })).status, 401);

  // Session schedule, finish state and both awards survive a fresh API read.
  assert.equal((await call('PATCH', `/api/days/${day.id}`, { date: '2026-10-18', startTime: '08:30', endTime: '11:30' })).status, 200);
  assert.equal((await call('PATCH', `/api/days/${day.id}`, { startTime: '12:00', endTime: '11:30' })).status, 400);
  assert.equal((await call('PATCH', `/api/days/${day.id}`, { date: '2026-02-30' })).status, 400);
  assert.equal((await call('POST', `/api/days/${day.id}/finish`)).status, 200);
  view = (await call('GET', `/api/days/${day.id}`)).data;
  assert.equal(view.day.date, '2026-10-18');
  assert.equal(view.day.startTime, '08:30');
  assert.equal(view.day.endTime, '11:30');
  assert.ok(view.day.finishedAt);
  assert.deepEqual(view.pair.winners[0].names, ['Meera Nair', 'Arjun Reddy']);
  assert.equal((await call('POST', `/api/days/${day.id}/matches`, { matches: [{ court: 1, kind: 'singles', teamA: [ids[0]], teamB: [ids[1]] }] })).status, 409);
  assert.equal((await call('POST', `/api/matches/${m.id}/result`, { score: { a: 6, b: 0 } })).status, 409);
  assert.equal((await call('POST', `/api/days/${day.id}/reopen`)).status, 200);
  assert.equal((await call('GET', `/api/days/${day.id}`)).data.day.finishedAt, null);
  assert.equal((await call('POST', `/api/matches/${m.id}/result`, { score: { a: 6, b: 0 } })).status, 200);

  const [running] = (await call('POST', `/api/days/${sameDate.id}/matches`, { matches: [{ court: 1, kind: 'singles', teamA: [ids[0]], teamB: [ids[1]] }] })).data;
  await call('POST', `/api/matches/${running.id}/start`);
  assert.equal((await call('POST', `/api/days/${sameDate.id}/finish`)).status, 409);
  assert.equal((await call('POST', `/api/days/${sameDate.id}/finish`, null, { auth: false })).status, 401);
  assert.equal((await call('POST', `/api/days/${sameDate.id}/finish`, { stopLive: true })).status, 400);
  assert.equal((await call('POST', `/api/days/${sameDate.id}/finish`, { stopLive: true, reason: 'Rain stopped play' })).status, 200);
  const ended = (await call('GET', `/api/days/${sameDate.id}`)).data;
  assert.ok(ended.day.finishedAt);
  assert.equal(ended.matches.find((x) => x.id === running.id).status, 'incomplete');
  assert.ok(ended.activity.some((a) => a.action === 'session_finished'));

  const report = await fetch(`${base}/api/days/${day.id}/report.pdf`, { headers: { Cookie: cookie } });
  const bytes = Buffer.from(await report.arrayBuffer());
  assert.equal(report.status, 200);
  assert.equal(report.headers.get('content-type'), 'application/pdf');
  assert.match(report.headers.get('content-disposition'), /slice-by-sta-2026-10-18/);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 10000);
  assert.equal((await fetch(`${base}/api/days/${day.id}/report.pdf`)).status, 401);
  const playerReport = await fetch(`${base}/api/public/${day.shareToken}/report.pdf`);
  assert.equal(playerReport.status, 200);
  assert.equal(playerReport.headers.get('content-type'), 'application/pdf');

  await call('PATCH', `/api/days/${sameDate.id}`, { title: 'Saturday Tennis' });
  assert.equal((await call('GET', `/api/days/${sameDate.id}`)).data.day.title, 'Saturday Tennis');
  assert.equal((await call('DELETE', `/api/days/${past.id}`)).status, 200);
  assert.equal((await call('GET', `/api/days/${past.id}`)).status, 404);
});
