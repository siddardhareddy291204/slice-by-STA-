// Tennis scoring rules. Shared by the server (source of truth) and the browser
// (instant feedback). A live match is stored as a point log: a string of "A"/"B",
// one character per point won. Everything else is derived by replaying it.

export const FORMATS = {
  set: {
    id: 'set',
    name: 'Standard set',
    short: 'One set',
    rule: 'One set: first to 6 games, win by 2. At 6–6 a 7-point tiebreak (win by 2) decides it. Deuce and advantage apply.',
    unit: 'games',
  },
  mtb: {
    id: 'mtb',
    name: '10-point match tiebreak',
    short: 'Match tiebreak',
    rule: 'First to 10 points, win by 2.',
    unit: 'points',
  },
};

const sideIndex = (side) => {
  if (side === 'A') return 0;
  if (side === 'B') return 1;
  throw new Error(`Unknown side: ${side}`);
};

export function newState(format) {
  if (!FORMATS[format]) throw new Error(`Unknown format: ${format}`);
  // pts = points in the current game, the tiebreak, or the match tiebreak.
  return { format, games: [0, 0], pts: [0, 0], tiebreak: format === 'mtb', tbFinal: null, winner: null, played: 0 };
}

export function applyPoint(state, side) {
  if (state.winner) throw new Error('The match is already over.');
  const i = sideIndex(side);
  const j = 1 - i;
  const s = { ...state, games: [...state.games], pts: [...state.pts], played: state.played + 1 };
  s.pts[i] += 1;

  if (s.format === 'mtb') {
    if (s.pts[i] >= 10 && s.pts[i] - s.pts[j] >= 2) s.winner = side;
    return s;
  }

  if (s.tiebreak) {
    if (s.pts[i] >= 7 && s.pts[i] - s.pts[j] >= 2) {
      s.tbFinal = [...s.pts];
      s.games[i] += 1;
      s.pts = [0, 0];
      s.winner = side;
    }
    return s;
  }

  // Regular game: first to 4 points, win by 2 (deuce/advantage).
  if (s.pts[i] >= 4 && s.pts[i] - s.pts[j] >= 2) {
    s.games[i] += 1;
    s.pts = [0, 0];
    if (s.games[i] >= 6 && s.games[i] - s.games[j] >= 2) s.winner = side;
    else if (s.games[0] === 6 && s.games[1] === 6) s.tiebreak = true;
  }
  return s;
}

export function replay(format, log = '') {
  let s = newState(format);
  for (const ch of log) s = applyPoint(s, ch);
  return s;
}

// What to show in the big "point" column.
export function pointDisplay(s) {
  if (s.winner) return { a: '', b: '', label: 'Final' };
  if (s.format === 'mtb') return { a: String(s.pts[0]), b: String(s.pts[1]), label: 'Match tiebreak' };
  if (s.tiebreak) return { a: String(s.pts[0]), b: String(s.pts[1]), label: 'Tiebreak' };
  const [a, b] = s.pts;
  if (a >= 3 && b >= 3) {
    if (a === b) return { a: '40', b: '40', label: 'Deuce' };
    return a > b ? { a: 'AD', b: '40', label: 'Advantage' } : { a: '40', b: 'AD', label: 'Advantage' };
  }
  const calls = ['0', '15', '30', '40'];
  return { a: calls[a], b: calls[b], label: `Game ${s.games[0] + s.games[1] + 1}` };
}

// For each side: would winning the next point win the match ('match') or a game ('game')?
export function pointSituation(s) {
  const out = { A: null, B: null };
  if (s.winner) return out;
  for (const side of ['A', 'B']) {
    const next = applyPoint(s, side);
    if (next.winner) out[side] = 'match';
    else if (s.format === 'set' && !s.tiebreak && next.games[sideIndex(side)] > s.games[sideIndex(side)]) out[side] = 'game';
  }
  return out;
}

