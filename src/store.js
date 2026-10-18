import crypto from 'node:crypto';
import { openDb } from './db.js';
import { FORMATS, replay, scoreFromState, validateResult, formatScore } from './shared/scoring.js';
import { computeStandings, playerOfTheDay, pairOfTheDay, sessionAwards, computeMonthlyStandings, monthlyAwards } from './shared/standings.js';
import { suggestRound } from './shared/scheduler.js';
import { cleanName, nameKey } from './shared/names.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();
const SESSION_DAYS = 30;
const MAX_COURTS = 12;

function toMatch(r) {
  return {
    id: Number(r.id),
    dayId: Number(r.day_id),
    seq: Number(r.seq),
    court: Number(r.court),
    kind: r.kind,
    teamA: JSON.parse(r.team_a),
    teamB: JSON.parse(r.team_b),
    status: r.status,
    points: r.points ?? '',
    score: r.score ? JSON.parse(r.score) : null,
    winner: r.winner ?? null,
    source: r.source ?? null,
    startedAt: r.started_at ?? null,
    completedAt: r.completed_at ?? null,
    updatedAt: r.updated_at,
  };
}

function toDay(r) {
  return {
    id: Number(r.id),
    date: r.date,
    title: r.title,
    format: r.format,
    courts: Number(r.courts),
    shareToken: r.share_token,
    scorer: r.scorer ?? null,
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    finishedAt: r.finished_at ?? null,
    createdAt: r.created_at,
  };
}

function groupBy(rows, key, map) {
  const out = new Map();
  for (const r of rows) {
    const k = Number(r[key]);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(map(r));
  }
  return out;
}

export class Store {
  static async open(opts) {
    const store = new Store();
    store.db = await openDb(opts);
    return store;
  }

  close() {
    return this.db.close();
  }

  all(sql, ...params) { return this.db.all(sql, ...params); }
  get(sql, ...params) { return this.db.get(sql, ...params); }
  run(sql, ...params) { return this.db.run(sql, ...params); }

  // Runs fn with a store bound to the transaction, so every query inside it
  // goes through the same connection.
  tx(fn) {
    return this.db.tx((db) => fn(Object.create(this, { db: { value: db } })));
  }

  // ---------- Organizer auth ----------

  async hasPassword() {
    if (this.passwordKnown) return true;
    this.passwordKnown = !!(await this.get(`SELECT 1 AS x FROM settings WHERE key = 'password'`));
    return this.passwordKnown;
  }

  // Password set? Session valid? One round trip for both.
  async authState(token) {
    const row = await this.get(
      `SELECT (SELECT 1 FROM settings WHERE key = 'password') AS pw,
              (SELECT 1 FROM auth_sessions WHERE token = ? AND expires_at > ?) AS ok`,
      token ?? '', now(),
    );
    if (row?.pw) this.passwordKnown = true;
    return { hasPassword: !!row?.pw, organizer: !!row?.ok };
  }

