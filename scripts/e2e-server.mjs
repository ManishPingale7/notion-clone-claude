// Starts a clean server instance for the Playwright suite.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.e2e-data');
fs.rmSync(dataDir, { recursive: true, force: true });
const env = { ...process.env, DATA_DIR: dataDir, PORT: '3100', HOST: '127.0.0.1' };
const flags = ['--disable-warning=ExperimentalWarning'];
if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
  console.error('client/dist is missing — run `npm run build` first');
  process.exit(1);
}
const seed = spawnSync(process.execPath, [...flags, 'server/src/seed.js'], { cwd: root, env, stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const server = spawn(process.execPath, [...flags, 'server/src/index.js'], { cwd: root, env, stdio: 'inherit' });
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
server.on('exit', (code) => process.exit(code ?? 0));
