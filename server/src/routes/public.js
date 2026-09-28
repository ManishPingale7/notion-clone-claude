import { Router } from 'express';
import { q, json } from '../db.js';
import { h, notFound } from '../lib/util.js';
import { isPublic } from '../permissions.js';
import { serializePage, serializeView, pageMeta, ancestors } from '../services.js';
import { rowFromBlock } from '../lib/blocks.js';
import { publicUser } from '../auth.js';

// Read-only access to pages that were published with "Publish to web".
const r = Router();

r.get(
  '/pages/:id',
  h((req, res) => {
    const page = q.get('SELECT * FROM pages WHERE id = ?', req.params.id);
    if (!page || page.deleted_at || !isPublic(page.id)) throw notFound('This page is not published');
    const blocks = q.all('SELECT * FROM blocks WHERE page_id = ? ORDER BY position', page.id).map(rowFromBlock);
    const pages = {};
    for (const b of blocks) {
      const id = b.content?.pageId;
      if (id) {
        const p = q.get('SELECT * FROM pages WHERE id = ?', id);
        if (p && !p.deleted_at) pages[id] = { ...pageMeta(p), noAccess: !isPublic(id) };
      }
      for (const m of JSON.stringify(b.content).match(/data-id=\\"([0-9a-f-]{36})\\"/g) || []) {
        const mid = m.slice(10, 46);
        const p = q.get('SELECT * FROM pages WHERE id = ?', mid);
        if (p) pages[mid] = isPublic(mid) ? pageMeta(p) : { id: mid, noAccess: true };
      }
    }
    let database = null;
    let data = null;
    if (page.parent_type === 'database') {
      const db = q.get('SELECT * FROM pages WHERE id = ?', page.parent_id);
      database = { id: db.id, title: db.title, icon: db.icon, schema: json.parse(db.schema, null) };
    }
    if (page.type === 'database') data = databasePayload(page);
    const inline = {};
    for (const b of blocks) {
      if (b.type === 'child_database' && b.content?.pageId) {
        const db = q.get('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL', b.content.pageId);
        if (db) inline[db.id] = databasePayload(db);
      }
    }
    const anc = ancestors(page.id).filter((p) => isPublic(p.id)).map(pageMeta);
    const workspace = q.get('SELECT id, name, icon FROM workspaces WHERE id = ?', page.workspace_id);
    res.json({ page: serializePage(page), blocks, pages, database, data, inline, ancestors: anc, workspace });
  }),
);

function databasePayload(db) {
  const people = q
    .all('SELECT u.* FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?', db.workspace_id)
    .map((u) => ({ ...publicUser(u), email: undefined }));
  return {
    database: serializePage(db),
    role: 'view',
    views: q.all('SELECT * FROM db_views WHERE database_id = ? ORDER BY position', db.id).map(serializeView),
    rows: q.all('SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position', db.id).map((p) => serializePage(p)),
    previews: {},
    related: {},
    people,
  };
}

export default r;
