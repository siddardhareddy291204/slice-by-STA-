import fs from 'node:fs';
import path from 'node:path';
import { Store, HttpError } from './store.js';
import { renderSessionPdf, reportFilename } from './report.js';

export { HttpError };

const COOKIE = 'slice_sid';
const MAX_BODY = 64 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

// Small in-memory throttle so the organizer password can't be brute-forced.
function makeThrottle(limit = 10, windowMs = 10 * 60 * 1000) {
  const hits = new Map();
  return (key) => {
    const t = Date.now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    recent.push(t);
    hits.set(key, recent);
    return recent.length <= limit;
  };
}

export async function createApp({ dbFile, rootDir }) {
  const store = await Store.open({ file: dbFile });
  // A bad ORGANIZER_PASSWORD must not crash the app: report it on every API call instead.
  let configError = null;
  const envPassword = process.env.ORGANIZER_PASSWORD;
  if (envPassword !== undefined && !(await store.hasPassword())) {
    if (envPassword.trim().length < 6) configError = 'ORGANIZER_PASSWORD is shorter than 6 characters. Set a longer one in Vercel and redeploy.';
    else await store.setPassword(envPassword.trim());
  }
  const publicDir = path.join(rootDir, 'public');
  const sharedDir = path.join(rootDir, 'src', 'shared');
  const allowLogin = makeThrottle();

  const routes = [];
  // auth: 'public' | 'organizer'
  const on = (method, pattern, auth, fn) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), auth, fn });
  const id = (s) => Number(s);

  on('GET', '/api/me', 'public', async ({ token }) => {
    const { hasPassword, organizer } = await store.authState(token);
    return { organizer, setupNeeded: !hasPassword };
  });

  on('POST', '/api/setup', 'public', async ({ body, res }) => {
    if (await store.hasPassword()) throw new HttpError(409, 'The organizer password is already set.');
    await store.setPassword(body.password);
    const token = await store.createSession();
    res.setHeader('Set-Cookie', sessionCookie(token));
    return { organizer: true };
  });

  on('POST', '/api/login', 'public', async ({ body, res, req }) => {
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    if (!allowLogin(ip)) throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
    if (!(await store.checkPassword(body.password))) throw new HttpError(401, 'That password isn’t right.');
    const token = await store.createSession();
    res.setHeader('Set-Cookie', sessionCookie(token));
    return { organizer: true };
  });

  on('POST', '/api/logout', 'public', async ({ token, res }) => {
    if (token) await store.deleteSession(token);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { organizer: false };
  });

  on('POST', '/api/password', 'organizer', async ({ body, token }) => {
    if (!(await store.checkPassword(body.current))) throw new HttpError(401, 'Your current password isn’t right.');
    await store.setPassword(body.next);
    await store.deleteOtherSessions(token);
    return { ok: true };
  });

  on('GET', '/api/players', 'organizer', () => store.listPlayers());
  on('POST', '/api/players', 'organizer', ({ body }) => store.addPlayer(body.name));
  on('PATCH', '/api/players/(\\d+)', 'organizer', ({ params, body }) => store.updatePlayer(id(params[0]), body));

  on('GET', '/api/days', 'organizer', ({ url }) => store.listDays({ month: url.searchParams.get('month') ?? undefined }));
  on('GET', '/api/monthly', 'organizer', ({ url }) => store.monthlyView(url.searchParams.get('month') ?? ''));
  on('POST', '/api/days', 'organizer', ({ body }) => store.createDay(body));
  on('GET', '/api/days/(\\d+)', 'organizer', async ({ params }) => store.dayView(id(params[0]), { organizer: true }));
  on('GET', '/api/days/(\\d+)/report.pdf', 'organizer', async ({ params }) => {
    const view = await store.dayView(id(params[0]), { organizer: true });
    return { pdf: await renderSessionPdf(view), filename: reportFilename(view.day) };
  });
  on('DELETE', '/api/days/(\\d+)', 'organizer', ({ params }) => store.deleteDay(id(params[0])));
  on('PATCH', '/api/days/(\\d+)', 'organizer', ({ params, body }) => store.updateDay(id(params[0]), body));
  on('POST', '/api/days/(\\d+)/finish', 'organizer', ({ params, body }) => store.finishDay(id(params[0]), body));
  on('POST', '/api/days/(\\d+)/reopen', 'organizer', ({ params }) => store.reopenDay(id(params[0])));
  on('POST', '/api/days/(\\d+)/suggest', 'organizer', ({ params, body }) => store.suggest(id(params[0]), body));
  on('POST', '/api/days/(\\d+)/matches', 'organizer', ({ params, body }) => store.createMatches(id(params[0]), body.matches));

  on('PATCH', '/api/matches/(\\d+)', 'organizer', ({ params, body }) => store.updateLineup(id(params[0]), body));
  on('DELETE', '/api/matches/(\\d+)', 'organizer', ({ params }) => store.deleteMatch(id(params[0])));
  on('POST', '/api/matches/(\\d+)/start', 'organizer', ({ params }) => store.startMatch(id(params[0])));
  on('POST', '/api/matches/(\\d+)/point', 'organizer', ({ params, body }) => store.addPoint(id(params[0]), body.side, body.at));
  on('POST', '/api/matches/(\\d+)/undo', 'organizer', ({ params, body }) => store.undoPoint(id(params[0]), body.at));
  on('POST', '/api/matches/(\\d+)/result', 'organizer', ({ params, body }) => store.setResult(id(params[0]), body.score, body.note));
  on('POST', '/api/matches/(\\d+)/incomplete', 'organizer', ({ params, body }) => store.markIncomplete(id(params[0]), body.note));
  on('POST', '/api/matches/(\\d+)/reopen', 'organizer', ({ params }) => store.reopen(id(params[0])));

  on('GET', '/api/public/([\\w-]+)', 'public', async ({ params }) => store.dayView(params[0], { organizer: false, byToken: true }));
  on('GET', '/api/public/([\\w-]+)/report.pdf', 'public', async ({ params }) => {
    const view = await store.dayView(params[0], { organizer: false, byToken: true });
    return { pdf: await renderSessionPdf(view), filename: reportFilename(view.day) };
  });

  function sessionCookie(token) {
    const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`;
  }

  async function handleApi(req, res, url) {
    if (configError) throw new HttpError(500, configError);
    const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    if (!route) throw new HttpError(404, 'Not found.');
    const token = parseCookies(req.headers.cookie)[COOKIE];
    // Only routes that need it pay for the session lookup.
    const organizer = route.auth === 'organizer' ? await store.isValidSession(token) : false;
    if (route.auth === 'organizer' && !organizer) throw new HttpError(401, 'Organizer sign-in required.');
    // CSRF guard: browsers can't send this custom header cross-site without a preflight.
    if (req.method !== 'GET' && req.headers['x-slice'] !== '1') throw new HttpError(403, 'Missing request header.');
    const body = req.method === 'GET' ? {} : await readJson(req);
    const params = url.pathname.match(route.pattern).slice(1);
    return await route.fn({ req, res, body, params, token, organizer, url });
  }

  function serveFile(res, file) {
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  function serveStatic(req, res, url) {
    const p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/install' || p.startsWith('/v/')) return serveFile(res, path.join(publicDir, 'index.html'));
    const [base, rel] = p.startsWith('/shared/') ? [sharedDir, p.slice('/shared/'.length)] : [publicDir, p.slice(1)];
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    return serveFile(res, file);
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
      return serveStatic(req, res, url);
    }
    try {
      const result = await handleApi(req, res, url);
      if (result?.pdf) {
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Content-Length': result.pdf.length,
          'Cache-Control': 'no-store',
        });
        return res.end(result.pdf);
      }
      send(res, 200, result ?? { ok: true });
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500 && !(err instanceof HttpError)) console.error(err);
      send(res, status, { error: status === 500 && !(err instanceof HttpError) ? 'Something went wrong on the server.' : err.message });
    }
  }

  return { handler, store };
}
