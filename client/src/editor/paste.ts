import type { BlockType } from '../types';
import { escapeHtml, sanitizeInline } from '../lib/format';

export interface BlockSpec {
  type: BlockType;
  content: Record<string, any>;
  children?: BlockSpec[];
}

function inlineMd(s: string) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** Parses Markdown-ish plain text into block specs (used for multi-line paste). */
export function markdownToBlocks(text: string): BlockSpec[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const root: BlockSpec[] = [];
  const stack: { indent: number; list: BlockSpec[] }[] = [{ indent: -1, list: root }];
  let i = 0;
  const push = (indent: number, spec: BlockSpec, nestable: boolean) => {
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].list.push(spec);
    if (nestable) {
      spec.children = [];
      stack.push({ indent, list: spec.children });
    }
  };
  while (i < lines.length) {
    const raw = lines[i];
    const indent = raw.match(/^\s*/)![0].replace(/\t/g, '    ').length;
    const line = raw.trim();
    if (line.startsWith('```')) {
      const language = line.slice(3).trim() || 'plain text';
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      i++;
      push(indent, { type: 'code', content: { text: body.join('\n'), language } }, false);
      continue;
    }
    i++;
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) push(indent, { type: `heading_${m[1].length}` as BlockType, content: { text: inlineMd(m[2]) } }, false);
    else if ((m = line.match(/^[-*+]\s+\[( |x|X)\]\s*(.*)$/))) push(indent, { type: 'to_do', content: { text: inlineMd(m[2]), checked: m[1] !== ' ' } }, true);
    else if ((m = line.match(/^[-*+]\s+(.*)$/))) push(indent, { type: 'bulleted_list', content: { text: inlineMd(m[1]) } }, true);
    else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) push(indent, { type: 'numbered_list', content: { text: inlineMd(m[1]) } }, true);
    else if ((m = line.match(/^>\s?(.*)$/))) push(indent, { type: 'quote', content: { text: inlineMd(m[1]) } }, false);
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) push(indent, { type: 'divider', content: {} }, false);
    else if ((m = line.match(/^!\[([^\]]*)\]\((\S+)\)$/))) push(indent, { type: 'image', content: { url: m[2], caption: escapeHtml(m[1]) } }, false);
    else if ((m = line.match(/^\$\$(.*)\$\$$/))) push(indent, { type: 'equation', content: { expression: m[1] } }, false);
    else push(indent, { type: 'text', content: { text: inlineMd(line) } }, false);
  }
  const prune = (list: BlockSpec[]) => list.forEach((b) => (b.children?.length ? prune(b.children) : delete b.children));
  prune(root);
  return root;
}

/** Converts pasted HTML (from web pages, docs, etc.) into block specs. */
export function htmlToBlocks(html: string): BlockSpec[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: BlockSpec[] = [];
  const inline = (el: Element) => sanitizeInline(el.innerHTML).trim();
  const walk = (node: Element, into: BlockSpec[]) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const level = Math.min(3, Number(tag[1]));
        into.push({ type: `heading_${level}` as BlockType, content: { text: inline(child) } });
      } else if (tag === 'p') {
        const t = inline(child);
        if (t) into.push({ type: 'text', content: { text: t } });
      } else if (tag === 'ul' || tag === 'ol') {
        for (const li of Array.from(child.children)) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          const nested = Array.from(li.children).filter((c) => ['ul', 'ol'].includes(c.tagName.toLowerCase()));
          const clone = li.cloneNode(true) as Element;
          clone.querySelectorAll('ul,ol').forEach((n) => n.remove());
          const checkbox = clone.querySelector('input[type=checkbox]') as HTMLInputElement | null;
          const spec: BlockSpec = checkbox
            ? { type: 'to_do', content: { text: inline(clone), checked: checkbox.checked } }
            : { type: tag === 'ul' ? 'bulleted_list' : 'numbered_list', content: { text: inline(clone) } };
          if (nested.length) {
            spec.children = [];
            const wrap = document.createElement('div');
            nested.forEach((n) => wrap.appendChild(n.cloneNode(true)));
            walk(wrap, spec.children);
          }
          into.push(spec);
        }
      } else if (tag === 'blockquote') {
        into.push({ type: 'quote', content: { text: inline(child) } });
      } else if (tag === 'pre') {
        into.push({ type: 'code', content: { text: child.textContent || '', language: 'plain text' } });
      } else if (tag === 'hr') {
        into.push({ type: 'divider', content: {} });
      } else if (tag === 'img') {
        const src = child.getAttribute('src');
        if (src && /^https?:/.test(src)) into.push({ type: 'image', content: { url: src } });
      } else if (tag === 'table') {
        const rows = Array.from(child.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((td) => inline(td)));
        if (rows.length) into.push({ type: 'table', content: { rows, headerRow: !!child.querySelector('th') } });
      } else if (['div', 'section', 'article', 'main', 'body', 'span', 'header', 'footer', 'li'].includes(tag)) {
        if (Array.from(child.children).some((c) => /^(p|h\d|ul|ol|div|pre|blockquote|table|hr|img|section)$/i.test(c.tagName))) walk(child, into);
        else {
          const t = inline(child);
          if (t) into.push({ type: 'text', content: { text: t } });
        }
      } else if (['b', 'strong', 'i', 'em', 'a', 'code', 'u', 's'].includes(tag)) {
        const t = sanitizeInline(child.outerHTML);
        if (t) into.push({ type: 'text', content: { text: t } });
      }
    }
  };
  walk(doc.body, out);
  if (!out.length && doc.body.textContent?.trim()) out.push({ type: 'text', content: { text: sanitizeInline(doc.body.innerHTML) } });
  return out;
}
