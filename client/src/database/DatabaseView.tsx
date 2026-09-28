import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Table2, KanbanSquare, Rows3, LayoutGrid, CalendarDays, GanttChart, Plus, Filter as FilterIcon, ArrowUpDown, Search,
  MoreHorizontal, ChevronDown, ChevronRight, Copy, Trash2, Eye, EyeOff, Layers, PanelRight, Square, Maximize2, WrapText,
  ArrowUpRight, GripVertical, X, Image as ImageIcon, Calendar,
} from 'lucide-react';
import { api } from '../api';
import { realtime } from '../realtime';
import { useApp } from '../store';
import type { DatabaseData, DbSchema, DbView, Page, PropertyDef, PropertyType, ViewConfig, ViewType } from '../types';
import { applyView, makeCtx, visibleProps, defaultsFromFilters, propIcon, type DbCtx } from './dbUtils';
import { FilterBar, PropertyPicker, SortMenu, newFilter } from './FilterSort';
import { Popover, MenuItem, Switch, Loading, Tooltip, PageIcon, confirmDialog } from '../components/ui';
import { pageTitle } from '../lib/format';
import { TableView } from './views/TableView';
import { BoardView } from './views/BoardView';
import { ListView } from './views/ListView';
import { GalleryView } from './views/GalleryView';
import { CalendarView } from './views/CalendarView';
import { TimelineView } from './views/TimelineView';

export const VIEW_TYPES: { type: ViewType; label: string; icon: React.ReactNode }[] = [
  { type: 'table', label: 'Table', icon: <Table2 size={16} strokeWidth={1.7} /> },
  { type: 'board', label: 'Board', icon: <KanbanSquare size={16} strokeWidth={1.7} /> },
  { type: 'list', label: 'List', icon: <Rows3 size={16} strokeWidth={1.7} /> },
  { type: 'gallery', label: 'Gallery', icon: <LayoutGrid size={16} strokeWidth={1.7} /> },
  { type: 'calendar', label: 'Calendar', icon: <CalendarDays size={16} strokeWidth={1.7} /> },
  { type: 'timeline', label: 'Timeline', icon: <GanttChart size={16} strokeWidth={1.7} /> },
];
/** Tells DatabaseViews in this tab that rows of a database changed. */
export function notifyDbChanged(databaseId: string) {
  window.dispatchEvent(new CustomEvent('db:changed', { detail: { databaseId } }));
}

export const viewIcon = (t: ViewType) => VIEW_TYPES.find((v) => v.type === t)?.icon;

export interface DbApi {
  data: DatabaseData;
  schema: DbSchema;
  view: DbView;
  cfg: ViewConfig;
  ctx: DbCtx;
  rows: Page[];
  readOnly: boolean;
  publicMode?: boolean;
  updateRow: (rowId: string, props: Record<string, any>) => void;
  addRow: (props?: Record<string, any>, opts?: { open?: boolean; position?: number; title?: string }) => Promise<Page | null>;
  deleteRows: (ids: string[]) => void;
  openRow: (id: string) => void;
  updateView: (patch: Partial<ViewConfig>) => void;
  updateDef: (propId: string, patch: Partial<PropertyDef> & { type?: PropertyType }) => Promise<PropertyDef | void>;
  addProperty: (type: PropertyType, opts?: { name?: string; viewIndex?: number }) => Promise<PropertyDef | null>;
  deleteProperty: (propId: string) => void;
  duplicateProperty: (propId: string) => void;
  reorderRows: (ids: string[]) => void;
  openFilterFor: (propId: string) => void;
  toggleSort: (propId: string, dir: 'asc' | 'desc') => void;
}

const DbContext = createContext<DbApi>(null as any);
export const useDb = () => useContext(DbContext);

