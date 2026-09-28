import { Router } from 'express';
import { q, tx, json } from '../db.js';
import { h, badRequest, forbidden, notFound, isEmail, uid, now } from '../lib/util.js';
import { requireUser, publicUser } from '../auth.js';
import {
  assertPageRole, atLeast, membership, pageRole, requireMember, workspaceRoles, isPublic, ROLE_RANK,
} from '../permissions.js';
import {
  serializePage, pageMeta, createPage, trashPage, restorePage, duplicatePage, descendantIds, ancestors,
  refreshSearchText, touchPage, notify, workspacePeople, maybeSnapshot, nextBlockPosition, nextPosition, createView,
} from '../services.js';
import { BLOCK_TYPES, sanitizeContent, rowFromBlock, RICH_TYPES } from '../lib/blocks.js';
import { mentionedUsers, safeUrl } from '../lib/richtext.js';
import { sanitizeValue, defaultSchema, defaultStatusOptions } from '../lib/database.js';
import { blocksToMarkdown } from '../lib/markdown.js';
import { toPage, toWorkspace, toUser } from '../realtime.js';

const r = Router();
r.use(requireUser);

const clientId = (req) => req.headers['x-client-id'] || null;
const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Metadata for every page referenced from blocks (sub-pages, links, @mentions) that the user can see. */
function referencedPages(user, workspaceId, blocks, extra = []) {
  const ids = new Set(extra);
  for (const b of blocks) {
    const raw = JSON.stringify(b.content);
    for (const m of raw.match(UUIDISH) || []) ids.add(m);
  }
  if (!ids.size) return {};
  const roles = workspaceRoles(workspaceId, user.id);
  const out = {};
  for (const id of ids) {
    const p = q.get('SELECT * FROM pages WHERE id = ?', id);
    if (!p) continue;
    if (!roles.has(id)) {
      out[id] = { id, noAccess: true, deleted: !!p.deleted_at };
      continue;
    }
    out[id] = pageMeta(p);
  }
  return out;
}

function databaseInfo(dbPage) {
  return { id: dbPage.id, title: dbPage.title, icon: dbPage.icon, schema: json.parse(dbPage.schema, null) };
}

// ---------- Create ----------

r.post(
  '/pages',
  h((req, res) => {
    const b = req.body || {};
    let workspaceId = b.workspaceId;
    let parent = null;
    if (b.parentId) {
      const { page } = assertPageRole(req.user, b.parentId, 'edit');
      parent = page;
      workspaceId = page.workspace_id;
      if (page.deleted_at) throw badRequest('Cannot add to a page in trash');
    } else {
      if (!workspaceId) throw badRequest('workspaceId is required');
      requireMember(workspaceId, req.user.id);
    }
    let properties = {};
    let title = String(b.title || '').slice(0, 2000);
    if (parent && parent.type === 'database' && b.properties) {
      const schema = json.parse(parent.schema, { properties: {} });
      for (const [k, v] of Object.entries(b.properties)) {
        const def = schema.properties[k];
        if (!def) continue;
        const val = sanitizeValue(def, v);
        if (val !== undefined) properties[k] = val;
      }
    }
    // Assign unique ids for "ID" properties.
    if (parent && parent.type === 'database') {
      const schema = json.parse(parent.schema, { properties: {} });
      let changed = false;
      for (const def of Object.values(schema.properties)) {
        if (def.type === 'unique_id') {
          properties[def.id] = def.next || 1;
          def.next = (def.next || 1) + 1;
          changed = true;
        }
      }
      if (changed) q.run('UPDATE pages SET schema = ? WHERE id = ?', JSON.stringify(schema), parent.id);
    }
    const type = b.type === 'database' ? 'database' : 'page';
    let views;
    if (type === 'database' && b.viewType) views = [{ name: b.viewType === 'table' ? 'Table' : cap(b.viewType), type: b.viewType }];
    const { page, block } = createPage(req.user, {
      id: b.id,
      workspaceId,
      parentId: b.parentId || null,
      title,
      icon: b.icon ? String(b.icon).slice(0, 500) : null,
      type,
      properties,
      visibility: b.visibility === 'workspace' ? 'workspace' : 'private',
      position: typeof b.position === 'number' ? b.position : undefined,
      blockPosition: typeof b.blockPosition === 'number' ? b.blockPosition : undefined,
      parentBlockId: b.parentBlockId || null,
      blockId: b.blockId || undefined,
      isInline: !!b.isInline,
      skipBlock: !!b.skipBlock,
      views,
      schema: b.schema,
      blocks: Array.isArray(b.blocks) ? b.blocks.slice(0, 2000) : undefined,
      format: b.format && typeof b.format === 'object' ? b.format : undefined,
    });
    if (parent?.type === 'page') touchPage(parent.id, req.user.id);
    toWorkspace(workspaceId, { type: 'pages.changed' }, clientId(req));
    if (block) toPage(parent.id, { type: 'ops', ops: [{ type: 'insert', block }], userId: req.user.id }, clientId(req));
    if (parent?.type === 'database') toPage(parent.id, { type: 'db.changed' }, clientId(req));
    res.status(201).json({ page: serializePage(page), block });
  }),
);

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Read ----------

