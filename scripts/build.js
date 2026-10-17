// Vercel build: copy the shared rule modules next to the static files so the
// browser can import /shared/*.js from the CDN (locally server.js serves them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(root, 'src', 'shared');
const to = path.join(root, 'public', 'shared');
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
for (const f of fs.readdirSync(from)) if (f.endsWith('.js')) fs.copyFileSync(path.join(from, f), path.join(to, f));
console.log(`Copied shared modules to ${path.relative(root, to)}`);
