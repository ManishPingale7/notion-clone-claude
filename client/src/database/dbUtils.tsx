import React from 'react';
import {
  Type, AlignLeft, Hash, CircleChevronDown, List, Loader, Calendar, Users, Paperclip, CheckSquare, Link, AtSign, Phone,
  Sigma, ArrowUpRight, Search, Clock, UserCircle, Fingerprint,
} from 'lucide-react';
import type { DatabaseData, DbSchema, Filter, Page, PropertyDef, PropertyType, Sort, User, ViewConfig } from '../types';
import { evaluate, fstr, type FVal } from './formula';
import { formatDateValue, formatNumber, htmlToText, parseISODate, toISODate } from '../lib/format';

const I = (C: any) => <C size={16} strokeWidth={1.6} />;

export const PROPERTY_TYPES: { type: PropertyType; label: string; icon: React.ReactNode; group?: string }[] = [
  { type: 'text', label: 'Text', icon: I(AlignLeft) },
  { type: 'number', label: 'Number', icon: I(Hash) },
  { type: 'select', label: 'Select', icon: I(CircleChevronDown) },
  { type: 'multi_select', label: 'Multi-select', icon: I(List) },
  { type: 'status', label: 'Status', icon: I(Loader) },
  { type: 'date', label: 'Date', icon: I(Calendar) },
  { type: 'person', label: 'Person', icon: I(Users) },
  { type: 'files', label: 'Files & media', icon: I(Paperclip) },
  { type: 'checkbox', label: 'Checkbox', icon: I(CheckSquare) },
  { type: 'url', label: 'URL', icon: I(Link) },
  { type: 'email', label: 'Email', icon: I(AtSign) },
  { type: 'phone', label: 'Phone', icon: I(Phone) },
  { type: 'formula', label: 'Formula', icon: I(Sigma), group: 'Advanced' },
  { type: 'relation', label: 'Relation', icon: I(ArrowUpRight), group: 'Advanced' },
  { type: 'rollup', label: 'Rollup', icon: I(Search), group: 'Advanced' },
  { type: 'created_time', label: 'Created time', icon: I(Clock), group: 'Advanced' },
  { type: 'created_by', label: 'Created by', icon: I(UserCircle), group: 'Advanced' },
  { type: 'last_edited_time', label: 'Last edited time', icon: I(Clock), group: 'Advanced' },
  { type: 'last_edited_by', label: 'Last edited by', icon: I(UserCircle), group: 'Advanced' },
  { type: 'unique_id', label: 'ID', icon: I(Fingerprint), group: 'Advanced' },
];

export function propIcon(type: PropertyType) {
  if (type === 'title') return I(Type);
  return PROPERTY_TYPES.find((p) => p.type === type)?.icon || I(AlignLeft);
}

