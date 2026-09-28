import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, '..', 'migrations');

let db;

export function openDb(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate();
  return db;
}

export function getDb() {
  if (!db) openDb();
  return db;
}

export function closeDb() {
  if (db) db.close();
  db = undefined;
}

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    tx(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(f, Date.now());
    });
  }
}

const stmtCache = new Map();
function prep(sql) {
  let s = stmtCache.get(sql);
  if (!s || stmtCache.dbRef !== db) {
    if (stmtCache.dbRef !== db) {
      stmtCache.clear();
      stmtCache.dbRef = db;
    }
    s = getDb().prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));

export const q = {
  get: (sql, ...params) => prep(sql).get(...clean(params)),
  all: (sql, ...params) => prep(sql).all(...clean(params)),
  run: (sql, ...params) => prep(sql).run(...clean(params)),
};

let depth = 0;
/** Runs fn inside a transaction (nested calls join the outer transaction). */
export function tx(fn) {
  const d = getDb();
  if (depth > 0) return fn();
  depth++;
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export const json = {
  parse(value, fallback) {
    if (value == null || value === '') return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },
};
