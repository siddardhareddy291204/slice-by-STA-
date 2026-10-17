import fs from 'node:fs';
import path from 'node:path';

// One small async interface over two backends:
//  - local SQLite file via Node's built-in node:sqlite (dev, club laptop)
//  - Turso / libSQL over the network (Vercel and other serverless hosts)
// Both speak SQLite, so the schema and queries are identical.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL UNIQUE,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS days (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL,
  format      TEXT NOT NULL CHECK (format IN ('set', 'mtb')),
  courts      INTEGER NOT NULL,
  share_token TEXT NOT NULL UNIQUE,
  scorer      TEXT,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS day_players (
  day_id    INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  PRIMARY KEY (day_id, player_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id           INTEGER PRIMARY KEY,
  day_id       INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  court        INTEGER NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('singles', 'doubles')),
  team_a       TEXT NOT NULL,
  team_b       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'completed', 'incomplete')),
  points       TEXT NOT NULL DEFAULT '',
  score        TEXT,
  winner       TEXT,
  source       TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  started_at   TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS matches_day ON matches(day_id, seq);
CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY,
  day_id      INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  match_id    INTEGER,
  match_label TEXT,
  action      TEXT NOT NULL,
  summary     TEXT NOT NULL,
  before      TEXT,
  after       TEXT,
  note        TEXT,
  by_name     TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_day ON activity(day_id, id);
`;

// Columns added after the first release; applied to older databases on open.
const MIGRATIONS = [
  ['days', 'scorer', 'ALTER TABLE days ADD COLUMN scorer TEXT'],
  ['activity', 'by_name', 'ALTER TABLE activity ADD COLUMN by_name TEXT'],
];

async function migrate(db) {
  for (const [table, column, sql] of MIGRATIONS) {
    const cols = await db.all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === column)) await db.exec(sql);
  }
}

async function openLocal(file) {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  let inTx = false;
  const db = {
    kind: 'sqlite',
    async all(sql, ...p) { return raw.prepare(sql).all(...p); },
    async get(sql, ...p) { return raw.prepare(sql).get(...p); },
    async run(sql, ...p) {
      const r = raw.prepare(sql).run(...p);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    async exec(sql) { raw.exec(sql); },
    // node:sqlite is synchronous, so a transaction body never yields to real I/O
    // and other requests can't interleave with it.
    async tx(fn) {
      if (inTx) return fn(db);
      raw.exec('BEGIN IMMEDIATE');
      inTx = true;
      try {
        const result = await fn(db);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      } finally {
        inTx = false;
      }
    },
    async close() { raw.close(); },
  };
  await db.exec(SCHEMA);
  await migrate(db);
  return db;
}

function wrapLibsql(exec, extra) {
  const args = (p) => p.map((v) => (v === undefined ? null : v));
  return {
    async all(sql, ...p) { return (await exec({ sql, args: args(p) })).rows; },
    async get(sql, ...p) { return (await exec({ sql, args: args(p) })).rows[0]; },
    async run(sql, ...p) {
      const r = await exec({ sql, args: args(p) });
      return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
    ...extra,
  };
}

async function openLibsql(url, authToken) {
  // Remote URLs use the /web build (pure fetch, no native modules, ideal for
  // serverless). file: URLs use the Node build, which lets tests run this path locally.
  const { createClient } = await import(url.startsWith('file:') ? '@libsql/client' : '@libsql/client/web');
  const client = createClient({ url, authToken });
  const db = wrapLibsql((q) => client.execute(q), {
    kind: 'libsql',
    async exec(sql) { await client.executeMultiple(sql); },
    async tx(fn) {
      const t = await client.transaction('write');
      const scoped = wrapLibsql((q) => t.execute(q), {
        kind: 'libsql-tx',
        async exec(sql) { await t.executeMultiple(sql); },
        async tx(inner) { return inner(scoped); },
      });
      try {
        const result = await fn(scoped);
        await t.commit();
        return result;
      } catch (err) {
        await t.rollback().catch(() => {});
        throw err;
      } finally {
        t.close();
      }
    },
    async close() { client.close(); },
  });
  await db.exec(SCHEMA);
  await migrate(db);
  return db;
}

// Vercel's Turso integration may prefix variable names (e.g. TURSO_DATABASE_TURSO_AUTH_TOKEN),
// so accept any variable that ends with the expected name.
export function envVar(name, env = process.env) {
  if (env[name]) return env[name];
  const key = Object.keys(env).find((k) => k.endsWith(`_${name}`) && env[k]);
  return key ? env[key] : undefined;
}

// A Turso URL wins (production); otherwise a local SQLite file.
export async function openDb({ file, url = envVar('TURSO_DATABASE_URL'), authToken = envVar('TURSO_AUTH_TOKEN') } = {}) {
  if (url) return openLibsql(url, authToken);
  return openLocal(file);
}