export const COMPUTED = new Set<PropertyType>(['formula', 'rollup', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id']);

export interface DbCtx {
  schema: DbSchema;
  people: Map<string, User>;
  related: DatabaseData['related'];
  rowsById?: Map<string, Page>;
}

export function makeCtx(data: DatabaseData, schema?: DbSchema): DbCtx {
  const rowsById = new Map<string, Page>();
  for (const r of data.rows) rowsById.set(r.id, r);
  return { schema: schema || data.database.schema!, people: new Map(data.people.map((p) => [p.id, p])), related: data.related, rowsById };
}

/** Raw value of a property on a row (computes derived properties). */
export function getValue(row: Page, def: PropertyDef, ctx: DbCtx, depth = 0): any {
  switch (def.type) {
    case 'title':
      return row.title;
    case 'created_time':
      return row.createdAt;
    case 'last_edited_time':
      return row.updatedAt;
    case 'created_by':
      return row.createdBy ? [row.createdBy] : [];
    case 'last_edited_by':
      return row.updatedBy ? [row.updatedBy] : [];
    case 'formula':
      return formulaValue(row, def, ctx, depth);
    case 'rollup':
      return rollupValue(row, def, ctx);
    default:
      return row.properties[def.id];
  }
}

function formulaInput(row: Page, def: PropertyDef, ctx: DbCtx, depth: number): FVal {
  const v = getValue(row, def, ctx, depth + 1);
  switch (def.type) {
    case 'title':
    case 'url':
    case 'email':
    case 'phone':
      return v ?? '';
    case 'text':
      return htmlToText(v || '');
    case 'number':
      return typeof v === 'number' ? v : null;
    case 'checkbox':
      return !!v;
    case 'select':
    case 'status':
      return def.options?.find((o) => o.id === v)?.name ?? '';
    case 'multi_select':
      return (v || []).map((id: string) => def.options?.find((o) => o.id === id)?.name).filter(Boolean);
    case 'date':
      return v?.start ? parseISODate(v.start) : null;
    case 'created_time':
    case 'last_edited_time':
      return new Date(v);
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return (v || []).map((id: string) => ctx.people.get(id)?.name || '');
    case 'relation':
      return (v || []).map((id: string) => relatedTitle(ctx, def, id));
    case 'unique_id':
      return typeof v === 'number' ? (def.prefix ? `${def.prefix}-${v}` : v) : null;
    default:
      return v ?? null;
  }
}

function formulaValue(row: Page, def: PropertyDef, ctx: DbCtx, depth: number): FVal | { error: string } {
  if (depth > 5) return { error: 'Circular reference' };
  try {
    return evaluate(def.expression || '', (name) => {
      if (name === '__id') return row.id;
      const target = Object.values(ctx.schema.properties).find((p) => p.name === name);
      if (!target) throw new Error(`Property "${name}" not found`);
      return formulaInput(row, target, ctx, depth);
    });
  } catch (e: any) {
    return { error: e.message };
  }
}

function relatedTitle(ctx: DbCtx, def: PropertyDef, id: string) {
  const rel = def.databaseId ? ctx.related[def.databaseId] : null;
  return rel?.rows.find((r) => r.id === id)?.title || ctx.rowsById?.get(id)?.title || 'Untitled';
}

function rollupValue(row: Page, def: PropertyDef, ctx: DbCtx): FVal {
  const relDef = def.relation ? ctx.schema.properties[def.relation] : null;
  if (!relDef || relDef.type !== 'relation' || !relDef.databaseId) return null;
  const rel = ctx.related[relDef.databaseId];
  if (!rel) return null;
  const ids: string[] = row.properties[relDef.id] || [];
  const targets = ids.map((id) => rel.rows.find((r) => r.id === id)).filter(Boolean) as Page[];
  const tdef = def.target === 'title' || !def.target ? rel.database.schema.properties.title : rel.database.schema.properties[def.target];
  if (!tdef) return null;
  const tctx: DbCtx = { schema: rel.database.schema, people: ctx.people, related: {} };
  const values = targets.map((t) => formulaInput(t, tdef, tctx, 3));
  const flat = values.flatMap((v) => (Array.isArray(v) ? v : [v]));
  const nums = flat.map((v) => (typeof v === 'number' ? v : v instanceof Date ? v.getTime() : parseFloat(String(v)))).filter((n) => Number.isFinite(n));
  switch (def.fn) {
    case 'count':
      return targets.length;
    case 'count_values':
      return flat.filter((v) => v !== null && v !== '' && v !== false).length;
    case 'count_unique':
      return new Set(flat.map((v) => fstr(v))).size;
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'average':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case 'min':
      return nums.length ? Math.min(...nums) : null;
    case 'max':
      return nums.length ? Math.max(...nums) : null;
    case 'percent_checked':
      return flat.length ? `${Math.round((flat.filter((v) => v === true).length / flat.length) * 100)}%` : '0%';
    case 'percent_empty':
      return flat.length ? `${Math.round((flat.filter((v) => v === null || v === '').length / flat.length) * 100)}%` : '0%';
    default:
      return flat.filter((v) => v !== null && v !== '');
  }
}

/** Plain-text representation used for search, sort, CSV-like display. */
export function valueText(row: Page, def: PropertyDef, ctx: DbCtx): string {
  const v = getValue(row, def, ctx);
  if (v === null || v === undefined) return '';
  switch (def.type) {
    case 'title':
      return v || '';
    case 'text':
      return htmlToText(v);
    case 'number':
      return formatNumber(v, def.format);
    case 'select':
    case 'status':
      return def.options?.find((o) => o.id === v)?.name || '';
    case 'multi_select':
      return (v as string[]).map((id) => def.options?.find((o) => o.id === id)?.name).filter(Boolean).join(', ');
    case 'date':
      return formatDateValue(v, def.dateFormat || 'full');
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return (v as string[]).map((id) => ctx.people.get(id)?.name || 'Unknown').join(', ');
    case 'checkbox':
      return v ? 'true' : 'false';
    case 'files':
      return (v as { name: string }[]).map((f) => f.name).join(', ');
    case 'relation':
      return (v as string[]).map((id) => relatedTitle(ctx, def, id)).join(', ');
    case 'created_time':
    case 'last_edited_time':
      return new Date(v).toLocaleString();
    case 'unique_id':
      return def.prefix ? `${def.prefix}-${v}` : String(v);
    case 'formula':
    case 'rollup':
      if (v && typeof v === 'object' && 'error' in v) return '';
      return fstr(v as FVal);
    default:
      return String(v);
  }
}

function isEmptyValue(v: any) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && 'start' in v && !v.start);
}

