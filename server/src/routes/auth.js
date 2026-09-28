import { Router } from 'express';
import { q } from '../db.js';
import { h, badRequest, unauthorized, isEmail, now } from '../lib/util.js';
import {
  createSession, destroySession, setSessionCookie, clearSessionCookie, verifyPassword, hashPassword,
  requireUser, publicUser,
} from '../auth.js';
import { createUser } from '../services.js';
import { userWorkspaces } from '../permissions.js';
import { safeUrl } from '../lib/richtext.js';

const r = Router();

function mePayload(user) {
  const settings = JSON.parse(user.settings || '{}');
  return { user: { ...publicUser(user), settings }, workspaces: userWorkspaces(user.id).map(serializeWorkspace) };
}

export function serializeWorkspace(w) {
  return { id: w.id, name: w.name, icon: w.icon, role: w.role, createdBy: w.created_by };
}

r.post(
  '/signup',
  h((req, res) => {
    const { email, name, password } = req.body || {};
    if (!isEmail(email)) throw badRequest('Please enter a valid email address');
    if (!name || !String(name).trim()) throw badRequest('Please enter your name');
    if (!password || String(password).length < 8) throw badRequest('Password must be at least 8 characters');
    if (q.get('SELECT id FROM users WHERE email = ?', String(email).trim())) throw badRequest('An account with this email already exists');
    const { user } = createUser({ email: String(email), name: String(name).slice(0, 100), password: String(password) });
    const token = createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json(mePayload(user));
  }),
);

r.post(
  '/login',
  h((req, res) => {
    const { email, password } = req.body || {};
    const user = q.get('SELECT * FROM users WHERE email = ?', String(email || '').trim());
    if (!user || !verifyPassword(String(password || ''), user.password_hash)) throw unauthorized('Incorrect email or password');
    const token = createSession(user.id);
    setSessionCookie(res, token);
    res.json(mePayload(user));
  }),
);

r.post(
  '/logout',
  h((req, res) => {
    destroySession(req.sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

r.get(
  '/me',
  requireUser,
  h((req, res) => res.json(mePayload(req.user))),
);

r.patch(
  '/me',
  requireUser,
  h((req, res) => {
    const { name, avatarUrl, settings } = req.body || {};
    if (name !== undefined) {
      if (!String(name).trim()) throw badRequest('Name cannot be empty');
      q.run('UPDATE users SET name = ? WHERE id = ?', String(name).trim().slice(0, 100), req.user.id);
    }
    if (avatarUrl !== undefined) q.run('UPDATE users SET avatar_url = ? WHERE id = ?', avatarUrl ? safeUrl(avatarUrl) : null, req.user.id);
    if (settings && typeof settings === 'object') {
      const merged = { ...JSON.parse(req.user.settings || '{}'), ...settings };
      q.run('UPDATE users SET settings = ? WHERE id = ?', JSON.stringify(merged).slice(0, 20000), req.user.id);
    }
    res.json(mePayload(q.get('SELECT * FROM users WHERE id = ?', req.user.id)));
  }),
);

r.post(
  '/password',
  requireUser,
  h((req, res) => {
    const { current, next } = req.body || {};
    if (!verifyPassword(String(current || ''), req.user.password_hash)) throw badRequest('Current password is incorrect');
    if (!next || String(next).length < 8) throw badRequest('New password must be at least 8 characters');
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(next)), req.user.id);
    q.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', req.user.id, req.sessionToken);
    res.json({ ok: true, at: now() });
  }),
);

export default r;
