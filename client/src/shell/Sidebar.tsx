import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Search, Home, Inbox, Settings, Trash2, ChevronsLeft, SquarePen, ChevronDown, ChevronRight, Plus, MoreHorizontal, Star,
  Link as LinkIcon, Copy, Pencil, CornerUpRight, ArrowUpRight, LogOut, Check, UserPlus, Users,
} from 'lucide-react';
import { useApp } from '../store';
import type { SidebarPage } from '../types';
import { Popover, MenuItem, Tooltip, PageIcon, Avatar, Modal } from '../components/ui';
import { EmojiPicker } from '../components/EmojiPicker';
import { PagePicker } from '../components/PagePicker';
import { createPage, trashPage, duplicatePage, toggleFavorite, copyLink, movePage, renamePage, setPageIcon } from '../page/pageActions';
import { pageTitle, MOD, between } from '../lib/format';
import { dragState, clearDrag } from '../editor/dnd';
import { api } from '../api';
import { TrashPopover } from './TrashPopover';

type Section = 'workspace' | 'private' | 'shared';

export function Sidebar({ onOpenInbox, peekFloating }: { onOpenInbox: () => void; peekFloating?: boolean }) {
  const s = useApp();
  const navigate = useNavigate();
  const [trashAnchor, setTrashAnchor] = useState<HTMLElement | null>(null);
  const ws = s.workspaces.find((w) => w.id === s.workspaceId);
  const byParent = useMemo(() => {
    const m = new Map<string, SidebarPage[]>();
    for (const p of s.sidebarPages) {
      const k = p.parentId || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    for (const list of m.values()) list.sort((a, b) => a.position - b.position);
    return m;
  }, [s.sidebarPages]);
  const roots = (section: Section) => s.sidebarPages.filter((p) => p.section === section).sort((a, b) => a.position - b.position);

  const newPage = async (section: Section = 'private', parentId: string | null = null) => {
    try {
      const page = await createPage({ parentId, visibility: section === 'workspace' ? 'workspace' : 'private' });
      navigate(`/p/${page.id}`);
    } catch (e: any) {
      s.toast(e.message, { kind: 'error' });
    }
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = s.sidebarWidth;
    const move = (ev: MouseEvent) => s.setSidebarWidth(w0 + ev.clientX - x0);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <nav className={'sidebar ' + (peekFloating ? 'floating' : '')} style={{ width: s.sidebarWidth }} data-testid="sidebar">
      <div className="sidebar-top">
        <WorkspaceSwitcher />
        <Tooltip label="Close sidebar" kbd={MOD + '\\'}>
          <button className="icon-btn sm sidebar-collapse" onClick={() => s.setSidebarOpen(false)} data-testid="close-sidebar">
            <ChevronsLeft size={18} />
          </button>
        </Tooltip>
        <Tooltip label="Create a new page">
          <button className="icon-btn sm" onClick={() => newPage(s.isMember ? 'private' : 'shared')} data-testid="new-page-top" disabled={!s.isMember}>
            <SquarePen size={17} />
          </button>
        </Tooltip>
      </div>
      <div className="sidebar-nav">
        <SideItem icon={<Search size={18} />} label="Search" onClick={() => s.set({ searchOpen: true })} testId="nav-search" />
        <SideItem icon={<Home size={18} />} label="Home" onClick={() => navigate('/')} testId="nav-home" />
        <SideItem icon={<Inbox size={18} />} label="Inbox" onClick={onOpenInbox} badge={s.unread || undefined} testId="nav-inbox" />
      </div>
      <div className="sidebar-scroll">
        {s.favorites.length > 0 && (
          <SidebarSection title="Favorites">
            {s.favorites.map((f) => {
              const sp = s.sidebarPages.find((p) => p.id === f.id);
              return <PageItem key={'fav-' + f.id} page={sp || { ...f, parentId: null, position: 0, isInline: false, section: null, role: 'view', type: f.type as any }} byParent={byParent} depth={0} keyPrefix="fav" />;
            })}
          </SidebarSection>
        )}
        {s.isMember && (
          <SidebarSection title={ws?.name ? `${ws.name}` : 'Workspace'} onAdd={() => newPage('workspace')} section="workspace" testId="section-workspace">
            {roots('workspace').map((p) => (
              <PageItem key={p.id} page={p} byParent={byParent} depth={0} />
            ))}
            {roots('workspace').length === 0 && <div className="sidebar-empty">Pages here are shared with everyone in the workspace</div>}
          </SidebarSection>
        )}
        {roots('shared').length > 0 && (
          <SidebarSection title="Shared" testId="section-shared">
            {roots('shared').map((p) => (
              <PageItem key={p.id} page={p} byParent={byParent} depth={0} />
            ))}
          </SidebarSection>
        )}
        {s.isMember && (
          <SidebarSection title="Private" onAdd={() => newPage('private')} section="private" testId="section-private">
            {roots('private').map((p) => (
              <PageItem key={p.id} page={p} byParent={byParent} depth={0} />
            ))}
            {roots('private').length === 0 && (
              <button className="sidebar-empty add" onClick={() => newPage('private')}>
                <Plus size={14} /> Add a page
              </button>
            )}
          </SidebarSection>
        )}
        <div className="sidebar-nav" style={{ marginTop: 12 }}>
          <SideItem icon={<Settings size={18} />} label="Settings" onClick={() => s.set({ settingsTab: 'account' })} testId="nav-settings" />
          <SideItem icon={<Trash2 size={18} />} label="Trash" onClick={(e) => setTrashAnchor(e.currentTarget)} testId="nav-trash" />
        </div>
      </div>
      {s.isMember && (
        <div className="sidebar-bottom">
          <button className="side-item invite" onClick={() => s.set({ settingsTab: 'people' })} data-testid="invite-members">
            <UserPlus size={18} />
            <span>Invite members</span>
          </button>
        </div>
      )}
      <div className="sidebar-resizer" onMouseDown={startResize} onDoubleClick={() => s.setSidebarWidth(240)} />
      {trashAnchor && <TrashPopover anchor={trashAnchor} onClose={() => setTrashAnchor(null)} />}
    </nav>
  );
}

function SideItem({ icon, label, onClick, badge, active, testId }: { icon: React.ReactNode; label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; badge?: number; active?: boolean; testId?: string }) {
  return (
    <button className={'side-item ' + (active ? 'active' : '')} onClick={onClick} data-testid={testId}>
      <span className="side-icon">{icon}</span>
      <span className="ellipsis">{label}</span>
      {badge ? <span className="side-badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

function SidebarSection({ title, children, onAdd, section, testId }: { title: string; children: React.ReactNode; onAdd?: () => void; section?: Section; testId?: string }) {
  const key = 'section:' + title;
  const expanded = useApp((s) => s.expanded[key] !== false);
  const setExpanded = useApp((s) => s.setExpanded);
  const [dropOver, setDropOver] = useState(false);
  return (
    <div className="sidebar-section" data-testid={testId}>
      <div
        className={'section-head ' + (dropOver ? 'drop-inside' : '')}
        onDragOver={(e) => {
          if (!section || section === 'shared' || !dragState.sidebarPageId) return;
          e.preventDefault();
          setDropOver(true);
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={async (e) => {
          setDropOver(false);
          if (!section || !dragState.sidebarPageId) return;
          e.preventDefault();
          const id = dragState.sidebarPageId;
          clearDrag();
          await movePage(id, null, { visibility: section as 'private' | 'workspace' });
        }}
      >
        <button className="section-title" onClick={() => setExpanded(key, !expanded)}>
          <span className="ellipsis">{title}</span>
          <ChevronDown size={12} className="section-chevron" style={{ transform: expanded ? undefined : 'rotate(-90deg)' }} />
        </button>
        {onAdd && (
          <Tooltip label="Add a page">
            <button className="icon-btn sm section-add" onClick={onAdd} data-testid={testId ? testId + '-add' : undefined}>
              <Plus size={15} />
            </button>
          </Tooltip>
        )}
      </div>
      {expanded && <div className="section-body">{children}</div>}
    </div>
  );
}

function PageItem({ page, byParent, depth, keyPrefix = '' }: { page: SidebarPage; byParent: Map<string, SidebarPage[]>; depth: number; keyPrefix?: string }) {
  const navigate = useNavigate();
  const { pageId: activeId } = useParams();
  const expKey = keyPrefix + page.id;
  const expanded = useApp((s) => !!s.expanded[expKey]);
  const setExpanded = useApp((s) => s.setExpanded);
  const meta = useApp((s) => s.pageMeta[page.id]);
  const isFav = useApp((s) => s.favorites.some((f) => f.id === page.id));
  const toast = useApp((s) => s.toast);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [rename, setRename] = useState<HTMLElement | null>(null);
  const [drop, setDrop] = useState<'before' | 'after' | 'inside' | null>(null);
  const [moveAnchor, setMoveAnchor] = useState<DOMRect | null>(null);
  const children = byParent.get(page.id) || [];
  const title = meta?.title ?? page.title;
  const icon = meta?.icon !== undefined ? meta.icon : page.icon;
  const canEdit = page.role === 'edit' || page.role === 'full';

  const addChild = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const p = await createPage({ parentId: page.id });
      setExpanded(expKey, true);
      navigate(`/p/${p.id}`);
    } catch (err: any) {
      toast(err.message, { kind: 'error' });
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const where = drop;
    setDrop(null);
    if (dragState.blockIds && dragState.pageId) {
      const ids = dragState.blockIds;
      const from = dragState.pageId;
      clearDrag();
      if (from === page.id || page.type !== 'page') return;
      try {
        await api.post(`/api/pages/${from}/move-blocks`, { targetPageId: page.id, blockIds: ids });
        toast(`Moved to ${pageTitle(title)}`);
      } catch (err: any) {
        toast(err.message, { kind: 'error' });
      }
      return;
    }
    const id = dragState.sidebarPageId;
    clearDrag();
    if (!id || id === page.id || !where) return;
    const state = useApp.getState();
    if (where === 'inside') {
      await movePage(id, page.id);
      return;
    }
    const sibs = (page.parentId ? byParent.get(page.parentId) : state.sidebarPages.filter((p) => p.section === page.section && !p.parentId).sort((a, b) => a.position - b.position)) || [];
    const others = sibs.filter((p) => p.id !== id);
    const i = others.findIndex((p) => p.id === page.id);
    const position = where === 'before' ? between(others[i - 1]?.position, page.position) : between(page.position, others[i + 1]?.position);
    const extra: { position: number; visibility?: 'private' | 'workspace' } = { position };
    if (!page.parentId && (page.section === 'private' || page.section === 'workspace')) extra.visibility = page.section;
    await movePage(id, page.parentId, extra);
  };

  return (
    <div className="page-item-wrap">
      <div
        className={`page-item ${activeId === page.id ? 'active' : ''} ${drop ? 'drop-' + drop : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => navigate(`/p/${page.id}`)}
        draggable
        onDragStart={(e) => {
          dragState.sidebarPageId = page.id;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', page.id);
        }}
        onDragEnd={() => clearDrag()}
        onDragOver={(e) => {
          if (!dragState.sidebarPageId && !dragState.blockIds) return;
          if (dragState.sidebarPageId === page.id) return;
          e.preventDefault();
          e.stopPropagation();
          if (dragState.blockIds) {
            setDrop('inside');
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          const y = e.clientY - r.top;
          setDrop(y < r.height * 0.25 ? 'before' : y > r.height * 0.75 ? 'after' : 'inside');
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={onDrop}
        data-testid="sidebar-page"
        data-page-id={page.id}
        title={pageTitle(title)}
      >
        <span className="page-item-icon">
          <span className="pi-emoji">
            <PageIcon icon={icon} type={page.type} size={18} />
          </span>
          <button
            className="pi-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(expKey, !expanded);
            }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            data-testid="sidebar-toggle"
          >
            <ChevronRight size={14} style={{ transform: expanded ? 'rotate(90deg)' : undefined }} />
          </button>
        </span>
        <span className="page-item-title ellipsis">{pageTitle(title)}</span>
        <span className="page-item-actions" onClick={(e) => e.stopPropagation()}>
          <Tooltip label="Delete, duplicate, and more…">
            <button className="icon-btn sm" onClick={(e) => setMenu(e.currentTarget)} data-testid="sidebar-page-menu">
              <MoreHorizontal size={15} />
            </button>
          </Tooltip>
          {canEdit && page.type === 'page' && (
            <Tooltip label="Add a page inside">
              <button className="icon-btn sm" onClick={addChild} data-testid="sidebar-add-child">
                <Plus size={15} />
              </button>
            </Tooltip>
          )}
        </span>
      </div>
      {expanded && (
        <div className="page-children">
          {children.length ? (
            children.map((c) => <PageItem key={c.id} page={c} byParent={byParent} depth={depth + 1} keyPrefix={keyPrefix} />)
          ) : (
            <div className="sidebar-empty" style={{ paddingLeft: 30 + depth * 12 }}>
              {page.type === 'database' ? 'No pages inside' : 'No pages inside'}
            </div>
          )}
        </div>
      )}
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)}>
          <div className="menu" style={{ width: 260 }} data-testid="sidebar-menu">
            <MenuItem
              icon={<Star size={16} />}
              label={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
              onClick={() => {
                toggleFavorite(page.id, !isFav);
                setMenu(null);
              }}
              testId="menu-favorite"
            />
            <div className="menu-divider" />
            <MenuItem icon={<LinkIcon size={16} />} label="Copy link" onClick={() => (copyLink(page.id), setMenu(null))} />
            {canEdit && (
              <MenuItem
                icon={<Copy size={16} />}
                label="Duplicate"
                right={MOD + 'D'}
                onClick={async () => {
                  setMenu(null);
                  const p = await duplicatePage(page.id);
                  if (p) navigate(`/p/${p.id}`);
                }}
                testId="menu-duplicate"
              />
            )}
            {canEdit && <MenuItem icon={<Pencil size={16} />} label="Rename" right={MOD + 'Shift+R'} onClick={() => (setRename(menu), setMenu(null))} testId="menu-rename" />}
            {canEdit && <MenuItem icon={<CornerUpRight size={16} />} label="Move to" onClick={(e) => setMoveAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())} />}
            {canEdit && (
              <MenuItem
                icon={<Trash2 size={16} />}
                label="Move to Trash"
                danger
                onClick={async () => {
                  setMenu(null);
                  if ((await trashPage(page.id, title)) && activeId === page.id) navigate(page.parentId ? `/p/${page.parentId}` : '/');
                }}
                testId="menu-trash"
              />
            )}
            <div className="menu-divider" />
            <MenuItem icon={<ArrowUpRight size={16} />} label="Open in new tab" onClick={() => (window.open(`/p/${page.id}`, '_blank'), setMenu(null))} />
          </div>
          {moveAnchor && (
            <Popover anchor={moveAnchor} onClose={() => setMoveAnchor(null)} placement="right-start">
              <PagePicker
                placeholder="Move page to…"
                exclude={[page.id]}
                filter={(p) => p.parentType !== 'database'}
                onPick={async (p) => {
                  setMoveAnchor(null);
                  setMenu(null);
                  if (await movePage(page.id, p.id)) toast(`Moved to ${pageTitle(p.title)}`);
                }}
              />
            </Popover>
          )}
        </Popover>
      )}
      {rename && <RenamePopover anchor={rename} pageId={page.id} title={title} icon={icon ?? null} type={page.type} onClose={() => setRename(null)} />}
    </div>
  );
}

function RenamePopover({ anchor, pageId, title, icon, type, onClose }: { anchor: HTMLElement; pageId: string; title: string; icon: string | null; type: string; onClose: () => void }) {
  const [value, setValue] = useState(title);
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const save = () => {
    if (value !== title) renamePage(pageId, value);
    onClose();
  };
  return (
    <Popover anchor={anchor} onClose={save} width={340}>
      <div className="rename-popover">
        <button className="icon-btn rename-icon" onClick={(e) => setIconAnchor(e.currentTarget)}>
          <PageIcon icon={icon} type={type} size={18} />
        </button>
        <input className="input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} onFocus={(e) => e.currentTarget.select()} data-testid="rename-input" />
      </div>
      {iconAnchor && (
        <Popover anchor={iconAnchor} onClose={() => setIconAnchor(null)}>
          <EmojiPicker
            onPick={(i) => {
              setPageIcon(pageId, i);
              setIconAnchor(null);
            }}
            onRemove={() => {
              setPageIcon(pageId, null);
              setIconAnchor(null);
            }}
          />
        </Popover>
      )}
    </Popover>
  );
}

function WorkspaceSwitcher() {
  const s = useApp();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const ws = s.workspaces.find((w) => w.id === s.workspaceId);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const r = await api.post('/api/workspaces', { name: name.trim() });
      await s.refreshWorkspaces();
      s.setWorkspace(r.workspace.id);
      setCreating(false);
      setName('');
      navigate('/');
    } catch (err: any) {
      s.toast(err.message, { kind: 'error' });
    }
  };
  return (
    <>
      <button className="ws-switcher" onClick={(e) => setAnchor(e.currentTarget)} data-testid="workspace-switcher">
        <span className="ws-icon">{ws?.icon || ws?.name.charAt(0).toUpperCase() || 'N'}</span>
        <span className="ws-name ellipsis">{ws?.name || 'Workspace'}</span>
        <ChevronDown size={14} className="faint" />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={300}>
          <div className="menu ws-menu">
            <div className="ws-menu-head">
              <span className="ws-icon lg">{ws?.icon || ws?.name.charAt(0).toUpperCase()}</span>
              <div className="grow">
                <div style={{ fontWeight: 600 }} className="ellipsis">{ws?.name}</div>
                <div className="faint small">{ws?.role === 'guest' ? 'Guest' : ws?.role === 'owner' ? 'Owner' : 'Member'}</div>
              </div>
            </div>
            <div className="ws-menu-actions">
              <button className="btn btn-outline" onClick={() => (s.set({ settingsTab: 'workspace' }), setAnchor(null))}>
                <Settings size={14} /> Settings
              </button>
              {ws?.role !== 'guest' && (
                <button className="btn btn-outline" onClick={() => (s.set({ settingsTab: 'people' }), setAnchor(null))}>
                  <Users size={14} /> Invite members
                </button>
              )}
            </div>
            <div className="menu-divider" />
            <div className="menu-label">{s.me?.email}</div>
            {s.workspaces.map((w) => (
              <MenuItem
                key={w.id}
                icon={<span className="ws-icon sm">{w.icon || w.name.charAt(0).toUpperCase()}</span>}
                label={w.name}
                desc={w.role === 'guest' ? 'Guest' : undefined}
                right={w.id === s.workspaceId ? <Check size={14} /> : undefined}
                onClick={() => {
                  s.setWorkspace(w.id);
                  setAnchor(null);
                  navigate('/');
                }}
                testId="workspace-option"
              />
            ))}
            <MenuItem icon={<Plus size={16} />} label="New workspace" onClick={() => (setCreating(true), setAnchor(null))} testId="new-workspace" />
            <div className="menu-divider" />
            <MenuItem
              icon={<LogOut size={16} />}
              label="Log out"
              onClick={async () => {
                await s.logout();
                navigate('/login');
              }}
              testId="logout"
            />
          </div>
        </Popover>
      )}
      {creating && (
        <Modal onClose={() => setCreating(false)} width={420}>
          <form onSubmit={create} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Create a new workspace</div>
            <div className="faint small">Workspaces keep pages, members and settings separate.</div>
            <input className="input" autoFocus placeholder="Workspace name" value={name} onChange={(e) => setName(e.target.value)} data-testid="new-workspace-name" />
            <button className="btn btn-primary btn-lg" type="submit" disabled={!name.trim()}>
              Create workspace
            </button>
          </form>
        </Modal>
      )}
      {void Avatar}
    </>
  );
}