// ---------- Filters ----------

export function operatorsFor(type: PropertyType): { op: string; label: string; noValue?: boolean }[] {
  const empty = [
    { op: 'is_empty', label: 'Is empty', noValue: true },
    { op: 'is_not_empty', label: 'Is not empty', noValue: true },
  ];
  switch (type) {
    case 'number':
      return [
        { op: 'eq', label: '=' }, { op: 'neq', label: '≠' }, { op: 'gt', label: '>' }, { op: 'lt', label: '<' },
        { op: 'gte', label: '≥' }, { op: 'lte', label: '≤' }, ...empty,
      ];
    case 'select':
    case 'status':
      return [{ op: 'is', label: 'Is' }, { op: 'is_not', label: 'Is not' }, ...empty];
    case 'multi_select':
    case 'person':
    case 'relation':
    case 'created_by':
    case 'last_edited_by':
    case 'files':
      return [{ op: 'contains', label: 'Contains' }, { op: 'not_contains', label: 'Does not contain' }, ...empty];
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return [
        { op: 'date_is', label: 'Is' }, { op: 'before', label: 'Is before' }, { op: 'after', label: 'Is after' },
        { op: 'on_or_before', label: 'Is on or before' }, { op: 'on_or_after', label: 'Is on or after' },
        { op: 'this_week', label: 'Is this week', noValue: true }, { op: 'past', label: 'Is in the past', noValue: true },
        { op: 'future', label: 'Is in the future', noValue: true }, ...empty,
      ];
    case 'checkbox':
      return [{ op: 'checked', label: 'Is checked', noValue: true }, { op: 'unchecked', label: 'Is not checked', noValue: true }];
    default:
      return [
        { op: 'contains', label: 'Contains' }, { op: 'not_contains', label: 'Does not contain' }, { op: 'is', label: 'Is' },
        { op: 'is_not', label: 'Is not' }, { op: 'starts_with', label: 'Starts with' }, { op: 'ends_with', label: 'Ends with' }, ...empty,
      ];
  }
}

function dayOf(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    const d = new Date(v);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (v.start) return parseISODate(v.start.slice(0, 10)).getTime();
  if (typeof v === 'string' && v) return parseISODate(v.slice(0, 10)).getTime();
  return null;
}

export function matchesFilter(row: Page, f: Filter, ctx: DbCtx): boolean {
  const def = ctx.schema.properties[f.property];
  if (!def) return true;
  const raw = getValue(row, def, ctx);
  const op = f.operator;
  if (op === 'is_empty') return isEmptyValue(raw);
  if (op === 'is_not_empty') return !isEmptyValue(raw);
  const val = f.value;
  const needsValue = !['checked', 'unchecked', 'this_week', 'past', 'future'].includes(op);
  if (needsValue && (val === undefined || val === null || val === '' || (Array.isArray(val) && !val.length))) return true;
  switch (def.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : null;
      const x = Number(val);
      if (n === null) return op === 'neq';
      return op === 'eq' ? n === x : op === 'neq' ? n !== x : op === 'gt' ? n > x : op === 'lt' ? n < x : op === 'gte' ? n >= x : op === 'lte' ? n <= x : true;
    }
    case 'select':
    case 'status': {
      const vals = Array.isArray(val) ? val : [val];
      return op === 'is' ? vals.includes(raw) : !vals.includes(raw);
    }
    case 'multi_select':
    case 'person':
    case 'relation':
    case 'created_by':
    case 'last_edited_by': {
      const list: string[] = raw || [];
      const vals = Array.isArray(val) ? val : [val];
      const has = vals.some((v: string) => list.includes(v));
      return op === 'contains' ? has : !has;
    }
    case 'checkbox':
      return op === 'checked' ? !!raw : !raw;
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const d = dayOf(raw);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (op === 'past') return d !== null && d < today.getTime();
      if (op === 'future') return d !== null && d > today.getTime();
      if (op === 'this_week') {
        const start = new Date(today);
        start.setDate(today.getDate() - today.getDay());
        return d !== null && d >= start.getTime() && d < start.getTime() + 7 * 864e5;
      }
      const target = resolveRelativeDate(val);
      if (d === null || target === null) return false;
      return op === 'date_is' ? d === target : op === 'before' ? d < target : op === 'after' ? d > target : op === 'on_or_before' ? d <= target : d >= target;
    }
    default: {
      const text = valueText(row, def, ctx).toLowerCase();
      const v = String(val).toLowerCase();
      switch (op) {
        case 'is':
          return text === v;
        case 'is_not':
          return text !== v;
        case 'contains':
          return text.includes(v);
        case 'not_contains':
          return !text.includes(v);
        case 'starts_with':
          return text.startsWith(v);
        case 'ends_with':
          return text.endsWith(v);
        default:
          return true;
      }
    }
  }
}