r.get(
  '/pages/meta',
  h((req, res) => {
    const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200);
    const out = {};
    for (const id of ids) {
      const p = q.get('SELECT * FROM pages WHERE id = ?', id);
      if (!p) continue;
      out[id] = pageRole(req.user.id, id) ? pageMeta(p) : { id, noAccess: true };
    }
    res.json({ pages: out });
  }),
);

r.get(
  '/pages/:id',
  h((req, res) => {
    const { page, role } = assertPageRole(req.user, req.params.id, 'view');
    const blocks = q.all('SELECT * FROM blocks WHERE page_id = ? ORDER BY position', page.id).map(rowFromBlock);
    const roles = workspaceRoles(page.workspace_id, req.user.id);
    const anc = ancestors(page.id).map((p) => ({ ...pageMeta(p), accessible: roles.has(p.id) }));
    let database = null;
    if (page.parent_type === 'database') {
      const db = q.get('SELECT * FROM pages WHERE id = ?', page.parent_id);
      if (db) database = databaseInfo(db);
    }
    if (!req.query.noRecent) {
      q.run('INSERT OR REPLACE INTO recents (user_id, page_id, visited_at) VALUES (?, ?, ?)', req.user.id, page.id, now());
    }
    const fav = q.get('SELECT 1 AS f FROM favorites WHERE user_id = ? AND page_id = ?', req.user.id, page.id);
    const childPages = referencedPages(req.user, page.workspace_id, blocks);
    // Include direct children that are not referenced by blocks (e.g. created from the sidebar).
    const workspace = q.get('SELECT id, name, icon FROM workspaces WHERE id = ?', page.workspace_id);
    const people = workspacePeople(page.workspace_id);
    const creator = q.get('SELECT * FROM users WHERE id = ?', page.created_by);
    const editor = page.updated_by ? q.get('SELECT * FROM users WHERE id = ?', page.updated_by) : null;
    const comments = q.get(
      `SELECT COUNT(*) AS c FROM discussions d WHERE d.page_id = ? AND d.resolved = 0 AND d.block_id IS NULL`,
      page.id,
    ).c;
    res.json({
      page: serializePage(page),
      role,
      blocks,
      ancestors: anc,
      database,
      pages: childPages,
      isFavorite: !!fav,
      workspace,
      people,
      isMember: !!membership(page.workspace_id, req.user.id),
      createdByUser: publicUser(creator),
      updatedByUser: publicUser(editor),
      pageCommentCount: comments,
    });
  }),
);

r.get(
  '/pages/:id/backlinks',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'view');
    const roles = workspaceRoles(page.workspace_id, req.user.id);
    const rows = q.all(
      `SELECT DISTINCT p.* FROM blocks b JOIN pages p ON p.id = b.page_id
       WHERE p.workspace_id = ? AND p.deleted_at IS NULL AND b.type NOT IN ('page', 'child_database') AND b.content LIKE ?`,
      page.workspace_id,
      `%${page.id}%`,
    );
    res.json({ pages: rows.filter((p) => roles.has(p.id) && p.id !== page.id).map(pageMeta) });
  }),
);

// ---------- Update ----------

