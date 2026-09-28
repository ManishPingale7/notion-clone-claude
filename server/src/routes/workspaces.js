import { Router } from 'express';
import { q, tx, json } from '../db.js';
import { h, badRequest, forbidden, isEmail, uid, now } from '../lib/util.js';
import { requireUser, publicUser } from '../auth.js';
import { membership, requireMember, userWorkspaces, workspaceRoles } from '../permissions.js';
import { createWorkspace, notify, workspacePeople, pageMeta } from '../services.js';
import { serializeWorkspace } from './auth.js';
import { toWorkspace, toUser } from '../realtime.js';

const r = Router();
r.use(requireUser);

function requireAccess(workspaceId, userId) {
  if (!userWorkspaces(userId).some((w) => w.id === workspaceId)) throw forbidden('You do not have access to this workspace');
}

r.get(
  '/',
  h((req, res) => res.json({ workspaces: userWorkspaces(req.user.id).map(serializeWorkspace) })),
);

r.post(
  '/',
  h((req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw badRequest('Workspace name is required');
    const ws = createWorkspace(req.user, name.slice(0, 100), { icon: req.body?.icon || null });
    res.status(201).json({ workspace: serializeWorkspace({ ...ws, role: 'owner' }) });
  }),
);

r.patch(
  '/:id',
  h((req, res) => {
    if (requireMember(req.params.id, req.user.id) !== 'owner') throw forbidden('Only workspace owners can change settings');
    const { name, icon } = req.body || {};
    if (name !== undefined && String(name).trim()) q.run('UPDATE workspaces SET name = ? WHERE id = ?', String(name).trim().slice(0, 100), req.params.id);
    if (icon !== undefined) q.run('UPDATE workspaces SET icon = ? WHERE id = ?', icon ? String(icon).slice(0, 500) : null, req.params.id);
    const ws = q.get('SELECT * FROM workspaces WHERE id = ?', req.params.id);
    toWorkspace(req.params.id, { type: 'workspace.updated' });
    res.json({ workspace: serializeWorkspace({ ...ws, role: 'owner' }) });
  }),
);

r.delete(
  '/:id',
  h((req, res) => {
    if (requireMember(req.params.id, req.user.id) !== 'owner') throw forbidden('Only workspace owners can delete a workspace');
    const remaining = q.get('SELECT COUNT(*) AS c FROM workspace_members WHERE user_id = ?', req.user.id).c;
    if (remaining <= 1) throw badRequest('You cannot delete your only workspace');
    toWorkspace(req.params.id, { type: 'workspace.deleted' });
    q.run('DELETE FROM workspaces WHERE id = ?', req.params.id);
    res.json({ ok: true });
  }),
);

r.post(
  '/:id/leave',
  h((req, res) => {
    const role = requireMember(req.params.id, req.user.id);
    if (role === 'owner') {
      const owners = q.get(`SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id = ? AND role = 'owner'`, req.params.id).c;
      if (owners <= 1) throw badRequest('Transfer ownership to another member before leaving');
    }
    q.run('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', req.params.id, req.user.id);
    toWorkspace(req.params.id, { type: 'members.changed' });
    res.json({ ok: true });
  }),
);

r.get(
  '/:id/members',
  h((req, res) => {
    requireAccess(req.params.id, req.user.id);
    const invites = q
      .all('SELECT * FROM invites WHERE workspace_id = ? AND page_id IS NULL ORDER BY created_at', req.params.id)
      .map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.created_at }));
    res.json({ people: workspacePeople(req.params.id), invites });
  }),
);