export function resolveRelativeDate(v: string): number | null {
  if (!v) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (v === 'today') return today.getTime();
  if (v === 'tomorrow') return today.getTime() + 864e5;
  if (v === 'yesterday') return today.getTime() - 864e5;
  if (v === 'one_week_ago') return today.getTime() - 7 * 864e5;
  if (v === 'one_week_from_now') return today.getTime() + 7 * 864e5;
  return parseISODate(v).getTime();
}

// ---------- Sorting ----------

export function compareRows(a: Page, b: Page, sorts: Sort[], ctx: DbCtx): number {
  for (const s of sorts) {
    const def = ctx.schema.properties[s.property];
    if (!def) continue;
    const va = sortKey(a, def, ctx);
    const vb = sortKey(b, def, ctx);
    const ea = va === null || va === '';
    const eb = vb === null || vb === '';
    if (ea && eb) continue;
    if (ea) return 1;
    if (eb) return -1;
    let c = 0;
    if (typeof va === 'number' && typeof vb === 'number') c = va - vb;
    else c = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    if (c !== 0) return s.direction === 'desc' ? -c : c;
  }
  return 0;
}

function sortKey(row: Page, def: PropertyDef, ctx: DbCtx): string | number | null {
  const v = getValue(row, def, ctx);
  switch (def.type) {
    case 'number':
    case 'unique_id':
      return typeof v === 'number' ? v : null;
    case 'checkbox':
      return v ? 1 : 0;
    case 'date':
      return v?.start ? parseISODate(v.start).getTime() : null;
    case 'created_time':
    case 'last_edited_time':
      return v;
    case 'select':
    case 'status': {
      const i = def.options?.findIndex((o) => o.id === v) ?? -1;
      return i < 0 ? null : i;
    }
    default: {
      const t = valueText(row, def, ctx);
      return t || null;
    }
  }
}

export function applyView(rows: Page[], cfg: ViewConfig, ctx: DbCtx, search = ''): Page[] {
  let out = rows;
  const filters = (cfg.filters || []).filter((f) => ctx.schema.properties[f.property]);
  if (filters.length) {
    out = out.filter((r) => (cfg.filterOp === 'or' ? filters.some((f) => matchesFilter(r, f, ctx)) : filters.every((f) => matchesFilter(r, f, ctx))));
  }
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    const defs = ctx.schema.order.map((id) => ctx.schema.properties[id]).filter(Boolean);
    out = out.filter((r) => defs.some((d) => valueText(r, d, ctx).toLowerCase().includes(q)));
  }
  const sorts = (cfg.sorts || []).filter((s) => ctx.schema.properties[s.property]);
  if (sorts.length) out = [...out].sort((a, b) => compareRows(a, b, sorts, ctx));
  return out;
}

// ---------- Grouping ----------

export interface Group {
  key: string; // option id / user id / '__none'
  label: string;
  color?: string;
  rows: Page[];
}