r.patch(
  '/pages/:id',
  h((req, res) => {
    const b = req.body || {};
    const { page } = assertPageRole(req.user, req.params.id, 'edit');
    const sets = [];
    const vals = [];
    let sidebarChanged = false;
    if (b.title !== undefined) {
      sets.push('title = ?');
      vals.push(String(b.title).replace(/\n/g, ' ').slice(0, 2000));
      sidebarChanged = true;
    }
    if (b.icon !== undefined) {
      sets.push('icon = ?');
      vals.push(b.icon ? String(b.icon).slice(0, 2000) : null);
      sidebarChanged = true;
    }
    if (b.cover !== undefined) {
      let cover = null;
      if (b.cover && typeof b.cover === 'object') {
        const position = Math.max(0, Math.min(100, Number(b.cover.position ?? 50)));
        if (b.cover.type === 'color') {
          // preset key (gradient / solid colour); the client maps keys to CSS
          cover = { type: 'color', value: String(b.cover.value || '').replace(/[^\w-]/g, '').slice(0, 40), position };
        } else {
          cover = { type: 'image', value: safeUrl(String(b.cover.value || '')), position };
        }
      }
      sets.push('cover = ?');
      vals.push(cover ? JSON.stringify(cover) : null);
    }
    if (b.format && typeof b.format === 'object') {
      const cur = json.parse(page.format, {});
      const next = { ...cur };
      for (const k of ['fullWidth', 'smallText', 'locked', 'showBacklinks', 'showComments']) if (k in b.format) next[k] = !!b.format[k];
      if ('font' in b.format) next.font = ['default', 'serif', 'mono'].includes(b.format.font) ? b.format.font : 'default';
      if ('pageOpen' in b.format) next.pageOpen = ['side', 'center', 'full'].includes(b.format.pageOpen) ? b.format.pageOpen : 'side';
      sets.push('format = ?');
      vals.push(JSON.stringify(next));
    }
    if (b.properties && typeof b.properties === 'object' && page.parent_type === 'database') {
      const db = q.get('SELECT schema FROM pages WHERE id = ?', page.parent_id);
      const schema = json.parse(db.schema, { properties: {} });
      const props = json.parse(page.properties, {});
      for (const [k, v] of Object.entries(b.properties)) {
        const def = schema.properties[k];
        if (!def) continue;
        if (def.type === 'title') {
          sets.push('title = ?');
          vals.push(String(v || '').slice(0, 2000));
          continue;
        }
        const val = sanitizeValue(def, v);
        if (val === undefined) continue;
        if (def.type === 'person') {
          const before = new Set(props[k] || []);
          for (const uidv of val) if (!before.has(uidv)) notify(uidv, { type: 'assigned', workspaceId: page.workspace_id, actorId: req.user.id, pageId: page.id, data: { property: def.name } });
        }
        props[k] = val;
      }
      sets.push('properties = ?');
      vals.push(JSON.stringify(props));
    }
    if (typeof b.position === 'number') {
      sets.push('position = ?');
      vals.push(b.position);
      sidebarChanged = true;
    }
    if (!sets.length) return res.json({ page: serializePage(page) });
    sets.push('updated_at = ?', 'updated_by = ?');
    vals.push(now(), req.user.id);
    q.run(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`, ...vals, page.id);
    const updated = q.get('SELECT * FROM pages WHERE id = ?', page.id);
    const data = serializePage(updated);
    toPage(page.id, { type: 'page.updated', page: data, userId: req.user.id }, clientId(req));
    if (page.parent_id) toPage(page.parent_id, { type: page.parent_type === 'database' ? 'db.changed' : 'child.updated', page: pageMeta(updated) }, clientId(req));
    if (sidebarChanged) toWorkspace(page.workspace_id, { type: 'pages.changed' }, clientId(req));
    res.json({ page: data });
  }),
);

/** Moves a page under another page / database, or to the top level of a sidebar section. */
r.post(
  '/pages/:id/move',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'edit');
    const targetId = req.body?.parentId || null;
    let target = null;
    if (targetId) {
      if (targetId === page.id || descendantIds(page.id).includes(targetId)) throw badRequest('Cannot move a page inside itself');
      target = assertPageRole(req.user, targetId, 'edit').page;
      if (target.workspace_id !== page.workspace_id) throw badRequest('Cannot move pages between workspaces');
    } else {
      requireMember(page.workspace_id, req.user.id);
    }
    const visibility = req.body?.visibility === 'workspace' ? 'workspace' : req.body?.visibility === 'private' ? 'private' : null;
    tx(() => {
      const oldParent = page.parent_id ? q.get('SELECT * FROM pages WHERE id = ?', page.parent_id) : null;
      const sameParent = (oldParent?.id || null) === (target?.id || null);
      if (oldParent && oldParent.type === 'page' && !sameParent) {
        q.run(`DELETE FROM blocks WHERE page_id = ? AND type IN ('page','child_database') AND json_extract(content, '$.pageId') = ?`, oldParent.id, page.id);
        toPage(oldParent.id, { type: 'blocks.reload' });
      }
      const position = typeof req.body?.position === 'number' ? req.body.position : sameParent ? page.position : nextPosition(targetId, page.workspace_id);
      let newVisibility = page.visibility;
      if (!target) {
        newVisibility = visibility || (page.parent_id ? rootVisibility(page) : page.visibility);
        if (newVisibility === 'private' && page.created_by !== req.user.id) {
          // moving someone else's page into my private section: I become the owner of that root
          q.run('UPDATE pages SET created_by = ? WHERE id = ?', req.user.id, page.id);
        }
      }
      q.run(
        'UPDATE pages SET parent_id = ?, parent_type = ?, position = ?, visibility = ?, updated_at = ?, updated_by = ? WHERE id = ?',
        target?.id || null,
        target ? (target.type === 'database' ? 'database' : 'page') : 'workspace',
        position,
        newVisibility,
        now(),
        req.user.id,
        page.id,
      );
      if (target && target.type === 'page' && !sameParent) {
        const t = now();
        const blockId = uid();
        q.run(
          `INSERT INTO blocks (id, page_id, parent_block_id, type, content, position, created_by, created_at, updated_by, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
          blockId,
          target.id,
          page.type === 'database' ? 'child_database' : 'page',
          JSON.stringify({ pageId: page.id }),
          nextBlockPosition(target.id),
          req.user.id,
          t,
          req.user.id,
          t,
        );
        toPage(target.id, { type: 'blocks.reload' });
      }
      if (target?.type === 'database' || oldParent?.type === 'database') {
        if (target) toPage(target.id, { type: 'db.changed' });
        if (oldParent) toPage(oldParent.id, { type: 'db.changed' });
      }
    });
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    toPage(page.id, { type: 'page.moved' });
    res.json({ page: serializePage(q.get('SELECT * FROM pages WHERE id = ?', page.id)) });
  }),
);

function rootVisibility(page) {
  const anc = ancestors(page.id);
  return (anc[0] || page).visibility;
}

