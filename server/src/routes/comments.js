import { Router } from 'express';
import { q, tx } from '../db.js';
import { h, badRequest, forbidden, notFound, uid, now } from '../lib/util.js';
import { requireUser, publicUser } from '../auth.js';
import { assertPageRole, pageRole, atLeast } from '../permissions.js';
import { notify } from '../services.js';
import { sanitizeRich, mentionedUsers, htmlToText } from '../lib/richtext.js';
import { toPage } from '../realtime.js';

const r = Router();
r.use(requireUser);

function discussionsFor(pageId) {
  const ds = q.all('SELECT * FROM discussions WHERE page_id = ? ORDER BY created_at', pageId);
  const users = new Map();
  const user = (id) => {
    if (!users.has(id)) users.set(id, publicUser(q.get('SELECT * FROM users WHERE id = ?', id)));
    return users.get(id);
  };
  return ds.map((d) => ({
    id: d.id,
    pageId: d.page_id,
    blockId: d.block_id,
    anchorText: d.anchor_text,
    resolved: !!d.resolved,
    createdAt: d.created_at,
    createdBy: user(d.created_by),
    comments: q
      .all('SELECT * FROM comments WHERE discussion_id = ? ORDER BY created_at', d.id)
      .map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, editedAt: c.edited_at, author: user(c.author_id) })),
  }));
}

function notifyComment(user, page, discussionId, body) {
  const participants = new Set(q.all('SELECT DISTINCT author_id FROM comments WHERE discussion_id = ?', discussionId).map((c) => c.author_id));
  participants.add(page.created_by);
  const text = htmlToText(body).slice(0, 200);
  for (const m of mentionedUsers(body)) {
    if (pageRole(m, page.id)) notify(m, { type: 'comment_mention', workspaceId: page.workspace_id, actorId: user.id, pageId: page.id, data: { text, discussionId } });
    participants.delete(m);
  }
  for (const p of participants) {
    if (pageRole(p, page.id)) notify(p, { type: 'comment', workspaceId: page.workspace_id, actorId: user.id, pageId: page.id, data: { text, discussionId } });
  }
}

r.get(
  '/pages/:id/discussions',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'view');
    res.json({ discussions: discussionsFor(page.id) });
  }),
);

r.post(
  '/pages/:id/discussions',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'comment');
    const body = sanitizeRich(String(req.body?.body || ''));
    if (!htmlToText(body).trim() && !body.includes('mention')) throw badRequest('Comment cannot be empty');
    const id = typeof req.body?.id === 'string' && req.body.id.length <= 64 ? req.body.id : uid();
    tx(() => {
      q.run(
        'INSERT INTO discussions (id, page_id, block_id, anchor_text, resolved, created_by, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
        id,
        page.id,
        req.body?.blockId || null,
        req.body?.anchorText ? String(req.body.anchorText).slice(0, 500) : null,
        req.user.id,
        now(),
      );
      q.run('INSERT INTO comments (id, discussion_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)', uid(), id, req.user.id, body, now());
    });
    notifyComment(req.user, page, id, body);
    toPage(page.id, { type: 'discussions.changed' });
    res.status(201).json({ discussions: discussionsFor(page.id), id });
  }),
);

function loadDiscussion(user, id, min) {
  const d = q.get('SELECT * FROM discussions WHERE id = ?', id);
  if (!d) throw notFound('Discussion not found');
  const { page, role } = assertPageRole(user, d.page_id, min);
  return { d, page, role };
}

r.post(
  '/discussions/:id/comments',
  h((req, res) => {
    const { d, page } = loadDiscussion(req.user, req.params.id, 'comment');
    const body = sanitizeRich(String(req.body?.body || ''));
    if (!htmlToText(body).trim()) throw badRequest('Comment cannot be empty');
    q.run('INSERT INTO comments (id, discussion_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)', uid(), d.id, req.user.id, body, now());
    if (d.resolved) q.run('UPDATE discussions SET resolved = 0 WHERE id = ?', d.id);
    notifyComment(req.user, page, d.id, body);
    toPage(page.id, { type: 'discussions.changed' });
    res.status(201).json({ discussions: discussionsFor(page.id) });
  }),
);

r.patch(
  '/discussions/:id',
  h((req, res) => {
    const { d, page } = loadDiscussion(req.user, req.params.id, 'comment');
    if (req.body?.resolved !== undefined) q.run('UPDATE discussions SET resolved = ? WHERE id = ?', req.body.resolved ? 1 : 0, d.id);
    toPage(page.id, { type: 'discussions.changed' });
    res.json({ discussions: discussionsFor(page.id) });
  }),
);

r.delete(
  '/discussions/:id',
  h((req, res) => {
    const { d, page, role } = loadDiscussion(req.user, req.params.id, 'comment');
    if (d.created_by !== req.user.id && !atLeast(role, 'full')) throw forbidden('Only the author can delete this discussion');
    q.run('DELETE FROM discussions WHERE id = ?', d.id);
    toPage(page.id, { type: 'discussions.changed' });
    res.json({ discussions: discussionsFor(page.id) });
  }),
);

r.patch(
  '/comments/:id',
  h((req, res) => {
    const c = q.get('SELECT * FROM comments WHERE id = ?', req.params.id);
    if (!c) throw notFound();
    const { page } = loadDiscussion(req.user, c.discussion_id, 'comment');
    if (c.author_id !== req.user.id) throw forbidden('You can only edit your own comments');
    const body = sanitizeRich(String(req.body?.body || ''));
    if (!htmlToText(body).trim()) throw badRequest('Comment cannot be empty');
    q.run('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?', body, now(), c.id);
    toPage(page.id, { type: 'discussions.changed' });
    res.json({ discussions: discussionsFor(page.id) });
  }),
);

r.delete(
  '/comments/:id',
  h((req, res) => {
    const c = q.get('SELECT * FROM comments WHERE id = ?', req.params.id);
    if (!c) throw notFound();
    const { page, role } = loadDiscussion(req.user, c.discussion_id, 'comment');
    if (c.author_id !== req.user.id && !atLeast(role, 'full')) throw forbidden('You can only delete your own comments');
    tx(() => {
      q.run('DELETE FROM comments WHERE id = ?', c.id);
      if (!q.get('SELECT id FROM comments WHERE discussion_id = ?', c.discussion_id)) q.run('DELETE FROM discussions WHERE id = ?', c.discussion_id);
    });
    toPage(page.id, { type: 'discussions.changed' });
    res.json({ discussions: discussionsFor(page.id) });
  }),
);

export default r;
