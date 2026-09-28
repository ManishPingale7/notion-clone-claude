import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare, Clock, Star, MoreHorizontal, Smile, Image as ImageIcon, Lock, Unlock, Link as LinkIcon, Copy, CornerUpRight,
  Trash2, History, Download, ChevronsRight, Maximize2, ChevronRight, Table2, KanbanSquare, Rows3, LayoutGrid, CalendarDays,
  GanttChart, FileText, X, ArrowUpRight, PanelRight, Square,
} from 'lucide-react';
import { api } from '../api';
import { realtime } from '../realtime';
import { useApp } from '../store';
import type { Block, Discussion, Page, PageMeta, PresenceUser, Role, User, DbSchema } from '../types';
import { EditorStore } from '../editor/EditorStore';
import { EditorContext, useStoreValue, type EditorCtx, type MenuState } from '../editor/context';
import { Editor } from '../editor/Editor';
import { Popover, MenuItem, Tooltip, Avatar, PageIcon, Loading, Switch, Modal, confirmDialog } from '../components/ui';
import { EmojiPicker, randomEmoji } from '../components/EmojiPicker';
import { PagePicker } from '../components/PagePicker';
import { ShareMenu } from './ShareMenu';
import { HistoryModal } from './HistoryModal';
import { CommentComposer, DiscussionThread } from './Comments';
import { trashPage, duplicatePage, toggleFavorite, copyLink, movePage, setPageIcon } from './pageActions';
import { COVER_PRESETS, coverCss, pageTitle, timeAgo, MOD, uuid, htmlToText } from '../lib/format';
import { DatabaseView, notifyDbChanged } from '../database/DatabaseView';
import { RowProperties } from '../database/RowProperties';
import { removeDiscussionAnchor } from '../editor/inline';

interface PageData {
  page: Page;
  role: Role;
  blocks: Block[];
  ancestors: (PageMeta & { accessible: boolean })[];
  database: { id: string; title: string; icon: string | null; schema: DbSchema } | null;
  pages: Record<string, PageMeta>;
  isFavorite: boolean;
  workspace: { id: string; name: string; icon: string | null };
  people: User[];
  isMember: boolean;
  createdByUser: User | null;
  updatedByUser: User | null;
}

