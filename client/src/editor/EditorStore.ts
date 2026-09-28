import { api } from '../api';
import type { Block, BlockType, Op } from '../types';
import { between, uuid } from '../lib/format';

// Client-side model of one page's block tree.
//  * All local edits go through `transact`, which records before/after
//    snapshots for undo/redo and produces ops for the server.
//  * Ops are queued, coalesced and flushed to POST /pages/:id/transactions.
//  * Remote ops (from other users via WebSocket) are applied with applyRemote.

type Snapshot = Map<string, Block | null>;
interface UndoEntry {
  key?: string;
  time: number;
  before: Snapshot;
  after: Snapshot;
  focusBefore?: FocusReq | null;
  focusAfter?: FocusReq | null;
}
export interface FocusReq {
  id: string;
  at: 'start' | 'end' | number;
  selEnd?: number;
}

export interface Tx {
  insert(b: Partial<Block> & { type: BlockType }, where?: { after?: string; before?: string; parentId?: string | null; position?: number }): Block;
  update(id: string, patch: Partial<Pick<Block, 'type' | 'content' | 'parentId' | 'position'>>): void;
  remove(id: string, opts?: { keepPage?: boolean }): void;
  move(id: string, where: { after?: string; before?: string; parentId?: string | null; position?: number }): void;
  get(id: string): Block | undefined;
}

const openToggles: Set<string> = (() => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem('openToggles') || '[]'));
  } catch {
    return new Set<string>();
  }
})();

