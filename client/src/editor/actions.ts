import type { Block, BlockType } from '../types';
import { EditorStore, TEXT_TYPES, isTextual, type Tx } from './EditorStore';
import type { BlockSpec } from './paste';
import { splitHtmlAt, textLength, getSelectionOffsets } from '../lib/caret';
import { uuid } from '../lib/format';

const LIST_TYPES = new Set<BlockType>(['bulleted_list', 'numbered_list', 'to_do', 'toggle']);
const CONTINUE_TYPES = new Set<BlockType>(['bulleted_list', 'numbered_list', 'to_do', 'toggle']);

export function emptyContentFor(type: BlockType, extra: Record<string, any> = {}): Record<string, any> {
  switch (type) {
    case 'to_do':
      return { text: '', checked: false, ...extra };
    case 'callout':
      return { text: '', icon: '💡', color: 'gray_background', ...extra };
    case 'code':
      return { text: '', language: 'plain text', ...extra };
    case 'table':
      return { rows: [['', '', ''], ['', '', ''], ['', '', '']], headerRow: true, ...extra };
    default:
      return TEXT_TYPES.has(type) ? { text: '', ...extra } : { ...extra };
  }
}

/** Enter key: split the block at the caret. */
export function splitBlock(store: EditorStore, block: Block, el: HTMLElement) {
  const sel = getSelectionOffsets(el);
  if (!sel) return;
  if (sel.start !== sel.end) {
    window.getSelection()?.getRangeAt(0).deleteContents();
  }
  const offset = sel.start;
  const text = el.innerHTML;
  const isEmpty = textLength(el) === 0;

  // Empty list-like block: outdent or turn into text (Notion behaviour).
  if (isEmpty && (LIST_TYPES.has(block.type) || block.type === 'quote' || block.type === 'callout')) {
    const parent = block.parentId ? store.get(block.parentId) : null;
    if (parent && parent.type !== 'column' && LIST_TYPES.has(parent.type)) return outdent(store, block);
    store.transact((tx) => tx.update(block.id, { type: 'text', content: { text: '', color: block.content.color } }), { focusAfter: { id: block.id, at: 0 } });
    return;
  }

  const [before, after] = splitHtmlAt(el, offset);
  const nextType: BlockType = CONTINUE_TYPES.has(block.type) ? block.type : 'text';
  const newContent = emptyContentFor(nextType);
  if (block.content.color && nextType === block.type) newContent.color = block.content.color;

  // Caret at the very start of a non-empty block: insert an empty block above.
  if (offset === 0 && !isEmpty) {
    store.transact(
      (tx) => {
        tx.insert({ type: block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3' ? 'text' : nextType, content: { ...newContent, text: '' } }, { before: block.id });
      },
      { focusAfter: { id: block.id, at: 0 } },
    );
    return;
  }

  let newId = '';
  store.transact((tx) => {
    tx.update(block.id, { content: { ...block.content, text: before } });
    const kids = store.children(block.id);
    const open = store.isOpen(block);
    const isToggle = block.type === 'toggle' || (block.type.startsWith('heading_') && block.content.toggleable);
    if (isToggle && open) {
      // open toggle: new block becomes its first child
      const nb = tx.insert({ type: 'text', content: { text: after } }, kids.length ? { before: kids[0].id } : { parentId: block.id });
      newId = nb.id;
    } else {
      const nb = tx.insert({ type: nextType, content: { ...newContent, text: after } }, { after: block.id });
      newId = nb.id;
      // children of a non-toggle list item move to the new block when splitting in the middle
      if (!isToggle && LIST_TYPES.has(block.type) && after && kids.length) {
        for (const k of kids) tx.update(k.id, { parentId: newId });
      }
    }
  });
  store.requestFocus({ id: newId, at: 0 });
}

/** Backspace at the start of a block. Returns true if handled. */
export function backspaceAtStart(store: EditorStore, block: Block, el: HTMLElement, focusTitle: () => void): boolean {
  if (block.type !== 'text') {
    const keep = block.type === 'code' ? { text: el.textContent || '' } : { text: block.content.text || '' };
    store.transact((tx) => tx.update(block.id, { type: 'text', content: { ...keep, ...(block.content.color ? { color: block.content.color } : {}) } }), {
      focusAfter: { id: block.id, at: 0 },
    });
    return true;
  }
  const parent = block.parentId ? store.get(block.parentId) : null;
  if (parent && parent.type !== 'column' && store.siblings(block.id).slice(-1)[0]?.id === block.id) {
    outdent(store, block);
    return true;
  }
  const prev = store.prevVisible(block.id, false);
  if (!prev) {
    if (textLength(el) === 0 && store.visibleOrder().length > 1) {
      const next = store.nextVisible(block.id);
      store.transact((tx) => tx.remove(block.id), { focusAfter: next ? { id: next.id, at: 0 } : null });
    } else focusTitle();
    return true;
  }
  if (!isTextual(prev.type) || prev.type === 'code') {
    if (textLength(el) === 0) {
      store.transact((tx) => tx.remove(block.id));
      store.setSelected([prev.id]);
      (document.activeElement as HTMLElement)?.blur();
    } else {
      store.setSelected([prev.id]);
      (document.activeElement as HTMLElement)?.blur();
    }
    return true;
  }
  mergeInto(store, prev, block);
  return true;
}

/** Appends `block`'s text to `target` and removes `block` (moving its children). */
export function mergeInto(store: EditorStore, target: Block, block: Block) {
  const targetEl = store.editables.get(target.id);
  const caretAt = targetEl ? textLength(targetEl) : (target.content.text || '').length;
  store.transact(
    (tx) => {
      tx.update(target.id, { content: { ...target.content, text: (target.content.text || '') + (block.content.text || '') } });
      for (const k of store.children(block.id)) tx.move(k.id, { parentId: store.hasChildrenArea(target) ? target.id : target.parentId });
      tx.remove(block.id);
    },
    { focusAfter: { id: target.id, at: caretAt } },
  );
}

export function deleteForward(store: EditorStore, block: Block) {
  const next = store.nextVisible(block.id, false);
  if (!next) return;
  if (!TEXT_TYPES.has(next.type)) {
    return;
  }
  mergeInto(store, block, next);
}

export function indent(store: EditorStore, block: Block) {
  const sibs = store.siblings(block.id);
  const i = sibs.findIndex((s) => s.id === block.id);
  const prev = sibs[i - 1];
  if (!prev || !store.hasChildrenArea(prev) || prev.type === 'column_list') return;
  const focus = store.currentFocus();
  store.transact((tx) => tx.move(block.id, { parentId: prev.id }), { focusAfter: focus });
  if (prev.type === 'toggle' || prev.content.toggleable) store.setOpen(prev.id, true);
}

export function outdent(store: EditorStore, block: Block) {
  const parent = block.parentId ? store.get(block.parentId) : null;
  if (!parent || parent.type === 'column') return;
  const focus = store.currentFocus() || { id: block.id, at: 0 };
  store.transact(
    (tx) => {
      // following siblings become children of the outdented block (Notion behaviour)
      const sibs = store.siblings(block.id);
      const i = sibs.findIndex((s) => s.id === block.id);
      const following = sibs.slice(i + 1);
      tx.move(block.id, { after: parent.id });
      for (const f of following) tx.move(f.id, { parentId: block.id });
    },
    { focusAfter: focus },
  );
}

export function turnInto(store: EditorStore, ids: string[], type: BlockType, extra: Record<string, any> = {}) {
  store.transact((tx) => {
    for (const id of ids) {
      const b = store.get(id);
      if (!b || b.type === 'page' || b.type === 'child_database') continue;
      if (!isTextual(b.type)) continue;
      const text = b.type === 'code' ? escapeText(b.content.text || '') : b.content.text || '';
      const content: Record<string, any> = { ...emptyContentFor(type), text: type === 'code' ? htmlToPlain(text) : text };
      if (b.content.color && type !== 'code') content.color = b.content.color;
      if (b.type === 'to_do' && type === 'to_do') content.checked = b.content.checked;
      if (extra.toggleable) content.toggleable = true;
      tx.update(id, { type, content });
    }
  });
}

function escapeText(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function htmlToPlain(html: string) {
  const d = document.createElement('div');
  d.innerHTML = html.replace(/<br\s*\/?>/g, '\n');
  return d.textContent || '';
}

export function setColor(store: EditorStore, ids: string[], color: string) {
  store.transact((tx) => {
    for (const id of ids) {
      const b = store.get(id);
      if (!b) continue;
      const content = { ...b.content };
      if (color === 'default') delete content.color;
      else content.color = color;
      tx.update(id, { content });
    }
  });
}

/** Deep-copies blocks (with children) and inserts copies after the last one. */
export function duplicateBlocks(store: EditorStore, ids: string[]) {
  const newIds: string[] = [];
  store.transact((tx) => {
    let anchor = ids[ids.length - 1];
    for (const id of ids) {
      const b = store.get(id);
      if (!b) continue;
      const copy = copyTree(store, tx, b, { after: anchor });
      newIds.push(copy.id);
      anchor = copy.id;
    }
  });
  return newIds;
}

function copyTree(store: EditorStore, tx: Tx, b: Block, where: Parameters<Tx['insert']>[1]): Block {
  const isPage = b.type === 'page' || b.type === 'child_database';
  const nb = tx.insert({ type: isPage ? 'link_to_page' : b.type, content: JSON.parse(JSON.stringify(b.content)) }, where);
  for (const c of store.children(b.id)) copyTree(store, tx, c, { parentId: nb.id });
  return nb;
}

export function deleteBlocks(store: EditorStore, ids: string[]) {
  const order = store.visibleOrder();
  const firstIdx = order.findIndex((b) => ids.includes(b.id));
  const prev = order.slice(0, Math.max(0, firstIdx)).reverse().find((b) => !ids.includes(b.id) && isTextual(b.type));
  store.transact((tx) => {
    for (const id of ids) tx.remove(id);
  }, { focusAfter: prev ? { id: prev.id, at: 'end' } : null });
  cleanupColumns(store);
  store.clearSelection();
}

export type DropPos = 'before' | 'after' | 'left' | 'right' | 'inside';

/** Moves blocks relative to a target (drag & drop). Creates column layouts for left/right drops. */
export function moveBlocks(store: EditorStore, ids: string[], targetId: string, pos: DropPos) {
  const target = store.get(targetId);
  if (!target || ids.includes(targetId) || ids.some((id) => store.isAncestor(id, targetId))) return;
  store.transact((tx) => {
    if (pos === 'before' || pos === 'after') {
      let anchor = targetId;
      const list = pos === 'before' ? ids : ids;
      if (pos === 'before') {
        for (const id of list) tx.move(id, { before: targetId });
      } else {
        for (const id of list) {
          tx.move(id, { after: anchor });
          anchor = id;
        }
      }
    } else if (pos === 'inside') {
      for (const id of ids) tx.move(id, { parentId: targetId });
    } else {
      const parent = target.parentId ? store.get(target.parentId) : null;
      if (parent?.type === 'column') {
        const col = tx.insert({ type: 'column', content: {} }, pos === 'left' ? { before: parent.id } : { after: parent.id });
        for (const id of ids) tx.move(id, { parentId: col.id });
      } else {
        const list = tx.insert({ type: 'column_list', content: {} }, { before: targetId });
        const c1 = tx.insert({ type: 'column', content: {} }, { parentId: list.id });
        const c2 = tx.insert({ type: 'column', content: {} }, { parentId: list.id });
        const [targetCol, movedCol] = pos === 'left' ? [c2, c1] : [c1, c2];
        tx.move(targetId, { parentId: targetCol.id });
        for (const id of ids) tx.move(id, { parentId: movedCol.id });
      }
    }
  });
  cleanupColumns(store);
}

/** Removes empty columns and unwraps column lists with a single column. */
export function cleanupColumns(store: EditorStore) {
  const lists = [...store.blocks.values()].filter((b) => b.type === 'column_list');
  if (!lists.length) return;
  const stray = [...store.blocks.values()].filter((b) => b.type === 'column' && store.get(b.parentId || '')?.type !== 'column_list');
  const work = lists.filter((l) => {
    const cols = store.children(l.id);
    return cols.length < 2 || cols.some((c) => store.children(c.id).length === 0);
  });
  if (!work.length && !stray.length) return;
  store.transact(
    (tx) => {
      for (const l of work) {
        const cols = store.children(l.id).filter((c) => {
          if (store.children(c.id).length === 0) {
            tx.remove(c.id);
            return false;
          }
          return true;
        });
        if (cols.length <= 1) {
          let anchor = l.id;
          for (const c of cols) {
            for (const k of store.children(c.id)) {
              tx.move(k.id, { after: anchor });
              anchor = k.id;
            }
            tx.remove(c.id);
          }
          tx.remove(l.id);
        }
      }
      for (const s of stray) {
        let anchor = s.id;
        for (const k of store.children(s.id)) {
          tx.move(k.id, { after: anchor });
          anchor = k.id;
        }
        tx.remove(s.id);
      }
    },
    { key: 'cleanup' },
  );
}

export function createColumns(store: EditorStore, afterId: string | null, count: number, replaceId?: string) {
  let firstChild = '';
  store.transact((tx) => {
    const list = tx.insert({ type: 'column_list', content: {} }, afterId ? { after: afterId } : { parentId: null });
    for (let i = 0; i < count; i++) {
      const col = tx.insert({ type: 'column', content: {} }, { parentId: list.id });
      const t = tx.insert({ type: 'text', content: { text: '' } }, { parentId: col.id });
      if (i === 0) firstChild = t.id;
    }
    if (replaceId) tx.remove(replaceId);
  });
  store.requestFocus({ id: firstChild, at: 0 });
}

/** Inserts pasted block specs after a block; returns the id of the last inserted top-level block. */
export function insertSpecs(store: EditorStore, specs: BlockSpec[], afterId: string | null, replaceEmptyId?: string) {
  let last = '';
  store.transact((tx) => {
    let anchor = afterId;
    const add = (spec: BlockSpec, where: Parameters<Tx['insert']>[1]) => {
      const b = tx.insert({ id: uuid(), type: spec.type, content: spec.content }, where);
      for (const c of spec.children || []) add(c, { parentId: b.id });
      return b;
    };
    for (const spec of specs) {
      const b = add(spec, anchor ? { after: anchor } : { parentId: null });
      anchor = b.id;
      last = b.id;
    }
    if (replaceEmptyId) tx.remove(replaceEmptyId);
  });
  const lastBlock = store.get(last);
  if (lastBlock && isTextual(lastBlock.type)) store.requestFocus({ id: last, at: 'end' });
  return last;
}

/** Serializes blocks (with descendants) for the clipboard. */
export function serializeBlocks(store: EditorStore, ids: string[]): BlockSpec[] {
  const ser = (b: Block): BlockSpec => ({
    type: b.type === 'page' || b.type === 'child_database' ? 'link_to_page' : b.type,
    content: b.content,
    children: store.children(b.id).map(ser),
  });
  return ids.map((id) => store.get(id)).filter(Boolean).map((b) => ser(b!));
}

export function blocksToPlainText(store: EditorStore, ids: string[]): string {
  const lines: string[] = [];
  const walk = (b: Block, depth: number) => {
    const pad = '  '.repeat(depth);
    const d = document.createElement('div');
    d.innerHTML = (b.content.text || '').replace(/<br\s*\/?>/g, '\n');
    const t = b.type === 'code' ? b.content.text : d.textContent || '';
    const prefix: Record<string, string> = { bulleted_list: '- ', numbered_list: '1. ', to_do: b.content.checked ? '- [x] ' : '- [ ] ', heading_1: '# ', heading_2: '## ', heading_3: '### ', quote: '> ', toggle: '- ' };
    if (b.type === 'divider') lines.push(pad + '---');
    else if (b.type === 'code') lines.push('```' + (b.content.language || ''), t, '```');
    else if (b.content.url) lines.push(pad + b.content.url);
    else if (t || TEXT_TYPES.has(b.type)) lines.push(pad + (prefix[b.type] || '') + t);
    for (const c of store.children(b.id)) walk(c, depth + (b.type === 'column_list' || b.type === 'column' ? 0 : 1));
  };
  for (const id of ids) {
    const b = store.get(id);
    if (b) walk(b, 0);
  }
  return lines.join('\n');
}
