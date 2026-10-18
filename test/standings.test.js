import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, playerOfTheDay, pairOfTheDay, sessionAwards, computeMonthlyStandings, monthlyAwards } from '../src/shared/standings.js';
import { suggestRound } from '../src/shared/scheduler.js';

const P = (...names) => names.map((name, i) => ({ id: i + 1, name }));
let seq = 0;
const done = (teamA, teamB, a, b) => ({ seq: ++seq, status: 'completed', teamA, teamB, score: { a, b, tb: null }, winner: a > b ? 'A' : 'B' });
const row = (rows, id) => rows.find((r) => r.playerId === id);

test('doubles results count for both partners, with score differential', () => {
  const rows = computeStandings(P('Asha', 'Vikram', 'Meera', 'Arjun'), [done([1, 2], [3, 4], 6, 3)]);
  for (const id of [1, 2]) assert.deepEqual([row(rows, id).wins, row(rows, id).diff], [1, 3]);
  for (const id of [3, 4]) assert.deepEqual([row(rows, id).losses, row(rows, id).diff], [1, -3]);
});

test('standings expose games won for champion and consolation decisions', () => {
  const rows = computeStandings(P('Asha', 'Vikram', 'Meera', 'Arjun'), [
    done([1], [2], 6, 4), done([1], [3], 6, 0), done([2], [4], 6, 1), done([3], [2], 6, 0),
  ]);
  assert.equal(row(rows, 1).gamesWon, 12);
  assert.equal(row(rows, 2).gamesWon, 10);
  const awards = sessionAwards(rows);
  assert.deepEqual(awards.champions.winners.map((x) => x.name), ['Asha']);
  assert.deepEqual(awards.consolation.winners.map((x) => x.name), ['Vikram']);
});

test('monthly recognition requires ten distinct participation days and supports both win measures', () => {
  const players = P('Asha', 'Vikram');
  const sessions = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    format: 'set',
    presentIds: [1, 2],
    matches: [done([1], [2], 6, i === 0 ? 0 : 4)],
  }));
  const rows = computeMonthlyStandings(players, sessions);
  assert.equal(row(rows, 1).participationDays, 10);
  assert.equal(monthlyAwards(rows).games.winners[0].name, 'Asha');
  assert.equal(monthlyAwards(rows).matches.winners[0].name, 'Asha');
  const pending = computeMonthlyStandings(players, sessions.slice(0, 9));
  assert.equal(monthlyAwards(pending).games.status, 'pending');
});

test('incomplete, live and scheduled matches are not wins or losses', () => {
  const matches = [
    { seq: 1, status: 'incomplete', teamA: [1], teamB: [2], score: { a: 4, b: 1 }, winner: null },
    { seq: 2, status: 'live', teamA: [1], teamB: [2], score: null, winner: null },
    { seq: 3, status: 'scheduled', teamA: [1], teamB: [2], score: null, winner: null },
  ];
  const rows = computeStandings(P('Asha', 'Vikram'), matches);
  assert.ok(rows.every((r) => r.played === 0));
  assert.equal(playerOfTheDay(rows).status, 'pending');
});

test('Player of the Day is pending until someone completes two matches', () => {
  const rows = computeStandings(P('Asha', 'Vikram'), [done([1], [2], 6, 0)]);
  assert.equal(playerOfTheDay(rows).status, 'pending');
  const rows2 = computeStandings(P('Asha', 'Vikram'), [done([1], [2], 6, 0), done([2], [1], 6, 4)]);
  assert.equal(playerOfTheDay(rows2).status, 'awarded');
});

test('ranking: win % first, then total wins, then average differential', () => {
  const players = P('Asha', 'Vikram', 'Meera', 'Arjun', 'Priya', 'Rohan');
  const matches = [
    // Asha 2–0 (100%), Vikram 3–1 (75%): Asha ranks higher despite fewer wins.
    done([1], [6], 6, 4), done([1], [6], 6, 4),
    done([2], [6], 6, 0), done([2], [6], 6, 0), done([2], [6], 6, 0), done([6], [2], 6, 0),
    // Meera 2–0 with bigger margins than Asha: same %, same wins → differential decides.
    done([3], [5], 6, 0), done([3], [5], 6, 1),
  ];
  const rows = computeStandings(players, matches);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.name), ['Meera', 'Asha', 'Vikram']);
  const potd = playerOfTheDay(rows);
  assert.deepEqual(potd.winners.map((w) => w.name), ['Meera']);
  assert.equal(potd.decidedBy, 'average score differential');
  assert.equal(row(rows, 4).eligible, false); // Arjun never played
});