export function groupRows(rows: Page[], groupBy: string | null | undefined, ctx: DbCtx, cfg: ViewConfig): Group[] | null {
  const def = groupBy ? ctx.schema.properties[groupBy] : null;
  if (!def) return null;
  const groups = new Map<string, Group>();
  const add = (key: string, label: string, color?: string) => {
    if (!groups.has(key)) groups.set(key, { key, label, color, rows: [] });
    return groups.get(key)!;
  };
  if (def.type === 'select' || def.type === 'multi_select' || def.type === 'status') {
    add('__none', `No ${def.name}`);
    for (const o of def.options || []) add(o.id, o.name, o.color);
  } else if (def.type === 'checkbox') {
    add('true', 'Checked');
    add('false', 'Unchecked');
  } else if (def.type === 'person') {
    add('__none', `No ${def.name}`);
    for (const p of ctx.people.values()) add(p.id, p.name);
  }
  for (const r of rows) {
    const v = getValue(r, def, ctx);
    if (def.type === 'checkbox') add(v ? 'true' : 'false', v ? 'Checked' : 'Unchecked').rows.push(r);
    else if (Array.isArray(v)) {
      if (!v.length) add('__none', `No ${def.name}`).rows.push(r);
      for (const id of v) (groups.get(id) || add(id, ctx.people.get(id)?.name || id)).rows.push(r);
    } else if (v === null || v === undefined || v === '') add('__none', `No ${def.name}`).rows.push(r);
    else (groups.get(String(v)) || add(String(v), valueText(r, def, ctx))).rows.push(r);
  }
  let list = [...groups.values()];
  if (cfg.groupOrder?.length) {
    const order = cfg.groupOrder;
    list.sort((a, b) => {
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
    });
  }
  // "No X" group goes first like Notion unless ordered explicitly
  if (!cfg.groupOrder?.length) list = [...list.filter((g) => g.key === '__none'), ...list.filter((g) => g.key !== '__none')];
  if (cfg.hideEmptyGroups) list = list.filter((g) => g.rows.length);
  return list;
}

/** Property values to set on a row that is moved into / created in a group. */
export function groupValue(def: PropertyDef, key: string, current: any) {
  if (def.type === 'checkbox') return key === 'true';
  if (key === '__none') return def.type === 'multi_select' || def.type === 'person' ? [] : null;
  if (def.type === 'multi_select' || def.type === 'person') return [key];
  void current;
  return key;
}

/** Default property values for a new row so it satisfies the view's filters. */
export function defaultsFromFilters(cfg: ViewConfig, schema: DbSchema): Record<string, any> {
  const out: Record<string, any> = {};
  if (cfg.filterOp === 'or') return out;
  for (const f of cfg.filters || []) {
    const def = schema.properties[f.property];
    if (!def || def.type === 'title' || COMPUTED.has(def.type)) continue;
    if ((def.type === 'select' || def.type === 'status') && f.operator === 'is' && f.value) out[def.id] = Array.isArray(f.value) ? f.value[0] : f.value;
    if ((def.type === 'multi_select' || def.type === 'person') && f.operator === 'contains' && f.value) out[def.id] = Array.isArray(f.value) ? f.value : [f.value];
    if (def.type === 'checkbox' && f.operator === 'checked') out[def.id] = true;
    if ((def.type === 'text' || def.type === 'url' || def.type === 'email') && (f.operator === 'is' || f.operator === 'contains') && f.value) out[def.id] = f.value;
    if (def.type === 'number' && f.operator === 'eq' && f.value !== '') out[def.id] = Number(f.value);
    if (def.type === 'date' && f.operator === 'date_is' && f.value) {
      const t = resolveRelativeDate(f.value);
      if (t) out[def.id] = { start: toISODate(new Date(t)) };
    }
  }
  return out;
}

// ---------- Calculations ----------

export function calcOptions(type: PropertyType): { key: string; label: string }[] {
  const base = [
    { key: 'none', label: 'None' },
    { key: 'count_all', label: 'Count all' },
    { key: 'count_values', label: 'Count values' },
    { key: 'count_unique', label: 'Count unique values' },
    { key: 'count_empty', label: 'Count empty' },
    { key: 'count_not_empty', label: 'Count not empty' },
    { key: 'percent_empty', label: 'Percent empty' },
    { key: 'percent_not_empty', label: 'Percent not empty' },
  ];
  if (type === 'number' || type === 'formula' || type === 'rollup') {
    base.push({ key: 'sum', label: 'Sum' }, { key: 'average', label: 'Average' }, { key: 'median', label: 'Median' }, { key: 'min', label: 'Min' }, { key: 'max', label: 'Max' }, { key: 'range', label: 'Range' });
  }
  if (type === 'checkbox') {
    return [
      { key: 'none', label: 'None' },
      { key: 'count_all', label: 'Count all' },
      { key: 'checked', label: 'Checked' },
      { key: 'unchecked', label: 'Unchecked' },
      { key: 'percent_checked', label: 'Percent checked' },
      { key: 'percent_unchecked', label: 'Percent unchecked' },
    ];
  }
  if (type === 'date' || type === 'created_time' || type === 'last_edited_time') {
    base.push({ key: 'earliest', label: 'Earliest date' }, { key: 'latest', label: 'Latest date' }, { key: 'date_range', label: 'Date range' });
  }
  return base;
}

