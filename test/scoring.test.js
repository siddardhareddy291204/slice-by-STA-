import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, pointDisplay, pointSituation, validateResult, scoreFromState, formatScore } from '../src/shared/scoring.js';

const game = (side) => side.repeat(4);

test('a love game is four straight points', () => {
  const s = replay('set', 'AAAA');
  assert.deepEqual(s.games, [1, 0]);
  assert.deepEqual(s.pts, [0, 0]);
});

test('deuce and advantage: a game needs a two-point lead', () => {
  let s = replay('set', 'AAABBB');
  assert.equal(pointDisplay(s).label, 'Deuce');
  s = replay('set', 'AAABBBA');
  assert.deepEqual(pointDisplay(s), { a: 'AD', b: '40', label: 'Advantage' });
  s = replay('set', 'AAABBBAB'); // back to deuce
  assert.equal(pointDisplay(s).label, 'Deuce');
  assert.deepEqual(s.games, [0, 0]);
  s = replay('set', 'AAABBBABBB'); // advantage B, then B wins
  assert.deepEqual(s.games, [0, 1]);
});

test('set is first to six by two: 6–5 continues, 7–5 wins', () => {
  const to55 = (game('A') + game('B')).repeat(5);
  let s = replay('set', to55 + game('A'));
  assert.deepEqual(s.games, [6, 5]);
  assert.equal(s.winner, null);
  assert.equal(s.tiebreak, false);
  s = replay('set', to55 + game('A') + game('A'));
  assert.equal(s.winner, 'A');
  assert.deepEqual(scoreFromState(s), { a: 7, b: 5, tb: null });
});

test('6–4 ends the set', () => {
  const s = replay('set', (game('A') + game('B')).repeat(4) + game('A') + game('A'));
  assert.equal(s.winner, 'A');
  assert.deepEqual(s.games, [6, 4]);
});

test('7-point tiebreak at 6–6, won by two (extends past 6–6)', () => {
  const to66 = (game('A') + game('B')).repeat(6);
  let s = replay('set', to66);
  assert.equal(s.tiebreak, true);
  assert.equal(pointDisplay(s).label, 'Tiebreak');
  s = replay('set', to66 + 'AB'.repeat(6) + 'A'); // 7–6 in the tiebreak: not over
  assert.equal(s.winner, null);
  s = replay('set', to66 + 'AB'.repeat(6) + 'BB'); // 6–8
  assert.equal(s.winner, 'B');
  assert.deepEqual(scoreFromState(s), { a: 6, b: 7, tb: [6, 8] });
  assert.equal(formatScore(scoreFromState(s), 'B'), '7–6 (8–6)');
});

test('match tiebreak: first to 10, win by 2', () => {
  assert.equal(replay('mtb', 'A'.repeat(10)).winner, 'A');
  const s = replay('mtb', 'AB'.repeat(9) + 'A'); // 10–9
  assert.equal(s.winner, null);
  assert.equal(replay('mtb', 'AB'.repeat(9) + 'BAA').winner, null); // 11–11
  assert.equal(replay('mtb', 'AB'.repeat(10) + 'BB').winner, 'B'); // 10–12
});

test('no points after the match is won', () => {
  assert.throws(() => replay('mtb', 'A'.repeat(11)), /already over/);
});

test('match point is flagged before it is played', () => {
  const s = replay('set', (game('A') + game('B')).repeat(4) + game('A') + 'AAA');
  assert.deepEqual(pointSituation(s), { A: 'match', B: null });
});

test('manual results are validated against the format', () => {
  const ok = (f, score) => validateResult(f, score).ok;
  assert.ok(ok('set', { a: 6, b: 4 }));
  assert.ok(ok('set', { a: 5, b: 7 }));
  assert.ok(ok('set', { a: 7, b: 6, tb: [7, 4] }));
  assert.ok(ok('set', { a: 6, b: 7, tb: [10, 12] }));
  assert.ok(ok('set', { a: 7, b: 6 })); // tiebreak points optional
  assert.equal(ok('set', { a: 6, b: 5 }), false);
  assert.equal(ok('set', { a: 7, b: 4 }), false);
  assert.equal(ok('set', { a: 8, b: 6 }), false);
  assert.equal(ok('set', { a: 6, b: 6 }), false);
  assert.equal(ok('set', { a: 6, b: 2, tb: [7, 5] }), false);
  assert.equal(ok('set', { a: 7, b: 6, tb: [7, 6] }), false); // tiebreak needs 2-point lead
  assert.equal(ok('set', { a: 7, b: 6, tb: [5, 7] }), false); // set winner must win the tiebreak
  assert.equal(ok('set', { a: 7, b: 6, tb: [9, 5] }), false);
  assert.ok(ok('mtb', { a: 10, b: 8 }));
  assert.ok(ok('mtb', { a: 12, b: 14 }));
  assert.equal(ok('mtb', { a: 10, b: 9 }), false);
  assert.equal(ok('mtb', { a: 11, b: 5 }), false);
  assert.equal(ok('mtb', { a: 13, b: 10 }), false);
  assert.equal(ok('mtb', { a: -1, b: 10 }), false);
  assert.equal(validateResult('set', { a: 4, b: 6 }).winner, 'B');
});