test('total wins breaks a win % tie', () => {
  // Opponents 3–8 play once each, so only Asha and Vikram are eligible.
  const rows = computeStandings(P('Asha', 'Vikram', 'C', 'D', 'E', 'F', 'G', 'H'), [
    done([1], [3], 6, 0), done([1], [4], 6, 0), done([5], [1], 6, 0), done([6], [1], 6, 0), // Asha 2–2
    done([2], [7], 6, 3), done([8], [2], 6, 3), // Vikram 1–1
  ]);
  assert.equal(playerOfTheDay(rows).winners[0].name, 'Asha');
  assert.equal(playerOfTheDay(rows).decidedBy, 'total wins');
});

test('a full tie shares the title', () => {
  const rows = computeStandings(P('Asha', 'Vikram', 'Meera', 'Arjun'), [done([1, 2], [3, 4], 6, 2), done([1, 2], [3, 4], 6, 4)]);
  const potd = playerOfTheDay(rows);
  assert.equal(potd.shared, true);
  assert.deepEqual(potd.winners.map((w) => w.name).sort(), ['Asha', 'Vikram']);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.rank), [1, 1]);
});

test('Pair of the Day uses completed doubles partnerships and shares exact ties', () => {
  const players = P('Asha', 'Vikram', 'Meera', 'Arjun', 'Priya', 'Rohan');
  const matches = [
    { ...done([1, 2], [3, 4], 6, 2), kind: 'doubles' },
    { ...done([1, 2], [5, 6], 6, 4), kind: 'doubles' },
    { ...done([3, 4], [5, 6], 6, 0), kind: 'doubles', status: 'incomplete' },
    { ...done([3], [4], 6, 0), kind: 'singles' },
  ];
  const pair = pairOfTheDay(players, matches);
  assert.deepEqual(pair.winners[0].names, ['Asha', 'Vikram']);
  assert.equal(pair.winners[0].played, 2);
  assert.equal(pairOfTheDay(players, matches.slice(2)).status, 'pending');
  const tie = pairOfTheDay(players, [{ ...done([1, 2], [3, 4], 6, 4), kind: 'doubles' }, { ...done([5, 6], [3, 4], 6, 4), kind: 'doubles' }]);
  assert.equal(tie.shared, true);
  assert.equal(tie.winners.length, 2);
});

test('standings are repeatable regardless of match order', () => {
  const players = P('Asha', 'Vikram', 'Meera', 'Arjun');
  const matches = [done([1, 2], [3, 4], 6, 3), done([1, 3], [2, 4], 7, 5), done([1, 4], [2, 3], 4, 6), done([1], [2], 6, 1)];
  const a = computeStandings(players, matches);
  const b = computeStandings(players, [...matches].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(computeStandings(players, matches), a);
});

test('suggestions put players with fewer matches on court first and list who sits out', () => {
  const present = P('A', 'B', 'C', 'D', 'E', 'F');
  const matches = [done([1, 2], [3, 4], 6, 2), done([1, 2], [3, 4], 6, 3)];
  const s = suggestRound({ present, matches, courts: 1, mode: 'doubles', seed: 7 });
  const onCourt = [...s.matches[0].teamA, ...s.matches[0].teamB];
  assert.ok(onCourt.includes(5) && onCourt.includes(6), 'E and F (0 played) must play');
  assert.equal(s.sittingOut.length, 2);
});

test('suggestions avoid repeat partners and skip busy players', () => {
  const present = P('A', 'B', 'C', 'D', 'E');
  const matches = [done([1, 2], [3, 4], 6, 2), { seq: 9, status: 'live', court: 1, teamA: [5], teamB: [3], score: null, winner: null }];
  for (let seed = 1; seed < 20; seed += 1) {
    const s = suggestRound({ present, matches, courts: 2, mode: 'auto', seed });
    const all = s.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
    assert.ok(!all.includes(5) && !all.includes(3), 'live players are busy');
    assert.equal(s.matches[0].kind, 'singles');
    assert.equal(s.matches[0].court, 2, 'uses the free court');
  }
  const four = suggestRound({ present: P('A', 'B', 'C', 'D'), matches: [done([1, 2], [3, 4], 6, 2)], courts: 1, mode: 'doubles', seed: 3 });
  const teams = [four.matches[0].teamA, four.matches[0].teamB].map((t) => [...t].sort().join());
  assert.ok(!teams.includes('1,2') && !teams.includes('3,4'), 'new partnerships chosen');
});
