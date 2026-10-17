// Sample data: a squad, a finished match-tiebreak day last week, and today's
// standard-set day in full swing (results, a manual entry, a correction,
// an incomplete match, one live match and one waiting).
// Usage: npm run seed   (wipes data/slice.db first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbFile = process.env.DB_FILE || path.join(root, 'data', 'slice.db');
if (process.argv.includes('--reset') && !process.env.TURSO_DATABASE_URL) for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });

const store = await Store.open({ file: dbFile });
const password = process.env.ORGANIZER_PASSWORD || 'game-set-match';
await store.setPassword(password);

let seed = 20261017;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

// Rough ability so results look like a real group, not coin flips.
const squad = {
  'Asha Rao': 8, 'Vikram Iyer': 7, 'Meera Nair': 6, 'Arjun Reddy': 7, 'Priya Menon': 5, 'Karthik Subramanian': 6,
  'Divya Shetty': 4, 'Rohan Das': 5, 'Neha Kulkarni': 6, 'Sameer Khan': 3, 'Anjali Verma': 5, 'Farhan Ali': 4,
};
const ids = {};
for (const n of Object.keys(squad)) ids[n] = (await store.addPlayer(n)).id;
await store.updatePlayer(ids['Farhan Ali'], { archived: true });
const skillOf = Object.fromEntries(Object.entries(ids).map(([n, id]) => [id, squad[n]]));
const strength = (team) => team.reduce((s, id) => s + skillOf[id], 0) / team.length;

async function play(match, maxPoints = Infinity) {
  const pA = 0.5 + (strength(match.teamA) - strength(match.teamB)) * 0.035;
  let m = await store.startMatch(match.id);
  for (let i = 0; i < maxPoints && m.status === 'live'; i += 1) m = await store.addPoint(m.id, rand() < pA ? 'A' : 'B');
  return m;
}

async function round(dayId, mode = 'auto') {
  const s = await store.suggest(dayId, { mode, seed: Math.floor(rand() * 1e9) });
  return store.createMatches(dayId, s.matches.map(({ court, kind, teamA, teamB }) => ({ court, kind, teamA, teamB })));
}

const isoDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Last week: quick match-tiebreak evening, all done.
const lastWeek = await store.createDay({
  date: isoDay(-7), title: 'Wednesday tiebreak ladder', format: 'mtb', courts: 2, scorer: 'Coach Sridhar',
  playerIds: ['Asha Rao', 'Vikram Iyer', 'Meera Nair', 'Arjun Reddy', 'Rohan Das', 'Neha Kulkarni'].map((n) => ids[n]),
});
for (let r = 0; r < 4; r += 1) for (const m of await round(lastWeek.id, r % 2 ? 'singles' : 'auto')) await play(m);

// Today: standard set, two courts, nine players.
const todayDay = await store.createDay({
  date: isoDay(0), title: 'Saturday morning session', format: 'set', courts: 2, scorer: 'Coach Sridhar',
  playerIds: ['Asha Rao', 'Vikram Iyer', 'Meera Nair', 'Arjun Reddy', 'Priya Menon', 'Karthik Subramanian', 'Divya Shetty', 'Rohan Das', 'Neha Kulkarni'].map((n) => ids[n]),
});
for (let r = 0; r < 3; r += 1) for (const m of await round(todayDay.id)) await play(m);

// A result entered by hand (scorer's phone was flat), then corrected.
// Mid-morning someone else picks up the scoring.
await store.updateDay(todayDay.id, { scorer: 'Farhan Ali' });
const [manual, rained] = await round(todayDay.id, 'auto');
await store.setResult(manual.id, { a: 6, b: 3 });
await store.setResult(manual.id, { a: 6, b: 4 }, 'Recounted games at the net post');
// Rain stopped play on the other court.
if ((await play(rained, 22)).status === 'completed') await store.undoPoint(rained.id);
await store.markIncomplete(rained.id, 'Rain, court too slippery');

// One match live mid-set and one waiting.
const [live, waiting] = await round(todayDay.id, 'auto');
if ((await play(live, 30)).status === 'completed') await store.undoPoint(live.id); // keep it live for the demo
console.log(`Waiting match on court ${waiting?.court ?? '-'}`);

await store.close();
console.log(`Seeded ${process.env.TURSO_DATABASE_URL ? process.env.TURSO_DATABASE_URL.replace(/\?.*/, "") : dbFile}`);
console.log(`Club password: ${password}`);
