import { Router } from 'express';
import { q, tx, json } from '../db.js';
import { h, badRequest, notFound } from '../lib/util.js';
import { requireUser } from '../auth.js';
import { assertPageRole, workspaceRoles } from '../permissions.js';
import { serializePage, serializeView, createView, workspacePeople, pageMeta } from '../services.js';
import { PROPERTY_TYPES, newPropertyDef, sanitizePropertyDef } from '../lib/database.js';
import { toPage } from '../realtime.js';

const r = Router();
r.use(requireUser);

const clientId = (req) => req.headers['x-client-id'] || null;

function loadDatabase(user, id, min) {
  const { page, role } = assertPageRole(user, id, min);
  if (page.type !== 'database') throw badRequest('Not a database');
  return { db: page, role, schema: json.parse(page.schema, { properties: {}, order: [] }) };
}

function saveSchema(dbId, schema) {
  q.run('UPDATE pages SET schema = ?, updated_at = ? WHERE id = ?', JSON.stringify(schema), Date.now(), dbId);
}

r.get(
  '/databases/:id',
  h((req, res) => {
    const { db, role, schema } = loadDatabase(req.user, req.params.id, 'view');
    const views = q.all('SELECT * FROM db_views WHERE database_id = ? ORDER BY position', db.id).map(serializeView);
    const rows = q.all('SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position', db.id);
    // Content previews for gallery cards / "page has content" indicators.
    const previews = {};
    for (const row of rows) {
      const blocks = q.all('SELECT type, content FROM blocks WHERE page_id = ? AND parent_block_id IS NULL ORDER BY position LIMIT 8', row.id);
      previews[row.id] = blocks.map((b) => ({ type: b.type, content: json.parse(b.content, {}) }));
    }
    // Related databases (relation properties) — titles of related pages and their rows for rollups.
    const related = {};
    const roles = workspaceRoles(db.workspace_id, req.user.id);
    for (const def of Object.values(schema.properties)) {
      if (def.type !== 'relation' || !def.databaseId || related[def.databaseId]) continue;
      const target = q.get('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL', def.databaseId);
      if (!target || !roles.has(target.id)) continue;
      related[target.id] = {
        database: { id: target.id, title: target.title, icon: target.icon, schema: json.parse(target.schema, null) },
        rows: q.all('SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position', target.id).map((p) => serializePage(p)),
      };
    }
    const parent = db.parent_id ? q.get('SELECT * FROM pages WHERE id = ?', db.parent_id) : null;
    res.json({
      database: serializePage(db),
      role,
      views,
      rows: rows.map((p) => serializePage(p)),
      previews,
      related,
      people: workspacePeople(db.workspace_id),
      parent: parent && roles.has(parent.id) ? pageMeta(parent) : null,
    });
  }),
);

// ---------- Properties ----------

r.post(
  '/databases/:id/properties',
  h((req, res) => {
    const { db, schema } = loadDatabase(req.user, req.params.id, 'edit');
    const type = req.body?.type;
    if (!PROPERTY_TYPES.includes(type) || type === 'title') throw badRequest('Invalid property type');
    const baseName = String(req.body?.name || '').trim() || defaultName(type);
    let name = baseName;
    const names = new Set(Object.values(schema.properties).map((p) => p.name));
    for (let i = 1; names.has(name); i++) name = `${baseName} ${i}`;
    const def = newPropertyDef(type, name);
    if (req.body?.options) Object.assign(def, sanitizePropertyDef(def, { options: req.body.options }));
    if (type === 'relation' && req.body?.databaseId) def.databaseId = String(req.body.databaseId);
    schema.properties[def.id] = def;
    const idx = typeof req.body?.index === 'number' ? Math.max(0, Math.min(schema.order.length, req.body.index)) : schema.order.length;
    schema.order.splice(idx, 0, def.id);
    tx(() => {
      saveSchema(db.id, schema);
      // make the new property visible in every view
      for (const v of q.all('SELECT * FROM db_views WHERE database_id = ?', db.id)) {
        const cfg = json.parse(v.config, {});
        cfg.properties = cfg.properties || [];
        if (!cfg.properties.some((p) => p.id === def.id)) {
          const vis = req.body?.viewId ? v.id === req.body.viewId || v.type === 'table' : v.type === 'table';
          cfg.properties.push({ id: def.id, visible: vis });
        }
        if (v.id === req.body?.viewId) {
          const i = cfg.properties.findIndex((p) => p.id === def.id);
          cfg.properties[i].visible = true;
          if (typeof req.body?.viewIndex === 'number') {
            const [item] = cfg.properties.splice(i, 1);
            cfg.properties.splice(Math.max(0, Math.min(cfg.properties.length, req.body.viewIndex)), 0, item);
          }
        }
        q.run('UPDATE db_views SET config = ? WHERE id = ?', JSON.stringify(cfg), v.id);
      }
    });
    toPage(db.id, { type: 'db.changed' }, clientId(req));
    res.status(201).json({ property: def, schema });
  }),
);

