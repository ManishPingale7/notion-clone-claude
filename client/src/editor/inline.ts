// Inline formatting operations on the current DOM selection inside an editable.

export function selectionRangeIn(el: HTMLElement): Range | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.commonAncestorContainer)) return null;
  return r;
}

function unwrap(node: Element) {
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
}

function reselect(nodes: Node[]) {
  if (!nodes.length) return;
  const sel = window.getSelection()!;
  const r = document.createRange();
  r.setStartBefore(nodes[0]);
  r.setEndAfter(nodes[nodes.length - 1]);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Returns true if every text node in the range is inside an element matching selector. */
export function rangeHas(el: HTMLElement, selector: string): boolean {
  const r = selectionRangeIn(el);
  if (!r) return false;
  const start = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : (r.startContainer as Element);
  if (start?.closest(selector) && el.contains(start.closest(selector))) {
    const end = r.endContainer.nodeType === 3 ? r.endContainer.parentElement : (r.endContainer as Element);
    return !!end?.closest(selector);
  }
  return false;
}

export function toggleWrap(el: HTMLElement, tag: string, attrs: Record<string, string> = {}, selector = tag) {
  const r = selectionRangeIn(el);
  if (!r || r.collapsed) return;
  if (rangeHas(el, selector)) {
    // unwrap: extract, strip matching wrappers, and also split the outer one
    const outer = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : (r.startContainer as Element))!.closest(selector)!;
    if (outer && outer.contains(r.startContainer) && outer.contains(r.endContainer) && outer.textContent === r.toString()) {
      unwrap(outer);
      return;
    }
    const frag = r.extractContents();
    frag.querySelectorAll(selector).forEach(unwrap);
    const nodes = Array.from(frag.childNodes);
    // split the containing wrapper around the extracted content
    const container = outer;
    if (container && container.parentNode) {
      const after = container.cloneNode(false) as Element;
      const range2 = document.createRange();
      range2.setStart(r.startContainer, r.startOffset);
      range2.setEndAfter(container.lastChild || container);
      after.appendChild(range2.extractContents());
      container.after(after);
      container.after(frag);
      if (!after.textContent) after.remove();
      if (!container.textContent) container.remove();
    } else r.insertNode(frag);
    reselect(nodes);
    return;
  }
  const frag = r.extractContents();
  frag.querySelectorAll(selector).forEach(unwrap);
  const w = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) w.setAttribute(k, v);
  w.appendChild(frag);
  r.insertNode(w);
  el.normalize();
  reselect([w]);
}

/** Applies a text colour or background colour span to the selection. */
export function applyColor(el: HTMLElement, color: string) {
  const r = selectionRangeIn(el);
  if (!r || r.collapsed) return;
  const isBg = color.endsWith('_background');
  const attr = isBg ? 'data-bg' : 'data-color';
  const value = isBg ? color.replace('_background', '') : color;
  const frag = r.extractContents();
  frag.querySelectorAll('span[data-color], span[data-bg]').forEach((s) => {
    if (color === 'default') {
      unwrap(s);
      return;
    }
    s.removeAttribute(attr);
    if (!s.getAttribute('data-color') && !s.getAttribute('data-bg') && !s.getAttribute('data-discussion') && !s.className) unwrap(s);
  });
  if (color === 'default') {
    const nodes = Array.from(frag.childNodes);
    r.insertNode(frag);
    reselect(nodes);
    return;
  }
  const span = document.createElement('span');
  span.setAttribute(attr, value);
  span.appendChild(frag);
  r.insertNode(span);
  el.normalize();
  reselect([span]);
}

export function setLink(el: HTMLElement, url: string | null, savedRange?: Range | null) {
  const sel = window.getSelection()!;
  if (savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  const r = selectionRangeIn(el);
  if (!r) return;
  const frag = r.extractContents();
  frag.querySelectorAll('a').forEach(unwrap);
  if (!url) {
    const nodes = Array.from(frag.childNodes);
    r.insertNode(frag);
    reselect(nodes);
    return;
  }
  const a = document.createElement('a');
  a.href = /^(https?:|mailto:|\/)/i.test(url) ? url : 'https://' + url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.appendChild(frag);
  r.insertNode(a);
  el.normalize();
  reselect([a]);
}

export function wrapDiscussion(el: HTMLElement, discussionId: string) {
  const r = selectionRangeIn(el);
  if (!r || r.collapsed) return '';
  const text = r.toString();
  const frag = r.extractContents();
  const span = document.createElement('span');
  span.setAttribute('data-discussion', discussionId);
  span.className = 'comment-anchor';
  span.appendChild(frag);
  r.insertNode(span);
  el.normalize();
  return text;
}

export function removeDiscussionAnchor(el: HTMLElement, discussionId: string) {
  el.querySelectorAll(`span[data-discussion="${discussionId}"]`).forEach(unwrap);
}

export function activeFormats(el: HTMLElement) {
  return {
    bold: rangeHas(el, 'b,strong'),
    italic: rangeHas(el, 'i,em'),
    underline: rangeHas(el, 'u'),
    strike: rangeHas(el, 's,strike,del'),
    code: rangeHas(el, 'code'),
    link: rangeHas(el, 'a'),
  };
}