r.post(
  '/:id/members',
  h((req, res) => {
    const myRole = requireMember(req.params.id, req.user.id);
    const emails = (Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.email]).map((e) => String(e || '').trim()).filter(Boolean);
    const role = req.body?.role === 'owner' ? 'owner' : 'member';
    if (role === 'owner' && myRole !== 'owner') throw forbidden('Only owners can add owners');
    if (!emails.length || !emails.every(isEmail)) throw badRequest('Enter valid email addresses');
    const added = [];
    tx(() => {
      for (const email of emails) {
        const user = q.get('SELECT * FROM users WHERE email = ?', email);
        if (user) {
          if (membership(req.params.id, user.id)) continue;
          q.run('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', req.params.id, user.id, role, now());
          notify(user.id, { type: 'workspace_joined', workspaceId: req.params.id, actorId: req.user.id });
          toUser(user.id, { type: 'workspaces.changed' });
          added.push(publicUser(user));
        } else if (!q.get('SELECT id FROM invites WHERE workspace_id = ? AND email = ? AND page_id IS NULL', req.params.id, email)) {
          q.run('INSERT INTO invites (id, workspace_id, email, page_id, role, invited_by, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)', uid(), req.params.id, email, role, req.user.id, now());
        }
      }
    });
    toWorkspace(req.params.id, { type: 'members.changed' });
    res.status(201).json({ added });
  }),
);

r.patch(
  '/:id/members/:userId',
  h((req, res) => {
    if (requireMember(req.params.id, req.user.id) !== 'owner') throw forbidden('Only owners can change roles');
    const role = req.body?.role;
    if (!['owner', 'member'].includes(role)) throw badRequest('Invalid role');
    if (role === 'member' && req.params.userId === req.user.id) {
      const owners = q.get(`SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id = ? AND role = 'owner'`, req.params.id).c;
      if (owners <= 1) throw badRequest('A workspace needs at least one owner');
    }
    q.run('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?', role, req.params.id, req.params.userId);
    toWorkspace(req.params.id, { type: 'members.changed' });
    res.json({ ok: true });
  }),
);

r.delete(
  '/:id/members/:userId',
  h((req, res) => {
    const myRole = requireMember(req.params.id, req.user.id);
    if (myRole !== 'owner' && req.params.userId !== req.user.id) throw forbidden('Only owners can remove members');
    const target = membership(req.params.id, req.params.userId);
    if (target === 'owner') {
      const owners = q.get(`SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id = ? AND role = 'owner'`, req.params.id).c;
      if (owners <= 1) throw badRequest('A workspace needs at least one owner');
    }
    tx(() => {
      q.run('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', req.params.id, req.params.userId);
      // Guests (and removed members) also lose explicit page grants when removed from the workspace.
      q.run('DELETE FROM page_permissions WHERE user_id = ? AND page_id IN (SELECT id FROM pages WHERE workspace_id = ?)', req.params.userId, req.params.id);
    });
    toWorkspace(req.params.id, { type: 'members.changed' });
    toUser(req.params.userId, { type: 'workspaces.changed' });
    res.json({ ok: true });
  }),
);

r.delete(
  '/:id/invites/:inviteId',
  h((req, res) => {
    requireMember(req.params.id, req.user.id);
    q.run('DELETE FROM invites WHERE id = ? AND workspace_id = ?', req.params.inviteId, req.params.id);
    res.json({ ok: true });
  }),
);

// ---------- Sidebar / navigation data ----------

r.get(
  '/:id/sidebar',
  h((req, res) => {
    const wsId = req.params.id;
    requireAccess(wsId, req.user.id);
    const roles = workspaceRoles(wsId, req.user.id);
    const isMember = !!membership(wsId, req.user.id);
    const rows = q.all(
      `SELECT id, title, icon, type, parent_id, parent_type, visibility, created_by, position, is_inline, updated_at
       FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND parent_type != 'database'`,
      wsId,
    );
    const visible = rows.filter((p) => roles.has(p.id));
    const visibleIds = new Set(visible.map((p) => p.id));
    const pages = visible.map((p) => {
      let section = null;
      if (!p.parent_id) {
        if (isMember && p.visibility === 'workspace') section = 'workspace';
        else if (isMember && p.created_by === req.user.id) section = 'private';
        else section = 'shared';
      } else if (!visibleIds.has(p.parent_id)) {
        section = 'shared';
      }
      return {
        id: p.id,
        title: p.title,
        icon: p.icon,
        type: p.type,
        parentId: p.parent_id,
        position: p.position,
        isInline: !!p.is_inline,
        section,
        role: roles.get(p.id),
      };
    });
    const favorites = q
      .all(
        `SELECT f.page_id, p.title, p.icon, p.type, p.deleted_at FROM favorites f JOIN pages p ON p.id = f.page_id
         WHERE f.user_id = ? AND p.workspace_id = ? ORDER BY f.position`,
        req.user.id,
        wsId,
      )
      .filter((f) => !f.deleted_at && roles.has(f.page_id))
      .map((f) => ({ id: f.page_id, title: f.title, icon: f.icon, type: f.type }));
    res.json({ pages, favorites, isMember });
  }),
);