// Final (or partial) score object stored on a match: { a, b, tb }.
// a/b are games for a standard set, points for a match tiebreak.
export function scoreFromState(s) {
  if (s.format === 'mtb') return { a: s.pts[0], b: s.pts[1], tb: null };
  return { a: s.games[0], b: s.games[1], tb: s.tbFinal ? [...s.tbFinal] : null };
}

const isWhole = (n) => Number.isInteger(n) && n >= 0;

// Validates a completed score entered by hand. Returns { ok, winner, score } or { ok: false, error }.
export function validateResult(format, input) {
  if (!FORMATS[format]) return { ok: false, error: 'Unknown scoring format.' };
  const a = Number(input?.a);
  const b = Number(input?.b);
  if (!isWhole(a) || !isWhole(b)) return { ok: false, error: 'Scores must be whole numbers.' };
  if (a === b) return { ok: false, error: 'A finished match needs a winner. The scores can’t be level.' };
  const winner = a > b ? 'A' : 'B';
  const w = Math.max(a, b);
  const l = Math.min(a, b);

  if (format === 'mtb') {
    if (input?.tb) return { ok: false, error: 'A match tiebreak has no separate tiebreak score.' };
    if (w < 10) return { ok: false, error: 'A match tiebreak is first to 10 points.' };
    if (l <= 8 && w !== 10) return { ok: false, error: `${w}–${l} isn’t possible. It ends at 10 unless it passes 9–9.` };
    if (l >= 9 && w !== l + 2) return { ok: false, error: `Past 9–9 the winner must lead by exactly 2 (e.g. ${l + 2}–${l}).` };
    return { ok: true, winner, score: { a, b, tb: null } };
  }

  const tbGiven = Array.isArray(input?.tb) && input.tb.some((v) => v !== null && v !== '' && v !== undefined);
  const setOk = (w === 6 && l <= 4) || (w === 7 && (l === 5 || l === 6));
  if (!setOk) return { ok: false, error: 'A standard set ends 6–0 to 6–4, 7–5, or 7–6 (tiebreak).' };
  if (!(w === 7 && l === 6)) {
    if (tbGiven) return { ok: false, error: 'Tiebreak points only apply to a 7–6 set.' };
    return { ok: true, winner, score: { a, b, tb: null } };
  }
  if (!tbGiven) return { ok: true, winner, score: { a, b, tb: null } };
  const ta = Number(input.tb[0]);
  const tb = Number(input.tb[1]);
  if (!isWhole(ta) || !isWhole(tb)) return { ok: false, error: 'Tiebreak points must be whole numbers.' };
  const tbWinner = ta > tb ? 'A' : tb > ta ? 'B' : null;
  if (tbWinner !== winner) return { ok: false, error: 'The set winner must also win the tiebreak.' };
  const tw = Math.max(ta, tb);
  const tl = Math.min(ta, tb);
  if (tw < 7) return { ok: false, error: 'A set tiebreak is first to 7 points.' };
  if (tl <= 5 && tw !== 7) return { ok: false, error: `${tw}–${tl} isn’t possible. The tiebreak ends at 7 unless it passes 6–6.` };
  if (tl >= 6 && tw !== tl + 2) return { ok: false, error: `Past 6–6 the tiebreak winner must lead by exactly 2 (e.g. ${tl + 2}–${tl}).` };
  return { ok: true, winner, score: { a, b, tb: [ta, tb] } };
}

// "6–4", "7–6 (7–5)", "10–8". perspective 'B' flips the numbers.
export function formatScore(score, perspective = 'A') {
  if (!score) return '';
  const flip = perspective === 'B';
  const [x, y] = flip ? [score.b, score.a] : [score.a, score.b];
  let text = `${x}–${y}`;
  if (score.tb) {
    const [p, q] = flip ? [score.tb[1], score.tb[0]] : score.tb;
    text += ` (${p}–${q})`;
  }
  return text;
}
