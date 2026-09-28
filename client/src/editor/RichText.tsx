import React, { useLayoutEffect, useRef } from 'react';
import type { Block, BlockType } from '../types';
import { useEditor } from './context';
import { useApp } from '../store';
import {
  caretOnEdgeLine, caretRect, focusAt, getSelectionOffsets, isCaretAtEnd, isCaretAtStart, setCaret, textBeforeCaret,
  deleteBeforeCaret, insertHtmlAtCaret, textLength, cleanupHtml,
} from '../lib/caret';
import { splitBlock, backspaceAtStart, deleteForward, indent, outdent, turnInto, duplicateBlocks, insertSpecs } from './actions';
import { toggleWrap } from './inline';
import { htmlToBlocks, markdownToBlocks } from './paste';
import { escapeHtml, sanitize, sanitizeInline } from '../lib/format';

// Markdown-style shortcuts typed at the start of a block (followed by a space).
const PREFIX_RULES: { re: RegExp; type: BlockType; content?: Record<string, any> }[] = [
  { re: /^#$/, type: 'heading_1' },
  { re: /^##$/, type: 'heading_2' },
  { re: /^###$/, type: 'heading_3' },
  { re: /^[-*+]$/, type: 'bulleted_list' },
  { re: /^(1|a|i)[.)]$/, type: 'numbered_list' },
  { re: /^\[ ?\]$/, type: 'to_do' },
  { re: /^\[x\]$/i, type: 'to_do', content: { checked: true } },
  { re: /^>$/, type: 'toggle' },
  { re: /^["“]$/, type: 'quote' },
];

// Inline markdown: **bold**, *italic*, _italic_, `code`, ~strike~
const INLINE_RULES: { re: RegExp; tag: string }[] = [
  { re: /\*\*([^*\n]+)\*\*$/, tag: 'b' },
  { re: /__([^_\n]+)__$/, tag: 'b' },
  { re: /(?<![*])\*([^*\n]+)\*$/, tag: 'i' },
  { re: /(?<![_\w])_([^_\n]+)_$/, tag: 'i' },
  { re: /`([^`\n]+)`$/, tag: 'code' },
  { re: /~~([^~\n]+)~~$/, tag: 's' },
  { re: /(?<!~)~([^~\n]+)~$/, tag: 's' },
];

/** Replace page-mention labels with current page titles for display. */
export function decorateHtml(html: string, titles: Record<string, { title?: string; noAccess?: boolean } | undefined>) {
  if (!html || !html.includes('data-type="page"')) return html;
  return html.replace(/(<span[^>]*data-type="page"[^>]*>)([^<]*)(<\/span>)/g, (m, open: string, _label, close) => {
    const id = open.match(/data-id="([^"]+)"/)?.[1];
    const meta = id ? titles[id] : undefined;
    if (!meta) return m;
    const t = meta.noAccess ? 'No access' : meta.title || 'Untitled';
    return open + escapeHtml(t) + close;
  });
}

interface Props {
  block: Block;
  className?: string;
  placeholder?: string;
  alwaysPlaceholder?: boolean;
  style?: React.CSSProperties;
}

export function RichText({ block, className = '', placeholder, alwaysPlaceholder, style }: Props) {
  const ctx = useEditor();
  const { store } = ctx;
  const ref = useRef<HTMLDivElement>(null);
  const pageMeta = useApp((s) => s.pageMeta);
  const readOnly = ctx.readOnly;
  const html = decorateHtml(block.content.text || '', { ...pageMeta, ...ctx.pages });

  useLayoutEffect(() => {
    const el = ref.current!;
    store.editables.set(block.id, el);
    return () => {
      if (store.editables.get(block.id) === el) store.editables.delete(block.id);
    };
  }, [block.id, store]);

  useLayoutEffect(() => {
    const el = ref.current!;
    if (el.innerHTML !== html) {
      const focused = document.activeElement === el;
      const sel = focused ? getSelectionOffsets(el) : null;
      el.innerHTML = html;
      if (sel) setCaret(el, sel.start, sel.end);
    }
  }, [html]);

  const commit = () => {
    const el = ref.current!;
    if (el.innerHTML === '<br>') el.innerHTML = '';
    store.setText(block.id, cleanupHtml(el.innerHTML));
  };

  const openMenu = (kind: 'slash' | 'mention' | 'link', back: number) => {
    const el = ref.current!;
    const caret = getSelectionOffsets(el)?.start ?? 0;
    const rect = caretRect() || el.getBoundingClientRect();
    ctx.setMenu({ kind, blockId: block.id, start: caret - back, rect });
  };

  const onInput = (e: React.FormEvent<HTMLDivElement>) => {
    const el = ref.current!;
    const ne = e.nativeEvent as InputEvent;
    const data = ne.data;
    if (ne.inputType === 'insertText' && data) {
      const before = textBeforeCaret(el);
      if (data === ' ') {
        const prefix = before.slice(0, -1);
        const rule = PREFIX_RULES.find((r) => r.re.test(prefix));
        if (rule && !(rule.type === block.type && !rule.content)) {
          deleteBeforeCaret(el, before.length);
          const text = cleanupHtml(el.innerHTML);
          store.transact(
            (tx) =>
              tx.update(block.id, {
                type: rule.type,
                content: { ...(rule.type === 'to_do' ? { checked: false } : {}), ...rule.content, text, ...(block.content.color ? { color: block.content.color } : {}) },
              }),
            { focusAfter: { id: block.id, at: 0 } },
          );
          return;
        }
      }
      if (data === '`' && before === '```') {
        deleteBeforeCaret(el, 3);
        store.transact((tx) => tx.update(block.id, { type: 'code', content: { text: el.textContent || '', language: 'plain text' } }), {
          focusAfter: { id: block.id, at: 0 },
        });
        return;
      }
      if (data === '-' && before === '---') {
        let nextId = '';
        store.transact((tx) => {
          tx.update(block.id, { type: 'divider', content: {} });
          nextId = tx.insert({ type: 'text', content: { text: '' } }, { after: block.id }).id;
        });
        store.requestFocus({ id: nextId, at: 0 });
        return;
      }
      if ('*_`~'.includes(data)) {
        for (const rule of INLINE_RULES) {
          const m = before.match(rule.re);
          if (!m || !m[1].trim()) continue;
          deleteBeforeCaret(el, m[0].length);
          insertHtmlAtCaret(el, `<${rule.tag}>${escapeHtml(m[1])}</${rule.tag}>​`);
          commit();
          return;
        }
      }
      if (data === '/') openMenu('slash', 1);
      else if (data === '@') openMenu('mention', 1);
      else if (data === '[' && before.endsWith('[[')) openMenu('link', 2);
    }
    commit();
    const menu = ctx.menu;
    if (menu && menu.blockId === block.id && !(data === '/' || data === '@' || data === '[')) {
      const caret = getSelectionOffsets(el)?.start ?? 0;
      if (caret <= menu.start) ctx.setMenu(null);
      else ctx.setMenu({ ...menu });
    }
  };

  const focusAdjacent = (dir: -1 | 1) => {
    const target = dir < 0 ? store.prevVisible(block.id) : store.nextVisible(block.id);
    if (!target) {
      if (dir < 0) {
        ctx.focusTitle();
        return true;
      }
      return false;
    }
    const tel = store.editables.get(target.id);
    if (!tel) {
      store.requestFocus({ id: target.id, at: dir < 0 ? 'end' : 'start' });
      return true;
    }
    const x = caretRect()?.left;
    const tr = tel.getBoundingClientRect();
    const y = dir < 0 ? tr.bottom - 6 : tr.top + 6;
    const anyDoc = document as any;
    let range: Range | null = null;
    if (x !== undefined && x > 0) {
      if (anyDoc.caretRangeFromPoint) range = anyDoc.caretRangeFromPoint(x, y);
      else if (anyDoc.caretPositionFromPoint) {
        const p = anyDoc.caretPositionFromPoint(x, y);
        if (p) {
          range = document.createRange();
          range.setStart(p.offsetNode, p.offset);
        }
      }
    }
    if (range && tel.contains(range.startContainer)) {
      tel.focus({ preventScroll: true });
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      tel.scrollIntoView({ block: 'nearest' });
    } else focusAt(tel, dir < 0 ? 'end' : 'start');
    return true;
  };

  const moveSibling = (dir: -1 | 1) => {
    const sibs = store.siblings(block.id);
    const i = sibs.findIndex((b) => b.id === block.id);
    const other = sibs[i + dir];
    if (!other) return;
    const focus = store.currentFocus();
    store.transact((tx) => tx.move(block.id, dir < 0 ? { before: other.id } : { after: other.id }), { focusAfter: focus });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current!;
    if (ctx.menu && ctx.menu.blockId === block.id && ctx.menuKey.current && ctx.menuKey.current(e)) return;
    if (e.nativeEvent.isComposing || readOnly) return;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      e.preventDefault();
      splitBlock(store, block, el);
      return;
    }
    if (e.key === 'Enter' && mod) {
      e.preventDefault();
      if (block.type === 'to_do') store.setContent(block.id, { checked: !block.content.checked });
      else if (block.type === 'toggle' || block.content.toggleable) store.setOpen(block.id, !store.isOpen(block));
      return;
    }
    if (e.key === 'Backspace' && !mod && isCaretAtStart(el)) {
      e.preventDefault();
      backspaceAtStart(store, block, el, ctx.focusTitle);
      return;
    }
    if (e.key === 'Delete' && isCaretAtEnd(el)) {
      e.preventDefault();
      deleteForward(store, block);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) outdent(store, block);
      else indent(store, block);
      return;
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && !mod && caretOnEdgeLine(el, 'first')) {
      if (focusAdjacent(-1)) e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && !mod && caretOnEdgeLine(el, 'last')) {
      if (focusAdjacent(1)) e.preventDefault();
      return;
    }
    if (e.key === 'ArrowLeft' && !e.shiftKey && !mod && isCaretAtStart(el)) {
      const prev = store.prevVisible(block.id);
      if (prev) {
        e.preventDefault();
        store.requestFocus({ id: prev.id, at: 'end' });
      }
      return;
    }
    if (e.key === 'ArrowRight' && !e.shiftKey && !mod && isCaretAtEnd(el)) {
      const next = store.nextVisible(block.id);
      if (next) {
        e.preventDefault();
        store.requestFocus({ id: next.id, at: 'start' });
      }
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && !mod) {
      const atEdge = e.key === 'ArrowUp' ? getSelectionOffsets(el)?.start === 0 : getSelectionOffsets(el)?.end === textLength(el);
      if (atEdge) {
        e.preventDefault();
        const other = e.key === 'ArrowUp' ? store.prevVisible(block.id, false) : store.nextVisible(block.id, false);
        el.blur();
        window.getSelection()?.removeAllRanges();
        store.setSelected(other ? [other.id, block.id] : [block.id]);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      el.blur();
      window.getSelection()?.removeAllRanges();
      store.setSelected([block.id]);
      return;
    }
    if (mod && e.key.toLowerCase() === 'a' && !e.shiftKey) {
      const o = getSelectionOffsets(el);
      if (o && o.start === 0 && o.end >= textLength(el)) {
        e.preventDefault();
        el.blur();
        window.getSelection()?.removeAllRanges();
        store.setSelected(store.children(null).map((b) => b.id));
      }
      return;
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i' || k === 'u') {
        e.preventDefault();
        document.execCommand('styleWithCSS', false, 'false');
        document.execCommand(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
        commit();
        return;
      }
      if (k === 'e') {
        e.preventDefault();
        toggleWrap(el, 'code');
        commit();
        return;
      }
      if (k === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('editor:link'));
        return;
      }
      if (k === 'd') {
        e.preventDefault();
        const ids = duplicateBlocks(store, [block.id]);
        if (ids[0]) store.requestFocus({ id: ids[0], at: 'end' });
        return;
      }
    }
    if (mod && e.shiftKey && ['s', 'x'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      document.execCommand('strikeThrough');
      commit();
      return;
    }
    if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveSibling(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (mod && e.altKey && /^Digit[0-9]$/.test(e.code)) {
      e.preventDefault();
      const d = e.code.slice(5);
      const map: Record<string, BlockType> = { '0': 'text', '1': 'heading_1', '2': 'heading_2', '3': 'heading_3', '4': 'to_do', '5': 'bulleted_list', '6': 'numbered_list', '7': 'toggle', '8': 'code' };
      if (map[d]) {
        turnInto(store, [block.id], map[d]);
        store.requestFocus({ id: block.id, at: 'end' });
      }
      if (d === '9') ctx.createSubpage({ after: block.id });
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const el = ref.current!;
    const cd = e.clipboardData;
    const custom = cd.getData('application/x-notion-clone-blocks');
    const htmlData = cd.getData('text/html');
    const text = cd.getData('text/plain');
    const files = Array.from(cd.files || []);
    e.preventDefault();
    if (files.length) {
      window.dispatchEvent(new CustomEvent('editor:paste-files', { detail: { blockId: block.id, files } }));
      return;
    }
    const isEmpty = textLength(el) === 0;
    const replace = isEmpty && block.type === 'text' ? block.id : undefined;
    if (custom) {
      try {
        insertSpecs(store, JSON.parse(custom), block.id, replace);
        return;
      } catch {
        /* fall through */
      }
    }
    const sel = window.getSelection();
    const trimmed = text.trim();
    if (sel && !sel.isCollapsed && /^https?:\/\/\S+$/.test(trimmed)) {
      document.execCommand('createLink', false, trimmed);
      el.querySelectorAll('a:not([target])').forEach((a) => {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      });
      commit();
      return;
    }
    let specs: ReturnType<typeof markdownToBlocks> | null = null;
    if (htmlData) {
      const blocks = htmlToBlocks(htmlData);
      if (blocks.length > 1 || (blocks.length === 1 && blocks[0].type !== 'text')) specs = blocks;
      else if (blocks.length === 1) {
        insertHtmlAtCaret(el, sanitize(sanitizeInline(blocks[0].content.text)));
        commit();
        return;
      }
    }
    if (!specs && text.includes('\n')) specs = markdownToBlocks(text);
    if (specs && specs.length) {
      if (specs.length === 1 && specs[0].type === 'text' && !specs[0].children) {
        insertHtmlAtCaret(el, specs[0].content.text);
        commit();
        return;
      }
      insertSpecs(store, specs, block.id, replace);
      return;
    }
    insertHtmlAtCaret(el, escapeHtml(text).replace(/\n/g, '<br>'));
    commit();
  };

  const onFocus = () => {
    store.clearSelection();
    window.dispatchEvent(new CustomEvent('editor:focus-block', { detail: { blockId: block.id } }));
  };

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const mention = t.closest('.mention') as HTMLElement | null;
    if (mention?.dataset.type === 'page' && mention.dataset.id) {
      e.preventDefault();
      ctx.navigate(mention.dataset.id);
      return;
    }
    const a = t.closest('a') as HTMLAnchorElement | null;
    if (a && (e.metaKey || e.ctrlKey || readOnly)) {
      e.preventDefault();
      window.open(a.href, '_blank', 'noopener');
      return;
    }
    const anchor = t.closest('[data-discussion]') as HTMLElement | null;
    if (anchor?.dataset.discussion) ctx.openDiscussion(block.id, anchor.getBoundingClientRect(), anchor.dataset.discussion);
  };

  const onBlur = () => {
    if (ctx.menu?.blockId === block.id)
      setTimeout(() => {
        if (document.activeElement !== ref.current) ctx.setMenu(null);
      }, 150);
  };

  const empty = !block.content.text || block.content.text === '<br>';
  return (
    <div
      ref={ref}
      className={`rich ${className} ${empty ? 'is-empty' : ''} ${alwaysPlaceholder ? 'ph-always' : ''}`}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      data-editable-id={block.id}
      style={style}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onClick}
    />
  );
}
