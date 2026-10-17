// Match suggestions for the next round.
// 1. Players already in a scheduled or live match are busy.
// 2. Of the rest, those with the fewest matches (then the longest rest) go on court.
// 3. Groups and partnerships are chosen to avoid repeat partners and opponents.

const PARTNER_REPEAT_COST = 10;
const OPPONENT_REPEAT_COST = 3;
const SEARCH_ITERATIONS = 400;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pairKey = (x, y) => (x < y ? `${x}:${y}` : `${y}:${x}`);

export function matchHistory(matches) {
  const played = new Map();
  const lastSeq = new Map();
  const partners = new Map();
  const opponents = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const m of matches) {
    for (const id of [...m.teamA, ...m.teamB]) {
      bump(played, id);
      lastSeq.set(id, Math.max(lastSeq.get(id) ?? -1, m.seq ?? 0));
    }
    for (const team of [m.teamA, m.teamB]) if (team.length === 2) bump(partners, pairKey(team[0], team[1]));
    for (const a of m.teamA) for (const b of m.teamB) bump(opponents, pairKey(a, b));
  }
  return { played, lastSeq, partners, opponents };
}

// How many singles/doubles to put on the given number of courts.
export function planCourts(available, courts, mode) {
  const kinds = [];
  let left = available;
  for (let c = 0; c < courts; c += 1) {
    if (mode !== 'singles' && left >= 4) {
      kinds.push('doubles');
      left -= 4;
    } else if (mode !== 'doubles' && left >= 2) {
      kinds.push('singles');
      left -= 2;
    }
  }
  return kinds;
}

function teamCost(teamA, teamB, h) {
  let cost = 0;
  for (const team of [teamA, teamB]) {
    if (team.length === 2) cost += PARTNER_REPEAT_COST * (h.partners.get(pairKey(team[0], team[1])) ?? 0);
  }
  for (const a of teamA) for (const b of teamB) cost += OPPONENT_REPEAT_COST * (h.opponents.get(pairKey(a, b)) ?? 0);
  return cost;
}

function bestSplit(group, h) {
  if (group.length === 2) return { teamA: [group[0]], teamB: [group[1]], cost: teamCost([group[0]], [group[1]], h) };
  const [p, q, r, s] = group;
  const options = [
    [[p, q], [r, s]],
    [[p, r], [q, s]],
    [[p, s], [q, r]],
  ];
  return options
    .map(([teamA, teamB]) => ({ teamA, teamB, cost: teamCost(teamA, teamB, h) }))
    .reduce((best, o) => (o.cost < best.cost ? o : best));
}

export function describeMatch(teamA, teamB, h) {
  const notes = [];
  for (const team of [teamA, teamB]) {
    if (team.length !== 2) continue;
    const n = h.partners.get(pairKey(team[0], team[1])) ?? 0;
    if (n) notes.push({ type: 'partner', ids: team, count: n });
  }
  for (const a of teamA) {
    for (const b of teamB) {
      const n = h.opponents.get(pairKey(a, b)) ?? 0;
      if (n) notes.push({ type: 'opponent', ids: [a, b], count: n });
    }
  }
  return notes;
}

// present: [{ id, name }], matches: every match of the day (any status).
export function suggestRound({ present, matches, courts, mode = 'auto', seed = 1 }) {
  const rand = mulberry32(seed);
  const active = matches.filter((m) => m.status === 'scheduled' || m.status === 'live');
  const busy = new Set(active.flatMap((m) => [...m.teamA, ...m.teamB]));
  const h = matchHistory(matches);

  const available = shuffle(present.filter((p) => !busy.has(p.id)), rand).sort(
    (x, y) => (h.played.get(x.id) ?? 0) - (h.played.get(y.id) ?? 0) || (h.lastSeq.get(x.id) ?? -1) - (h.lastSeq.get(y.id) ?? -1),
  );

  const kinds = planCourts(available.length, courts, mode);
  const needed = kinds.reduce((n, k) => n + (k === 'doubles' ? 4 : 2), 0);
  const chosen = available.slice(0, needed).map((p) => p.id);
  const sittingOut = available.slice(needed).map((p) => p.id);

  let best = null;
  for (let i = 0; i < (kinds.length ? SEARCH_ITERATIONS : 0); i += 1) {
    const order = shuffle(chosen, rand);
    let at = 0;
    let cost = 0;
    const round = kinds.map((kind) => {
      const size = kind === 'doubles' ? 4 : 2;
      const split = bestSplit(order.slice(at, at + size), h);
      at += size;
      cost += split.cost;
      return { kind, teamA: split.teamA, teamB: split.teamB };
    });
    if (!best || cost < best.cost) best = { cost, round };
    if (cost === 0) break;
  }

  // Free courts first; if every court is taken the round queues behind them.
  const occupied = new Set(active.map((m) => m.court));
  const all = Array.from({ length: courts }, (_, i) => i + 1);
  const courtOrder = [...all.filter((c) => !occupied.has(c)), ...all.filter((c) => occupied.has(c))];

  return {
    matches: (best?.round ?? []).map((m, i) => ({
      ...m,
      court: courtOrder[i % courtOrder.length],
      notes: describeMatch(m.teamA, m.teamB, h),
    })),
    sittingOut,
    busy: [...busy],
    played: Object.fromEntries(present.map((p) => [p.id, h.played.get(p.id) ?? 0])),
    repeatCost: best?.cost ?? 0,
  };
}