/** Turns an empty page into a full-page database (the "Get started with: Table / Board…" options). */
r.post(
  '/pages/:id/convert',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'edit');
    if (page.type === 'database') throw badRequest('Already a database');
    if (page.parent_type === 'database') throw badRequest('Database rows cannot become databases');
    if (q.get('SELECT id FROM blocks WHERE page_id = ? LIMIT 1', page.id)) throw badRequest('Only empty pages can be turned into a database');
    const viewType = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline'].includes(req.body?.viewType) ? req.body.viewType : 'table';
    let schema = defaultSchema();
    if (viewType === 'board') {
      schema.properties.status = { id: 'status', name: 'Status', type: 'status', options: defaultStatusOptions() };
      schema.order.splice(1, 0, 'status');
    }
    if (viewType === 'calendar' || viewType === 'timeline') {
      schema.properties.date = { id: 'date', name: 'Date', type: 'date', dateFormat: 'relative' };
      schema.order.splice(1, 0, 'date');
    }
    tx(() => {
      q.run(`UPDATE pages SET type = 'database', schema = ?, updated_at = ?, updated_by = ? WHERE id = ?`, JSON.stringify(schema), now(), req.user.id, page.id);
      createView(page.id, { name: viewType === 'table' ? 'Table' : viewType.charAt(0).toUpperCase() + viewType.slice(1), type: viewType });
      if (page.parent_id) {
        q.run(`UPDATE blocks SET type = 'child_database' WHERE page_id = ? AND type = 'page' AND json_extract(content, '$.pageId') = ?`, page.parent_id, page.id);
      }
    });
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    if (page.parent_id) toPage(page.parent_id, { type: 'blocks.reload' });
    res.json({ page: serializePage(q.get('SELECT * FROM pages WHERE id = ?', page.id)) });
  }),
);

r.post(
  '/pages/:id/duplicate',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'view');
    if (page.parent_id) assertPageRole(req.user, page.parent_id, 'edit');
    else requireMember(page.workspace_id, req.user.id);
    const newId = duplicatePage(req.user, page.id);
    refreshSearchText(newId);
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    if (page.parent_id) toPage(page.parent_id, { type: page.parent_type === 'database' ? 'db.changed' : 'blocks.reload' });
    res.status(201).json({ page: serializePage(q.get('SELECT * FROM pages WHERE id = ?', newId)) });
  }),
);

// ---------- Trash ----------

r.delete(
  '/pages/:id',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'edit');
    trashPage(req.user, page.id);
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    toPage(page.id, { type: 'page.trashed' });
    if (page.parent_id) toPage(page.parent_id, { type: page.parent_type === 'database' ? 'db.changed' : 'child.updated', page: pageMeta({ ...page, deleted_at: now() }) });
    res.json({ ok: true });
  }),
);

r.post(
  '/pages/trash-many',
  h((req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 1000) : [];
    const parents = new Set();
    let workspaceId = null;
    for (const id of ids) {
      const { page } = assertPageRole(req.user, id, 'edit');
      trashPage(req.user, id);
      workspaceId = page.workspace_id;
      if (page.parent_id) parents.add(page.parent_id);
    }
    for (const p of parents) toPage(p, { type: 'db.changed' });
    if (workspaceId) toWorkspace(workspaceId, { type: 'pages.changed' });
    res.json({ ok: true });
  }),
);

r.post(
  '/pages/:id/restore',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'edit');
    restorePage(req.user, page.id);
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    toPage(page.id, { type: 'page.restored' });
    if (page.parent_id) toPage(page.parent_id, { type: page.parent_type === 'database' ? 'db.changed' : 'blocks.reload' });
    res.json({ page: serializePage(q.get('SELECT * FROM pages WHERE id = ?', page.id)) });
  }),
);

r.delete(
  '/pages/:id/permanent',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'full');
    if (!page.deleted_at) throw badRequest('Move the page to trash first');
    tx(() => {
      if (page.parent_id) {
        q.run(`DELETE FROM blocks WHERE page_id = ? AND type IN ('page','child_database') AND json_extract(content, '$.pageId') = ?`, page.parent_id, page.id);
      }
      q.run('DELETE FROM pages WHERE id = ?', page.id);
    });
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    res.json({ ok: true });
  }),
);

// ---------- Block transactions ----------

/**
 * Applies a batch of block operations atomically, like Notion's submitTransaction.
 * ops: {type:'insert', block} | {type:'update', id, set} | {type:'delete', id}
 */
r.post(
  '/pages/:id/transactions',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'edit');
    if (page.deleted_at) throw badRequest('This page is in the trash');
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
    if (ops.length > 5000) throw badRequest('Too many operations');
    maybeSnapshot(page.id, req.user.id);
    const applied = [];
    const mentions = new Set();
    const sideEffects = { trashed: [], restored: [] };
    tx(() => {
      for (const op of ops) {
        const result = applyOp(req.user, page, op, mentions, sideEffects);
        if (result) applied.push(result);
      }
      touchPage(page.id, req.user.id);
      refreshSearchText(page.id);
    });
    for (const u of mentions) {
      if (pageRole(u, page.id) || membership(page.workspace_id, u)) {
        notify(u, { type: 'mention', workspaceId: page.workspace_id, actorId: req.user.id, pageId: page.id });
      }
    }
    if (applied.length) toPage(page.id, { type: 'ops', ops: applied, userId: req.user.id }, clientId(req));
    if (sideEffects.trashed.length || sideEffects.restored.length) toWorkspace(page.workspace_id, { type: 'pages.changed' });
    res.json({ ok: true, applied: applied.length, updatedAt: now() });
  }),
);