export function calculate(key: string, rows: Page[], def: PropertyDef, ctx: DbCtx): string {
  if (!key || key === 'none') return '';
  const vals = rows.map((r) => getValue(r, def, ctx));
  const nonEmpty = vals.filter((v) => !isEmptyValue(v) && !(def.type === 'checkbox' && v === false));
  const pct = (n: number) => (rows.length ? `${Math.round((n / rows.length) * 1000) / 10}%` : '0%');
  const nums = vals.map((v) => (typeof v === 'number' ? v : NaN)).filter((n) => Number.isFinite(n));
  const fmt = (n: number) => formatNumber(n, def.type === 'number' ? def.format : 'number');
  switch (key) {
    case 'count_all':
      return String(rows.length);
    case 'count_values':
      return String(vals.reduce((n, v) => n + (Array.isArray(v) ? v.length : isEmptyValue(v) ? 0 : 1), 0));
    case 'count_unique':
      return String(new Set(rows.map((r) => valueText(r, def, ctx)).filter(Boolean)).size);
    case 'count_empty':
      return String(rows.length - nonEmpty.length);
    case 'count_not_empty':
      return String(nonEmpty.length);
    case 'percent_empty':
      return pct(rows.length - nonEmpty.length);
    case 'percent_not_empty':
      return pct(nonEmpty.length);
    case 'checked':
      return String(vals.filter(Boolean).length);
    case 'unchecked':
      return String(vals.filter((v) => !v).length);
    case 'percent_checked':
      return pct(vals.filter(Boolean).length);
    case 'percent_unchecked':
      return pct(vals.filter((v) => !v).length);
    case 'sum':
      return fmt(nums.reduce((a, b) => a + b, 0));
    case 'average':
      return nums.length ? fmt(nums.reduce((a, b) => a + b, 0) / nums.length) : '';
    case 'median': {
      if (!nums.length) return '';
      const s = [...nums].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return fmt(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
    }
    case 'min':
      return nums.length ? fmt(Math.min(...nums)) : '';
    case 'max':
      return nums.length ? fmt(Math.max(...nums)) : '';
    case 'range':
      return nums.length ? fmt(Math.max(...nums) - Math.min(...nums)) : '';
    case 'earliest':
    case 'latest':
    case 'date_range': {
      const days = vals.map(dayOf).filter((d): d is number => d !== null);
      if (!days.length) return '';
      const min = Math.min(...days);
      const max = Math.max(...days);
      if (key === 'date_range') return `${Math.round((max - min) / 864e5)} days`;
      return formatDateValue({ start: toISODate(new Date(key === 'earliest' ? min : max)) }, 'full');
    }
    default:
      return '';
  }
}

export function calcLabel(key: string) {
  const map: Record<string, string> = {
    count_all: 'Count', count_values: 'Values', count_unique: 'Unique', count_empty: 'Empty', count_not_empty: 'Not empty',
    percent_empty: 'Empty', percent_not_empty: 'Not empty', sum: 'Sum', average: 'Average', median: 'Median', min: 'Min', max: 'Max',
    range: 'Range', checked: 'Checked', unchecked: 'Unchecked', percent_checked: 'Checked', percent_unchecked: 'Unchecked',
    earliest: 'Earliest', latest: 'Latest', date_range: 'Range',
  };
  return map[key] || '';
}

export function visibleProps(cfg: ViewConfig, schema: DbSchema, includeHidden = false): { def: PropertyDef; visible: boolean; width?: number }[] {
  const seen = new Set<string>();
  const out: { def: PropertyDef; visible: boolean; width?: number }[] = [];
  for (const p of cfg.properties || []) {
    const def = schema.properties[p.id];
    if (!def || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ def, visible: p.id === 'title' ? true : p.visible, width: p.width });
  }
  for (const id of schema.order) {
    if (seen.has(id) || !schema.properties[id]) continue;
    out.push({ def: schema.properties[id], visible: id === 'title' });
  }
  // title always first
  out.sort((a, b) => (a.def.type === 'title' ? -1 : b.def.type === 'title' ? 1 : 0));
  return includeHidden ? out : out.filter((p) => p.visible);
}

export const OPTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
export function nextOptionColor(existing: number) {
  const pool = OPTION_COLORS.slice(1);
  return pool[(existing * 3 + 2) % pool.length];
}
