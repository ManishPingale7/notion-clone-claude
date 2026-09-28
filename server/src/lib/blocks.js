import { sanitizeRich, htmlToText, safeUrl } from './richtext.js';

export const RICH_TYPES = new Set([
  'text', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list', 'numbered_list',
  'to_do', 'toggle', 'quote', 'callout',
]);

export const BLOCK_TYPES = new Set([
  ...RICH_TYPES,
  'code', 'divider', 'image', 'video', 'audio', 'file', 'bookmark', 'embed', 'page',
  'child_database', 'link_to_page', 'equation', 'table_of_contents', 'table',
  'column_list', 'column', 'breadcrumb',
]);

export const COLORS = new Set([
  'default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
  'gray_background', 'brown_background', 'orange_background', 'yellow_background', 'green_background',
  'blue_background', 'purple_background', 'pink_background', 'red_background',
]);

const s = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Normalizes and sanitizes a block's content object for its type. */
export function sanitizeContent(type, content) {
  const c = content && typeof content === 'object' ? content : {};
  const out = {};
  if (c.color && COLORS.has(c.color)) out.color = c.color;
  if (RICH_TYPES.has(type)) {
    out.text = sanitizeRich(c.text || '');
    if (type === 'to_do') out.checked = !!c.checked;
    if (type === 'toggle' || type.startsWith('heading_')) {
      if (c.toggleable) out.toggleable = true;
      if (c.collapsed) out.collapsed = true;
    }
    if (type === 'toggle' && c.collapsed === false) out.collapsed = false;
    if (type === 'callout') out.icon = s(c.icon, 64) || '💡';
    return out;
  }
  switch (type) {
    case 'code':
      out.text = s(c.text, 200000);
      out.language = s(c.language, 40) || 'plain text';
      if (c.wrap) out.wrap = true;
      if (c.caption) out.caption = sanitizeRich(c.caption);
      break;
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
      out.url = safeUrl(c.url);
      if (c.name) out.name = s(c.name, 300);
      if (typeof c.size === 'number') out.size = c.size;
      if (c.caption) out.caption = sanitizeRich(c.caption);
      if (typeof c.width === 'number') out.width = Math.max(40, Math.min(2000, c.width));
      if (c.align && ['left', 'center', 'right'].includes(c.align)) out.align = c.align;
      break;
    case 'bookmark':
    case 'embed':
      out.url = safeUrl(c.url);
      if (c.title) out.title = s(c.title, 500);
      if (c.description) out.description = s(c.description, 1000);
      if (c.image) out.image = safeUrl(c.image);
      if (c.caption) out.caption = sanitizeRich(c.caption);
      if (typeof c.height === 'number') out.height = Math.max(80, Math.min(2000, c.height));
      break;
    case 'page':
    case 'child_database':
    case 'link_to_page':
      out.pageId = s(c.pageId, 64);
      break;
    case 'equation':
      out.expression = s(c.expression, 5000);
      break;
    case 'table': {
      const rows = Array.isArray(c.rows) ? c.rows.slice(0, 500) : [['', ''], ['', '']];
      const width = Math.max(1, Math.min(50, Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 1)));
      out.rows = rows.map((r) => Array.from({ length: width }, (_, i) => sanitizeRich((Array.isArray(r) ? r[i] : '') || '')));
      out.headerRow = !!c.headerRow;
      out.headerCol = !!c.headerCol;
      if (Array.isArray(c.colWidths)) out.colWidths = c.colWidths.slice(0, 50).map((w) => (typeof w === 'number' ? w : 120));
      break;
    }
    case 'column':
      if (typeof c.ratio === 'number' && c.ratio > 0 && c.ratio < 1) out.ratio = c.ratio;
      break;
    default:
      break;
  }
  return out;
}

export function blockPlainText(type, content) {
  if (!content) return '';
  if (RICH_TYPES.has(type)) return htmlToText(content.text);
  if (type === 'code') return content.text || '';
  if (type === 'table') return (content.rows || []).map((r) => r.map(htmlToText).join(' ')).join('\n');
  if (type === 'bookmark' || type === 'embed') return [content.title, content.url].filter(Boolean).join(' ');
  if (type === 'equation') return content.expression || '';
  if (['image', 'file', 'video', 'audio'].includes(type)) return htmlToText(content.caption || '') + ' ' + (content.name || '');
  return '';
}

export function rowFromBlock(r) {
  return {
    id: r.id,
    pageId: r.page_id,
    parentId: r.parent_block_id,
    type: r.type,
    content: JSON.parse(r.content || '{}'),
    position: r.position,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}
