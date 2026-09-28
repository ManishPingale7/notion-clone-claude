import React, { useEffect, useMemo, useState } from 'react';
import { Plus, CalendarDays } from 'lucide-react';
import { useEditor, type MenuState } from './context';
import { filterSlash, type SlashItem } from './blockTypes';
import { Popover, MenuItem, useMenuNav, Avatar, PageIcon } from '../components/ui';
import { getSelectionOffsets, setCaret, textBeforeCaret, insertHtmlAtCaret } from '../lib/caret';
import { emptyContentFor, createColumns, setColor } from './actions';
import { api } from '../api';
import { useApp } from '../store';
import { escapeHtml, pageTitle, toISODate, MONTHS_LONG } from '../lib/format';
import { TEXT_TYPES } from './EditorStore';
import type { BlockType, PageMeta } from '../types';

function useQuery(menu: MenuState) {
  const { store } = useEditor();
  const el = store.editables.get(menu.blockId);
  if (!el) return null;
  const before = textBeforeCaret(el);
  if (before.length <= menu.start) return null;
  const skip = menu.kind === 'link' ? 2 : 1;
  return before.slice(menu.start + skip);
}

/** Removes the trigger + query text typed since the menu opened. */
function removeTrigger(el: HTMLElement, menu: MenuState) {
  const o = getSelectionOffsets(el);
  if (!o) return;
  setCaret(el, menu.start, o.start);
  window.getSelection()?.getRangeAt(0).deleteContents();
  el.normalize();
  setCaret(el, menu.start);
}

