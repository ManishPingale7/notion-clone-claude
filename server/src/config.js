import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(here, '..', 'data');

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '127.0.0.1',
  dataDir,
  dbFile: process.env.DB_FILE || path.join(dataDir, 'notion.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  clientDist: path.join(here, '..', '..', 'client', 'dist'),
  sessionDays: 30,
  maxUploadBytes: 20 * 1024 * 1024,
  secureCookies: process.env.SECURE_COOKIES === 'true',
};