  async setPassword(password) {
    if (typeof password !== 'string' || password.length < 6) throw new HttpError(400, 'Use at least 6 characters.');
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 32);
    this.passwordKnown = true;
    await this.run(
      `INSERT INTO settings (key, value) VALUES ('password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      `${salt.toString('hex')}:${hash.toString('hex')}`,
    );
  }

  async checkPassword(password) {
    const row = await this.get(`SELECT value FROM settings WHERE key = 'password'`);
    if (!row || typeof password !== 'string') return false;
    const [saltHex, hashHex] = row.value.split(':');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(expected, actual);
  }

  async createSession() {
    const token = crypto.randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    await this.run('INSERT INTO auth_sessions (token, created_at, expires_at) VALUES (?, ?, ?)', token, now(), expires);
    return token;
  }

  async isValidSession(token) {
    if (!token) return false;
    return !!(await this.get('SELECT 1 AS x FROM auth_sessions WHERE token = ? AND expires_at > ?', token, now()));
  }

  async deleteSession(token) {
    await this.run('DELETE FROM auth_sessions WHERE token = ?', token);
  }

  async deleteOtherSessions(keepToken) {
    await this.run('DELETE FROM auth_sessions WHERE token != ?', keepToken ?? '');
  }

  // ---------- Players ----------

  async listPlayers() {
    const rows = await this.all('SELECT id, name, archived FROM players ORDER BY archived, name COLLATE NOCASE');
    return rows.map((r) => ({ id: Number(r.id), name: r.name, archived: !!Number(r.archived) }));
  }

  async playerNames() {
    const rows = await this.all('SELECT id, name FROM players');
    return Object.fromEntries(rows.map((r) => [Number(r.id), r.name]));
  }

  async checkName(raw, exceptId = null) {
    const name = cleanName(raw);
    if (!name) throw new HttpError(400, 'Enter a name.');
    if (name.length > 40) throw new HttpError(400, 'Keep names under 40 characters.');
    const key = nameKey(name);
    const clash = await this.get('SELECT id, name, archived FROM players WHERE name_key = ?', key);
    if (clash && Number(clash.id) !== exceptId) {
      if (Number(clash.archived)) throw new HttpError(409, `“${clash.name}” is archived. Restore them from Players instead.`);
      throw new HttpError(409, `“${clash.name}” is already on the list. Someone else? Add an initial, like “${clash.name} K.”`);
    }
    return { name, key };
  }

  async addPlayer(rawName) {
    const { name, key } = await this.checkName(rawName);
    const r = await this.run('INSERT INTO players (name, name_key, created_at) VALUES (?, ?, ?)', name, key, now());
    return { id: r.lastInsertRowid, name, archived: false };
  }

  async updatePlayer(id, { name, archived }) {
    if (!(await this.get('SELECT id FROM players WHERE id = ?', id))) throw new HttpError(404, 'Player not found.');
    if (name !== undefined) {
      const checked = await this.checkName(name, id);
      await this.run('UPDATE players SET name = ?, name_key = ? WHERE id = ?', checked.name, checked.key, id);
    }
    if (archived !== undefined) await this.run('UPDATE players SET archived = ? WHERE id = ?', archived ? 1 : 0, id);
    const p = await this.get('SELECT id, name, archived FROM players WHERE id = ?', id);
    return { id: Number(p.id), name: p.name, archived: !!Number(p.archived) };
  }

  // ---------- Days ----------

  async dayRow(id) {
    const r = await this.get('SELECT * FROM days WHERE id = ?', id);
    if (!r) throw new HttpError(404, 'That session doesn’t exist.');
    return toDay(r);
  }

  async dayByToken(token) {
    const r = await this.get('SELECT * FROM days WHERE share_token = ?', token);
    if (!r) throw new HttpError(404, 'This link doesn’t match a session. Ask the organizer for a fresh one.');
    return toDay(r);
  }

  async presentIds(dayId) {
    return (await this.all('SELECT player_id FROM day_players WHERE day_id = ?', dayId)).map((r) => Number(r.player_id));
  }

  async matchesFor(dayId) {
    return (await this.all('SELECT * FROM matches WHERE day_id = ? ORDER BY seq', dayId)).map(toMatch);
  }

  checkDayFields({ format, courts, date, title, scorer, startTime, endTime }) {
    if (format !== undefined && !FORMATS[format]) throw new HttpError(400, 'Choose a scoring format.');
    if (courts !== undefined && (!Number.isInteger(courts) || courts < 1 || courts > MAX_COURTS)) {
      throw new HttpError(400, `Courts must be between 1 and ${MAX_COURTS}.`);
    }
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) throw new HttpError(400, 'Pick a valid date.');
    if (title !== undefined && cleanName(title).length > 60) throw new HttpError(400, 'Keep the title under 60 characters.');
    if (scorer !== undefined && scorer !== null && cleanName(scorer).length > 40) throw new HttpError(400, 'Keep the scorer’s name under 40 characters.');
    for (const time of [startTime, endTime]) if (time !== undefined && time !== null && time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Use a valid session time.');
  }

  assertOpen(day) {
    if (day.finishedAt) throw new HttpError(409, 'This session is finished. Reopen it in Setup to change matches.');
  }

  async setPresent(dayId, playerIds) {
    if (!Array.isArray(playerIds)) throw new HttpError(400, 'playerIds must be a list.');
    const ids = [...new Set(playerIds.map(Number))];
    for (const id of ids) {
      if (!(await this.get('SELECT 1 AS x FROM players WHERE id = ?', id))) throw new HttpError(400, 'One of the selected players no longer exists.');
    }
    await this.run('DELETE FROM day_players WHERE day_id = ?', dayId);
    for (const id of ids) await this.run('INSERT INTO day_players (day_id, player_id) VALUES (?, ?)', dayId, id);
  }

  createDay({ date, title, format, courts, playerIds = [], scorer, startTime, endTime }) {
    this.checkDayFields({ date, title, format, courts, scorer, startTime, endTime });
    if (!date) throw new HttpError(400, 'Pick a date.');
    if (startTime && endTime && startTime >= endTime) throw new HttpError(400, 'End time must be after start time.');
    return this.tx(async (s) => {
      const token = crypto.randomBytes(9).toString('base64url');
      const r = await s.run(
        'INSERT INTO days (date, title, format, courts, share_token, scorer, start_time, end_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        date, cleanName(title) || defaultTitle(date), format, courts, token, cleanName(scorer) || null, startTime || null, endTime || null, now(),
      );
      await s.setPresent(r.lastInsertRowid, playerIds);
      return s.dayRow(r.lastInsertRowid);
    });
  }

  async updateDay(id, { date, title, courts, format, playerIds, scorer, startTime, endTime }) {
    const day = await this.dayRow(id);
    this.checkDayFields({ date, title, courts, format, scorer, startTime, endTime });
    const nextStart = startTime === undefined ? day.startTime : startTime;
    const nextEnd = endTime === undefined ? day.endTime : endTime;
    if (nextStart && nextEnd && nextStart >= nextEnd) throw new HttpError(400, 'End time must be after start time.');
    if (day.finishedAt && (courts !== undefined || format !== undefined || playerIds !== undefined)) this.assertOpen(day);
    return this.tx(async (s) => {
      if (date !== undefined) await s.run('UPDATE days SET date = ? WHERE id = ?', date, id);
      if (title !== undefined) await s.run('UPDATE days SET title = ? WHERE id = ?', cleanName(title) || defaultTitle(date ?? day.date), id);
      if (startTime !== undefined) await s.run('UPDATE days SET start_time = ? WHERE id = ?', startTime || null, id);
      if (endTime !== undefined) await s.run('UPDATE days SET end_time = ? WHERE id = ?', endTime || null, id);
      if (courts !== undefined) {
        const tooHigh = await s.get(`SELECT 1 AS x FROM matches WHERE day_id = ? AND court > ? AND status IN ('scheduled', 'live')`, id, courts);
        if (tooHigh) throw new HttpError(409, `A match is waiting or live on a court above ${courts}. Move it first.`);
        await s.run('UPDATE days SET courts = ? WHERE id = ?', courts, id);
      }
      if (format !== undefined && format !== day.format) {
        const started = await s.get(`SELECT 1 AS x FROM matches WHERE day_id = ? AND (status != 'scheduled' OR points != '')`, id);
        if (started) throw new HttpError(409, 'The format is locked once play starts, so results stay comparable.');
        await s.run('UPDATE days SET format = ? WHERE id = ?', format, id);
      }
      if (playerIds !== undefined) await s.setPresent(id, playerIds);
      if (scorer !== undefined) await s.run('UPDATE days SET scorer = ? WHERE id = ?', cleanName(scorer) || null, id);
      return s.dayRow(id);
    });
  }

  finishDay(id, { stopLive = false } = {}) {
    return this.tx(async (s) => {
      const day = await s.dayRow(id);
      if (day.finishedAt) return day;
      const live = (await s.matchesFor(id)).filter((m) => m.status === 'live');
      if (live.length && stopLive !== true) throw new HttpError(409, 'There are live matches. End them as incomplete to finish this session.');
      for (const match of live) await s.markIncomplete(match.id, 'Session ended before this match finished');
      const at = now();
      await s.run('UPDATE days SET finished_at = ? WHERE id = ?', at, id);
      await s.run('INSERT INTO activity (day_id, action, summary, by_name, at) VALUES (?, ?, ?, ?, ?)', id, 'session_finished', 'Session ended', day.scorer, at);
      return s.dayRow(id);
    });
  }

  reopenDay(id) {
    return this.tx(async (s) => {
      const day = await s.dayRow(id);
      if (!day.finishedAt) return day;
      await s.run('UPDATE days SET finished_at = NULL WHERE id = ?', id);
      await s.run('INSERT INTO activity (day_id, action, summary, by_name, at) VALUES (?, ?, ?, ?, ?)', id, 'session_reopened', 'Session reopened', day.scorer, now());
      return s.dayRow(id);
    });
  }

  async deleteDay(id) {
    await this.dayRow(id);
    return this.tx(async (s) => {
      for (const table of ['activity', 'matches', 'day_players']) await s.run(`DELETE FROM ${table} WHERE day_id = ?`, id);
      await s.run('DELETE FROM days WHERE id = ?', id);
      return { deleted: id };
    });
  }

  // Home screen data in one database round trip, grouped in memory.
  async listDays({ month } = {}) {
    if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'Choose a valid month.');
    const start = month ? `${month}-01` : null;
    const next = month ? new Date(`${start}T12:00:00Z`) : null;
    if (next) next.setUTCMonth(next.getUTCMonth() + 1);
    const end = next ? next.toISOString().slice(0, 10) : null;
    const dayFilter = month ? 'WHERE date >= ? AND date < ?' : '';
    const childFilter = month ? 'WHERE day_id IN (SELECT id FROM days WHERE date >= ? AND date < ?)' : '';
    const [dayRows, playerRows, presentRows, matchRows] = await this.db.readMany([
      [`SELECT * FROM days ${dayFilter} ORDER BY date DESC, id DESC`, ...(month ? [start, end] : [])],
      ['SELECT id, name FROM players'],
      [`SELECT day_id, player_id FROM day_players ${childFilter}`, ...(month ? [start, end] : [])],
      [`SELECT * FROM matches ${childFilter} ORDER BY seq`, ...(month ? [start, end] : [])],
    ]);
    const names = Object.fromEntries(playerRows.map((r) => [Number(r.id), r.name]));
    const presentBy = groupBy(presentRows, 'day_id', (r) => Number(r.player_id));
    const matchesBy = groupBy(matchRows, 'day_id', toMatch);
    return dayRows.map(toDay).map((day) => {
      const matches = matchesBy.get(day.id) ?? [];
      const present = presentBy.get(day.id) ?? [];
      const standings = computeStandings(present.map((id) => ({ id, name: names[id] })), matches, { format: day.format });
      for (const r of standings) r.name = names[r.playerId] ?? r.name;
      const potd = playerOfTheDay(standings);
      return {
        ...day,
        playerCount: present.length,
        matchCount: matches.length,
        completedCount: matches.filter((m) => m.status === 'completed').length,
        liveCount: matches.filter((m) => m.status === 'live').length,
        potd: potd.status === 'awarded' ? potd.winners.map((w) => w.name) : [],
        pair: pairOfTheDay(Object.entries(names).map(([id, name]) => ({ id: Number(id), name })), matches).winners.map((w) => w.names.join(' & ')),
      };
    });
  }

  // Everything a screen needs for one day, in one database round trip.
  // Standings are recomputed from saved results every time.
  async dayView(dayOrId, { organizer, byToken = false }) {
    const where = byToken ? 'share_token = ?' : 'id = ?';
    const key = typeof dayOrId === 'object' ? dayOrId.id : dayOrId;
    const dayId = byToken ? `(SELECT id FROM days WHERE share_token = ?)` : '?';
    const queries = [
      [`SELECT * FROM days WHERE ${where}`, key],
      ['SELECT id, name, archived FROM players'],
      [`SELECT player_id FROM day_players WHERE day_id = ${dayId}`, key],
      [`SELECT * FROM matches WHERE day_id = ${dayId} ORDER BY seq`, key],
    ];
    if (organizer) queries.push([`SELECT * FROM activity WHERE day_id = ${dayId} ORDER BY id DESC LIMIT 200`, key]);
    const [dayRows, playerRows, presentRows, matchRows, activityRows = []] = await this.db.readMany(queries);
    if (!dayRows[0]) {
      throw new HttpError(404, byToken ? 'This link doesn’t match a session. Ask for a fresh one in the group chat.' : 'That session doesn’t exist.');
    }
    const day = toDay(dayRows[0]);
    const names = Object.fromEntries(playerRows.map((r) => [Number(r.id), r.name]));
    const presentIds = presentRows.map((r) => Number(r.player_id));
    const matches = matchRows.map(toMatch);
    const people = {};
    for (const id of presentIds) people[id] = names[id];
    for (const m of matches) for (const id of [...m.teamA, ...m.teamB]) people[id] = names[id] ?? 'Unknown player';
    const standings = computeStandings(presentIds.map((id) => ({ id, name: names[id] })), matches, { format: day.format });
    for (const r of standings) r.name = people[r.playerId] ?? r.name;
    const view = {
      day: { ...day, formatInfo: FORMATS[day.format] },
      present: presentIds.map((id) => ({ id, name: names[id] })).sort((a, b) => a.name.localeCompare(b.name)),
      people,
      matches,
      standings,
      potd: playerOfTheDay(standings),
      pair: pairOfTheDay(playerRows.map((r) => ({ id: Number(r.id), name: r.name })), matches),
      awards: sessionAwards(standings),
    };
    if (organizer) {
      // Everyone who could be put in a match: all active players, plus anyone already here.
      view.roster = playerRows
        .filter((r) => !Number(r.archived) || presentIds.includes(Number(r.id)))
        .map((r) => ({ id: Number(r.id), name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      view.activity = activityRows.map((a) => ({
        id: Number(a.id),
        matchId: a.match_id == null ? null : Number(a.match_id),
        matchLabel: a.match_label ?? null,
        action: a.action,
        summary: a.summary,
        before: a.before ? JSON.parse(a.before) : null,
        after: a.after ? JSON.parse(a.after) : null,
        note: a.note ?? null,
        by: a.by_name ?? null,
        at: a.at,
      }));
    } else {
      delete view.day.shareToken;
    }
    return view;
  }

  async monthlyView(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'Choose a valid month.');
    const start = `${month}-01`;
    const next = new Date(`${start}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const end = next.toISOString().slice(0, 10);
    const [dayRows, playerRows, presentRows, matchRows] = await this.db.readMany([
      ['SELECT id, date, format FROM days WHERE date >= ? AND date < ? ORDER BY date, id', start, end],
      ['SELECT id, name FROM players'],
      ['SELECT day_id, player_id FROM day_players WHERE day_id IN (SELECT id FROM days WHERE date >= ? AND date < ?)', start, end],
      ['SELECT * FROM matches WHERE day_id IN (SELECT id FROM days WHERE date >= ? AND date < ?) ORDER BY seq', start, end],
    ]);
    const presentBy = groupBy(presentRows, 'day_id', (r) => Number(r.player_id));
    const matchesBy = groupBy(matchRows, 'day_id', toMatch);
    const sessions = dayRows.map((day) => ({
      date: day.date,
      format: day.format,
      presentIds: presentBy.get(Number(day.id)) ?? [],
      matches: matchesBy.get(Number(day.id)) ?? [],
    }));
    const players = playerRows.map((r) => ({ id: Number(r.id), name: r.name }));
    const standings = computeMonthlyStandings(players, sessions);
    return { month, sessionCount: dayRows.length, standings, awards: monthlyAwards(standings) };
  }

