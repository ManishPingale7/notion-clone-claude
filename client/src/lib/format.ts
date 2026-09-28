import DOMPurify from 'dompurify';

// ---------- Rich text sanitizing (mirrors the server allow-list) ----------

const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike', 'code', 'a', 'span', 'br', 'mark'];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'contenteditable', 'spellcheck', 'data-color', 'data-bg', 'data-type', 'data-id', 'data-discussion', 'data-label', 'data-equation'];

export function sanitize(html: string) {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false });
}

/** Normalizes pasted HTML into our inline subset (drops block structure). */
export function sanitizeInline(html: string) {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: [...ALLOWED_TAGS, 'p', 'div'], ALLOWED_ATTR: ['href'] });
  return clean.replace(/<\/(p|div)>\s*<(p|div)>/g, '<br>').replace(/<\/?(p|div)>/g, '');
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function htmlToText(html: string | undefined | null) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html.replace(/<br\s*\/?>/gi, '\n');
  div.querySelectorAll('[data-type="page"]').forEach((n) => (n.textContent = n.getAttribute('data-label') || n.textContent));
  return div.textContent || '';
}

// ---------- Dates ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export { MONTHS_LONG };

export function timeAgo(ts: number | null | undefined) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDateShort(new Date(ts));
}

export function formatDateShort(d: Date) {
  const now = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? ', ' + d.getFullYear() : ''}`;
}

export function formatDateTime(ts: number) {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${formatTime(d)}`;
}

export function formatTime(d: Date) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Parses "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" as a local date. */
export function parseISODate(s: string): Date {
  const [datePart, timePart] = s.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const date = new Date(y, (mo || 1) - 1, d || 1);
  if (timePart) {
    const [hh, mm] = timePart.split(':').map(Number);
    date.setHours(hh || 0, mm || 0);
  }
  return date;
}

export function toISODate(d: Date, withTime = false) {
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return withTime ? `${s}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : s;
}

export function formatDateValue(v: { start: string; end?: string; includeTime?: boolean } | null | undefined, fmt = 'full') {
  if (!v?.start) return '';
  const one = (s: string) => {
    const d = parseISODate(s);
    let out: string;
    if (fmt === 'relative') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dd = new Date(d);
      dd.setHours(0, 0, 0, 0);
      const diff = Math.round((dd.getTime() - today.getTime()) / 864e5);
      if (diff === 0) out = 'Today';
      else if (diff === 1) out = 'Tomorrow';
      else if (diff === -1) out = 'Yesterday';
      else out = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    } else if (fmt === 'us') out = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    else if (fmt === 'eu') out = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    else if (fmt === 'iso') out = toISODate(d);
    else out = `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    if (v.includeTime && s.includes('T')) out += ' ' + formatTime(d);
    return out;
  };
  return v.end ? `${one(v.start)} → ${one(v.end)}` : one(v.start);
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ---------- Misc ----------

export const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export const COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export const COLOR_NAMES: Record<string, string> = {
  default: 'Default', gray: 'Gray', brown: 'Brown', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink', red: 'Red',
};

export function pageTitle(t: string | undefined | null) {
  return t && t.trim() ? t : 'Untitled';
}

export function formatNumber(n: number | null | undefined, format = 'number') {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  switch (format) {
    case 'number_with_commas':
      return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
    case 'percent':
      return `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: 4 })}%`;
    case 'dollar':
      return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    case 'euro':
      return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    case 'pound':
      return n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
    case 'yen':
      return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY' });
    case 'rupee':
      return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
    default:
      return String(Math.round(n * 1e8) / 1e8);
  }
}

export function fileSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}
export const MOD = isMac() ? '⌘' : 'Ctrl+';

/** Position between two neighbours for fractional ordering. */
export function between(a: number | null | undefined, b: number | null | undefined) {
  if (a == null && b == null) return 1;
  if (a == null) return (b as number) - 1;
  if (b == null) return a + 1;
  return (a + b) / 2;
}

export const COVER_PRESETS: Record<string, string> = {
  solid_red: '#e16259',
  solid_yellow: '#dfab01',
  solid_blue: '#0b6e99',
  solid_beige: '#fcf3db',
  gradient_1: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
  gradient_2: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
  gradient_3: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)',
  gradient_4: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
  gradient_5: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  gradient_6: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  gradient_7: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  gradient_8: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  gradient_9: 'linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)',
  gradient_10: 'linear-gradient(to top, #f77062 0%, #fe5196 100%)',
  gradient_11: 'linear-gradient(to right, #43e97b 0%, #38f9d7 100%)',
  gradient_12: 'linear-gradient(to top, #09203f 0%, #537895 100%)',
};

export function coverCss(cover: { type: string; value: string; position?: number } | null) {
  if (!cover) return undefined;
  if (cover.type === 'color') return { background: COVER_PRESETS[cover.value] || '#e3e2e0' };
  return { backgroundImage: `url("${cover.value.replace(/"/g, '%22')}")`, backgroundSize: 'cover', backgroundPosition: `center ${cover.position ?? 50}%` };
}