export const TEXT_TYPES = new Set<BlockType>(['text', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list', 'numbered_list', 'to_do', 'toggle', 'quote', 'callout']);
export const isTextual = (t: BlockType) => TEXT_TYPES.has(t) || t === 'code';

export class EditorStore {
  pageId: string;
  readOnly: boolean;
  blocks = new Map<string, Block>();
  version = 0;
  private listeners = new Set<() => void>();
  private childCache: Map<string, Block[]> | null = null;
  focusRequest: FocusReq | null = null;
  selected = new Set<string>();
  editables = new Map<string, HTMLElement>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private queue: Op[] = [];
  private flushTimer = 0;
  private sending = false;
  private retries = 0;
  saving = false;
  onError: (msg: string, fatal?: boolean) => void = () => {};
  onPageBlockDeleted: (pageId: string) => void = () => {};
  /** Block whose media picker should open automatically after insertion via the slash menu. */
  autoOpen: string | null = null;

  constructor(pageId: string, blocks: Block[], readOnly = false) {
    this.pageId = pageId;
    this.readOnly = readOnly;
    for (const b of blocks) this.blocks.set(b.id, b);
  }

  // ---------- subscription ----------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    this.childCache = null;
    this.listeners.forEach((l) => l());
  }

  reset(blocks: Block[]) {
    this.blocks = new Map(blocks.map((b) => [b.id, b]));
    this.undoStack = [];
    this.redoStack = [];
    this.selected.clear();
    this.emit();
  }

  // ---------- queries ----------
  get(id: string) {
    return this.blocks.get(id);
  }

  children(parentId: string | null): Block[] {
    if (!this.childCache) {
      const m = new Map<string, Block[]>();
      for (const b of this.blocks.values()) {
        const k = b.parentId || '';
        let arr = m.get(k);
        if (!arr) m.set(k, (arr = []));
        arr.push(b);
      }
      for (const arr of m.values()) arr.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
      this.childCache = m;
    }
    return this.childCache.get(parentId || '') || [];
  }

  siblings(id: string) {
    const b = this.blocks.get(id);
    return b ? this.children(b.parentId) : [];
  }

  isCollapsed(b: Block) {
    if (b.type === 'toggle' || (b.type.startsWith('heading_') && b.content.toggleable)) return !this.isOpen(b);
    return false;
  }

  // Toggle open/closed state is per-viewer (like Notion), persisted locally.
  isOpen(b: Block) {
    return openToggles.has(b.id);
  }

  setOpen(id: string, open: boolean) {
    if (open) openToggles.add(id);
    else openToggles.delete(id);
    try {
      localStorage.setItem('openToggles', JSON.stringify([...openToggles].slice(-2000)));
    } catch {
      /* ignore */
    }
    this.emit();
  }

  hasChildrenArea(b: Block) {
    return !['page', 'child_database', 'divider', 'image', 'video', 'audio', 'file', 'bookmark', 'embed', 'equation', 'table_of_contents', 'table', 'code', 'link_to_page', 'breadcrumb'].includes(b.type);
  }

  /** Blocks in visual reading order (skipping collapsed toggle children). */
  visibleOrder(): Block[] {
    const out: Block[] = [];
    const walk = (parentId: string | null) => {
      for (const b of this.children(parentId)) {
        if (b.type !== 'column_list' && b.type !== 'column') out.push(b);
        if (!this.isCollapsed(b)) walk(b.id);
      }
    };
    walk(null);
    return out;
  }

  descendants(id: string): Block[] {
    const out: Block[] = [];
    const walk = (pid: string) => {
      for (const c of this.children(pid)) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  }

  depthOf(id: string) {
    let d = 0;
    let b = this.blocks.get(id);
    while (b?.parentId) {
      d++;
      b = this.blocks.get(b.parentId);
    }
    return d;
  }

  isAncestor(ancestorId: string, id: string) {
    let b = this.blocks.get(id);
    while (b?.parentId) {
      if (b.parentId === ancestorId) return true;
      b = this.blocks.get(b.parentId);
    }
    return false;
  }

  prevVisible(id: string, textualOnly = true) {
    const order = this.visibleOrder();
    const i = order.findIndex((b) => b.id === id);
    for (let j = i - 1; j >= 0; j--) if (!textualOnly || isTextual(order[j].type)) return order[j];
    return undefined;
  }

  nextVisible(id: string, textualOnly = true) {
    const order = this.visibleOrder();
    const i = order.findIndex((b) => b.id === id);
    for (let j = i + 1; j < order.length; j++) if (!textualOnly || isTextual(order[j].type)) return order[j];
    return undefined;
  }

  positionFor(where: { after?: string; before?: string; parentId?: string | null; position?: number }): { parentId: string | null; position: number } {
    if (where.after) {
      const ref = this.blocks.get(where.after)!;
      const sibs = this.children(ref.parentId);
      const i = sibs.findIndex((s) => s.id === ref.id);
      return { parentId: ref.parentId, position: between(ref.position, sibs[i + 1]?.position) };
    }
    if (where.before) {
      const ref = this.blocks.get(where.before)!;
      const sibs = this.children(ref.parentId);
      const i = sibs.findIndex((s) => s.id === ref.id);
      return { parentId: ref.parentId, position: between(sibs[i - 1]?.position, ref.position) };
    }
    const parentId = where.parentId ?? null;
    if (typeof where.position === 'number') return { parentId, position: where.position };
    const sibs = this.children(parentId);
    return { parentId, position: between(sibs[sibs.length - 1]?.position, null) };
  }

  // ---------- transactions ----------

  transact(fn: (tx: Tx) => void, opts: { key?: string; focusAfter?: FocusReq | null; undoable?: boolean } = {}) {
    if (this.readOnly) return;
    const before: Snapshot = new Map();
    const touched = new Set<string>();
    const ops: Op[] = [];
    const touch = (id: string) => {
      if (!touched.has(id)) {
        touched.add(id);
        before.set(id, this.blocks.get(id) ?? null);
      }
    };
    const tx: Tx = {
      get: (id) => this.blocks.get(id),
      insert: (partial, where = {}) => {
        const { parentId, position } = this.positionFor(where);
        const b: Block = {
          id: partial.id || uuid(),
          pageId: this.pageId,
          parentId: partial.parentId !== undefined && !where.after && !where.before ? partial.parentId : parentId,
          type: partial.type,
          content: partial.content || {},
          position: partial.position ?? position,
        };
        touch(b.id);
        this.blocks.set(b.id, b);
        this.childCache = null;
        ops.push({ type: 'insert', block: b });
        return b;
      },
      update: (id, patch) => {
        const cur = this.blocks.get(id);
        if (!cur) return;
        touch(id);
        const next = { ...cur, ...patch };
        this.blocks.set(id, next);
        this.childCache = null;
        ops.push({ type: 'update', id, set: patch });
      },
      remove: (id, o = {}) => {
        const cur = this.blocks.get(id);
        if (!cur) return;
        const all = [cur, ...this.descendants(id)];
        for (const b of all) {
          touch(b.id);
          this.blocks.delete(b.id);
          if ((b.type === 'page' || b.type === 'child_database') && !o.keepPage) this.onPageBlockDeleted(b.content.pageId);
        }
        this.selected.delete(id);
        this.childCache = null;
        ops.push({ type: 'delete', id, ...(o.keepPage ? { keepPage: true } : {}) });
      },
      move: (id, where) => {
        const cur = this.blocks.get(id);
        if (!cur) return;
        // compute position excluding the moving block itself
        this.blocks.delete(id);
        this.childCache = null;
        const { parentId, position } = this.positionFor(where);
        this.blocks.set(id, cur);
        this.childCache = null;
        tx.update(id, { parentId, position });
      },
    };
    const focusBefore = this.currentFocus();
    fn(tx);
    if (!ops.length) return;
    const after: Snapshot = new Map();
    for (const id of touched) after.set(id, this.blocks.get(id) ?? null);
    if (opts.undoable !== false) {
      const top = this.undoStack[this.undoStack.length - 1];
      const t = Date.now();
      if (opts.key && top && top.key === opts.key && t - top.time < 1500) {
        for (const [id, b] of before) if (!top.before.has(id)) top.before.set(id, b);
        for (const [id, b] of after) top.after.set(id, b);
        top.time = t;
        top.focusAfter = opts.focusAfter ?? this.currentFocus();
      } else {
        this.undoStack.push({ key: opts.key, time: t, before, after, focusBefore, focusAfter: opts.focusAfter });
        if (this.undoStack.length > 200) this.undoStack.shift();
      }
      this.redoStack = [];
    }
    if (opts.focusAfter) this.focusRequest = opts.focusAfter;
    for (const op of ops) this.enqueue(op);
    this.emit();
  }

  currentFocus(): FocusReq | null {
    const el = document.activeElement as HTMLElement | null;
    const id = el?.closest('[data-block-id]')?.getAttribute('data-block-id');
    if (!id || !this.blocks.has(id)) return null;
    const editable = this.editables.get(id);
    if (!editable) return { id, at: 'end' };
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return { id, at: 'end' };
    try {
      // lazy import avoided: compute offset via range length
      const r = document.createRange();
      r.setStart(editable, 0);
      r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
      return { id, at: r.toString().length };
    } catch {
      return { id, at: 'end' };
    }
  }

  setText(id: string, html: string) {
    const b = this.blocks.get(id);
    if (!b || b.content.text === html) return;
    this.transact((tx) => tx.update(id, { content: { ...b.content, text: html } }), { key: 'text:' + id });
  }

  setContent(id: string, patch: Record<string, any>, key?: string) {
    const b = this.blocks.get(id);
    if (!b) return;
    this.transact((tx) => tx.update(id, { content: { ...b.content, ...patch } }), { key });
  }

  requestFocus(req: FocusReq | null) {
    this.focusRequest = req;
    this.emit();
  }

  // ---------- undo / redo ----------

  canUndo() {
    return this.undoStack.length > 0;
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.restore(e.before);
    this.redoStack.push(e);
    this.focusRequest = e.focusBefore || null;
    this.emit();
    return true;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.restore(e.after);
    this.undoStack.push(e);
    this.focusRequest = e.focusAfter || null;
    this.emit();
    return true;
  }

  private restore(snap: Snapshot) {
    const inserts: Block[] = [];
    const updates: Block[] = [];
    const deletes: string[] = [];
    for (const [id, target] of snap) {
      const cur = this.blocks.get(id);
      if (!target) {
        if (cur) deletes.push(id);
      } else if (!cur) inserts.push(target);
      else updates.push(target);
    }
    // parents first for inserts
    const depth = (b: Block) => {
      let d = 0;
      let p = b.parentId;
      while (p && d < 100) {
        d++;
        p = (snap.get(p) || this.blocks.get(p))?.parentId ?? null;
      }
      return d;
    };
    inserts.sort((a, b) => depth(a) - depth(b));
    for (const b of inserts) {
      this.blocks.set(b.id, b);
      this.enqueue({ type: 'insert', block: b });
    }
    for (const b of updates) {
      this.blocks.set(b.id, b);
      this.enqueue({ type: 'update', id: b.id, set: { type: b.type, content: b.content, parentId: b.parentId, position: b.position } });
    }
    for (const id of deletes) {
      const b = this.blocks.get(id);
      this.blocks.delete(id);
      if (b && (b.type === 'page' || b.type === 'child_database')) this.onPageBlockDeleted(b.content.pageId);
      this.enqueue({ type: 'delete', id });
    }
    this.childCache = null;
  }

  // ---------- server sync ----------

  private enqueue(op: Op) {
    const last = this.queue[this.queue.length - 1];
    if (op.type === 'update' && last && last.type === 'update' && last.id === op.id) {
      last.set = { ...last.set, ...op.set };
    } else if (op.type === 'update' && last && last.type === 'insert' && last.block.id === op.id) {
      last.block = { ...last.block, ...op.set } as Block;
    } else {
      this.queue.push(op);
    }
    this.saving = true;
    window.clearTimeout(this.flushTimer);
    const structural = op.type !== 'update' || op.set.parentId !== undefined;
    this.flushTimer = window.setTimeout(() => this.flush(), structural ? 30 : 350);
  }

  async flush(): Promise<void> {
    if (this.sending || !this.queue.length) {
      if (!this.queue.length && !this.sending) this.saving = false;
      return;
    }
    const ops = this.queue;
    this.queue = [];
    this.sending = true;
    try {
      await api.post(`/api/pages/${this.pageId}/transactions`, { ops });
      this.retries = 0;
    } catch (e: any) {
      if (e?.status >= 400 && e?.status < 500) {
        this.onError(e.message || 'Could not save changes', true);
      } else {
        // network / server error: put the ops back and retry
        this.queue = [...ops, ...this.queue];
        this.retries++;
        if (this.retries === 3) this.onError('Having trouble saving — retrying…');
        this.sending = false;
        window.setTimeout(() => this.flush(), Math.min(10000, 1000 * this.retries));
        return;
      }
    }
    this.sending = false;
    if (this.queue.length) this.flush();
    else this.saving = false;
  }

  hasPending() {
    return this.queue.length > 0 || this.sending;
  }

  applyRemote(ops: Op[]) {
    let changed = false;
    for (const op of ops) {
      if (op.type === 'insert') {
        this.blocks.set(op.block.id, op.block);
        changed = true;
      } else if (op.type === 'update') {
        const b = (op as any).block as Block | undefined;
        if (b) this.blocks.set(b.id, b);
        else {
          const cur = this.blocks.get(op.id);
          if (cur) this.blocks.set(op.id, { ...cur, ...op.set });
        }
        changed = true;
      } else if (op.type === 'delete') {
        const cur = this.blocks.get(op.id);
        if (cur) {
          for (const d of [cur, ...this.descendants(op.id)]) this.blocks.delete(d.id);
          changed = true;
        }
      }
      this.childCache = null;
    }
    if (changed) this.emit();
  }

  // ---------- selection ----------

  setSelected(ids: Iterable<string>) {
    this.selected = new Set(ids);
    this.emit();
  }

  clearSelection() {
    if (!this.selected.size) return;
    this.selected = new Set();
    this.emit();
  }

  /** Selected ids in document order, excluding ones whose ancestor is also selected. */
  selectedTopLevel(): string[] {
    const order: string[] = [];
    const walk = (pid: string | null) => {
      for (const b of this.children(pid)) {
        if (this.selected.has(b.id)) order.push(b.id);
        else walk(b.id);
      }
    };
    walk(null);
    return order;
  }
}
