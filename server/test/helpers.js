import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Boots the real app (HTTP + WebSocket) on a random port against a throwaway DB.
export async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-test-'));
  process.env.DATA_DIR = dir;
  process.env.DB_FILE = path.join(dir, 'test.db');
  const { openDb, closeDb } = await import('../src/db.js');
  const { createApp } = await import('../src/app.js');
  const { attachRealtime } = await import('../src/realtime.js');
  openDb(process.env.DB_FILE);
  const app = createApp();
  const server = http.createServer(app);
  const wss = attachRealtime(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async stop() {
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise((r) => server.close(r));
      closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Minimal cookie-keeping API client. */
export function client(base) {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b = {}) => call('POST', u, b),
    patch: (u, b = {}) => call('PATCH', u, b),
    del: (u, b) => call('DELETE', u, b),
    get cookie() {
      return cookie;
    },
  };
}

export async function signup(base, name, email) {
  const c = client(base);
  const r = await c.post('/api/auth/signup', { name, email, password: 'password123' });
  if (r.status !== 201) throw new Error('signup failed: ' + JSON.stringify(r.data));
  return { c, user: r.data.user, workspaces: r.data.workspaces };
}