export function SlashMenu({ menu }: { menu: MenuState }) {
  const ctx = useEditor();
  const { store } = ctx;
  const query = useQuery(menu);
  const items = useMemo(() => filterSlash(query || ''), [query]);
  const [missCount, setMissCount] = useState(0);

  const run = (item: SlashItem) => {
    const el = store.editables.get(menu.blockId);
    const block = store.get(menu.blockId);
    ctx.setMenu(null);
    if (!el || !block) return;
    removeTrigger(el, menu);
    ctx.commitText(block.id);
    const cur = store.get(block.id)!;
    const isEmpty = !(el.textContent || '').trim() && !el.querySelector('.mention');
    const a = item.action;
    if (a.kind === 'block') {
      const content = emptyContentFor(a.type, a.content || {});
      if (isEmpty && TEXT_TYPES.has(cur.type) && cur.type !== 'callout') {
        store.transact((tx) => tx.update(block.id, { type: a.type, content: TEXT_TYPES.has(a.type) || a.type === 'code' ? { ...content, text: '' } : content }), {
          focusAfter: TEXT_TYPES.has(a.type) || a.type === 'code' ? { id: block.id, at: 0 } : null,
        });
        if (!TEXT_TYPES.has(a.type) && a.type !== 'code') afterNonText(block.id, a.type);
      } else {
        let nid = '';
        store.transact((tx) => (nid = tx.insert({ type: a.type, content }, { after: block.id }).id));
        if (TEXT_TYPES.has(a.type) || a.type === 'code') store.requestFocus({ id: nid, at: 0 });
        else afterNonText(nid, a.type);
      }
    } else if (a.kind === 'page') {
      ctx.createSubpage({ after: block.id, replace: isEmpty ? block.id : undefined });
    } else if (a.kind === 'database') {
      ctx.createDatabase({ after: block.id, replace: isEmpty ? block.id : undefined, view: a.view, inline: a.inline });
    } else if (a.kind === 'columns') {
      createColumns(store, block.id, a.count, isEmpty ? block.id : undefined);
    } else if (a.kind === 'link_to_page') {
      ctx.linkPage(block.id, isEmpty);
    } else if (a.kind === 'mention') {
      el.focus();
      insertHtmlAtCaret(el, '@');
      const caret = getSelectionOffsets(el)?.start ?? 1;
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      ctx.setMenu({ kind: 'mention', blockId: block.id, start: caret - 1, rect, mentionWhat: a.what });
    } else if (a.kind === 'color') {
      setColor(store, [block.id], a.color);
      store.requestFocus({ id: block.id, at: 'end' });
    }
  };

  const afterNonText = (id: string, type: BlockType) => {
    store.autoOpen = id;
    // make sure there is a text block after media/divider blocks so typing can continue
    const next = store.siblings(id).find((b, i, arr) => arr[i - 1]?.id === id);
    if (!next && type === 'divider') {
      let nid = '';
      store.transact((tx) => (nid = tx.insert({ type: 'text', content: { text: '' } }, { after: id }).id));
      store.requestFocus({ id: nid, at: 0 });
    } else store.emit();
  };

  const nav = useMenuNav(items.length, (i) => run(items[i]), [query]);
  useEffect(() => {
    ctx.menuKey.current = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        ctx.setMenu(null);
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        ctx.setMenu(null);
        return false;
      }
      return nav.onKeyDown(e);
    };
    return () => {
      ctx.menuKey.current = null;
    };
  });
  useEffect(() => {
    if (query === null) ctx.setMenu(null);
    else if (!items.length) {
      setMissCount((n) => n + 1);
    } else setMissCount(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    if (missCount > 3 || (query && query.endsWith('  '))) ctx.setMenu(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missCount]);

  let lastGroup = '';
  return (
    <Popover anchor={menu.rect} onClose={() => ctx.setMenu(null)} placement="bottom-start" offset={6}>
      <div className="menu slash-menu" style={{ width: 324, maxHeight: 'min(40vh, 380px)' }} data-testid="slash-menu">
        {items.length === 0 && <div className="menu-empty">No results</div>}
        {items.map((it, i) => {
          const header = it.group !== lastGroup && !query ? it.group : null;
          lastGroup = it.group;
          return (
            <React.Fragment key={it.id}>
              {header && <div className="menu-label">{header}</div>}
              <MenuItem icon={<span className="slash-icon">{it.icon}</span>} label={it.label} right={it.hint} selected={i === nav.index} onMouseEnter={() => nav.setIndex(i)} onClick={() => run(it)} testId={'slash-' + it.id} />
            </React.Fragment>
          );
        })}
      </div>
      <div className="menu-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Type '/' on the page</span>
        <span>esc</span>
      </div>
    </Popover>
  );
}

interface MentionOption {
  key: string;
  section: string;
  label: React.ReactNode;
  icon: React.ReactNode;
  desc?: string;
  html?: string;
  create?: string;
}

function parseDateQuery(q: string): Date | null {
  const s = q.trim().toLowerCase();
  if (!s) return null;
  const now = new Date();
  if ('today'.startsWith(s) || s === 'now') return now;
  if ('tomorrow'.startsWith(s)) return new Date(now.getTime() + 864e5);
  if ('yesterday'.startsWith(s)) return new Date(now.getTime() - 864e5);
  const m = s.match(/^in (\d+) days?$/);
  if (m) return new Date(now.getTime() + Number(m[1]) * 864e5);
  if (/\d/.test(s)) {
    const d = new Date(q);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1900) return d;
  }
  return null;
}

