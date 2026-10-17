// Vercel entry point: every /api/* request lands here (see vercel.json).
// Static files are served by Vercel's CDN from public/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { envVar } from '../src/db.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let app; // reused across invocations of a warm function

export default async function handler(req, res) {
  if (!envVar('TURSO_DATABASE_URL')) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Database not configured. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel → Settings → Environment Variables.' }));
    return;
  }
  app ??= createApp({ rootDir });
  try {
    const { handler: handle } = await app;
    return await handle(req, res);
  } catch (err) {
    app = undefined; // retry the connection on the next request
    throw err;
  }
}
