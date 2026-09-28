import http from 'node:http';
import { openDb } from './db.js';
import { config } from './config.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';
import { seedDemo } from './demo.js';

openDb();
if (process.env.SEED_DEMO === 'true' && seedDemo()) console.log('Seeded demo data (SEED_DEMO=true)');
const app = createApp();
const server = http.createServer(app);
attachRealtime(server);

server.listen(config.port, config.host, () => {
  console.log(`Notion clone server listening on http://${config.host}:${config.port}`);
  console.log(`Database: ${config.dbFile}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