export function MentionMenu({ menu }: { menu: MenuState }) {
  const ctx = useEditor();
  const { store } = ctx;
  const query = useQuery(menu);
  const workspaceId = useApp((s) => s.workspaceId);
  const mergeMeta = useApp((s) => s.mergeMeta);
  const [pages, setPages] = useState<(PageMeta & { path?: string })[]>([]);
  const q = (query || '').trim();
  const isLink = menu.kind === 'link';
  const what = menu.mentionWhat;

  useEffect(() => {
    if (query === null) {
      ctx.setMenu(null);
      return;
    }
    if (what === 'person' || what === 'date') return;
    let alive = true;
    const t = setTimeout(() => {
      api
        .get(`/api/workspaces/${workspaceId}/search?titles=1&limit=8&q=${encodeURIComponent(q)}`)
        .then((r) => alive && setPages(r.results))
        .catch(() => {});
    }, 100);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, workspaceId]);

  const options: MentionOption[] = [];
  const lower = q.toLowerCase();
  if (!isLink && what !== 'page' && what !== 'date') {
    for (const p of ctx.people.filter((p) => p.name.toLowerCase().includes(lower) || (p.email || '').toLowerCase().includes(lower)).slice(0, 5)) {
      options.push({
        key: 'u' + p.id,
        section: 'People',
        label: p.name,
        icon: <Avatar user={p} size={20} />,
        html: `<span class="mention" data-type="user" data-id="${p.id}" contenteditable="false">@${escapeHtml(p.name)}</span>&nbsp;`,
      });
    }
  }
  if (!isLink && what !== 'person' && what !== 'page') {
    const dates: { label: string; d: Date }[] = [];
    const parsed = parseDateQuery(q);
    if (parsed) dates.push({ label: q.match(/^(t|y|n)/i) ? q.charAt(0).toUpperCase() + q.slice(1) : 'Date', d: parsed });
    else if (!q) {
      const now = new Date();
      dates.push({ label: 'Today', d: now }, { label: 'Tomorrow', d: new Date(now.getTime() + 864e5) });
    }
    for (const { d } of dates.slice(0, 2)) {
      const label = `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
      options.push({
        key: 'd' + toISODate(d),
        section: 'Date',
        label,
        icon: <CalendarDays size={18} strokeWidth={1.6} />,
        html: `<span class="mention" data-type="date" data-id="${toISODate(d)}" contenteditable="false">@${label}</span>&nbsp;`,
      });
    }
  }
  if (what !== 'person' && what !== 'date') {
    for (const p of pages.filter((p) => p.id !== ctx.pageId || true).slice(0, 8)) {
      options.push({
        key: 'p' + p.id,
        section: isLink ? 'Link to page' : 'Link to page',
        label: pageTitle(p.title),
        desc: p.path,
        icon: <PageIcon icon={p.icon} type={p.type} size={18} />,
        html: `<span class="mention" data-type="page" data-id="${p.id}" contenteditable="false">${escapeHtml(pageTitle(p.title))}</span>&nbsp;`,
      });
    }
    if (q && !ctx.readOnly) {
      options.push({ key: 'new', section: 'New', label: <>New "{q}" sub-page</>, icon: <Plus size={18} />, create: q });
    }
  }

  const choose = async (o: MentionOption) => {
    const el = store.editables.get(menu.blockId);
    ctx.setMenu(null);
    if (!el) return;
    el.focus();
    removeTrigger(el, menu);
    let html = o.html;
    if (o.create) {
      try {
        const r = await api.post('/api/pages', { parentId: ctx.pageId, title: o.create });
        mergeMeta([{ id: r.page.id, title: r.page.title, icon: null, type: 'page' }]);
        html = `<span class="mention" data-type="page" data-id="${r.page.id}" contenteditable="false">${escapeHtml(o.create)}</span>&nbsp;`;
        if (r.block) store.applyRemote([{ type: 'insert', block: r.block }]);
      } catch {
        return;
      }
    }
    if (html) insertHtmlAtCaret(el, html);
    ctx.commitText(menu.blockId);
  };

  const nav = useMenuNav(options.length, (i) => choose(options[i]), [q, options.length]);
  useEffect(() => {
    ctx.menuKey.current = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        ctx.setMenu(null);
        return true;
      }
      if (e.key === ' ' && !options.length) {
        ctx.setMenu(null);
        return false;
      }
      return nav.onKeyDown(e);
    };
    return () => {
      ctx.menuKey.current = null;
    };
  });

  let last = '';
  return (
    <Popover anchor={menu.rect} onClose={() => ctx.setMenu(null)} placement="bottom-start" offset={6}>
      <div className="menu" style={{ width: 320, maxHeight: 360 }} data-testid="mention-menu">
        {options.length === 0 && <div className="menu-empty">No results</div>}
        {options.map((o, i) => {
          const header = o.section !== last ? o.section : null;
          last = o.section;
          return (
            <React.Fragment key={o.key}>
              {header && <div className="menu-label">{header}</div>}
              <MenuItem icon={o.icon} label={o.label} desc={o.desc} selected={i === nav.index} onMouseEnter={() => nav.setIndex(i)} onClick={() => choose(o)} />
            </React.Fragment>
          );
        })}
      </div>
    </Popover>
  );
}
