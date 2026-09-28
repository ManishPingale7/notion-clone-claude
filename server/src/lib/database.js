import crypto from 'node:crypto';
import { sanitizeRich, safeUrl } from './richtext.js';

export const PROPERTY_TYPES = [
  'title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'files', 'checkbox',
  'url', 'email', 'phone', 'formula', 'relation', 'rollup', 'created_time', 'created_by', 'last_edited_time',
  'last_edited_by', 'unique_id',
];

export const COMPUTED_TYPES = new Set(['formula', 'rollup', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by']);

const shortId = () => crypto.randomBytes(4).toString('hex');

export function defaultStatusOptions() {
  return [
    { id: 'not-started', name: 'Not started', color: 'default', group: 'todo' },
    { id: 'in-progress', name: 'In progress', color: 'blue', group: 'in_progress' },
    { id: 'done', name: 'Done', color: 'green', group: 'complete' },
  ];
}

export function defaultSchema() {
  const tags = shortId();
  return {
    properties: {
      title: { id: 'title', name: 'Name', type: 'title' },
      [tags]: { id: tags, name: 'Tags', type: 'multi_select', options: [] },
    },
    order: ['title', tags],
  };
}

export function defaultViewConfig(type, schema) {
  const order = schema?.order || ['title'];
  const props = schema?.properties || {};
  const cfg = {
    properties: order.map((id) => ({ id, visible: type === 'table' || id === 'title' || type === 'list' ? true : ['select', 'status', 'multi_select', 'person', 'date'].includes(props[id]?.type) })),
    filters: [],
    filterOp: 'and',
    sorts: [],
  };
  if (type === 'list') cfg.properties = order.map((id) => ({ id, visible: id === 'title' || ['select', 'status', 'multi_select', 'date'].includes(props[id]?.type) }));
  if (type === 'board') {
    const g = order.find((id) => props[id]?.type === 'status') || order.find((id) => props[id]?.type === 'select');
    cfg.groupBy = g || null;
    cfg.cardPreview = 'none';
    cfg.cardSize = 'medium';
  }
  if (type === 'gallery') {
    cfg.cardPreview = 'content';
    cfg.cardSize = 'medium';
  }
  if (type === 'calendar' || type === 'timeline') {
    cfg.dateBy = order.find((id) => props[id]?.type === 'date') || null;
  }
  return cfg;
}

export function newPropertyDef(type, name) {
  const id = shortId();
  const def = { id, name: name || 'Property', type };
  if (type === 'select' || type === 'multi_select') def.options = [];
  if (type === 'status') def.options = defaultStatusOptions();
  if (type === 'number') def.format = 'number';
  if (type === 'formula') def.expression = '';
  if (type === 'unique_id') {
    def.prefix = '';
    def.next = 1;
  }
  if (type === 'relation') def.databaseId = null;
  if (type === 'rollup') {
    def.relation = null;
    def.target = null;
    def.fn = 'show_original';
  }
  if (type === 'date') def.dateFormat = 'relative';
  return def;
}

const str = (v, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Sanitizes a raw property value according to its definition. Returns undefined to drop. */
export function sanitizeValue(def, value) {
  if (value === null || value === undefined) return null;
  switch (def.type) {
    case 'text':
      return sanitizeRich(str(value, 20000));
    case 'number': {
      if (value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'select':
    case 'status':
      return typeof value === 'string' && (def.options || []).some((o) => o.id === value) ? value : null;
    case 'multi_select':
      return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && (def.options || []).some((o) => o.id === v)) : [];
    case 'date': {
      if (typeof value !== 'object' || !value.start) return null;
      const out = { start: str(value.start, 40) };
      if (value.end) out.end = str(value.end, 40);
      if (value.includeTime) out.includeTime = true;
      return out;
    }
    case 'person':
    case 'relation':
      return Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, 100) : [];
    case 'files':
      return Array.isArray(value)
        ? value.slice(0, 50).map((f) => ({ name: str(f?.name, 300) || 'file', url: safeUrl(f?.url) })).filter((f) => f.url)
        : [];
    case 'checkbox':
      return !!value;
    case 'url':
      return str(value, 2000);
    case 'email':
    case 'phone':
      return str(value, 300);
    case 'unique_id':
      return typeof value === 'number' ? value : undefined;
    default:
      return undefined; // computed / title
  }
}

export function sanitizePropertyDef(existing, patch) {
  const def = { ...existing };
  if (typeof patch.name === 'string') def.name = patch.name.slice(0, 200) || def.name;
  if (patch.type && PROPERTY_TYPES.includes(patch.type) && patch.type !== 'title' && def.type !== 'title' && patch.type !== def.type) {
    const fresh = newPropertyDef(patch.type, def.name);
    Object.assign(def, { ...fresh, id: def.id, name: def.name });
    // keep options when switching between option-based types
    if (['select', 'multi_select'].includes(patch.type) && existing.options && existing.type !== 'status') def.options = existing.options;
  }
  if (Array.isArray(patch.options)) {
    def.options = patch.options.slice(0, 500).map((o) => ({
      id: str(o.id, 64) || shortId(),
      name: str(o.name, 200),
      color: str(o.color, 30) || 'default',
      ...(def.type === 'status' ? { group: ['todo', 'in_progress', 'complete'].includes(o.group) ? o.group : 'todo' } : {}),
    }));
  }
  for (const key of ['format', 'expression', 'prefix', 'databaseId', 'relation', 'target', 'fn', 'dateFormat', 'timeFormat']) {
    if (key in patch) def[key] = typeof patch[key] === 'string' || patch[key] === null ? (patch[key] ?? null) : def[key];
  }
  if ('showAs' in patch) def.showAs = patch.showAs === 'checkbox' || patch.showAs === 'select' ? patch.showAs : 'select';
  if ('wrap' in patch) def.wrap = !!patch.wrap;
  return def;
}
