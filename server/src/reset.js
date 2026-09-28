// Deletes the local database and uploaded files (development convenience).
import fs from 'node:fs';
import { config } from './config.js';

for (const f of [config.dbFile, config.dbFile + '-wal', config.dbFile + '-shm']) fs.rmSync(f, { force: true });
fs.rmSync(config.uploadDir, { recursive: true, force: true });
console.log('Removed', config.dbFile, 'and uploads. Run `npm run seed` to add demo data.');