export function DatabaseView({ databaseId, inline, fullPage, readOnly: readOnlyProp, publicMode, publicData }: { databaseId: string; inline?: boolean; fullPage?: boolean; readOnly?: boolean; publicMode?: boolean; publicData?: DatabaseData }) {
  const [data, setData] = useState<DatabaseData | null>(publicData || null);
  const [error, setError] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('view:' + databaseId);
    } catch {
      return null;
    }
  });
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [openFilterId, setOpenFilterId] = useState<string | null>(null);
  const [filterPicker, setFilterPicker] = useState<HTMLElement | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const toast = useApp((s) => s.toast);
  const mergeMeta = useApp((s) => s.mergeMeta);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const reloadTimer = useRef(0);

  const load = useCallback(async () => {
    if (publicMode) return;
    try {
      const d: DatabaseData = await api.get(`/api/databases/${databaseId}`);
      setData(d);
      mergeMeta(d.rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon, type: r.type, parentId: databaseId, parentType: 'database' })));
    } catch (e: any) {
      setError(e.message);
    }
  }, [databaseId, publicMode, mergeMeta]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // changes made elsewhere in this tab (row peek, row page) — the server does not echo them back
    const onLocal = (e: Event) => {
      if ((e as CustomEvent).detail?.databaseId === databaseId) {
        window.clearTimeout(reloadTimer.current);
        reloadTimer.current = window.setTimeout(load, 50);
      }
    };
    window.addEventListener('db:changed', onLocal);
    return () => window.removeEventListener('db:changed', onLocal);
  }, [databaseId, load]);

  useEffect(() => {
    if (publicMode) return;
    const unsub = realtime.subscribe('page:' + databaseId);
    const off = realtime.on((msg) => {
      if ((msg.pageId === databaseId && (msg.type === 'db.changed' || msg.type === 'page.updated')) || msg.type === 'reconnected') {
        window.clearTimeout(reloadTimer.current);
        reloadTimer.current = window.setTimeout(load, 120);
      }
    });
    return () => {
      off();
      unsub();
    };
  }, [databaseId, load, publicMode]);

  const view = data ? data.views.find((v) => v.id === viewId) || data.views[0] : null;
  const schema = data?.database.schema;
  const readOnly = !!readOnlyProp || !data || !['edit', 'full'].includes(data.role) || !!publicMode;
  const ctx = useMemo(() => (data && schema ? makeCtx(data, schema) : null), [data, schema]);
  const cfg = view?.config || {};
  const rows = useMemo(() => (data && ctx && view ? applyView(data.rows, view.config, ctx, search) : []), [data, ctx, view, search]);

  const selectView = (id: string) => {
    setViewId(id);
    try {
      localStorage.setItem('view:' + databaseId, id);
    } catch {
      /* ignore */
    }
  };

  const patchData = (fn: (d: DatabaseData) => DatabaseData) => setData((d) => (d ? fn(d) : d));

  const dbApi: DbApi | null =
    data && schema && view && ctx
      ? {
          data,
          schema,
          view,
          cfg,
          ctx,
          rows,
          readOnly,
          publicMode,
          updateRow: (rowId, props) => {
            patchData((d) => ({
              ...d,
              rows: d.rows.map((r) => {
                if (r.id !== rowId) return r;
                const next = { ...r, properties: { ...r.properties }, updatedAt: Date.now() };
                for (const [k, v] of Object.entries(props)) {
                  if (schema.properties[k]?.type === 'title') next.title = v;
                  else next.properties[k] = v;
                }
                return next;
              }),
            }));
            if ('title' in props) mergeMeta([{ id: rowId, title: props.title }]);
            api.patch(`/api/pages/${rowId}`, { properties: props }).catch((e) => {
              toast(e.message, { kind: 'error' });
              load();
            });
          },
          addRow: async (props = {}, opts = {}) => {
            try {
              const defaults = { ...defaultsFromFilters(cfg, schema), ...props };
              const title = opts.title ?? '';
              const r = await api.post('/api/pages', { parentId: databaseId, title, properties: defaults, position: opts.position });
              patchData((d) => ({ ...d, rows: [...d.rows, r.page].sort((a, b) => a.position - b.position) }));
              mergeMeta([{ id: r.page.id, title, icon: null, type: 'page', parentId: databaseId, parentType: 'database' }]);
              if (opts.open) dbApi!.openRow(r.page.id);
              return r.page as Page;
            } catch (e: any) {
              toast(e.message, { kind: 'error' });
              return null;
            }
          },
          deleteRows: async (ids) => {
            patchData((d) => ({ ...d, rows: d.rows.filter((r) => !ids.includes(r.id)) }));
            try {
              await api.post('/api/pages/trash-many', { ids });
              toast(ids.length === 1 ? 'Moved to Trash' : `Moved ${ids.length} pages to Trash`, {
                action: {
                  label: 'Undo',
                  run: async () => {
                    for (const id of ids) await api.post(`/api/pages/${id}/restore`);
                    load();
                  },
                },
              });
            } catch (e: any) {
              toast(e.message, { kind: 'error' });
              load();
            }
          },
          openRow: (id) => {
            if (publicMode) {
              navigate(`/share/${id}`);
              return;
            }
            const openIn = cfg.openIn || 'side';
            if (openIn === 'full') navigate(`/p/${id}`);
            else {
              const next = new URLSearchParams(params);
              next.set('p', id);
              if (openIn === 'center') next.set('peek', 'center');
              else next.delete('peek');
              setParams(next);
            }
          },
          updateView: (patch) => {
            const nextCfg = { ...cfg, ...patch };
            patchData((d) => ({ ...d, views: d.views.map((v) => (v.id === view.id ? { ...v, config: nextCfg } : v)) }));
            if (!readOnly) api.patch(`/api/views/${view.id}`, { config: patch }).catch((e) => toast(e.message, { kind: 'error' }));
          },
          updateDef: async (propId, patch) => {
            patchData((d) => ({
              ...d,
              database: { ...d.database, schema: { ...d.database.schema!, properties: { ...d.database.schema!.properties, [propId]: { ...d.database.schema!.properties[propId], ...patch } as PropertyDef } } },
            }));
            try {
              const r = await api.patch(`/api/databases/${databaseId}/properties/${propId}`, patch);
              if (patch.type || patch.options || patch.databaseId) load();
              else patchData((d) => ({ ...d, database: { ...d.database, schema: r.schema } }));
              return r.property as PropertyDef;
            } catch (e: any) {
              toast(e.message, { kind: 'error' });
              load();
            }
          },
          addProperty: async (type, opts = {}) => {
            try {
              const r = await api.post(`/api/databases/${databaseId}/properties`, { type, name: opts.name, viewId: view.id, viewIndex: opts.viewIndex });
              await load();
              return r.property as PropertyDef;
            } catch (e: any) {
              toast(e.message, { kind: 'error' });
              return null;
            }
          },
          deleteProperty: async (propId) => {
            try {
              await api.del(`/api/databases/${databaseId}/properties/${propId}`);
              load();
            } catch (e: any) {
              toast(e.message, { kind: 'error' });
            }
          },
          duplicateProperty: async (propId) => {
            await api.post(`/api/databases/${databaseId}/properties/${propId}/duplicate`);
            load();
          },
          reorderRows: (ids) => {
            const pos = new Map(ids.map((id, i) => [id, i + 1]));
            patchData((d) => ({ ...d, rows: d.rows.map((r) => (pos.has(r.id) ? { ...r, position: pos.get(r.id)! } : r)).sort((a, b) => a.position - b.position) }));
            api.post(`/api/databases/${databaseId}/reorder`, { ids }).catch(() => load());
          },
          openFilterFor: (propId) => {
            const def = schema.properties[propId];
            if (!def) return;
            const existing = (cfg.filters || []).find((f) => f.property === propId);
            if (existing) setOpenFilterId(existing.id);
            else {
              const f = newFilter(def);
              dbApi!.updateView({ filters: [...(cfg.filters || []), f] });
              setTimeout(() => setOpenFilterId(f.id), 30);
            }
          },
          toggleSort: (propId, dir) => {
            dbApi!.updateView({ sorts: [{ property: propId, direction: dir }, ...(cfg.sorts || []).filter((s) => s.property !== propId)] });
          },
        }
      : null;

  if (error) return <div className="db-error faint">Could not load database: {error}</div>;
  if (!data || !dbApi || !view) return <div style={{ height: 120 }}><Loading /></div>;

  const Comp = { table: TableView, board: BoardView, list: ListView, gallery: GalleryView, calendar: CalendarView, timeline: TimelineView }[view.type];

  return (
    <DbContext.Provider value={dbApi}>
      <div className={`db-view ${inline ? 'db-inline' : ''} ${fullPage ? 'db-full' : ''}`} data-testid="database-view" data-db-id={databaseId}>
        {inline && <InlineDbTitle data={data} readOnly={readOnly} onChange={(title) => patchData((d) => ({ ...d, database: { ...d.database, title } }))} />}
        <div className="db-toolbar">
          <ViewTabs views={data.views} active={view} onSelect={selectView} readOnly={readOnly} databaseId={databaseId} reload={load} />
          <div className="db-actions">
            <Tooltip label="Filter">
              <button
                className={'icon-btn ' + ((cfg.filters || []).length ? 'accent' : '')}
                onClick={(e) => setFilterPicker(e.currentTarget)}
                data-testid="db-filter"
              >
                <FilterIcon size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Sort">
              <button className={'icon-btn ' + ((cfg.sorts || []).length ? 'accent' : '')} onClick={(e) => setSortAnchor(e.currentTarget)} data-testid="db-sort">
                <ArrowUpDown size={16} />
              </button>
            </Tooltip>
            {searchOpen ? (
              <div className="db-search">
                <Search size={14} className="faint" />
                <input autoFocus placeholder="Type to search…" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => !search && setSearchOpen(false)} onKeyDown={(e) => e.key === 'Escape' && (setSearch(''), setSearchOpen(false))} data-testid="db-search-input" />
                {search && (
                  <button className="icon-btn sm" onClick={() => setSearch('')}>
                    <X size={12} />
                  </button>
                )}
              </div>
            ) : (
              <Tooltip label="Search">
                <button className="icon-btn" onClick={() => setSearchOpen(true)} data-testid="db-search">
                  <Search size={16} />
                </button>
              </Tooltip>
            )}
            <Tooltip label="Edit view layout, grouping, and more…">
              <button className="icon-btn" onClick={(e) => setSettingsAnchor(e.currentTarget)} data-testid="db-settings">
                <MoreHorizontal size={16} />
              </button>
            </Tooltip>
            {!readOnly && (
              <button className="db-new-btn" onClick={() => dbApi.addRow({}, { open: view.type !== 'table' })} data-testid="db-new">
                New
                <span className="db-new-caret">
                  <ChevronDown size={12} />
                </span>
              </button>
            )}
          </div>
        </div>
        <FilterBar cfg={cfg} schema={data.database.schema!} people={data.people} update={dbApi.updateView} readOnly={readOnly} openFilterId={openFilterId} setOpenFilterId={setOpenFilterId} />
        <div className="db-body">
          <Comp />
        </div>
        {filterPicker && (
          <Popover anchor={filterPicker} onClose={() => setFilterPicker(null)}>
            <PropertyPicker
              schema={data.database.schema!}
              onPick={(p) => {
                setFilterPicker(null);
                dbApi.openFilterFor(p.id);
              }}
            />
          </Popover>
        )}
        {sortAnchor && <SortMenu anchor={sortAnchor} sorts={cfg.sorts || []} schema={data.database.schema!} onChange={(s) => dbApi.updateView({ sorts: s })} onClose={() => setSortAnchor(null)} />}
        {settingsAnchor && <ViewSettings anchor={settingsAnchor} onClose={() => setSettingsAnchor(null)} reload={load} onDeleted={() => setViewId(null)} />}
      </div>
    </DbContext.Provider>
  );

}

