import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;
const dbFile = process.env.DB_FILE || path.join(rootDir, 'data', 'slice.db');

const { handler, store } = await createApp({ dbFile, rootDir });
const server = http.createServer(handler);

server.listen(port, async () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  console.log(`Slice is running at http://localhost:${port}`);
  if (lan) console.log(`On the same Wi-Fi, phones can open http://${lan.address}:${port}`);
  if (!(await store.hasPassword())) console.log('No organizer password yet — the first visit will ask you to set one.');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    server.close();
    await store.close();
    process.exit(0);
  });
}
