import crypto from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';
import { now, unauthorized } from './lib/util.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = now();
  q.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', token, userId, t, t + config.sessionDays * 864e5);
  return token;
}

export function destroySession(token) {
  if (token) q.run('DELETE FROM sessions WHERE token = ?', token);
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function userFromToken(token) {
  if (!token) return null;
  const row = q.get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`,
    token,
    now(),
  );
  return row || null;
}

export function setSessionCookie(res, token) {
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: config.sessionDays * 864e5,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie('sid', { path: '/' });
}

/** Express middleware: attaches req.user when a valid session cookie is present. */
export function sessionMiddleware(req, _res, next) {
  const cookies = parseCookies(req.headers.cookie);
  req.sessionToken = cookies.sid;
  req.user = userFromToken(cookies.sid);
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url, color: u.color };
}