function applyOp(user, page, op, mentions, sideEffects) {
  const t = now();
  if (op.type === 'insert') {
    const b = op.block || {};
    if (!b.id || typeof b.id !== 'string' || b.id.length > 64) throw badRequest('Block id required');
    if (!BLOCK_TYPES.has(b.type)) throw badRequest('Unknown block type ' + b.type);
    const existing = q.get('SELECT page_id FROM blocks WHERE id = ?', b.id);
    if (existing) {
      if (existing.page_id !== page.id) throw badRequest('Block belongs to another page');
      return applyOp(user, page, { type: 'update', id: b.id, set: b }, mentions, sideEffects);
    }
    const parentId = b.parentId || null;
    if (parentId && !q.get('SELECT id FROM blocks WHERE id = ? AND page_id = ?', parentId, page.id)) throw badRequest('Parent block not found');
    const content = sanitizeContent(b.type, b.content);
    if (b.type === 'page' || b.type === 'child_database') {
      const ref = content.pageId && q.get('SELECT * FROM pages WHERE id = ?', content.pageId);
      if (!ref || ref.parent_id !== page.id) throw badRequest('Sub-page blocks must reference a child page');
      if (ref.deleted_at) {
        restorePage(user, ref.id);
        // restorePage may have added its own block; remove it since we're inserting ours.
        q.run(`DELETE FROM blocks WHERE page_id = ? AND type IN ('page','child_database') AND json_extract(content, '$.pageId') = ?`, page.id, ref.id);
        sideEffects.restored.push(ref.id);
      }
    }
    if (RICH_TYPES.has(b.type)) for (const m of mentionedUsers(content.text)) mentions.add(m);
    const position = typeof b.position === 'number' ? b.position : nextBlockPosition(page.id, parentId);
    q.run(
      `INSERT INTO blocks (id, page_id, parent_block_id, type, content, position, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.id,
      page.id,
      parentId,
      b.type,
      JSON.stringify(content),
      position,
      user.id,
      t,
      user.id,
      t,
    );
    return { type: 'insert', block: rowFromBlock(q.get('SELECT * FROM blocks WHERE id = ?', b.id)) };
  }
  if (op.type === 'update') {
    const row = q.get('SELECT * FROM blocks WHERE id = ? AND page_id = ?', op.id, page.id);
    if (!row) return null; // deleted concurrently; ignore
    const set = op.set || {};
    const type = set.type && BLOCK_TYPES.has(set.type) ? set.type : row.type;
    if ((row.type === 'page' || row.type === 'child_database') && type !== row.type) throw badRequest('Cannot convert a page block');
    let content = json.parse(row.content, {});
    if (set.content !== undefined || type !== row.type) {
      const before = RICH_TYPES.has(row.type) ? mentionedUsers(content.text) : new Set();
      const merged = set.content !== undefined ? set.content : content;
      if (row.type === 'page' || row.type === 'child_database') merged.pageId = content.pageId;
      content = sanitizeContent(type, merged);
      if (RICH_TYPES.has(type)) for (const m of mentionedUsers(content.text)) if (!before.has(m)) mentions.add(m);
    }
    let parentId = row.parent_block_id;
    if (set.parentId !== undefined) {
      parentId = set.parentId || null;
      if (parentId) {
        if (parentId === row.id) throw badRequest('Invalid parent');
        if (!q.get('SELECT id FROM blocks WHERE id = ? AND page_id = ?', parentId, page.id)) throw badRequest('Parent block not found');
        // prevent cycles
        let cur = parentId;
        for (let g = 0; cur && g < 500; g++) {
          if (cur === row.id) throw badRequest('Cannot nest a block inside itself');
          cur = q.get('SELECT parent_block_id FROM blocks WHERE id = ?', cur)?.parent_block_id;
        }
      }
    }
    const position = typeof set.position === 'number' ? set.position : row.position;
    q.run(
      'UPDATE blocks SET type = ?, content = ?, parent_block_id = ?, position = ?, updated_by = ?, updated_at = ? WHERE id = ?',
      type,
      JSON.stringify(content),
      parentId,
      position,
      user.id,
      t,
      row.id,
    );
    return { type: 'update', id: row.id, block: rowFromBlock(q.get('SELECT * FROM blocks WHERE id = ?', row.id)) };
  }
  if (op.type === 'delete') {
    const row = q.get('SELECT * FROM blocks WHERE id = ? AND page_id = ?', op.id, page.id);
    if (!row) return null;
    const toDelete = [row];
    for (let i = 0; i < toDelete.length; i++) {
      toDelete.push(...q.all('SELECT * FROM blocks WHERE parent_block_id = ? AND page_id = ?', toDelete[i].id, page.id));
    }
    for (const b of toDelete) {
      if (b.type === 'page' || b.type === 'child_database') {
        const ref = json.parse(b.content, {}).pageId;
        const child = ref && q.get('SELECT * FROM pages WHERE id = ?', ref);
        if (child && child.parent_id === page.id && !child.deleted_at && !op.keepPage) {
          trashPage(user, child.id);
          sideEffects.trashed.push(child.id);
        }
      }
      q.run('DELETE FROM blocks WHERE id = ?', b.id);
    }
    return { type: 'delete', id: row.id };
  }
  throw badRequest('Unknown op ' + op.type);
}

/** Moves blocks (with their children) to the end of another page. */
r.post(
  '/pages/:id/move-blocks',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'edit');
    const target = assertPageRole(req.user, req.body?.targetPageId, 'edit').page;
    if (target.type !== 'page') throw badRequest('Blocks can only be moved into pages');
    const ids = Array.isArray(req.body?.blockIds) ? req.body.blockIds : [];
    tx(() => {
      let pos = nextBlockPosition(target.id);
      for (const id of ids) {
        const row = q.get('SELECT * FROM blocks WHERE id = ? AND page_id = ?', id, page.id);
        if (!row) continue;
        const all = [row];
        for (let i = 0; i < all.length; i++) all.push(...q.all('SELECT * FROM blocks WHERE parent_block_id = ?', all[i].id));
        for (const b of all) {
          if (b.type === 'page' || b.type === 'child_database') {
            const ref = json.parse(b.content, {}).pageId;
            q.run(`UPDATE pages SET parent_id = ?, parent_type = 'page' WHERE id = ? AND parent_id = ?`, target.id, ref, page.id);
          }
          q.run('UPDATE blocks SET page_id = ? WHERE id = ?', target.id, b.id);
        }
        q.run('UPDATE blocks SET parent_block_id = NULL, position = ? WHERE id = ?', pos++, row.id);
      }
      refreshSearchText(page.id);
      refreshSearchText(target.id);
      touchPage(page.id, req.user.id);
      touchPage(target.id, req.user.id);
    });
    toPage(page.id, { type: 'blocks.reload' }, clientId(req));
    toPage(target.id, { type: 'blocks.reload' });
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    res.json({ ok: true });
  }),
);

// ---------- Sharing ----------

function sharePayload(user, page) {
  const anc = ancestors(page.id);
  const root = anc[0] || page;
  const chain = [...anc, page];
  const byUser = new Map();
  for (const p of chain) {
    for (const perm of q.all(
      `SELECT pp.*, u.name, u.email, u.color, u.avatar_url FROM page_permissions pp JOIN users u ON u.id = pp.user_id WHERE pp.page_id = ?`,
      p.id,
    )) {
      const prev = byUser.get(perm.user_id);
      if (!prev || (ROLE_RANK[perm.role] || 0) >= (ROLE_RANK[prev.role] || 0)) {
        byUser.set(perm.user_id, {
          user: { id: perm.user_id, name: perm.name, email: perm.email, color: perm.color, avatarUrl: perm.avatar_url },
          role: perm.role,
          inheritedFrom: p.id === page.id ? null : { id: p.id, title: p.title, icon: p.icon },
          isGuest: !membership(page.workspace_id, perm.user_id),
        });
      }
    }
  }
  const owner = q.get('SELECT * FROM users WHERE id = ?', root.created_by);
  const invites = q
    .all('SELECT * FROM invites WHERE page_id = ?', page.id)
    .map((i) => ({ id: i.id, email: i.email, role: i.role }));
  const workspace = q.get('SELECT id, name, icon FROM workspaces WHERE id = ?', page.workspace_id);
  const publicAncestor = anc.find((p) => p.public);
  return {
    role: pageRole(user.id, page.id),
    visibility: root.visibility,
    rootId: root.id,
    isRoot: root.id === page.id,
    owner: root.visibility === 'private' ? publicUser(owner) : null,
    workspace,
    people: [...byUser.values()],
    invites,
    public: !!page.public,
    publicAncestor: publicAncestor ? { id: publicAncestor.id, title: publicAncestor.title } : null,
  };
}

r.get(
  '/pages/:id/permissions',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'view');
    res.json(sharePayload(req.user, page));
  }),
);

r.post(
  '/pages/:id/permissions',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'full');
    const emails = (Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.email]).map((e) => String(e || '').trim()).filter(Boolean);
    const role = ['full', 'edit', 'comment', 'view'].includes(req.body?.role) ? req.body.role : 'edit';
    if (!emails.length || !emails.every(isEmail)) throw badRequest('Enter a valid email address');
    tx(() => {
      for (const email of emails) {
        const u = q.get('SELECT * FROM users WHERE email = ?', email);
        if (u) {
          q.run(
            'INSERT OR REPLACE INTO page_permissions (page_id, user_id, role, granted_by, created_at) VALUES (?, ?, ?, ?, ?)',
            page.id,
            u.id,
            role,
            req.user.id,
            now(),
          );
          notify(u.id, { type: 'page_shared', workspaceId: page.workspace_id, actorId: req.user.id, pageId: page.id, data: { role } });
          toUser(u.id, { type: 'workspaces.changed' });
        } else if (!q.get('SELECT id FROM invites WHERE page_id = ? AND email = ?', page.id, email)) {
          q.run('INSERT INTO invites (id, workspace_id, email, page_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', uid(), page.workspace_id, email, page.id, role, req.user.id, now());
        }
      }
    });
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    res.status(201).json(sharePayload(req.user, page));
  }),
);

r.patch(
  '/pages/:id/permissions/:userId',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'full');
    const role = req.body?.role;
    if (!['full', 'edit', 'comment', 'view'].includes(role)) throw badRequest('Invalid role');
    const existing = q.get('SELECT * FROM page_permissions WHERE page_id = ? AND user_id = ?', page.id, req.params.userId);
    if (existing) q.run('UPDATE page_permissions SET role = ? WHERE page_id = ? AND user_id = ?', role, page.id, req.params.userId);
    else q.run('INSERT INTO page_permissions (page_id, user_id, role, granted_by, created_at) VALUES (?, ?, ?, ?, ?)', page.id, req.params.userId, role, req.user.id, now());
    toUser(req.params.userId, { type: 'workspaces.changed' });
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    res.json(sharePayload(req.user, page));
  }),
);

r.delete(
  '/pages/:id/permissions/:userId',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, req.params.userId === req.user.id ? 'view' : 'full');
    q.run('DELETE FROM page_permissions WHERE page_id = ? AND user_id = ?', page.id, req.params.userId);
    toUser(req.params.userId, { type: 'workspaces.changed' });
    toUser(req.params.userId, { type: 'access.revoked', pageId: page.id });
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    res.json(pageRole(req.user.id, page.id) ? sharePayload(req.user, page) : { ok: true });
  }),
);

r.delete(
  '/pages/:id/invites/:inviteId',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'full');
    q.run('DELETE FROM invites WHERE id = ? AND page_id = ?', req.params.inviteId, page.id);
    res.json(sharePayload(req.user, page));
  }),
);

/** General access for a top-level page: 'private' (only invited people) or 'workspace' (every member). */
r.patch(
  '/pages/:id/general-access',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'full');
    const visibility = req.body?.visibility === 'workspace' ? 'workspace' : 'private';
    const root = ancestors(page.id)[0] || page;
    requireMember(page.workspace_id, req.user.id);
    if (visibility === 'private' && root.created_by !== req.user.id) {
      q.run('UPDATE pages SET created_by = ? WHERE id = ?', req.user.id, root.id);
    }
    q.run('UPDATE pages SET visibility = ? WHERE id = ?', visibility, root.id);
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    res.json(sharePayload(req.user, page));
  }),
);

r.patch(
  '/pages/:id/publish',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'full');
    q.run('UPDATE pages SET public = ? WHERE id = ?', req.body?.public ? 1 : 0, page.id);
    toPage(page.id, { type: 'page.updated', page: serializePage(q.get('SELECT * FROM pages WHERE id = ?', page.id)) });
    res.json(sharePayload(req.user, q.get('SELECT * FROM pages WHERE id = ?', page.id)));
  }),
);

// ---------- Favorites ----------

r.post(
  '/pages/:id/favorite',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'view');
    const pos = (q.get('SELECT MAX(position) AS m FROM favorites WHERE user_id = ?', req.user.id)?.m ?? 0) + 1;
    q.run('INSERT OR IGNORE INTO favorites (user_id, page_id, position) VALUES (?, ?, ?)', req.user.id, page.id, pos);
    toUser(req.user.id, { type: 'favorites.changed', workspaceId: page.workspace_id });
    res.json({ ok: true });
  }),
);

r.delete(
  '/pages/:id/favorite',
  h((req, res) => {
    q.run('DELETE FROM favorites WHERE user_id = ? AND page_id = ?', req.user.id, req.params.id);
    toUser(req.user.id, { type: 'favorites.changed' });
    res.json({ ok: true });
  }),
);

r.post(
  '/favorites/reorder',
  h((req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    tx(() => ids.forEach((id, i) => q.run('UPDATE favorites SET position = ? WHERE user_id = ? AND page_id = ?', i + 1, req.user.id, id)));
    toUser(req.user.id, { type: 'favorites.changed' });
    res.json({ ok: true });
  }),
);

// ---------- History ----------

r.get(
  '/pages/:id/history',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'view');
    const rows = q.all(
      `SELECT s.id, s.title, s.icon, s.created_at, s.created_by, u.name, u.color FROM page_snapshots s LEFT JOIN users u ON u.id = s.created_by
       WHERE s.page_id = ? ORDER BY s.created_at DESC LIMIT 100`,
      page.id,
    );
    res.json({
      versions: rows.map((s) => ({ id: s.id, title: s.title, icon: s.icon, createdAt: s.created_at, author: s.created_by ? { id: s.created_by, name: s.name, color: s.color } : null })),
    });
  }),
);

r.get(
  '/pages/:id/history/:snapId',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'view');
    const s = q.get('SELECT * FROM page_snapshots WHERE id = ? AND page_id = ?', req.params.snapId, page.id);
    if (!s) throw notFound();
    const blocks = json.parse(s.blocks, []);
    res.json({ version: { id: s.id, title: s.title, icon: s.icon, createdAt: s.created_at, blocks }, pages: referencedPages(req.user, page.workspace_id, blocks) });
  }),
);

r.post(
  '/pages/:id/history/:snapId/restore',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'edit');
    const s = q.get('SELECT * FROM page_snapshots WHERE id = ? AND page_id = ?', req.params.snapId, page.id);
    if (!s) throw notFound();
    tx(() => {
      maybeSnapshot(page.id, req.user.id, true);
      const blocks = json.parse(s.blocks, []);
      q.run('DELETE FROM blocks WHERE page_id = ?', page.id);
      const t = now();
      for (const b of blocks) {
        if (b.type === 'page' || b.type === 'child_database') {
          const ref = q.get('SELECT * FROM pages WHERE id = ?', b.content?.pageId);
          if (!ref || ref.parent_id !== page.id) continue;
          if (ref.deleted_at) restorePage(req.user, ref.id);
          q.run(`DELETE FROM blocks WHERE page_id = ? AND json_extract(content, '$.pageId') = ? AND type IN ('page','child_database')`, page.id, ref.id);
        }
        q.run(
          `INSERT INTO blocks (id, page_id, parent_block_id, type, content, position, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          b.id,
          page.id,
          b.parentId,
          b.type,
          JSON.stringify(b.content || {}),
          b.position,
          b.createdBy || req.user.id,
          b.createdAt || t,
          req.user.id,
          t,
        );
      }
      q.run('UPDATE pages SET title = ?, icon = ?, updated_at = ?, updated_by = ? WHERE id = ?', s.title, s.icon, t, req.user.id, page.id);
      refreshSearchText(page.id);
    });
    toPage(page.id, { type: 'blocks.reload' });
    toWorkspace(page.workspace_id, { type: 'pages.changed' });
    res.json({ ok: true });
  }),
);

