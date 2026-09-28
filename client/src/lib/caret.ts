// Caret & selection helpers for contentEditable blocks. Offsets are measured in
// characters of text content, treating atomic mentions as a single character
// and <br> as a newline, so they survive re-rendering of innerHTML.

const isAtomic = (n: Node) => n.nodeType === 1 && (n as HTMLElement).getAttribute('contenteditable') === 'false';

function nodeLength(n: Node): number {
  if (n.nodeType === 3) return (n as Text).data.length;
  if (isAtomic(n)) return 1;
  if (n.nodeName === 'BR') return 1;
  let len = 0;
  n.childNodes.forEach((c) => (len += nodeLength(c)));
  return len;
}

export function textLength(root: HTMLElement) {
  return nodeLength(root);
}

/** Text offset of a (node, offset) position inside root. */
export function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  let total = 0;
  let found = false;
  const walk = (n: Node): void => {
    if (found) return;
    if (n === node) {
      if (n.nodeType === 3) total += offset;
      else for (let i = 0; i < offset && i < n.childNodes.length; i++) total += nodeLength(n.childNodes[i]);
      found = true;
      return;
    }
    if (n.nodeType === 3) {
      total += (n as Text).data.length;
      return;
    }
    if (isAtomic(n) || n.nodeName === 'BR') {
      if (n.contains(node)) {
        found = true;
        total += 1;
        return;
      }
      total += 1;
      return;
    }
    for (const c of Array.from(n.childNodes)) {
      walk(c);
      if (found) return;
    }
  };
  walk(root);
  return total;
}

export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const start = offsetOf(root, r.startContainer, r.startOffset);
  const end = r.collapsed ? start : offsetOf(root, r.endContainer, r.endOffset);
  return { start, end };
}

export function getCaret(root: HTMLElement): number | null {
  return getSelectionOffsets(root)?.start ?? null;
}

/** Converts a text offset into a DOM (node, offset) position. */
export function pointAt(root: HTMLElement, target: number): { node: Node; offset: number } {
  let remaining = target;
  const walk = (n: Node): { node: Node; offset: number } | null => {
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes[i];
      if (c.nodeType === 3) {
        const len = (c as Text).data.length;
        if (remaining <= len) return { node: c, offset: remaining };
        remaining -= len;
      } else if (isAtomic(c) || c.nodeName === 'BR') {
        if (remaining === 0) return { node: n, offset: i };
        remaining -= 1;
        if (remaining === 0) return { node: n, offset: i + 1 };
      } else {
        const r = walk(c);
        if (r) return r;
      }
    }
    return null;
  };
  const res = walk(root);
  if (res) return res;
  return { node: root, offset: root.childNodes.length };
}

export function setCaret(root: HTMLElement, start: number, end = start) {
  const sel = window.getSelection();
  if (!sel) return;
  const len = textLength(root);
  const a = pointAt(root, Math.max(0, Math.min(start, len)));
  const b = end === start ? a : pointAt(root, Math.max(0, Math.min(end, len)));
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function focusAt(root: HTMLElement, where: 'start' | 'end' | number) {
  root.focus({ preventScroll: true });
  const len = textLength(root);
  setCaret(root, where === 'start' ? 0 : where === 'end' ? len : where);
  const sel = window.getSelection();
  const rect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
  const r = rect && rect.height ? rect : root.getBoundingClientRect();
  const scroller = root.closest('.page-scroller, .peek-scroller') as HTMLElement | null;
  if (scroller) {
    const s = scroller.getBoundingClientRect();
    if (r.bottom > s.bottom - 40) scroller.scrollTop += r.bottom - s.bottom + 80;
    else if (r.top < s.top + 40) scroller.scrollTop -= s.top - r.top + 80;
  }
}

/** HTML of the content before/after the caret (used to split blocks on Enter). */
export function splitHtmlAt(root: HTMLElement, offset: number): [string, string] {
  const clone = root.cloneNode(true) as HTMLElement;
  const p = pointAt(clone, offset);
  const after = document.createRange();
  after.setStart(p.node, p.offset);
  after.setEnd(clone, clone.childNodes.length);
  const frag = after.extractContents();
  const div = document.createElement('div');
  div.appendChild(frag);
  return [cleanupHtml(clone.innerHTML), cleanupHtml(div.innerHTML)];
}

export function cleanupHtml(html: string) {
  // strip empty formatting wrappers & trailing lone <br>
  let out = html.replace(/<(b|i|u|s|code|span|a|strong|em)(\s[^>]*)?><\/\1>/g, '');
  if (out === '<br>') out = '';
  return out;
}

export function isCaretAtStart(root: HTMLElement) {
  const o = getSelectionOffsets(root);
  return !!o && o.start === 0 && o.end === 0;
}

export function isCaretAtEnd(root: HTMLElement) {
  const o = getSelectionOffsets(root);
  return !!o && o.start === o.end && o.end >= textLength(root);
}

/** Is the caret on the first/last visual line of the element? */
export function caretOnEdgeLine(root: HTMLElement, edge: 'first' | 'last') {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return true;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  let rect = range.getClientRects()[0];
  if (!rect) {
    // empty line: fall back to inserting a temporary marker
    const span = document.createElement('span');
    span.textContent = '​';
    range.insertNode(span);
    rect = span.getBoundingClientRect();
    const parent = span.parentNode;
    span.remove();
    parent?.normalize();
    const o = getSelectionOffsets(root);
    if (o) setCaret(root, o.start);
  }
  const box = root.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(root).lineHeight) || 24;
  if (edge === 'first') return rect.top - box.top < lh * 0.9;
  return box.bottom - rect.bottom < lh * 0.9;
}

export function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);
  const rects = range.getClientRects();
  if (rects.length) return rects[rects.length - 1];
  const node = range.startContainer as HTMLElement;
  const el = node.nodeType === 1 ? node : node.parentElement;
  return el ? el.getBoundingClientRect() : null;
}

/** Plain text before the caret within the root (mentions count as one char). */
export function textBeforeCaret(root: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return '';
  const r = document.createRange();
  r.setStart(root, 0);
  const cur = sel.getRangeAt(0);
  r.setEnd(cur.startContainer, cur.startOffset);
  const div = document.createElement('div');
  div.appendChild(r.cloneContents());
  div.querySelectorAll('[contenteditable="false"]').forEach((n) => n.replaceWith('⁣'));
  div.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  return div.textContent || '';
}

/** Deletes `count` characters immediately before the caret. */
export function deleteBeforeCaret(root: HTMLElement, count: number) {
  const o = getSelectionOffsets(root);
  if (!o) return;
  setCaret(root, o.start - count, o.start);
  const sel = window.getSelection()!;
  sel.getRangeAt(0).deleteContents();
  root.normalize();
  setCaret(root, o.start - count);
}

/** Inserts HTML at the caret (replacing the selection) and places caret after it. */
export function insertHtmlAtCaret(root: HTMLElement, html: string) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return;
  range.deleteContents();
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const frag = tpl.content;
  const last = frag.lastChild;
  range.insertNode(frag);
  if (last) {
    const r = document.createRange();
    r.setStartAfter(last);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  root.normalize();
}
