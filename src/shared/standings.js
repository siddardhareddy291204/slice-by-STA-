// Session standings, awards and monthly recognition. Pure functions over saved
// match results, so the same matches always produce the same table.

export const MIN_MATCHES = 2;
export const MIN_PARTICIPATION_DAYS = 10;

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
export function computeStandings(players, matches, { format = 'set' } = {}) {
  const rows = new Map();
  const ensure = (id, name) => {
    if (!rows.has(id)) rows.set(id, {
      playerId: id, name: name ?? 'Unknown player', played: 0, wins: 0, losses: 0,
      gamesWon: 0, gamesLost: 0, diff: 0,
    });
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
        if (format === 'set' && m.score && Number.isFinite(Number(m.score.a)) && Number.isFinite(Number(m.score.b))) {
          const own = side === 'A' ? Number(m.score.a) : Number(m.score.b);
          const other = side === 'A' ? Number(m.score.b) : Number(m.score.a);
          r.gamesWon += own;
          r.gamesLost += other;
        }
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

// Session awards requested by the club: champions are the best match winners
// after two completed matches; consolation follows games won, skipping anyone
// already crowned champion. Exact ties share an award.
export function sessionAwards(standings) {
  const eligible = standings.filter((r) => r.eligible);
  const championRows = [...eligible].sort((a, b) => b.wins - a.wins || b.gamesWon - a.gamesWon || a.name.localeCompare(b.name));
  const championTop = championRows[0];
  const champions = championTop ? championRows.filter((r) => r.wins === championTop.wins) : [];
  const championIds = new Set(champions.map((r) => r.playerId));
  if (!standings.some((r) => r.gamesWon > 0)) {
    return {
      champions: { status: champions.length ? 'awarded' : 'pending', winners: champions, shared: champions.length > 1 },
      consolation: { status: 'pending', winners: [], shared: false },
      rule: `Champions: most match wins after ${MIN_MATCHES} completed matches. Consolation: most games won among different eligible players; ties share.`
    };
  }
  const consolationRows = [...eligible]
    .sort((a, b) => b.gamesWon - a.gamesWon || b.wins - a.wins || a.name.localeCompare(b.name));
  const consolationTop = consolationRows.find((r) => !championIds.has(r.playerId));
  const consolation = consolationTop
    ? consolationRows.filter((r) => r.gamesWon === consolationTop.gamesWon && r.wins === consolationTop.wins && !championIds.has(r.playerId))
    : [];
  return {
    champions: { status: champions.length ? 'awarded' : 'pending', winners: champions, shared: champions.length > 1 },
    consolation: { status: consolation.length ? 'awarded' : 'pending', winners: consolation, shared: consolation.length > 1 },
    rule: `Champions: most match wins after ${MIN_MATCHES} completed matches. Consolation: most games won among different eligible players; ties share.`
  };
}

// sessions: [{ date, format, presentIds, matches }]. Participation counts
// distinct tennis dates, while wins/games come only from completed matches.
export function computeMonthlyStandings(players, sessions) {
  const rows = new Map();
  const ensure = (id, name) => {
    if (!rows.has(id)) rows.set(id, {
      playerId: id, name: name ?? 'Unknown player', participationDays: 0,
      matchesPlayed: 0, matchWins: 0, matchLosses: 0, gamesWon: 0, gamesLost: 0,
    });
    return rows.get(id);
  };
  for (const p of players) ensure(p.id, p.name);
  for (const session of sessions) {
    const day = session.date ?? (typeof session.day === 'object' ? session.day.date : session.day);
    const ids = session.presentIds ?? session.playerIds ?? [];
    for (const id of ids) ensure(Number(id))._days ??= new Set();
    for (const id of ids) ensure(Number(id))._days.add(day);
    for (const m of session.matches ?? []) {
      if (m.status !== 'completed' || !m.score || !['A', 'B'].includes(m.winner)) continue;
      for (const [team, side] of [[m.teamA, 'A'], [m.teamB, 'B']]) {
        for (const id of team) {
          const r = ensure(Number(id));
          r.matchesPlayed++;
          if (m.winner === side) r.matchWins++;
          else r.matchLosses++;
          if ((session.format ?? 'set') === 'set') {
            r.gamesWon += side === 'A' ? Number(m.score.a) : Number(m.score.b);
            r.gamesLost += side === 'A' ? Number(m.score.b) : Number(m.score.a);
          }
        }
      }
    }
  }
  const list = [...rows.values()].map(({ _days, ...r }) => ({
    ...r,
    participationDays: _days?.size ?? 0,
    eligible: (_days?.size ?? 0) >= MIN_PARTICIPATION_DAYS,
  }));
  list.sort((a, b) => b.participationDays - a.participationDays || b.gamesWon - a.gamesWon || b.matchWins - a.matchWins || a.name.localeCompare(b.name));
  return list;
}

export function monthlyAward(standings, metric = 'games') {
  const eligible = standings.filter((r) => r.eligible);
  if (!eligible.length) return { status: 'pending', winners: [], shared: false, metric, rule: `Minimum ${MIN_PARTICIPATION_DAYS} distinct tennis days.` };
  const value = (r) => metric === 'matches' ? r.matchWins : r.gamesWon;
  const other = (r) => metric === 'matches' ? r.gamesWon : r.matchWins;
  const sorted = [...eligible].sort((a, b) => value(b) - value(a) || other(b) - other(a) || b.participationDays - a.participationDays || a.name.localeCompare(b.name));
  const top = sorted[0];
  const winners = sorted.filter((r) => value(r) === value(top) && other(r) === other(top) && r.participationDays === top.participationDays);
  return {
    status: 'awarded', winners, shared: winners.length > 1, metric,
    decidedBy: winners.length > 1 ? 'tied on every tiebreaker' : metric === 'matches' ? 'matches won' : 'games won',
    rule: `Eligible after ${MIN_PARTICIPATION_DAYS} distinct tennis days. Ranked by ${metric === 'matches' ? 'matches won' : 'games won'}, then the other win total.`
  };
}

export function monthlyAwards(standings) {
  return { games: monthlyAward(standings, 'games'), matches: monthlyAward(standings, 'matches') };
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

// A partnership qualifies after one completed doubles result together.
// Their record follows the same tie breakers as the individual award.
export function pairOfTheDay(players, matches) {
  const names = Object.fromEntries(players.map((p) => [p.id, p.name]));
  const pairs = new Map();
  for (const m of matches) {
    if (m.kind !== 'doubles' || m.status !== 'completed' || !m.score || !['A', 'B'].includes(m.winner)) continue;
    for (const [ids, side, sign] of [[m.teamA, 'A', 1], [m.teamB, 'B', -1]]) {
      if (ids.length !== 2) continue;
      const sorted = [...ids].sort((a, b) => a - b);
      const key = sorted.join(':');
      if (!pairs.has(key)) pairs.set(key, { playerIds: sorted, names: sorted.map((id) => names[id] ?? 'Unknown player'), played: 0, wins: 0, losses: 0, diff: 0 });
      const row = pairs.get(key);
      row.played++;
      if (m.winner === side) row.wins++;
      else row.losses++;
      row.diff += sign * (m.score.a - m.score.b);
    }
  }
  const rows = [...pairs.values()].map((r) => ({ ...r, winPct: r.wins / r.played, avgDiff: r.diff / r.played }));
  rows.sort((a, b) => compareRows(a, b) || a.names.join(' & ').localeCompare(b.names.join(' & ')));
  if (!rows.length) return { status: 'pending', winners: [], shared: false, decidedBy: null };
  const winners = rows.filter((r) => compareRows(r, rows[0]) === 0);
  const runnerUp = rows.find((r) => compareRows(r, rows[0]) !== 0);
  return {
    status: 'awarded', winners, shared: winners.length > 1,
    decidedBy: winners.length > 1 ? 'tied on every tiebreaker' : runnerUp ? CRITERIA.find(([, cmp]) => cmp(rows[0], runnerUp) !== 0)?.[0] ?? null : 'only eligible pair',
  };
}