  // ---------- Matches ----------

  async matchRow(id) {
    const r = await this.get('SELECT * FROM matches WHERE id = ?', id);
    if (!r) throw new HttpError(404, 'That match no longer exists.');
    return toMatch(r);
  }

  async checkLineup(day, { court, kind, teamA, teamB }) {
    if (kind !== 'singles' && kind !== 'doubles') throw new HttpError(400, 'Choose singles or doubles.');
    const size = kind === 'doubles' ? 2 : 1;
    if (!Array.isArray(teamA) || !Array.isArray(teamB) || teamA.length !== size || teamB.length !== size) {
      throw new HttpError(400, `${kind === 'doubles' ? 'Doubles needs two' : 'Singles needs one'} player${size > 1 ? 's' : ''} per side.`);
    }
    const ids = [...teamA, ...teamB].map(Number);
    if (ids.some((id) => !Number.isInteger(id))) throw new HttpError(400, 'Fill every player slot.');
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'A player can’t appear twice in the same match.');
    // Any saved player can be picked; anyone not yet ticked as here gets added to the session.
    const known = new Set((await this.all(`SELECT id FROM players WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)).map((r) => Number(r.id)));
    if (ids.some((id) => !known.has(id))) throw new HttpError(400, 'One of these players no longer exists.');
    const present = new Set(await this.presentIds(day.id));
    if (!Number.isInteger(court) || court < 1 || court > day.courts) throw new HttpError(400, `Pick a court from 1 to ${day.courts}.`);
    return { court, kind, teamA: teamA.map(Number), teamB: teamB.map(Number), newcomers: ids.filter((id) => !present.has(id)) };
  }

  async markPresent(dayId, ids) {
    for (const id of new Set(ids)) await this.run('INSERT OR IGNORE INTO day_players (day_id, player_id) VALUES (?, ?)', dayId, id);
  }

  async createMatches(dayId, list) {
    const day = await this.dayRow(dayId);
    this.assertOpen(day);
    if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Add at least one match.');
    const lineups = [];
    for (const m of list) lineups.push(await this.checkLineup(day, m));
    const seen = new Set();
    for (const l of lineups) {
      for (const id of [...l.teamA, ...l.teamB]) {
        if (seen.has(id)) throw new HttpError(400, 'The same player is in two of these new matches.');
        seen.add(id);
      }
    }
    return this.tx(async (s) => {
      s.assertOpen(await s.dayRow(dayId));
      await s.markPresent(dayId, lineups.flatMap((l) => l.newcomers));
      let seq = Number((await s.get('SELECT MAX(seq) AS s FROM matches WHERE day_id = ?', dayId)).s ?? 0) + 1;
      const ts = now();
      const created = [];
      for (const l of lineups) {
        const r = await s.run(
          `INSERT INTO matches (day_id, seq, court, kind, team_a, team_b, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
          dayId, seq++, l.court, l.kind, JSON.stringify(l.teamA), JSON.stringify(l.teamB), ts, ts,
        );
        created.push(await s.matchRow(r.lastInsertRowid));
      }
      return created;
    });
  }

  label(m, names) {
    const team = (ids) => ids.map((id) => names[id] ?? 'Unknown').join(' & ');
    return `Court ${m.court} · ${team(m.teamA)} v ${team(m.teamB)}`;
  }

  resultText(m, names) {
    if (!m.score || !m.winner) return 'no result';
    const team = (ids) => ids.map((id) => names[id] ?? 'Unknown').join(' & ');
    const [w, l] = m.winner === 'A' ? [m.teamA, m.teamB] : [m.teamB, m.teamA];
    return `${team(w)} d. ${team(l)} ${formatScore(m.score, m.winner)}`;
  }

  // Every result change records who was scoring at the time.
  async log(m, names, action, summary, { before = null, after = null, note = null } = {}) {
    const day = await this.dayRow(m.dayId);
    await this.run(
      `INSERT INTO activity (day_id, match_id, match_label, action, summary, before, after, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.dayId, m.id, this.label(m, names), action, summary,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, note ? String(note).slice(0, 200) : null, day.scorer, now(),
    );
  }

  snapshot(m) {
    return { status: m.status, score: m.score, winner: m.winner, teamA: m.teamA, teamB: m.teamB };
  }

  async save(id, fields) {
    const map = { teamA: 'team_a', teamB: 'team_b', startedAt: 'started_at', completedAt: 'completed_at' };
    const cols = Object.keys(fields);
    const sql = cols.map((c) => `${map[c] ?? c} = ?`).join(', ');
    const values = cols.map((c) => {
      const v = fields[c];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    await this.run(`UPDATE matches SET ${sql}, updated_at = ? WHERE id = ?`, ...values, now(), id);
    return this.matchRow(id);
  }

  updateLineup(id, input) {
    return this.tx(async (s) => {
      const m = await s.matchRow(id);
      const day = await s.dayRow(m.dayId);
      s.assertOpen(day);
      const l = await s.checkLineup(day, { court: m.court, kind: m.kind, teamA: m.teamA, teamB: m.teamB, ...input });
      if (l.kind !== m.kind && m.points) throw new HttpError(409, 'Undo the recorded points before switching singles and doubles.');
      await s.markPresent(m.dayId, l.newcomers);
      const updated = await s.save(id, { court: l.court, kind: l.kind, teamA: l.teamA, teamB: l.teamB });
      if (m.status === 'completed') {
        const names = await s.playerNames();
        await s.log(updated, names, 'corrected', `Players corrected: ${s.label(m, names)} → ${s.label(updated, names)}`, {
          before: s.snapshot(m),
          after: s.snapshot(updated),
          note: input.note,
        });
      }
      return updated;
    });
  }

  startMatch(id) {
    return this.tx(async (s) => {
      const m = await s.matchRow(id);
      s.assertOpen(await s.dayRow(m.dayId));
      if (m.status === 'live') return m;
      if (m.status !== 'scheduled') throw new HttpError(409, 'Only a waiting match can be started.');
      return s.save(id, { status: 'live', startedAt: now() });
    });
  }

  addPoint(id, side, at) {
    if (side !== 'A' && side !== 'B') throw new HttpError(400, 'Point must go to side A or B.');
    return this.tx(async (s) => {
      let m = await s.matchRow(id);
      s.assertOpen(await s.dayRow(m.dayId));
      if (m.status === 'scheduled') m = await s.save(id, { status: 'live', startedAt: now() });
      if (m.status !== 'live') throw new HttpError(409, 'This match isn’t live, so points can’t be added.');
      if (m.source === 'manual') throw new HttpError(409, 'This score was entered by hand.');
      if (Number.isInteger(at) && at !== m.points.length) throw new HttpError(409, 'The score changed on another device. Refreshed to the latest.');
      const { format } = await s.dayRow(m.dayId);
      const points = m.points + side;
      const state = replay(format, points);
      if (!state.winner) return s.save(id, { points });
      const done = await s.save(id, { points, status: 'completed', score: scoreFromState(state), winner: state.winner, source: 'live', completedAt: now() });
      const names = await s.playerNames();
      await s.log(done, names, 'completed', `Final: ${s.resultText(done, names)}`, { after: s.snapshot(done) });
      return done;
    });
  }

  undoPoint(id, at) {
    return this.tx(async (s) => {
      const m = await s.matchRow(id);
      s.assertOpen(await s.dayRow(m.dayId));
      if (m.source === 'manual') throw new HttpError(409, 'This score was typed in. Use Correct score instead.');
      if (!m.points) throw new HttpError(409, 'There are no points to undo.');
      if (Number.isInteger(at) && at !== m.points.length) throw new HttpError(409, 'The score changed on another device. Refreshed to the latest.');
      if (m.status !== 'live' && m.status !== 'completed') throw new HttpError(409, 'Resume the match before undoing points.');
      const points = m.points.slice(0, -1);
      if (m.status === 'live') return s.save(id, { points });
      const reopened = await s.save(id, { points, status: 'live', score: null, winner: null, source: null, completedAt: null });
      const names = await s.playerNames();
      await s.log(reopened, names, 'reopened', `Undo reopened the match (was ${s.resultText(m, names)})`, { before: s.snapshot(m), after: s.snapshot(reopened) });
      return reopened;
    });
  }

  setResult(id, input, note) {
    return this.tx(async (s) => {
      const m = await s.matchRow(id);
      const day = await s.dayRow(m.dayId);
      s.assertOpen(day);
      const { format } = day;
      const check = validateResult(format, input);
      if (!check.ok) throw new HttpError(400, check.error);
      const fields = { status: 'completed', score: check.score, winner: check.winner, source: 'manual', completedAt: m.completedAt ?? now() };
      if (!m.startedAt) fields.startedAt = now();
      const updated = await s.save(id, fields);
      const names = await s.playerNames();
      if (m.status === 'completed') {
        if (formatScore(m.score) === formatScore(updated.score)) return updated;
        await s.log(updated, names, 'corrected', `Score corrected ${formatScore(m.score)} → ${formatScore(updated.score)}: ${s.resultText(updated, names)}`, {
          before: s.snapshot(m),
          after: s.snapshot(updated),
          note,
        });
      } else {
        await s.log(updated, names, 'completed', `Result entered: ${s.resultText(updated, names)}`, { before: s.snapshot(m), after: s.snapshot(updated), note });
      }
      return updated;
    });
  }

  markIncomplete(id, note) {
    return this.tx(async (s) => {
      const m = await s.matchRow(id);
      s.assertOpen(await s.dayRow(m.dayId));
      if (m.status === 'incomplete') return m;
      const { format } = await s.dayRow(m.dayId);
      const partial = m.points && m.source !== 'manual' ? scoreFromState(replay(format, m.points)) : m.score;
      const updated = await s.save(id, { status: 'incomplete', score: partial, winner: null });
      const names = await s.playerNames();
      const was = m.status === 'completed' ? ` (was ${s.resultText(m, names)})` : partial ? ` at ${formatScore(partial)}` : '';
      await s.log(updated, names, 'incomplete', `Stopped${was}, not counted`, { before: s.snapshot(m), after: s.snapshot(updated), note });
      return updated;
    });
  }

  reopen(id) {
    return this.tx(async (s) => {
      const m = await s.matchRow(id);
      s.assertOpen(await s.dayRow(m.dayId));
      if (m.status !== 'incomplete') throw new HttpError(409, 'Only a stopped match can be resumed.');
      const fields = m.source === 'manual' ? { status: 'live', score: null, source: null, points: '' } : { status: 'live', score: null };
      const updated = await s.save(id, fields);
      await s.log(updated, await s.playerNames(), 'reopened', 'Resumed after being stopped', { before: s.snapshot(m), after: s.snapshot(updated) });
      return updated;
    });
  }

  deleteMatch(id) {
    return this.tx(async (s) => {
      const m = await s.matchRow(id);
      s.assertOpen(await s.dayRow(m.dayId));
      if (m.status === 'completed' || m.status === 'incomplete' || m.points) {
        const names = await s.playerNames();
        await s.log(m, names, 'deleted', m.status === 'completed' ? `Deleted result: ${s.resultText(m, names)}` : 'Deleted a match that had started', {
          before: s.snapshot(m),
        });
      }
      await s.run('DELETE FROM matches WHERE id = ?', id);
      return { deleted: id };
    });
  }

  async suggest(dayId, { mode = 'auto', seed = 1 } = {}) {
    const day = await this.dayRow(dayId);
    this.assertOpen(day);
    if (!['auto', 'singles', 'doubles'].includes(mode)) throw new HttpError(400, 'Mode must be auto, singles or doubles.');
    const names = await this.playerNames();
    const present = (await this.presentIds(dayId)).map((id) => ({ id, name: names[id] }));
    return suggestRound({ present, matches: await this.matchesFor(dayId), courts: day.courts, mode, seed: Number(seed) || 1 });
  }
}

export function defaultTitle(date) {
  const d = new Date(`${date}T12:00:00`);
  return `${d.toLocaleDateString('en-GB', { weekday: 'long' })} Tennis`;
}
