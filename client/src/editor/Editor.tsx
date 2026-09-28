import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor, useStoreValue } from './context';
import { BlockChildren } from './BlockView';
import { SlashMenu, MentionMenu } from './Menus';
import { InlineToolbar } from './InlineToolbar';
import { focusAt } from '../lib/caret';
import { dragState, clearDrag } from './dnd';
import { moveBlocks, deleteBlocks, duplicateBlocks, serializeBlocks, blocksToPlainText, insertSpecs, indent, outdent, type DropPos } from './actions';
import { isTextual } from './EditorStore';
import { api } from '../api';
import { useApp } from '../store';
import { hasOpenPopover } from '../components/ui';
import { markdownToBlocks } from './paste';

const INTERACTIVE = 'input, textarea, select, button, a, [contenteditable="true"], .rich, .inline-editable, .block-gutter, .popover, .inline-db, .media-frame, .code-block, .db-view, .page-link, .bookmark, .equation-block, .simple-table-wrap, .callout-icon, .checkbox, .toggle-arrow';

export function Editor() {
  const ctx = useEditor();
  const { store, readOnly } = ctx;
  const rootRef = useRef<HTMLDivElement>(null);
  const version = useStoreValue(store, () => store.version);
  const empty = useStoreValue(store, () => store.children(null).length === 0);
  const [dropIndicator, setDropIndicator] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const toast = useApp((s) => s.toast);

  // Process focus requests after render
  useLayoutEffect(() => {
    const req = store.focusRequest;
    if (!req) return;
    const el = store.editables.get(req.id);
    if (el) {
      store.focusRequest = null;
      focusAt(el, req.at);
    }
  }, [version, store]);

  // ----- keyboard: undo/redo + block selection -----
  useEffect(() => {
    const inThisEditor = (node: Node | null) => !!node && !!rootRef.current?.contains(node);
    const onKey = (e: KeyboardEvent) => {
      if (readOnly) return;
      const mod = e.metaKey || e.ctrlKey;
      const active = document.activeElement as HTMLElement | null;
      const editingHere = active && inThisEditor(active);
      const typingElsewhere = active && !editingHere && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (mod && e.key.toLowerCase() === 'z' && !typingElsewhere) {
        if (!editingHere && !store.selected.size && active !== document.body) return;
        if (!editingHere && !store.selected.size && !store.canUndo()) return;
        if (active?.closest('.inline-editable')) return;
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !typingElsewhere && (editingHere || store.selected.size)) {
        e.preventDefault();
        store.redo();
        return;
      }
      if (!store.selected.size || editingHere || typingElsewhere || hasOpenPopover()) return;
      const ids = store.selectedTopLevel();
      if (!ids.length) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteBlocks(store, ids);
      } else if (e.key === 'Escape') {
        store.clearSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const b = store.get(ids[ids.length - 1]);
        if (b && isTextual(b.type)) {
          store.clearSelection();
          store.requestFocus({ id: b.id, at: 'end' });
        } else if (b && (b.type === 'page' || b.type === 'link_to_page')) ctx.navigate(b.content.pageId);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const order = store.visibleOrder();
        const idx = order.map((b) => b.id);
        const first = idx.indexOf(ids[0]);
        const last = idx.indexOf(ids[ids.length - 1]);
        if (e.shiftKey) {
          const next = e.key === 'ArrowUp' ? order[first - 1] : order[last + 1];
          if (next) store.setSelected([...ids, next.id]);
        } else {
          const next = e.key === 'ArrowUp' ? order[Math.max(0, first - 1)] : order[Math.min(order.length - 1, last + 1)];
          if (next) store.setSelected([next.id]);
        }
        const el = document.querySelector(`[data-block-id="${store.selectedTopLevel()[0]}"]`);
        el?.scrollIntoView({ block: 'nearest' });
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        store.setSelected(duplicateBlocks(store, ids));
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        store.setSelected(store.children(null).map((b) => b.id));
      } else if (e.key === 'Tab') {
        e.preventDefault();
        for (const id of ids) {
          const b = store.get(id);
          if (b) (e.shiftKey ? outdent : indent)(store, b);
        }
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (!store.selected.size || (active && inThisEditor(active) && active.isContentEditable)) return;
      const ids = store.selectedTopLevel();
      if (!ids.length || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', blocksToPlainText(store, ids));
      e.clipboardData.setData('application/x-notion-clone-blocks', JSON.stringify(serializeBlocks(store, ids)));
      if (e.type === 'cut' && !readOnly) deleteBlocks(store, ids);
    };
    const onPaste = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (readOnly || !store.selected.size || (active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'))) return;
      const ids = store.selectedTopLevel();
      if (!ids.length || !e.clipboardData) return;
      e.preventDefault();
      const custom = e.clipboardData.getData('application/x-notion-clone-blocks');
      const specs = custom ? JSON.parse(custom) : markdownToBlocks(e.clipboardData.getData('text/plain'));
      if (specs.length) insertSpecs(store, specs, ids[ids.length - 1]);
      store.clearSelection();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, [store, readOnly, ctx]);

  // ----- mouse: clear selection, marquee selection, cross-block text drag -----
  useEffect(() => {
    const root = rootRef.current!;
    const scroller = root.closest('.page-scroller, .peek-scroller') as HTMLElement | null;
    const blockEls = () =>
      Array.from(root.querySelectorAll<HTMLElement>('.block-wrap[data-block-id]')).filter((el) => !el.parentElement?.closest('.inline-db'));
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest('.popover, .inline-toolbar, .modal')) return;
      const inside = scroller ? scroller.contains(t) : root.contains(t);
      if (!inside) return;
      if (t.closest('.block-gutter')) return;
      if (t.closest('.inline-db') && root.contains(t)) return;
      const startBlock = (t.closest('.block-wrap[data-block-id]') as HTMLElement | null)?.dataset.blockId;
      if (store.selected.size && !(startBlock && store.selected.has(startBlock) && !t.closest('.rich'))) store.clearSelection();
      if (t.closest('.page-header, .page-properties, .db-view, .page-comments, .page-title')) return;
      const inText = t.closest('.rich, .inline-editable, code');
      if (!inText && t.closest(INTERACTIVE)) return;
      if (readOnly && !inText) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let marqueeOn = false;
      const move = (ev: MouseEvent) => {
        if (inText) {
          const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
          const id = (under?.closest('.block-wrap[data-block-id]') as HTMLElement | null)?.dataset.blockId;
          if (!startBlock || !id || id === startBlock || !root.contains(under!)) return;
          if (store.isAncestor(id, startBlock) || store.isAncestor(startBlock, id)) return;
          const order = store.visibleOrder().map((b) => b.id);
          const a = order.indexOf(startBlock);
          const b = order.indexOf(id);
          if (a < 0 || b < 0) return;
          window.getSelection()?.removeAllRanges();
          (document.activeElement as HTMLElement)?.blur();
          store.setSelected(order.slice(Math.min(a, b), Math.max(a, b) + 1));
          return;
        }
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        if (!marqueeOn && Math.hypot(dx, dy) < 5) return;
        marqueeOn = true;
        ev.preventDefault();
        window.getSelection()?.removeAllRanges();
        const box = { x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), w: Math.abs(dx), h: Math.abs(dy) };
        setMarquee(box);
        const hits: string[] = [];
        for (const el of blockEls()) {
          const row = el.querySelector(':scope > .block-row') as HTMLElement | null;
          const r = (row || el).getBoundingClientRect();
          if (r.right >= box.x && r.left <= box.x + box.w && r.bottom >= box.y && r.top <= box.y + box.h) hits.push(el.dataset.blockId!);
        }
        store.setSelected(hits);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setMarquee(null);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [store, readOnly]);

  // ----- drag & drop of blocks and files -----
  const dropTarget = useRef<{ id: string; pos: DropPos } | null>(null);
  const computeDrop = (e: React.DragEvent) => {
    const root = rootRef.current!;
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    let wrap = under?.closest('.block-wrap[data-block-id]') as HTMLElement | null;
    while (wrap && wrap.parentElement?.closest('.inline-db')) wrap = wrap.parentElement.closest('.block-wrap[data-block-id]');
    if (!wrap || !root.contains(wrap)) {
      // below the last block
      const last = store.children(null).slice(-1)[0];
      if (!last) return null;
      const lastEl = root.querySelector(`[data-block-id="${last.id}"]`) as HTMLElement | null;
      if (lastEl && e.clientY > lastEl.getBoundingClientRect().bottom) return { id: last.id, pos: 'after' as DropPos, el: lastEl };
      return null;
    }
    const id = wrap.dataset.blockId!;
    const b = store.get(id);
    if (!b) return null;
    if (b.type === 'column_list') return null;
    const row = (wrap.querySelector(':scope > .block-row') as HTMLElement) || wrap;
    const r = row.getBoundingClientRect();
    let pos: DropPos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    const parent = b.parentId ? store.get(b.parentId) : null;
    const columnable = !b.parentId || parent?.type === 'column';
    if (columnable && dragState.blockIds && e.clientX > r.right - 50) pos = 'right';
    else if (columnable && dragState.blockIds && e.clientX < r.left + 30 && e.clientX > r.left - 10 && !dragState.blockIds.includes(id)) pos = 'left';
    if (under?.closest('.empty-toggle')) pos = 'inside';
    return { id, pos, el: wrap };
  };

  const onDragOver = (e: React.DragEvent) => {
    if (readOnly) return;
    const files = e.dataTransfer.types.includes('Files');
    if (!files && !(dragState.blockIds && dragState.pageId === store.pageId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = files ? 'copy' : 'move';
    const t = computeDrop(e);
    if (!t || (dragState.blockIds?.includes(t.id) && t.pos !== 'inside')) {
      dropTarget.current = null;
      setDropIndicator(null);
      return;
    }
    dropTarget.current = { id: t.id, pos: t.pos };
    const row = (t.el.querySelector(':scope > .block-row') as HTMLElement) || t.el;
    const r = row.getBoundingClientRect();
    const content = (row.querySelector('.block-content') as HTMLElement | null)?.getBoundingClientRect() || r;
    if (t.pos === 'left' || t.pos === 'right') setDropIndicator({ top: r.top, left: t.pos === 'left' ? content.left - 4 : content.right + 2, width: 3, height: r.height });
    else if (t.pos === 'inside') setDropIndicator({ top: r.bottom, left: content.left + 24, width: content.width - 24, height: 3 });
    else setDropIndicator({ top: t.pos === 'before' ? r.top - 2 : t.el.getBoundingClientRect().bottom - 1, left: content.left, width: content.width, height: 3 });
  };

  const onDrop = async (e: React.DragEvent) => {
    const target = dropTarget.current;
    setDropIndicator(null);
    dropTarget.current = null;
    if (readOnly) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) {
      e.preventDefault();
      await insertFiles(files, target ? target.id : null, target?.pos === 'before');
      return;
    }
    if (!dragState.blockIds || !target) return;
    e.preventDefault();
    moveBlocks(store, dragState.blockIds, target.id, target.pos);
    clearDrag();
  };

  const insertFiles = async (files: File[], anchorId: string | null, before = false) => {
    let anchor = anchorId;
    for (const f of files) {
      try {
        const r = await api.upload(f);
        const type = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'file';
        let nid = '';
        store.transact((tx) => {
          nid = tx.insert({ type, content: { url: r.url, name: r.name, size: r.size } }, anchor ? (before ? { before: anchor } : { after: anchor }) : { parentId: null }).id;
        });
        anchor = nid;
        before = false;
      } catch (err: any) {
        toast(err.message || 'Upload failed', { kind: 'error' });
      }
    }
  };

  useEffect(() => {
    const onPasteFiles = (e: Event) => {
      const { blockId, files } = (e as CustomEvent).detail;
      if (!store.blocks.has(blockId)) return;
      const b = store.get(blockId);
      const emptyText = b && b.type === 'text' && !b.content.text;
      insertFiles(files, blockId).then(() => {
        if (emptyText) store.transact((tx) => tx.remove(blockId));
      });
    };
    window.addEventListener('editor:paste-files', onPasteFiles);
    return () => window.removeEventListener('editor:paste-files', onPasteFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const onBottomClick = () => {
    if (readOnly) return;
    const roots = store.children(null);
    const last = roots[roots.length - 1];
    if (last && last.type === 'text' && !last.content.text) {
      store.requestFocus({ id: last.id, at: 'end' });
      return;
    }
    let nid = '';
    store.transact((tx) => (nid = tx.insert({ type: 'text', content: { text: '' } }, { parentId: null }).id));
    store.requestFocus({ id: nid, at: 0 });
  };

  return (
    <div className="editor" ref={rootRef} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropIndicator(null)} data-testid="editor">
      <BlockChildren parentId={null} />
      {empty && !readOnly && (
        <div className="editor-empty-hint" onClick={onBottomClick}>
          <span className="faint">Write something, or press '/' for commands…</span>
        </div>
      )}
      <div className="editor-bottom" onClick={onBottomClick} />
      {ctx.menu && ctx.menu.kind === 'slash' && <SlashMenu menu={ctx.menu} />}
      {ctx.menu && (ctx.menu.kind === 'mention' || ctx.menu.kind === 'link') && <MentionMenu menu={ctx.menu} />}
      <InlineToolbar />
      {dropIndicator && <div className="drop-indicator" style={dropIndicator} />}
      {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
    </div>
  );
}
