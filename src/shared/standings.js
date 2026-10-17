// Session standings and Player of the Day. Pure functions over saved match results,
// so the same matches always produce the same table.

export const MIN_MATCHES = 2;

export const POTD_RULE =
  `Eligible after ${MIN_MATCHES} completed matches. Ranked by win %, then total wins, ` +
  'then average score differential per match. A tie on all three shares the title.';

// Negative when x ranks ahead of y. Uses cross-multiplication so ratios compare exactly.
export function compareRows(x, y) {
  const byPct = y.wins * x.played - x.wins * y.played;
  if (byPct !== 0) return byPct;
  if (x.wins !== y.wins) return y.wins - x.wins;
  return y.diff * x.played - x.diff * y.played;
}

// players: [{ id, name }]; matches: saved matches with status, teamA, teamB, score, winner.
// Only completed matches count. Doubles results are credited to both partners.
export function computeStandings(players, matches) {
  const rows = new Map();
  const ensure = (id, name) => {
    if (!rows.has(id)) rows.set(id, { playerId: id, name: name ?? 'Unknown player', played: 0, wins: 0, losses: 0, diff: 0 });
    return rows.get(id);
  };
  for (const p of players) ensure(p.id, p.name);

  for (const m of matches) {
    if (m.status !== 'completed' || !m.score || (m.winner !== 'A' && m.winner !== 'B')) continue;
    const margin = m.score.a - m.score.b;
    for (const [team, side, sign] of [[m.teamA, 'A', 1], [m.teamB, 'B', -1]]) {
      for (const id of team) {
        const r = ensure(id);
        r.played += 1;
        if (m.winner === side) r.wins += 1;
        else r.losses += 1;
        r.diff += sign * margin;
      }
    }
  }

  const list = [...rows.values()].map((r) => ({
    ...r,
    winPct: r.played ? r.wins / r.played : 0,
    avgDiff: r.played ? r.diff / r.played : 0,
    eligible: r.played >= MIN_MATCHES,
  }));

  list.sort((x, y) => {
    if (x.eligible !== y.eligible) return x.eligible ? -1 : 1;
    return compareRows(x, y) || y.played - x.played || x.name.localeCompare(y.name);
  });

  // Competition ranking ("1, 1, 3") among eligible players only.
  for (const r of list) {
    r.rank = r.eligible ? 1 + list.filter((o) => o.eligible && compareRows(o, r) < 0).length : null;
  }
  return list;
}

const CRITERIA = [
  ['win %', (x, y) => y.wins * x.played - x.wins * y.played],
  ['total wins', (x, y) => y.wins - x.wins],
  ['average score differential', (x, y) => y.diff * x.played - x.diff * y.played],
];

// { status: 'pending' } or { status: 'awarded', winners, shared, decidedBy }.
export function playerOfTheDay(standings) {
  const eligible = standings.filter((r) => r.eligible);
  if (!eligible.length) return { status: 'pending', winners: [], shared: false, decidedBy: null };
  const top = eligible[0];
  const winners = eligible.filter((r) => compareRows(r, top) === 0);
  const runnerUp = eligible.find((r) => compareRows(r, top) !== 0);
  let decidedBy = null;
  if (winners.length > 1) decidedBy = 'tied on every tiebreaker';
  else if (!runnerUp) decidedBy = 'only eligible player';
  else decidedBy = CRITERIA.find(([, cmp]) => cmp(top, runnerUp) !== 0)?.[0] ?? null;
  return { status: 'awarded', winners, shared: winners.length > 1, decidedBy };
}