r.get(
  '/:id/recents',
  h((req, res) => {
    requireAccess(req.params.id, req.user.id);
    const roles = workspaceRoles(req.params.id, req.user.id);
    const rows = q.all(
      `SELECT p.*, r.visited_at FROM recents r JOIN pages p ON p.id = r.page_id
       WHERE r.user_id = ? AND p.workspace_id = ? AND p.deleted_at IS NULL ORDER BY r.visited_at DESC LIMIT 30`,
      req.user.id,
      req.params.id,
    );
    const people = new Map(workspacePeople(req.params.id).map((p) => [p.id, p]));
    res.json({
      pages: rows
        .filter((p) => roles.has(p.id))
        .map((p) => ({
          ...pageMeta(p),
          cover: json.parse(p.cover, null),
          visitedAt: p.visited_at,
          updatedAt: p.updated_at,
          updatedBy: people.get(p.updated_by) || null,
        })),
    });
  }),
);

r.get(
  '/:id/trash',
  h((req, res) => {
    requireAccess(req.params.id, req.user.id);
    const roles = workspaceRoles(req.params.id, req.user.id);
    const rows = q.all(
      `SELECT p.*, par.title AS parent_title, par.deleted_at AS parent_deleted FROM pages p LEFT JOIN pages par ON par.id = p.parent_id
       WHERE p.workspace_id = ? AND p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC LIMIT 500`,
      req.params.id,
    );
    // Only show the top of each trashed subtree (a page whose parent is not trashed at the same time).
    const pages = rows
      .filter((p) => roles.has(p.id) && (!p.parent_deleted || p.parent_deleted !== p.deleted_at))
      .map((p) => ({ ...pageMeta(p), deletedAt: p.deleted_at, parentTitle: p.parent_title, role: roles.get(p.id) }));
    res.json({ pages });
  }),
);

r.get(
  '/:id/search',
  h((req, res) => {
    requireAccess(req.params.id, req.user.id);
    const roles = workspaceRoles(req.params.id, req.user.id);
    const text = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const onlyTitles = req.query.titles === '1';
    const rows = q.all(
      `SELECT id, title, icon, type, parent_id, parent_type, is_inline, search_text, updated_at, created_by, deleted_at FROM pages
       WHERE workspace_id = ? AND deleted_at IS NULL`,
      req.params.id,
    );
    const byId = new Map(rows.map((p) => [p.id, p]));
    const pathOf = (p) => {
      const parts = [];
      let cur = p.parent_id ? byId.get(p.parent_id) : null;
      for (let g = 0; cur && g < 50; g++) {
        if (roles.has(cur.id)) parts.unshift(cur.title || 'Untitled');
        cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      }
      return parts.join(' / ');
    };
    const results = [];
    for (const p of rows) {
      if (!roles.has(p.id)) continue;
      const title = (p.title || 'Untitled').toLowerCase();
      let score = 0;
      let snippet = null;
      if (!text) score = 1;
      else if (title === text) score = 100;
      else if (title.startsWith(text)) score = 60;
      else if (title.includes(text)) score = 40;
      else if (!onlyTitles) {
        const idx = p.search_text.toLowerCase().indexOf(text);
        if (idx >= 0) {
          score = 10;
          const start = Math.max(0, idx - 40);
          snippet = (start > 0 ? '…' : '') + p.search_text.slice(start, idx + text.length + 60).replace(/\s+/g, ' ');
        }
      }
      if (!score) continue;
      results.push({ ...pageMeta(p), path: pathOf(p), snippet, updatedAt: p.updated_at, score });
    }
    results.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
    res.json({ results: results.slice(0, limit) });
  }),
);

export default r;
