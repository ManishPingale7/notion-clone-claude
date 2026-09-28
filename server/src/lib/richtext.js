import sanitizeHtml from 'sanitize-html';

// Inline rich text is stored as a restricted HTML subset (like Notion's
// annotated text runs). Everything is sanitized server-side before storage.
const RICH_OPTIONS = {
  allowedTags: ['b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike', 'code', 'a', 'span', 'br', 'mark'],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'data-*'],
    span: ['class', 'contenteditable', 'data-*', 'spellcheck'],
    mark: ['data-*'],
    code: ['data-*'],
    b: ['data-*'],
    i: ['data-*'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  allowedSchemesAppliedToAttributes: ['href'],
  disallowedTagsMode: 'discard',
  parser: { decodeEntities: true },
};

export function sanitizeRich(html) {
  if (typeof html !== 'string' || html === '') return '';
  return sanitizeHtml(html.slice(0, 200000), RICH_OPTIONS);
}

export function htmlToText(html) {
  if (!html) return '';
  const withBreaks = String(html).replace(/<br\s*\/?>/gi, '\n');
  const text = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Returns the set of user ids mentioned (@person) in a rich text string. */
export function mentionedUsers(html) {
  const ids = new Set();
  if (!html) return ids;
  const re = /data-type="user"[^>]*data-id="([^"]+)"|data-id="([^"]+)"[^>]*data-type="user"/g;
  let m;
  while ((m = re.exec(html))) ids.add(m[1] || m[2]);
  return ids;
}

const SAFE_URL = /^(https?:\/\/|\/uploads\/|mailto:)/i;
export function safeUrl(url) {
  if (typeof url !== 'string') return '';
  const u = url.trim().slice(0, 4000);
  if (!u) return '';
  if (SAFE_URL.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return ''; // javascript:, data:, etc.
  return 'https://' + u;
}