function defaultName(type) {
  const map = {
    text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select', status: 'Status', date: 'Date',
    person: 'Person', files: 'Files & media', checkbox: 'Checkbox', url: 'URL', email: 'Email', phone: 'Phone',
    formula: 'Formula', relation: 'Relation', rollup: 'Rollup', created_time: 'Created time', created_by: 'Created by',
    last_edited_time: 'Last edited time', last_edited_by: 'Last edited by', unique_id: 'ID',
  };
  return map[type] || 'Property';
}

r.patch(
  '/databases/:id/properties/:propId',
  h((req, res) => {
    const { db, schema } = loadDatabase(req.user, req.params.id, 'edit');
    const existing = schema.properties[req.params.propId];
    if (!existing) throw notFound('Property not found');
    const next = sanitizePropertyDef(existing, req.body || {});
    // Assign sequential ids to existing rows when a property becomes a unique ID.
    tx(() => {
      if (next.type === 'unique_id' && existing.type !== 'unique_id') {
        const rows = q.all('SELECT id, properties FROM pages WHERE parent_id = ? ORDER BY created_at', db.id);
        let n = 1;
        for (const row of rows) {
          const props = json.parse(row.properties, {});
          props[next.id] = n++;
          q.run('UPDATE pages SET properties = ? WHERE id = ?', JSON.stringify(props), row.id);
        }
        next.next = n;
      }
      // Changing type or removing options clears incompatible stored values.
      if (next.type !== existing.type || req.body?.options) {
        const optionIds = new Set((next.options || []).map((o) => o.id));
        const rows = q.all('SELECT id, properties FROM pages WHERE parent_id = ?', db.id);
        for (const row of rows) {
          const props = json.parse(row.properties, {});
          if (!(next.id in props)) continue;
          const v = props[next.id];
          let nv = v;
          if (next.type !== existing.type) nv = convertValue(existing, next, v);
          else if (next.type === 'select' || next.type === 'status') nv = optionIds.has(v) ? v : null;
          else if (next.type === 'multi_select') nv = (v || []).filter((x) => optionIds.has(x));
          if (JSON.stringify(nv) !== JSON.stringify(v)) {
            props[next.id] = nv;
            q.run('UPDATE pages SET properties = ? WHERE id = ?', JSON.stringify(props), row.id);
          }
        }
      }
      schema.properties[next.id] = next;
      saveSchema(db.id, schema);
    });
    toPage(db.id, { type: 'db.changed' }, clientId(req));
    res.json({ property: next, schema });
  }),
);