// ---------- Export ----------

r.get(
  '/pages/:id/export',
  h((req, res) => {
    const { page } = assertPageRole(req.user, req.params.id, 'view');
    const blocks = q.all('SELECT * FROM blocks WHERE page_id = ?', page.id).map(rowFromBlock);
    const titles = new Map();
    for (const b of blocks) if (b.content?.pageId) titles.set(b.content.pageId, q.get('SELECT title FROM pages WHERE id = ?', b.content.pageId)?.title);
    let md;
    if (page.type === 'database') {
      const schema = json.parse(page.schema, { properties: {}, order: [] });
      const rows = q.all('SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position', page.id);
      const cols = schema.order.map((id) => schema.properties[id]).filter(Boolean);
      const cell = (row, def) => {
        const props = json.parse(row.properties, {});
        if (def.type === 'title') return row.title;
        const v = props[def.id];
        if (v == null) return '';
        if (def.type === 'select' || def.type === 'status') return def.options?.find((o) => o.id === v)?.name || '';
        if (def.type === 'multi_select') return v.map((id) => def.options?.find((o) => o.id === id)?.name).filter(Boolean).join(', ');
        if (def.type === 'date') return v.start + (v.end ? ' → ' + v.end : '');
        if (def.type === 'checkbox') return v ? 'Yes' : 'No';
        if (Array.isArray(v)) return v.join(', ');
        return String(v).replace(/<[^>]+>/g, '');
      };
      md = `# ${page.title || 'Untitled'}\n\n| ${cols.map((c) => c.name).join(' | ')} |\n|${cols.map(() => ' --- ').join('|')}|\n` +
        rows.map((row) => '| ' + cols.map((c) => String(cell(row, c)).replace(/\|/g, '\\|')).join(' | ') + ' |').join('\n') + '\n';
    } else {
      md = blocksToMarkdown(page.title, blocks, titles);
    }
    const name = (page.title || 'Untitled').replace(/[^\w\- ]+/g, '').trim() || 'Untitled';
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.md"`);
    res.send(md);
  }),
);

// ---------- Link previews for bookmark blocks ----------

r.post(
  '/link-preview',
  h(async (req, res) => {
    const url = safeUrl(req.body?.url);
    if (!url || !/^https?:/i.test(url)) throw badRequest('Invalid URL');
    const out = { url, title: null, description: null, image: null };
    try {
      const host = new URL(url).hostname;
      if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host.endsWith('.local')) throw new Error('private address');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (NotionClone link preview)' } });
      clearTimeout(timer);
      const html = (await resp.text()).slice(0, 500000);
      const meta = (name) => {
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
        const m = html.match(re);
        return m ? (m[1] || m[2]) : null;
      };
      const decode = (s) => s && s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      out.title = decode(meta('og:title') || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || null);
      out.description = decode(meta('og:description') || meta('description'));
      const img = meta('og:image');
      if (img) out.image = new URL(img, url).toString();
    } catch {
      // Offline or blocked: the bookmark still works with just the URL.
    }
    res.json(out);
  }),
);

export default r;