function InlineDbTitle({ data, readOnly, onChange }: { data: DatabaseData; readOnly: boolean; onChange: (t: string) => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(data.database.title);
  const timer = useRef(0);
  const mergeMeta = useApp((s) => s.mergeMeta);
  useEffect(() => setTitle(data.database.title), [data.database.title]);
  return (
    <div className="db-inline-title">
      <input
        className="db-title-input"
        value={title}
        placeholder="Untitled"
        readOnly={readOnly}
        onChange={(e) => {
          const t = e.target.value;
          setTitle(t);
          onChange(t);
          mergeMeta([{ id: data.database.id, title: t }]);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => api.patch(`/api/pages/${data.database.id}`, { title: t }).then(() => useApp.getState().loadSidebar()), 400);
        }}
        data-testid="inline-db-title"
      />
      {!data.database.isInline || true ? (
        <Tooltip label="Open as full page">
          <button className="icon-btn sm db-open-full" onClick={() => navigate(`/p/${data.database.id}`)}>
            <ArrowUpRight size={14} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function ViewTabs({ views, active, onSelect, readOnly, databaseId, reload }: { views: DbView[]; active: DbView; onSelect: (id: string) => void; readOnly: boolean; databaseId: string; reload: () => Promise<void> }) {
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [tabMenu, setTabMenu] = useState<{ view: DbView; el: HTMLElement } | null>(null);
  const toast = useApp((s) => s.toast);
  const addView = async (type: ViewType) => {
    setAddAnchor(null);
    try {
      const r = await api.post(`/api/databases/${databaseId}/views`, { type, name: VIEW_TYPES.find((v) => v.type === type)?.label });
      await reload();
      onSelect(r.view.id);
    } catch (e: any) {
      toast(e.message, { kind: 'error' });
    }
  };
  return (
    <div className="view-tabs" data-testid="view-tabs">
      {views.map((v) => (
        <button
          key={v.id}
          className={'view-tab ' + (v.id === active.id ? 'on' : '')}
          onClick={(e) => {
            if (v.id === active.id && !readOnly) setTabMenu({ view: v, el: e.currentTarget });
            else onSelect(v.id);
          }}
          data-testid="view-tab"
        >
          {viewIcon(v.type)}
          <span className="ellipsis">{v.name}</span>
        </button>
      ))}
      {!readOnly && (
        <Tooltip label="Add a new view">
          <button className="icon-btn sm view-add" onClick={(e) => setAddAnchor(e.currentTarget)} data-testid="add-view">
            <Plus size={14} />
          </button>
        </Tooltip>
      )}
      {addAnchor && (
        <Popover anchor={addAnchor} onClose={() => setAddAnchor(null)}>
          <div className="menu" style={{ width: 220 }}>
            <div className="menu-label">Add a new view</div>
            {VIEW_TYPES.map((t) => (
              <MenuItem key={t.type} icon={t.icon} label={t.label} onClick={() => addView(t.type)} testId={'add-view-' + t.type} />
            ))}
          </div>
        </Popover>
      )}
      {tabMenu && <ViewTabMenu view={tabMenu.view} anchor={tabMenu.el} onClose={() => setTabMenu(null)} views={views} reload={reload} onSelect={onSelect} databaseId={databaseId} />}
    </div>
  );
}

function ViewTabMenu({ view, anchor, onClose, views, reload, onSelect, databaseId }: { view: DbView; anchor: HTMLElement; onClose: () => void; views: DbView[]; reload: () => Promise<void>; onSelect: (id: string) => void; databaseId: string }) {
  const [name, setName] = useState(view.name);
  const toast = useApp((s) => s.toast);
  const save = async () => {
    if (name.trim() && name !== view.name) {
      await api.patch(`/api/views/${view.id}`, { name: name.trim() });
      reload();
    }
  };
  return (
    <Popover
      anchor={anchor}
      onClose={() => {
        save();
        onClose();
      }}
    >
      <div className="menu" style={{ width: 240 }}>
        <div className="menu-search">
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                save();
                onClose();
              }
            }}
            data-testid="view-name"
          />
        </div>
        <MenuItem
          icon={<Copy size={16} />}
          label="Duplicate view"
          onClick={async () => {
            onClose();
            const r = await api.post(`/api/databases/${databaseId}/views`, { type: view.type, name: view.name + ' (copy)', duplicateOf: view.id });
            await reload();
            onSelect(r.view.id);
          }}
        />
        <MenuItem
          icon={<Trash2 size={16} />}
          label="Delete view"
          danger
          disabled={views.length <= 1}
          onClick={async () => {
            onClose();
            if (!(await confirmDialog({ title: `Delete the "${view.name}" view?`, confirm: 'Delete', danger: true }))) return;
            try {
              await api.del(`/api/views/${view.id}`);
              await reload();
              onSelect(views.find((v) => v.id !== view.id)!.id);
            } catch (e: any) {
              toast(e.message, { kind: 'error' });
            }
          }}
        />
      </div>
    </Popover>
  );
}

function ViewSettings({ anchor, onClose, reload, onDeleted }: { anchor: HTMLElement; onClose: () => void; reload: () => Promise<void>; onDeleted: () => void }) {
  const db = useDb();
  const { view, cfg, schema, readOnly } = db;
  const [panel, setPanel] = useState<'main' | 'layout' | 'properties' | 'group' | 'dateby' | 'open'>('main');
  const [name, setName] = useState(view.name);
  const toast = useApp((s) => s.toast);
  const setType = async (type: ViewType) => {
    try {
      await api.patch(`/api/views/${view.id}`, { type });
      await reload();
    } catch (e: any) {
      toast(e.message, { kind: 'error' });
    }
  };
  const saveName = () => {
    if (name.trim() && name !== view.name) api.patch(`/api/views/${view.id}`, { name: name.trim() }).then(reload);
  };
  const props = visibleProps(cfg, schema, true);
  const groupable = schema.order.map((id) => schema.properties[id]).filter((p) => p && ['select', 'multi_select', 'status', 'person', 'checkbox'].includes(p.type));
  const dateProps = schema.order.map((id) => schema.properties[id]).filter((p) => p && ['date', 'created_time', 'last_edited_time'].includes(p.type));
  const setVisible = (id: string, visible: boolean) => {
    const list = props.map((p) => ({ id: p.def.id, visible: p.def.id === id ? visible : p.visible, width: p.width }));
    db.updateView({ properties: list });
  };
  const back = (
    <button className="menu-back" onClick={() => setPanel('main')}>
      <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> Back
    </button>
  );
  return (
    <Popover
      anchor={anchor}
      onClose={() => {
        saveName();
        onClose();
      }}
      placement="bottom-end"
      width={290}
    >
      <div className="menu view-settings" data-testid="view-settings">
        {panel === 'main' && (
          <>
            <div className="menu-label">View options</div>
            <div className="menu-search">
              <input className="input" value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()} />
            </div>
            <MenuItem icon={viewIcon(view.type)} label="Layout" right={<>{VIEW_TYPES.find((v) => v.type === view.type)?.label} <ChevronRight size={14} /></>} onClick={() => setPanel('layout')} disabled={readOnly} testId="settings-layout" />
            <MenuItem icon={<Eye size={16} />} label="Property visibility" right={<>{props.filter((p) => p.visible).length} shown <ChevronRight size={14} /></>} onClick={() => setPanel('properties')} testId="settings-properties" />
            {(view.type === 'board' || view.type === 'table' || view.type === 'list' || view.type === 'gallery') && (
              <MenuItem icon={<Layers size={16} />} label="Group" right={<>{cfg.groupBy ? schema.properties[cfg.groupBy]?.name : 'None'} <ChevronRight size={14} /></>} onClick={() => setPanel('group')} testId="settings-group" />
            )}
            {(view.type === 'calendar' || view.type === 'timeline') && (
              <MenuItem icon={<Calendar size={16} />} label={view.type === 'calendar' ? 'Show calendar by' : 'Show timeline by'} right={<>{cfg.dateBy ? schema.properties[cfg.dateBy]?.name : 'None'} <ChevronRight size={14} /></>} onClick={() => setPanel('dateby')} />
            )}
            {(view.type === 'gallery' || view.type === 'board') && (
              <>
                <MenuItem
                  icon={<ImageIcon size={16} />}
                  label="Card preview"
                  right={<>{{ none: 'None', cover: 'Page cover', content: 'Page content' }[cfg.cardPreview || 'none']}</>}
                  onClick={() => db.updateView({ cardPreview: cfg.cardPreview === 'content' ? 'cover' : cfg.cardPreview === 'cover' ? 'none' : 'content' })}
                />
                <MenuItem
                  icon={<LayoutGrid size={16} />}
                  label="Card size"
                  right={<>{{ small: 'Small', medium: 'Medium', large: 'Large' }[cfg.cardSize || 'medium']}</>}
                  onClick={() => db.updateView({ cardSize: cfg.cardSize === 'small' ? 'medium' : cfg.cardSize === 'medium' || !cfg.cardSize ? 'large' : 'small' })}
                />
              </>
            )}
            {view.type === 'table' && <MenuItem icon={<WrapText size={16} />} label="Wrap all columns" right={<Switch on={!!cfg.wrap} onChange={() => {}} />} onClick={() => db.updateView({ wrap: !cfg.wrap })} />}
            <MenuItem icon={<PanelRight size={16} />} label="Open pages in" right={<>{{ side: 'Side peek', center: 'Center peek', full: 'Full page' }[cfg.openIn || 'side']} <ChevronRight size={14} /></>} onClick={() => setPanel('open')} />
            {!readOnly && (
              <>
                <div className="menu-divider" />
                <MenuItem
                  icon={<Copy size={16} />}
                  label="Duplicate view"
                  onClick={async () => {
                    onClose();
                    await api.post(`/api/databases/${db.data.database.id}/views`, { type: view.type, name: view.name + ' (copy)', duplicateOf: view.id });
                    reload();
                  }}
                />
                <MenuItem
                  icon={<Trash2 size={16} />}
                  label="Delete view"
                  danger
                  disabled={db.data.views.length <= 1}
                  onClick={async () => {
                    onClose();
                    if (!(await confirmDialog({ title: `Delete the "${view.name}" view?`, confirm: 'Delete', danger: true }))) return;
                    await api.del(`/api/views/${view.id}`);
                    onDeleted();
                    reload();
                  }}
                />
              </>
            )}
          </>
        )}
        {panel === 'layout' && (
          <>
            {back}
            <div className="layout-grid">
              {VIEW_TYPES.map((t) => (
                <button key={t.type} className={'layout-opt ' + (t.type === view.type ? 'on' : '')} onClick={() => setType(t.type)} data-testid={'layout-' + t.type}>
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {panel === 'properties' && (
          <>
            {back}
            <PropertyVisibilityList />
            <div className="menu-divider" />
            <MenuItem icon={<EyeOff size={16} />} label="Hide all" onClick={() => db.updateView({ properties: props.map((p) => ({ id: p.def.id, visible: p.def.type === 'title', width: p.width })) })} />
            <MenuItem icon={<Eye size={16} />} label="Show all" onClick={() => db.updateView({ properties: props.map((p) => ({ id: p.def.id, visible: true, width: p.width })) })} />
            {void setVisible}
          </>
        )}
        {panel === 'group' && (
          <>
            {back}
            <div className="menu-label">Group by</div>
            {view.type !== 'board' && <MenuItem label="None" checked={!cfg.groupBy} onClick={() => db.updateView({ groupBy: null, groupOrder: [], hiddenGroups: [] })} />}
            {groupable.map((p) => (
              <MenuItem key={p.id} icon={propIcon(p.type)} label={p.name} checked={cfg.groupBy === p.id} onClick={() => db.updateView({ groupBy: p.id, groupOrder: [], hiddenGroups: [] })} testId={'group-by-' + p.name} />
            ))}
            {!groupable.length && <div className="menu-empty">Add a Select, Status, Person or Checkbox property to group by it.</div>}
            {cfg.groupBy && <MenuItem label="Hide empty groups" right={<Switch on={!!cfg.hideEmptyGroups} onChange={() => {}} />} onClick={() => db.updateView({ hideEmptyGroups: !cfg.hideEmptyGroups })} />}
          </>
        )}
        {panel === 'dateby' && (
          <>
            {back}
            {dateProps.map((p) => (
              <MenuItem key={p.id} icon={propIcon(p.type)} label={p.name} checked={cfg.dateBy === p.id} onClick={() => db.updateView({ dateBy: p.id })} />
            ))}
            {!dateProps.length && <div className="menu-empty">Add a Date property first.</div>}
          </>
        )}
        {panel === 'open' && (
          <>
            {back}
            <MenuItem icon={<PanelRight size={16} />} label="Side peek" desc="Open pages on the side. Keeps the view behind interactive." tall checked={(cfg.openIn || 'side') === 'side'} onClick={() => db.updateView({ openIn: 'side' })} />
            <MenuItem icon={<Square size={16} />} label="Center peek" desc="Open pages in a focused, centered view." tall checked={cfg.openIn === 'center'} onClick={() => db.updateView({ openIn: 'center' })} />
            <MenuItem icon={<Maximize2 size={16} />} label="Full page" desc="Open pages in full page." tall checked={cfg.openIn === 'full'} onClick={() => db.updateView({ openIn: 'full' })} />
          </>
        )}
      </div>
    </Popover>
  );
}

function PropertyVisibilityList() {
  const db = useDb();
  const props = visibleProps(db.cfg, db.schema, true);
  const [drag, setDrag] = useState<string | null>(null);
  const reorder = (from: string, to: string) => {
    const list = props.map((p) => ({ id: p.def.id, visible: p.visible, width: p.width }));
    const i = list.findIndex((p) => p.id === from);
    const [item] = list.splice(i, 1);
    const j = list.findIndex((p) => p.id === to);
    list.splice(j, 0, item);
    db.updateView({ properties: list });
  };
  return (
    <>
      {props.map((p) => (
        <div
          key={p.def.id}
          className="menu-item prop-vis-row"
          draggable={p.def.type !== 'title'}
          onDragStart={() => setDrag(p.def.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drag && drag !== p.def.id && p.def.type !== 'title' && reorder(drag, p.def.id)}
        >
          <GripVertical size={14} className="faint" />
          <span className="mi-icon">{propIcon(p.def.type)}</span>
          <span className="mi-body ellipsis">{p.def.name}</span>
          {p.def.type !== 'title' && (
            <button
              className="icon-btn sm"
              onClick={() => db.updateView({ properties: props.map((x) => ({ id: x.def.id, visible: x.def.id === p.def.id ? !x.visible : x.visible, width: x.width })) })}
              data-testid={'toggle-visibility-' + p.def.name}
            >
              {p.visible ? <Eye size={14} /> : <EyeOff size={14} className="faint" />}
            </button>
          )}
        </div>
      ))}
    </>
  );
}

/** Shared "+ New" row used by table and list views. */
export function NewRowButton({ onClick, label = 'New page' }: { onClick: () => void; label?: string }) {
  return (
    <button className="db-new-row" onClick={onClick} data-testid="db-new-row">
      <Plus size={14} /> {label}
    </button>
  );
}

export function RowTitle({ row, showIcon = true }: { row: Page; showIcon?: boolean }) {
  return (
    <span className="row-title">
      {showIcon && row.icon && <PageIcon icon={row.icon} size={16} />}
      <span className={'ellipsis ' + (row.title ? '' : 'faint')}>{pageTitle(row.title)}</span>
    </span>
  );
}