function convertValue(from, to, v) {
  if (v == null) return null;
  const optName = (id) => from.options?.find((o) => o.id === id)?.name;
  const textOf = () => {
    if (from.type === 'select' || from.type === 'status') return optName(v) || '';
    if (from.type === 'multi_select') return (v || []).map(optName).filter(Boolean).join(', ');
    if (from.type === 'date') return v.start || '';
    if (typeof v === 'object') return '';
    return String(v).replace(/<[^>]+>/g, '');
  };
  switch (to.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return textOf();
    case 'number': {
      const n = parseFloat(textOf());
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return ['true', 'yes', '1', 'checked'].includes(textOf().toLowerCase()) || v === true;
    case 'select':
    case 'status': {
      const name = textOf().split(',')[0]?.trim();
      return to.options?.find((o) => o.name === name)?.id || null;
    }
    case 'multi_select': {
      const names = textOf().split(',').map((s) => s.trim());
      return (to.options || []).filter((o) => names.includes(o.name)).map((o) => o.id);
    }
    default:
      return null;
  }
}

r.delete(
  '/databases/:id/properties/:propId',
  h((req, res) => {
    const { db, schema } = loadDatabase(req.user, req.params.id, 'edit');
    const def = schema.properties[req.params.propId];
    if (!def) throw notFound('Property not found');
    if (def.type === 'title') throw badRequest('The title property cannot be deleted');
    delete schema.properties[def.id];
    schema.order = schema.order.filter((id) => id !== def.id);
    tx(() => {
      saveSchema(db.id, schema);
      for (const v of q.all('SELECT * FROM db_views WHERE database_id = ?', db.id)) {
        const cfg = json.parse(v.config, {});
        cfg.properties = (cfg.properties || []).filter((p) => p.id !== def.id);
        cfg.filters = (cfg.filters || []).filter((f) => f.property !== def.id);
        cfg.sorts = (cfg.sorts || []).filter((s) => s.property !== def.id);
        if (cfg.groupBy === def.id) cfg.groupBy = null;
        if (cfg.dateBy === def.id) cfg.dateBy = null;
        q.run('UPDATE db_views SET config = ? WHERE id = ?', JSON.stringify(cfg), v.id);
      }
    });
    toPage(db.id, { type: 'db.changed' }, clientId(req));
    res.json({ schema });
  }),
);

r.post(
  '/databases/:id/properties/:propId/duplicate',
  h((req, res) => {
    const { db, schema } = loadDatabase(req.user, req.params.id, 'edit');
    const def = schema.properties[req.params.propId];
    if (!def || def.type === 'title') throw badRequest('Cannot duplicate this property');
    const copy = { ...newPropertyDef(def.type, def.name + ' (1)'), ...JSON.parse(JSON.stringify(def)) };
    copy.id = newPropertyDef(def.type).id;
    copy.name = def.name + ' (1)';
    schema.properties[copy.id] = copy;
    schema.order.splice(schema.order.indexOf(def.id) + 1, 0, copy.id);
    tx(() => {
      saveSchema(db.id, schema);
      for (const row of q.all('SELECT id, properties FROM pages WHERE parent_id = ?', db.id)) {
        const props = json.parse(row.properties, {});
        if (def.id in props) {
          props[copy.id] = props[def.id];
          q.run('UPDATE pages SET properties = ? WHERE id = ?', JSON.stringify(props), row.id);
        }
      }
      for (const v of q.all('SELECT * FROM db_views WHERE database_id = ?', db.id)) {
        const cfg = json.parse(v.config, {});
        const i = (cfg.properties || []).findIndex((p) => p.id === def.id);
        if (i >= 0) cfg.properties.splice(i + 1, 0, { id: copy.id, visible: cfg.properties[i].visible });
        q.run('UPDATE db_views SET config = ? WHERE id = ?', JSON.stringify(cfg), v.id);
      }
    });
    toPage(db.id, { type: 'db.changed' }, clientId(req));
    res.status(201).json({ property: copy, schema });
  }),
);

// ---------- Views ----------

r.post(
  '/databases/:id/views',
  h((req, res) => {
    const { db } = loadDatabase(req.user, req.params.id, 'edit');
    const type = req.body?.type;
    if (!['table', 'board', 'list', 'gallery', 'calendar', 'timeline'].includes(type)) throw badRequest('Invalid view type');
    let config = req.body?.config;
    if (req.body?.duplicateOf) {
      const src = q.get('SELECT * FROM db_views WHERE id = ? AND database_id = ?', req.body.duplicateOf, db.id);
      if (src) config = json.parse(src.config, {});
    }
    const view = createView(db.id, { name: String(req.body?.name || '').slice(0, 200) || undefined, type, config });
    toPage(db.id, { type: 'db.changed' }, clientId(req));
    res.status(201).json({ view: serializeView(view) });
  }),
);

function loadView(user, viewId, min) {
  const v = q.get('SELECT * FROM db_views WHERE id = ?', viewId);
  if (!v) throw notFound('View not found');
  const { db } = loadDatabase(user, v.database_id, min);
  return { view: v, db };
}

r.patch(
  '/views/:id',
  h((req, res) => {
    const { view, db } = loadView(req.user, req.params.id, 'edit');
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).slice(0, 200) || view.name : view.name;
    const type = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline'].includes(b.type) ? b.type : view.type;
    let config = json.parse(view.config, {});
    if (b.config && typeof b.config === 'object') config = { ...config, ...b.config };
    if (type !== view.type) {
      const schema = json.parse(db.schema, { properties: {}, order: [] });
      const props = schema.properties;
      if (type === 'board' && !config.groupBy) config.groupBy = schema.order.find((id) => ['status', 'select'].includes(props[id]?.type)) || null;
      if ((type === 'calendar' || type === 'timeline') && !config.dateBy) config.dateBy = schema.order.find((id) => props[id]?.type === 'date') || null;
    }
    const position = typeof b.position === 'number' ? b.position : view.position;
    q.run('UPDATE db_views SET name = ?, type = ?, config = ?, position = ? WHERE id = ?', name, type, JSON.stringify(config).slice(0, 200000), position, view.id);
    toPage(db.id, { type: 'db.changed' }, clientId(req));
    res.json({ view: serializeView(q.get('SELECT * FROM db_views WHERE id = ?', view.id)) });
  }),
);

r.delete(
  '/views/:id',
  h((req, res) => {
    const { view, db } = loadView(req.user, req.params.id, 'edit');
    const count = q.get('SELECT COUNT(*) AS c FROM db_views WHERE database_id = ?', db.id).c;
    if (count <= 1) throw badRequest('A database needs at least one view');
    q.run('DELETE FROM db_views WHERE id = ?', view.id);
    toPage(db.id, { type: 'db.changed' }, clientId(req));
    res.json({ ok: true });
  }),
);

/** Reorders rows (manual sort) — body: { ids: [...] } in the desired order. */
r.post(
  '/databases/:id/reorder',
  h((req, res) => {
    const { db } = loadDatabase(req.user, req.params.id, 'edit');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    tx(() => ids.forEach((id, i) => q.run('UPDATE pages SET position = ? WHERE id = ? AND parent_id = ?', i + 1, id, db.id)));
    toPage(db.id, { type: 'db.changed' }, clientId(req));
    res.json({ ok: true });
  }),
);

export default r;
