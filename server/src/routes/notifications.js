import { Router } from 'express';
import { q, json } from '../db.js';
import { h } from '../lib/util.js';
import { requireUser, publicUser } from '../auth.js';
import { pageRole } from '../permissions.js';
import { pageMeta } from '../services.js';

const r = Router();
r.use(requireUser);

r.get(
  '/',
  h((req, res) => {
    const archived = req.query.archived === '1' ? 1 : 0;
    const rows = q.all(
      `SELECT * FROM notifications WHERE user_id = ? AND archived = ? ORDER BY created_at DESC LIMIT 100`,
      req.user.id,
      archived,
    );
    const out = [];
    for (const n of rows) {
      const page = n.page_id ? q.get('SELECT * FROM pages WHERE id = ?', n.page_id) : null;
      if (n.page_id && (!page || !pageRole(req.user.id, n.page_id))) continue;
      const actor = n.actor_id ? q.get('SELECT * FROM users WHERE id = ?', n.actor_id) : null;
      const ws = n.workspace_id ? q.get('SELECT id, name, icon FROM workspaces WHERE id = ?', n.workspace_id) : null;
      out.push({
        id: n.id,
        type: n.type,
        read: !!n.read,
        archived: !!n.archived,
        createdAt: n.created_at,
        actor: publicUser(actor),
        page: page ? pageMeta(page) : null,
        workspace: ws,
        data: json.parse(n.data, {}),
      });
    }
    const unread = q.get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0 AND archived = 0', req.user.id).c;
    res.json({ notifications: out, unread });
  }),
);

r.post(
  '/read',
  h((req, res) => {
    if (req.body?.all) q.run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
    else for (const id of req.body?.ids || []) q.run('UPDATE notifications SET read = ? WHERE id = ? AND user_id = ?', req.body?.unread ? 0 : 1, id, req.user.id);
    res.json({ ok: true });
  }),
);

r.post(
  '/archive',
  h((req, res) => {
    const val = req.body?.unarchive ? 0 : 1;
    if (req.body?.all) q.run('UPDATE notifications SET archived = 1, read = 1 WHERE user_id = ?', req.user.id);
    else for (const id of req.body?.ids || []) q.run('UPDATE notifications SET archived = ?, read = 1 WHERE id = ? AND user_id = ?', val, id, req.user.id);
    res.json({ ok: true });
  }),
);

export default r;