export function PageView({
  pageId,
  mode = 'full',
  peekStyle = 'side',
  onClosePeek,
  onPeekStyle,
}: {
  pageId: string;
  mode?: 'full' | 'peek';
  peekStyle?: 'side' | 'center';
  onClosePeek?: () => void;
  onPeekStyle?: (s: 'side' | 'center' | 'full') => void;
}) {
  const navigate = useNavigate();
  const me = useApp((s) => s.me)!;
  const toast = useApp((s) => s.toast);
  const mergeMeta = useApp((s) => s.mergeMeta);
  const mergePeople = useApp((s) => s.mergePeople);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const currentWs = useApp((s) => s.workspaceId);
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState<EditorStore | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuKey = useRef<((e: any) => boolean) | null>(null);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [discPop, setDiscPop] = useState<{ blockId: string; rect: DOMRect; discussionId?: string; pending?: { id: string; text: string } } | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);
  const [deleted, setDeleted] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [linkPicker, setLinkPicker] = useState<{ blockId: string; replace: boolean; rect: DOMRect } | null>(null);

  const load = useCallback(
    async (keepStore = false) => {
      try {
        const d: PageData = await api.get(`/api/pages/${pageId}${mode === 'peek' ? '?noRecent=1' : ''}`);
        setData(d);
        setDeleted(!!d.page.deletedAt);
        mergeMeta({ ...d.pages, [d.page.id]: { id: d.page.id, title: d.page.title, icon: d.page.icon, type: d.page.type, parentId: d.page.parentId } });
        mergePeople(d.people);
        const readOnly = !['edit', 'full'].includes(d.role) || !!d.page.format.locked || !!d.page.deletedAt;
        setStore((prev) => {
          if (keepStore && prev && prev.pageId === pageId) {
            if (!prev.hasPending()) prev.reset(d.blocks);
            prev.readOnly = readOnly;
            return prev;
          }
          return new EditorStore(pageId, d.blocks, readOnly);
        });
        if (mode === 'full' && d.page.workspaceId !== useApp.getState().workspaceId) setWorkspace(d.page.workspaceId);
      } catch (e: any) {
        setError(e.status === 404 ? 'This page does not exist, or you do not have access to it.' : e.message);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageId, mode],
  );

  const loadDiscussions = useCallback(() => {
    api.get(`/api/pages/${pageId}/discussions`).then((r) => setDiscussions(r.discussions)).catch(() => {});
  }, [pageId]);

  useEffect(() => {
    setData(null);
    setStore(null);
    setError(null);
    setDiscussions([]);
    setPresence([]);
    setMenu(null);
    load();
    loadDiscussions();
  }, [pageId, load, loadDiscussions]);

  // keep the store's read-only state in sync with lock/role changes
  useEffect(() => {
    if (!store || !data) return;
    const ro = !['edit', 'full'].includes(data.role) || !!data.page.format.locked || deleted;
    if (store.readOnly !== ro) {
      store.readOnly = ro;
      store.emit();
    }
  }, [store, data, deleted]);

  useEffect(() => {
    if (!store) return;
    store.onError = (msg, fatal) => {
      toast(msg, { kind: 'error' });
      if (fatal) load(true);
    };
    store.onPageBlockDeleted = (id) => {
      mergeMeta([{ id, deleted: true }]);
      setTimeout(() => useApp.getState().loadSidebar(), 400);
    };
    const flushOnLeave = () => store.flush();
    window.addEventListener('beforeunload', flushOnLeave);
    return () => {
      store.flush();
      window.removeEventListener('beforeunload', flushOnLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // realtime
  useEffect(() => {
    const unsub = realtime.subscribe('page:' + pageId);
    const off = realtime.on((msg) => {
      if (msg.type === 'reconnected') {
        load(true);
        loadDiscussions();
        return;
      }
      if (msg.pageId !== pageId) return;
      switch (msg.type) {
        case 'ops':
          store?.applyRemote(msg.ops);
          for (const op of msg.ops) if (op.type === 'insert' && op.block.content?.pageId) api.get(`/api/pages/meta?ids=${op.block.content.pageId}`).then((r) => mergeMeta(r.pages));
          setData((d) => (d ? { ...d, page: { ...d.page, updatedAt: Date.now(), updatedBy: msg.userId } } : d));
          break;
        case 'page.updated':
          setData((d) => (d ? { ...d, page: { ...d.page, ...msg.page } } : d));
          mergeMeta([{ id: msg.page.id, title: msg.page.title, icon: msg.page.icon }]);
          if (titleRef.current && document.activeElement !== titleRef.current && titleRef.current.textContent !== msg.page.title) titleRef.current.textContent = msg.page.title;
          break;
        case 'blocks.reload':
        case 'page.moved':
        case 'page.restored':
          load(true);
          break;
        case 'page.trashed':
          setDeleted(true);
          break;
        case 'presence':
          setPresence(msg.users);
          break;
        case 'discussions.changed':
          loadDiscussions();
          break;
        case 'child.updated':
          if (msg.page) mergeMeta([msg.page]);
          break;
        default:
          break;
      }
    });
    return () => {
      off();
      unsub();
    };
  }, [pageId, store, load, loadDiscussions, mergeMeta]);

  // presence: report which block I'm editing
  useEffect(() => {
    realtime.presence(pageId, null);
    const onFocus = (e: Event) => {
      const { blockId } = (e as CustomEvent).detail;
      if (store?.blocks.has(blockId)) realtime.presence(pageId, blockId);
    };
    window.addEventListener('editor:focus-block', onFocus);
    return () => window.removeEventListener('editor:focus-block', onFocus);
  }, [pageId, store]);

  // scroll to #block anchors
  useEffect(() => {
    if (!store || mode !== 'full') return;
    const id = location.hash.slice(1);
    if (!id) return;
    setTimeout(() => {
      const el = document.querySelector(`[data-block-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1600);
      }
    }, 200);
  }, [store, mode]);

  const page = data?.page;
  const role = data?.role;
  const canEdit = !!role && ['edit', 'full'].includes(role) && !deleted;
  const locked = !!page?.format.locked;
  const canComment = !!role && role !== 'view';

  const updatePage = useCallback(
    async (patch: Partial<Page> & Record<string, any>): Promise<void> => {
      setData((d) => (d ? { ...d, page: { ...d.page, ...patch, format: patch.format ? { ...d.page.format, ...patch.format } : d.page.format } } : d));
      try {
        const r = await api.patch(`/api/pages/${pageId}`, patch);
        setData((d) => (d ? { ...d, page: { ...d.page, ...r.page } } : d));
        if (r.page.parentType === 'database' && r.page.parentId) notifyDbChanged(r.page.parentId);
      } catch (e: any) {
        toast(e.message, { kind: 'error' });
      }
    },
    [pageId, toast],
  );

  const goto = useCallback((id: string) => navigate(`/p/${id}`), [navigate]);

  const discussionsByBlock = useMemo(() => {
    const m: Record<string, Discussion[]> = {};
    for (const d of discussions) if (d.blockId) (m[d.blockId] ||= []).push(d);
    return m;
  }, [discussions]);

  const presenceByBlock = useMemo(() => {
    const m: Record<string, { name: string; color: string }[]> = {};
    for (const p of presence) if (p.blockId && p.userId !== me.id) (m[p.blockId] ||= []).push({ name: p.name, color: p.color });
    return m;
  }, [presence, me.id]);

  const focusTitle = useCallback(() => {
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  }, []);

  const ctx: EditorCtx | null = useMemo(() => {
    if (!store || !data) return null;
    return {
      store,
      pageId,
      workspaceId: data.page.workspaceId,
      readOnly: store.readOnly,
      canComment,
      pages: data.pages,
      people: data.people,
      ancestors: data.ancestors,
      pageMetaSelf: { id: data.page.id, title: data.page.title, icon: data.page.icon, type: data.page.type },
      navigate: goto,
      menu,
      setMenu,
      menuKey,
      createSubpage: async ({ after, replace }) => {
        try {
          await store.flush();
          const b = after ? store.get(after) : null;
          const blockId = uuid();
          const sibs = b ? store.children(b.parentId) : store.children(null);
          const i = b ? sibs.findIndex((s) => s.id === b.id) : sibs.length - 1;
          const position = b ? (b.position + (sibs[i + 1]?.position ?? b.position + 2)) / 2 : undefined;
          const r = await api.post('/api/pages', { parentId: pageId, blockId, blockPosition: position, parentBlockId: b?.parentId || null });
          if (r.block) store.applyRemote([{ type: 'insert', block: r.block }]);
          mergeMeta([{ id: r.page.id, title: '', icon: null, type: 'page', parentId: pageId }]);
          if (replace) store.transact((tx) => tx.remove(replace));
          useApp.getState().setExpanded(pageId, true);
          useApp.getState().loadSidebar();
          goto(r.page.id);
        } catch (e: any) {
          toast(e.message, { kind: 'error' });
        }
      },
      createDatabase: async ({ after, replace, view, inline }) => {
        try {
          await store.flush();
          const b = after ? store.get(after) : null;
          const sibs = b ? store.children(b.parentId) : store.children(null);
          const i = b ? sibs.findIndex((s) => s.id === b.id) : sibs.length - 1;
          const position = b ? (b.position + (sibs[i + 1]?.position ?? b.position + 2)) / 2 : undefined;
          const r = await api.post('/api/pages', { parentId: pageId, type: 'database', viewType: view, isInline: inline, blockPosition: position, parentBlockId: b?.parentId || null, title: '' });
          mergeMeta([{ id: r.page.id, title: '', icon: null, type: 'database', parentId: pageId, isInline: inline }]);
          if (r.block) store.applyRemote([{ type: 'insert', block: r.block }]);
          if (replace) store.transact((tx) => tx.remove(replace));
          useApp.getState().loadSidebar();
          if (!inline) goto(r.page.id);
        } catch (e: any) {
          toast(e.message, { kind: 'error' });
        }
      },
      linkPage: (blockId, replace) => {
        const el = document.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null;
        setLinkPicker({ blockId, replace, rect: (el || document.body).getBoundingClientRect() });
      },
      discussionsByBlock,
      openDiscussion: (blockId, rect, discussionId) => setDiscPop({ blockId, rect, discussionId }),
      startInlineComment: (blockId, id, text, rect) => setDiscPop({ blockId, rect, pending: { id, text } }),
      focusTitle,
      presenceByBlock,
      commitText: (blockId) => {
        const el = store.editables.get(blockId);
        if (el) store.setText(blockId, el.innerHTML === '<br>' ? '' : el.innerHTML);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, data, menu, discussionsByBlock, presenceByBlock, canComment, goto, focusTitle, store?.readOnly]);

  if (error) {
    return (
      <div className="page-error">
        {mode === 'full' && <div className="topbar" />}
        <div className="page-error-body">
          <div style={{ fontSize: 40 }}>🔒</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{error}</div>
          {mode === 'full' ? (
            <button className="btn btn-outline" onClick={() => navigate('/')}>
              Back to my content
            </button>
          ) : (
            <button className="btn btn-outline" onClick={onClosePeek}>
              Close
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!data || !page || !store || !ctx) return <div className={mode === 'full' ? 'page-loading' : 'peek-loading'}><Loading /></div>;

  const isDb = page.type === 'database';
  const others = presence.filter((p) => p.userId !== me.id).filter((p, i, a) => a.findIndex((x) => x.userId === p.userId) === i);
  const pageComments = discussions.filter((d) => !d.blockId && !d.resolved);
  const fontClass = page.format.font === 'serif' ? 'font-serif' : page.format.font === 'mono' ? 'font-mono' : '';

  const header = (
    <PageHeader
      data={data}
      canEdit={canEdit}
      titleRef={titleRef}
      updatePage={updatePage}
      store={store}
      hasPageComments={pageComments.length > 0}
      onAddComment={() => setShowComposer(true)}
      isDb={isDb}
    />
  );

  const body = (
    <div className={`page-body ${page.format.fullWidth || isDb ? 'full-width' : ''} ${page.format.smallText ? 'small-text' : ''} ${fontClass} ${mode === 'peek' ? 'in-peek' : ''}`}>
      {deleted && (
        <div className="trash-banner">
          <span>This page is in Trash.</span>
          {['edit', 'full'].includes(data.role) && (
            <>
              <button
                className="btn btn-outline"
                onClick={async () => {
                  await api.post(`/api/pages/${pageId}/restore`);
                  setDeleted(false);
                  useApp.getState().loadSidebar();
                  load(true);
                }}
              >
                Restore page
              </button>
              {data.role === 'full' && (
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: 'Delete this page permanently?', body: 'This cannot be undone.', confirm: 'Yes. Delete this page', danger: true }))) return;
                    await api.del(`/api/pages/${pageId}/permanent`);
                    useApp.getState().loadSidebar();
                    if (mode === 'peek') onClosePeek?.();
                    else navigate('/');
                  }}
                >
                  Delete from Trash
                </button>
              )}
            </>
          )}
        </div>
      )}
      {header}
      <EditorContext.Provider value={ctx}>
        <div className="page-content">
          {data.database && page.parentType === 'database' && (
            <RowProperties page={page} databaseId={data.database.id} schema={data.database.schema} people={data.people} readOnly={!canEdit || locked} onChange={(props) => setData((d) => (d ? { ...d, page: { ...d.page, ...props } } : d))} />
          )}
          {!isDb && (pageComments.length > 0 || showComposer) && (
            <PageComments discussions={pageComments} pageId={pageId} people={data.people} canComment={canComment} autoFocus={showComposer} onChange={setDiscussions} onDone={() => setShowComposer(false)} />
          )}
          {!isDb && <Backlinks pageId={pageId} navigate={goto} />}
          {isDb ? (
            <DatabaseView databaseId={page.id} readOnly={!canEdit} fullPage />
          ) : (
            <>
              {canEdit && page.parentType !== 'database' && !locked && <EmptyPageOptions pageId={pageId} onConverted={() => load(true)} store={store} />}
              <Editor />
            </>
          )}
        </div>
      </EditorContext.Provider>
    </div>
  );

  return (
    <div className={'page-view mode-' + mode} data-testid="page-view">
      {mode === 'full' ? (
        <Topbar
          data={data}
          others={others}
          commentsOpen={commentsOpen}
          onToggleComments={() => setCommentsOpen((v) => !v)}
          updatePage={updatePage}
          store={store}
          reload={() => load(true)}
          setFavorite={(v) => setData((d) => (d ? { ...d, isFavorite: v } : d))}
        />
      ) : (
        <PeekHeader data={data} others={others} peekStyle={peekStyle} onClose={onClosePeek!} onPeekStyle={onPeekStyle!} onOpen={() => goto(page.id)} updatePage={updatePage} store={store} reload={() => load(true)} setFavorite={(v) => setData((d) => (d ? { ...d, isFavorite: v } : d))} />
      )}
      <div className="page-main">
        <div className={mode === 'full' ? 'page-scroller' : 'peek-scroller'}>{body}</div>
        {commentsOpen && mode === 'full' && <CommentsPanel discussions={discussions} people={data.people} canComment={canComment} onChange={setDiscussions} onClose={() => setCommentsOpen(false)} />}
      </div>
      {discPop && (
        <DiscussionPopover
          state={discPop}
          discussions={discussions.filter((d) => d.blockId === discPop.blockId && (!discPop.discussionId || d.id === discPop.discussionId))}
          pageId={pageId}
          people={data.people}
          canComment={canComment}
          onChange={setDiscussions}
          onClose={(posted) => {
            if (discPop.pending && !posted) {
              const el = store.editables.get(discPop.blockId);
              if (el) {
                removeDiscussionAnchor(el, discPop.pending.id);
                ctx.commitText(discPop.blockId);
              }
            }
            setDiscPop(null);
          }}
        />
      )}
      {linkPicker && (
        <Popover anchor={linkPicker.rect} onClose={() => setLinkPicker(null)}>
          <PagePicker
            placeholder="Link to page…"
            exclude={[pageId]}
            onPick={(p) => {
              store.transact((tx) => {
                const nb = tx.insert({ type: 'link_to_page', content: { pageId: p.id } }, { after: linkPicker.blockId });
                if (linkPicker.replace) tx.remove(linkPicker.blockId);
                return nb;
              });
              mergeMeta([p]);
              setLinkPicker(null);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header: cover, icon, title
// ---------------------------------------------------------------------------

function PageHeader({
  data,
  canEdit,
  titleRef,
  updatePage,
  store,
  hasPageComments,
  onAddComment,
  isDb,
}: {
  data: PageData;
  canEdit: boolean;
  titleRef: React.RefObject<HTMLDivElement | null>;
  updatePage: (p: any) => Promise<void> | void;
  store: EditorStore;
  hasPageComments: boolean;
  onAddComment: () => void;
  isDb: boolean;
}) {
  const page = data.page;
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const [coverAnchor, setCoverAnchor] = useState<HTMLElement | null>(null);
  const [repositioning, setRepositioning] = useState<number | null>(null);
  const titleTimer = useRef(0);
  const mergeMeta = useApp((s) => s.mergeMeta);
  const editable = canEdit && !page.format.locked;

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (el && el.textContent !== page.title && document.activeElement !== el) el.textContent = page.title;
  }, [page.id, page.title, titleRef]);

  const onTitleInput = () => {
    const el = titleRef.current!;
    const title = (el.textContent || '').replace(/\n/g, ' ');
    if (el.innerHTML === '<br>') el.innerHTML = '';
    mergeMeta([{ id: page.id, title }]);
    const s = useApp.getState();
    s.set({ sidebarPages: s.sidebarPages.map((p) => (p.id === page.id ? { ...p, title } : p)) });
    window.clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(async () => {
      await updatePage({ title });
      // re-apply after save in case a sidebar refresh raced with typing
      const st = useApp.getState();
      st.mergeMeta([{ id: page.id, title }]);
      st.set({ sidebarPages: st.sidebarPages.map((p) => (p.id === page.id ? { ...p, title } : p)) });
    }, 300);
  };

  const onTitleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
      e.preventDefault();
      if (isDb) return;
      const first = store.children(null)[0];
      if (e.key === 'Enter') {
        let nid = '';
        store.transact((tx) => (nid = tx.insert({ type: 'text', content: { text: '' } }, first ? { before: first.id } : { parentId: null }).id));
        store.requestFocus({ id: nid, at: 0 });
      } else if (first) store.requestFocus({ id: first.id, at: 'start' });
    }
  };

  const startReposition = (e: React.MouseEvent) => {
    const startY = e.clientY;
    const startPos = page.cover?.position ?? 50;
    let pos = startPos;
    const move = (ev: MouseEvent) => {
      pos = Math.max(0, Math.min(100, startPos - (ev.clientY - startY) / 3));
      setRepositioning(pos);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      updatePage({ cover: { ...page.cover, position: pos } });
      setRepositioning(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const cover = page.cover ? { ...page.cover, position: repositioning ?? page.cover.position } : null;
  return (
    <div className={'page-header ' + (cover ? 'has-cover ' : '') + (page.icon ? 'has-icon' : '')}>
      {cover && (
        <div className="page-cover" style={coverCss(cover)} data-testid="page-cover">
          {editable && (
            <div className="cover-controls">
              <button onClick={(e) => setCoverAnchor(e.currentTarget)}>Change cover</button>
              {cover.type === 'image' && <button onMouseDown={startReposition}>{repositioning !== null ? 'Drag image to reposition' : 'Reposition'}</button>}
            </div>
          )}
        </div>
      )}
      <div className="page-header-inner">
        {page.icon && (
          <button className="page-icon" onClick={(e) => editable && setIconAnchor(e.currentTarget)} disabled={!editable} data-testid="page-icon">
            <PageIcon icon={page.icon} size={78} />
          </button>
        )}
        {editable && (
          <div className="page-controls">
            {!page.icon && (
              <button
                onClick={() => {
                  const icon = randomEmoji();
                  updatePage({ icon });
                  setPageIcon(page.id, icon);
                }}
                data-testid="add-icon"
              >
                <Smile size={14} /> Add icon
              </button>
            )}
            {!page.cover && (
              <button onClick={() => updatePage({ cover: { type: 'color', value: Object.keys(COVER_PRESETS)[4 + Math.floor(Math.random() * 8)], position: 50 } })} data-testid="add-cover">
                <ImageIcon size={14} /> Add cover
              </button>
            )}
            {!hasPageComments && !isDb && (
              <button onClick={onAddComment}>
                <MessageSquare size={14} /> Add comment
              </button>
            )}
          </div>
        )}
        <div
          ref={titleRef}
          className="page-title"
          contentEditable={editable}
          suppressContentEditableWarning
          data-placeholder={isDb ? 'New database' : 'New page'}
          onInput={onTitleInput}
          onKeyDown={onTitleKey}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\n/g, ' '));
          }}
          spellCheck
          data-testid="page-title"
        />
      </div>
      {iconAnchor && (
        <Popover anchor={iconAnchor} onClose={() => setIconAnchor(null)}>
          <EmojiPicker
            onPick={(icon) => {
              updatePage({ icon });
              setPageIcon(page.id, icon);
              setIconAnchor(null);
            }}
            onRemove={() => {
              updatePage({ icon: null });
              setPageIcon(page.id, null);
              setIconAnchor(null);
            }}
          />
        </Popover>
      )}
      {coverAnchor && (
        <Popover anchor={coverAnchor} onClose={() => setCoverAnchor(null)} placement="bottom-end">
          <CoverPicker
            onPick={(cover) => {
              updatePage({ cover });
              setCoverAnchor(null);
            }}
            onRemove={() => {
              updatePage({ cover: null });
              setCoverAnchor(null);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function CoverPicker({ onPick, onRemove }: { onPick: (c: any) => void; onRemove: () => void }) {
  const [tab, setTab] = useState<'gallery' | 'upload' | 'link'>('gallery');
  const [link, setLink] = useState('');
  const toast = useApp((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="cover-picker">
      <div className="ep-tabs">
        {(['gallery', 'upload', 'link'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'gallery' ? 'Gallery' : t === 'upload' ? 'Upload' : 'Link'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="ep-remove" onClick={onRemove}>
          Remove
        </button>
      </div>
      {tab === 'gallery' && (
        <div style={{ padding: 12 }}>
          <div className="menu-label" style={{ padding: '0 0 8px' }}>Color & Gradient</div>
          <div className="cover-grid">
            {Object.entries(COVER_PRESETS).map(([k, v]) => (
              <button key={k} className="cover-swatch" style={{ background: v }} onClick={() => onPick({ type: 'color', value: k, position: 50 })} />
            ))}
          </div>
        </div>
      )}
      {tab === 'upload' && (
        <div style={{ padding: 12 }}>
          <button className="btn btn-outline btn-block" onClick={() => fileRef.current?.click()}>
            Upload file
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/*"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const r = await api.upload(f);
                onPick({ type: 'image', value: r.url, position: 50 });
              } catch (err: any) {
                toast(err.message, { kind: 'error' });
              }
            }}
          />
          <div className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>Images wider than 1500 pixels work best.</div>
        </div>
      )}
      {tab === 'link' && (
        <form
          style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (/^https?:\/\//.test(link)) onPick({ type: 'image', value: link, position: 50 });
          }}
        >
          <input className="input" autoFocus placeholder="Paste an image link…" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="btn btn-primary" type="submit" style={{ alignSelf: 'center', width: 240 }}>
            Submit
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function Breadcrumbs({ data }: { data: PageData }) {
  const navigate = useNavigate();
  const liveTitle = useApp((s) => s.pageMeta[data.page.id]?.title);
  const metas = useApp((s) => s.pageMeta);
  const items = [...data.ancestors.filter((a) => a.accessible), { id: data.page.id, title: liveTitle ?? data.page.title, icon: data.page.icon, type: data.page.type }];
  const shown = items.length > 4 ? [items[0], null, ...items.slice(-2)] : items;
  return (
    <div className="breadcrumbs">
      {shown.map((p, i) => (
        <React.Fragment key={p ? p.id : 'ellipsis'}>
          {i > 0 && <span className="crumb-sep">/</span>}
          {p ? (
            <button className="crumb" onClick={() => navigate(`/p/${p.id}`)}>
              {(metas[p.id]?.icon ?? p.icon) && <PageIcon icon={metas[p.id]?.icon ?? p.icon} size={16} />}
              <span className="ellipsis">{pageTitle(metas[p.id]?.title ?? p.title)}</span>
            </button>
          ) : (
            <span className="crumb faint">…</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function PresenceAvatars({ others }: { others: PresenceUser[] }) {
  if (!others.length) return null;
  return (
    <div className="avatar-stack presence-stack" data-testid="presence">
      {others.slice(0, 4).map((p) => (
        <Tooltip key={p.clientId} label={`${p.name} is viewing`}>
          <span>
            <Avatar user={{ name: p.name, color: p.color }} size={24} />
          </span>
        </Tooltip>
      ))}
      {others.length > 4 && <span className="faint small" style={{ marginLeft: 4 }}>+{others.length - 4}</span>}
    </div>
  );
}

function Topbar({
  data,
  others,
  commentsOpen,
  onToggleComments,
  updatePage,
  store,
  reload,
  setFavorite,
}: {
  data: PageData;
  others: PresenceUser[];
  commentsOpen: boolean;
  onToggleComments: () => void;
  updatePage: (p: any) => void;
  store: EditorStore;
  reload: () => void;
  setFavorite: (v: boolean) => void;
}) {
  const [shareAnchor, setShareAnchor] = useState<HTMLElement | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [history, setHistory] = useState(false);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const setSidebarOpen = useApp((s) => s.setSidebarOpen);
  const page = data.page;
  const locked = !!page.format.locked;
  const canEdit = ['edit', 'full'].includes(data.role);
  return (
    <div className="topbar" data-testid="topbar">
      {!sidebarOpen && (
        <button className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar" data-testid="open-sidebar">
          <ChevronsRight size={18} />
        </button>
      )}
      <Breadcrumbs data={data} />
      {locked && (
        <button className="btn topbar-lock" onClick={() => canEdit && updatePage({ format: { locked: false } })} title="Click to unlock">
          <Lock size={14} /> Locked
        </button>
      )}
      {!data.isMember && <span className="guest-badge">Guest</span>}
      <div className="topbar-right">
        <span className="edited-at faint">Edited {timeAgo(page.updatedAt)}</span>
        <PresenceAvatars others={others} />
        <button className="btn" onClick={(e) => setShareAnchor(e.currentTarget)} data-testid="share-button">
          Share
        </button>
        <Tooltip label="View all comments" kbd={MOD + 'Shift+U'}>
          <button className={'icon-btn ' + (commentsOpen ? 'active' : '')} onClick={onToggleComments} data-testid="comments-button">
            <MessageSquare size={18} />
          </button>
        </Tooltip>
        <Tooltip label="View all updates">
          <button className="icon-btn" onClick={() => setHistory(true)} data-testid="history-button">
            <Clock size={18} />
          </button>
        </Tooltip>
        <Tooltip label={data.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}>
          <button
            className="icon-btn"
            onClick={async () => {
              await toggleFavorite(page.id, !data.isFavorite);
              setFavorite(!data.isFavorite);
            }}
            data-testid="favorite-button"
          >
            <Star size={18} fill={data.isFavorite ? '#F6C050' : 'none'} color={data.isFavorite ? '#F6C050' : 'currentColor'} />
          </button>
        </Tooltip>
        <Tooltip label="Style, export, and more…">
          <button className="icon-btn" onClick={(e) => setMenuAnchor(e.currentTarget)} data-testid="page-menu-button">
            <MoreHorizontal size={18} />
          </button>
        </Tooltip>
      </div>
      {shareAnchor && <ShareMenu pageId={page.id} anchor={shareAnchor} onClose={() => setShareAnchor(null)} />}
      {menuAnchor && <PageMenu anchor={menuAnchor} data={data} onClose={() => setMenuAnchor(null)} updatePage={updatePage} store={store} onHistory={() => setHistory(true)} />}
      {history && <HistoryModal pageId={page.id} workspaceId={page.workspaceId} canRestore={canEdit} onClose={() => setHistory(false)} onRestored={reload} />}
    </div>
  );
}

function PeekHeader({
  data,
  others,
  peekStyle,
  onClose,
  onPeekStyle,
  onOpen,
  updatePage,
  store,
  reload,
  setFavorite,
}: {
  data: PageData;
  others: PresenceUser[];
  peekStyle: 'side' | 'center';
  onClose: () => void;
  onPeekStyle: (s: 'side' | 'center' | 'full') => void;
  onOpen: () => void;
  updatePage: (p: any) => void;
  store: EditorStore;
  reload: () => void;
  setFavorite: (v: boolean) => void;
}) {
  const [shareAnchor, setShareAnchor] = useState<HTMLElement | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [styleAnchor, setStyleAnchor] = useState<HTMLElement | null>(null);
  const [history, setHistory] = useState(false);
  void reload;
  return (
    <div className="peek-header">
      <Tooltip label="Close" kbd="Esc">
        <button className="icon-btn" onClick={onClose} data-testid="peek-close">
          <ChevronsRight size={18} />
        </button>
      </Tooltip>
      <Tooltip label="Open as full page">
        <button className="icon-btn" onClick={onOpen} data-testid="peek-open-full">
          <Maximize2 size={16} />
        </button>
      </Tooltip>
      <Tooltip label="Switch peek mode">
        <button className="icon-btn" onClick={(e) => setStyleAnchor(e.currentTarget)}>
          {peekStyle === 'side' ? <PanelRight size={16} /> : <Square size={16} />}
        </button>
      </Tooltip>
      <div style={{ flex: 1 }} />
      <PresenceAvatars others={others} />
      <button className="btn" onClick={(e) => setShareAnchor(e.currentTarget)}>
        Share
      </button>
      <button
        className="icon-btn"
        onClick={async () => {
          await toggleFavorite(data.page.id, !data.isFavorite);
          setFavorite(!data.isFavorite);
        }}
      >
        <Star size={18} fill={data.isFavorite ? '#F6C050' : 'none'} color={data.isFavorite ? '#F6C050' : 'currentColor'} />
      </button>
      <button className="icon-btn" onClick={(e) => setMenuAnchor(e.currentTarget)}>
        <MoreHorizontal size={18} />
      </button>
      {styleAnchor && (
        <Popover anchor={styleAnchor} onClose={() => setStyleAnchor(null)}>
          <div className="menu">
            <MenuItem icon={<PanelRight size={16} />} label="Side peek" checked={peekStyle === 'side'} onClick={() => (onPeekStyle('side'), setStyleAnchor(null))} />
            <MenuItem icon={<Square size={16} />} label="Center peek" checked={peekStyle === 'center'} onClick={() => (onPeekStyle('center'), setStyleAnchor(null))} />
            <MenuItem icon={<Maximize2 size={16} />} label="Full page" onClick={() => (onPeekStyle('full'), setStyleAnchor(null))} />
          </div>
        </Popover>
      )}
      {shareAnchor && <ShareMenu pageId={data.page.id} anchor={shareAnchor} onClose={() => setShareAnchor(null)} />}
      {menuAnchor && <PageMenu anchor={menuAnchor} data={data} onClose={() => setMenuAnchor(null)} updatePage={updatePage} store={store} onHistory={() => setHistory(true)} onDeleted={onClose} />}
      {history && <HistoryModal pageId={data.page.id} workspaceId={data.page.workspaceId} canRestore={['edit', 'full'].includes(data.role)} onClose={() => setHistory(false)} onRestored={reload} />}
    </div>
  );
}

function PageMenu({
  anchor,
  data,
  onClose,
  updatePage,
  store,
  onHistory,
  onDeleted,
}: {
  anchor: HTMLElement;
  data: PageData;
  onClose: () => void;
  updatePage: (p: any) => void;
  store: EditorStore;
  onHistory: () => void;
  onDeleted?: () => void;
}) {
  const navigate = useNavigate();
  const [moveAnchor, setMoveAnchor] = useState<DOMRect | null>(null);
  const page = data.page;
  const f = page.format;
  const canEdit = ['edit', 'full'].includes(data.role);
  const words = useMemo(() => {
    let n = 0;
    for (const b of store.blocks.values()) {
      const t = b.type === 'code' ? b.content.text || '' : htmlToText(b.content.text);
      n += t.split(/\s+/).filter(Boolean).length;
    }
    return n;
  }, [store]);
  const fonts: { key: 'default' | 'serif' | 'mono'; label: string; sample: string; family: string }[] = [
    { key: 'default', label: 'Default', sample: 'Ag', family: 'var(--font)' },
    { key: 'serif', label: 'Serif', sample: 'Ag', family: 'var(--font-serif)' },
    { key: 'mono', label: 'Mono', sample: 'Ag', family: 'var(--font-mono)' },
  ];
  return (
    <Popover anchor={anchor} onClose={onClose} placement="bottom-end" width={260}>
      <div className="menu page-menu" data-testid="page-menu">
        {canEdit && (
          <>
            <div className="font-picker">
              {fonts.map((fo) => (
                <button key={fo.key} className={(f.font || 'default') === fo.key ? 'on' : ''} onClick={() => updatePage({ format: { font: fo.key } })}>
                  <span style={{ fontFamily: fo.family, fontSize: 22 }}>{fo.sample}</span>
                  <span className="small">{fo.label}</span>
                </button>
              ))}
            </div>
            <div className="menu-divider" />
          </>
        )}
        <MenuItem icon={<LinkIcon size={16} />} label="Copy link" onClick={() => (copyLink(page.id), onClose())} />
        {canEdit && (
          <MenuItem
            icon={<Copy size={16} />}
            label="Duplicate"
            right={MOD + 'D'}
            onClick={async () => {
              onClose();
              const p = await duplicatePage(page.id);
              if (p) navigate(`/p/${p.id}`);
            }}
          />
        )}
        {canEdit && <MenuItem icon={<CornerUpRight size={16} />} label="Move to" right={MOD + 'Shift+P'} onClick={(e) => setMoveAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())} />}
        {canEdit && (
          <MenuItem
            icon={<Trash2 size={16} />}
            label="Move to Trash"
            danger
            onClick={async () => {
              onClose();
              if (await trashPage(page.id, page.title)) {
                if (onDeleted) onDeleted();
                else if (page.parentId) navigate(`/p/${page.parentId}`);
                else navigate('/');
              }
            }}
            testId="page-menu-trash"
          />
        )}
        <div className="menu-divider" />
        {canEdit && (
          <>
            <MenuItem label="Small text" right={<Switch on={!!f.smallText} onChange={() => {}} />} onClick={() => updatePage({ format: { smallText: !f.smallText } })} />
            <MenuItem label="Full width" right={<Switch on={!!f.fullWidth} onChange={() => {}} />} onClick={() => updatePage({ format: { fullWidth: !f.fullWidth } })} testId="toggle-full-width" />
            <MenuItem
              icon={f.locked ? <Unlock size={16} /> : <Lock size={16} />}
              label="Lock page"
              right={<Switch on={!!f.locked} onChange={() => {}} />}
              onClick={() => updatePage({ format: { locked: !f.locked } })}
              testId="toggle-lock"
            />
            <div className="menu-divider" />
          </>
        )}
        <MenuItem icon={<History size={16} />} label="Version history" onClick={() => (onHistory(), onClose())} />
        <MenuItem
          icon={<Download size={16} />}
          label="Export"
          desc="Markdown"
          onClick={() => {
            window.open(`/api/pages/${page.id}/export`, '_blank');
            onClose();
          }}
        />
        <div className="menu-footer">
          <div>Word count: {words}</div>
          {data.updatedByUser && <div>Last edited by {data.updatedByUser.name}</div>}
          <div>{timeAgo(page.updatedAt)}</div>
        </div>
      </div>
      {moveAnchor && (
        <Popover anchor={moveAnchor} onClose={() => setMoveAnchor(null)} placement="left-start">
          <PagePicker
            placeholder="Move page to…"
            exclude={[page.id]}
            filter={(p) => p.parentType !== 'database' || false}
            extraTop={
              data.isMember ? (
                <div className="menu" style={{ paddingBottom: 0 }}>
                  <MenuItem
                    icon={<FileText size={16} />}
                    label="Private pages"
                    onClick={async () => {
                      setMoveAnchor(null);
                      onClose();
                      await movePage(page.id, null, { visibility: 'private' });
                    }}
                  />
                  <MenuItem
                    icon={<FileText size={16} />}
                    label="Workspace (shared with everyone)"
                    onClick={async () => {
                      setMoveAnchor(null);
                      onClose();
                      await movePage(page.id, null, { visibility: 'workspace' });
                    }}
                  />
                  <div className="menu-divider" />
                </div>
              ) : null
            }
            onPick={async (p) => {
              setMoveAnchor(null);
              onClose();
              if (await movePage(page.id, p.id)) useApp.getState().toast(`Moved to ${pageTitle(p.title)}`);
            }}
          />
        </Popover>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Comments UI
// ---------------------------------------------------------------------------

function PageComments({
  discussions,
  pageId,
  people,
  canComment,
  autoFocus,
  onChange,
  onDone,
}: {
  discussions: Discussion[];
  pageId: string;
  people: User[];
  canComment: boolean;
  autoFocus: boolean;
  onChange: (d: Discussion[]) => void;
  onDone: () => void;
}) {
  return (
    <div className="page-comments" data-testid="page-comments">
      {discussions.map((d) => (
        <DiscussionThread key={d.id} d={d} people={people} canComment={canComment} onChange={onChange} />
      ))}
      {canComment && (
        <CommentComposer
          people={people}
          autoFocus={autoFocus}
          onSubmit={async (body) => {
            const r = await api.post(`/api/pages/${pageId}/discussions`, { body });
            onChange(r.discussions);
            onDone();
          }}
        />
      )}
    </div>
  );
}

function DiscussionPopover({
  state,
  discussions,
  pageId,
  people,
  canComment,
  onChange,
  onClose,
}: {
  state: { blockId: string; rect: DOMRect; discussionId?: string; pending?: { id: string; text: string } };
  discussions: Discussion[];
  pageId: string;
  people: User[];
  canComment: boolean;
  onChange: (d: Discussion[]) => void;
  onClose: (posted: boolean) => void;
}) {
  const posted = useRef(false);
  const toast = useApp((s) => s.toast);
  const open = discussions.filter((d) => !d.resolved || d.id === state.discussionId);
  return (
    <Popover anchor={state.rect} onClose={() => onClose(posted.current)} placement="bottom-start" width={400}>
      <div className="discussion-popover" data-testid="discussion-popover">
        {state.pending && <div className="discussion-anchor">{state.pending.text}</div>}
        {!state.pending && open.map((d) => <DiscussionThread key={d.id} d={d} people={people} canComment={canComment} onChange={onChange} />)}
        {canComment && (state.pending || open.length === 0) && (
          <CommentComposer
            people={people}
            autoFocus
            onSubmit={async (body) => {
              try {
                const r = await api.post(`/api/pages/${pageId}/discussions`, {
                  id: state.pending?.id,
                  blockId: state.blockId,
                  anchorText: state.pending?.text,
                  body,
                });
                posted.current = true;
                onChange(r.discussions);
                onClose(true);
              } catch (e: any) {
                toast(e.message, { kind: 'error' });
              }
            }}
          />
        )}
      </div>
    </Popover>
  );
}

function CommentsPanel({ discussions, people, canComment, onChange, onClose }: { discussions: Discussion[]; people: User[]; canComment: boolean; onChange: (d: Discussion[]) => void; onClose: () => void }) {
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const list = discussions.filter((d) => (filter === 'open' ? !d.resolved : d.resolved));
  return (
    <aside className="comments-panel" data-testid="comments-panel">
      <div className="comments-panel-head">
        <span style={{ fontWeight: 600 }}>Comments</span>
        <div className="segmented">
          <button className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>
            Open
          </button>
          <button className={filter === 'resolved' ? 'on' : ''} onClick={() => setFilter('resolved')}>
            Resolved
          </button>
        </div>
        <button className="icon-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="comments-panel-body">
        {list.length === 0 && <div className="empty-state">{filter === 'open' ? 'No open comments yet' : 'No resolved comments'}</div>}
        {list.map((d) => (
          <div
            key={d.id}
            className="comments-panel-item"
            onClick={() => {
              if (!d.blockId) return;
              const el = document.querySelector(`[data-block-id="${d.blockId}"]`);
              el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }}
          >
            <DiscussionThread d={d} people={people} canComment={canComment} onChange={onChange} />
          </div>
        ))}
      </div>
    </aside>
  );
}

function Backlinks({ pageId, navigate }: { pageId: string; navigate: (id: string) => void }) {
  const [links, setLinks] = useState<PageMeta[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api.get(`/api/pages/${pageId}/backlinks`).then((r) => setLinks(r.pages)).catch(() => {});
  }, [pageId]);
  if (!links.length) return null;
  return (
    <div className="backlinks">
      <button className="backlinks-toggle" onClick={() => setOpen(!open)} data-testid="backlinks">
        <ArrowUpRight size={14} /> {links.length} backlink{links.length > 1 ? 's' : ''}
      </button>
      {open &&
        links.map((p) => (
          <button key={p.id} className="backlink-item" onClick={() => navigate(p.id)}>
            <PageIcon icon={p.icon} type={p.type} size={16} /> <span className="page-link-title">{pageTitle(p.title)}</span>
          </button>
        ))}
    </div>
  );
}

function EmptyPageOptions({ pageId, onConverted, store }: { pageId: string; onConverted: () => void; store: EditorStore }) {
  const toast = useApp((s) => s.toast);
  const empty = useStoreValue(store, () => store.children(null).length === 0);
  const convert = async (viewType: string) => {
    try {
      await api.post(`/api/pages/${pageId}/convert`, { viewType });
      useApp.getState().loadSidebar();
      onConverted();
    } catch (e: any) {
      toast(e.message, { kind: 'error' });
    }
  };
  if (!empty) return null;
  const opts: [string, string, React.ReactNode][] = [
    ['table', 'Table', <Table2 key="t" size={16} />],
    ['board', 'Board', <KanbanSquare key="b" size={16} />],
    ['list', 'List', <Rows3 key="l" size={16} />],
    ['gallery', 'Gallery', <LayoutGrid key="g" size={16} />],
    ['calendar', 'Calendar', <CalendarDays key="c" size={16} />],
    ['timeline', 'Timeline', <GanttChart key="tl" size={16} />],
  ];
  return (
    <div className="empty-page-options" data-testid="empty-page-options">
      <div className="faint" style={{ marginBottom: 6 }}>Get started with</div>
      <div className="epo-row">
        <button
          className="epo-btn"
          onClick={() => {
            let nid = '';
            store.transact((tx) => (nid = tx.insert({ type: 'text', content: { text: '' } }, { parentId: null }).id));
            store.requestFocus({ id: nid, at: 0 });
          }}
        >
          <FileText size={16} /> Empty page
        </button>
        {opts.map(([k, label, icon]) => (
          <button key={k} className="epo-btn" onClick={() => convert(k)} data-testid={'convert-' + k}>
            {icon} {label}
          </button>
        ))}
      </div>
    </div>
  );
}

void ChevronRight;
void Modal;
