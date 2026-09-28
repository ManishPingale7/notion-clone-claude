import React, { useMemo, useRef, useState } from 'react';
import { X, MoreHorizontal, Trash2, Paperclip, GripVertical, Plus, ArrowUpRight } from 'lucide-react';
import type { Page, PropertyDef, SelectOption, User } from '../types';
import { Avatar, Popover, MenuItem, useMenuNav, PageIcon } from '../components/ui';
import { DatePicker } from '../components/DatePicker';
import { getValue, valueText, OPTION_COLORS, nextOptionColor, type DbCtx } from './dbUtils';
import { formatDateValue, formatNumber, COLOR_NAMES, htmlToText, pageTitle, uuid, fileSize } from '../lib/format';
import { api } from '../api';
import { useApp } from '../store';

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function Tag({ option, onRemove, status }: { option: SelectOption; onRemove?: () => void; status?: boolean }) {
  return (
    <span className={`tag tag-${option.color || 'default'} ${status ? 'status' : ''}`} title={option.name}>
      {status && <span className={'dot dot-' + (option.color || 'default')} />}
      <span className="ellipsis">{option.name}</span>
      {onRemove && (
        <span
          className="tag-x"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={12} />
        </span>
      )}
    </span>
  );
}

export function PropertyDisplay({ def, row, ctx, wrap }: { def: PropertyDef; row: Page; ctx: DbCtx; wrap?: boolean }) {
  const v = getValue(row, def, ctx);
  switch (def.type) {
    case 'title':
      return <span className="prop-title">{row.title || ''}</span>;
    case 'text':
      return v ? <span className={'prop-text ' + (wrap ? 'wrap' : '')} dangerouslySetInnerHTML={{ __html: v }} /> : null;
    case 'number':
      return typeof v === 'number' ? <span className="prop-number">{formatNumber(v, def.format)}</span> : null;
    case 'select':
    case 'status': {
      const o = def.options?.find((x) => x.id === v);
      return o ? <Tag option={o} status={def.type === 'status'} /> : null;
    }
    case 'multi_select': {
      const opts = ((v as string[]) || []).map((id) => def.options?.find((o) => o.id === id)).filter(Boolean) as SelectOption[];
      return opts.length ? (
        <span className={'tag-list ' + (wrap ? 'wrap' : '')}>
          {opts.map((o) => (
            <Tag key={o.id} option={o} />
          ))}
        </span>
      ) : null;
    }
    case 'date':
      return v?.start ? <span className="prop-date">{formatDateValue(v, def.dateFormat || 'full')}</span> : null;
    case 'person':
    case 'created_by':
    case 'last_edited_by': {
      const people = ((v as string[]) || []).map((id) => ctx.people.get(id)).filter(Boolean) as User[];
      return people.length ? (
        <span className="person-list">
          {people.map((p) => (
            <span key={p.id} className="person-chip">
              <Avatar user={p} size={20} />
              <span className="ellipsis">{p.name}</span>
            </span>
          ))}
        </span>
      ) : null;
    }
    case 'checkbox':
      return (
        <span className={'checkbox ' + (v ? 'checked' : '')}>
          {v && (
            <svg viewBox="0 0 14 14" width="12" height="12">
              <polygon fill="currentColor" points="5.5 11.9993304 14 3.49933039 12.5 2 5.5 8.99933039 1.5 4.9968652 0 6.49933039" />
            </svg>
          )}
        </span>
      );
    case 'url':
      return v ? (
        <a className="prop-link" href={/^https?:/.test(v) ? v : 'https://' + v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {String(v).replace(/^https?:\/\//, '')}
        </a>
      ) : null;
    case 'email':
      return v ? (
        <a className="prop-link" href={'mailto:' + v} onClick={(e) => e.stopPropagation()}>
          {v}
        </a>
      ) : null;
    case 'phone':
      return v ? (
        <a className="prop-link" href={'tel:' + v} onClick={(e) => e.stopPropagation()}>
          {v}
        </a>
      ) : null;
    case 'files':
      return (v as any[])?.length ? (
        <span className="tag-list">
          {(v as { name: string; url: string }[]).map((f, i) => (
            <a key={i} className="file-chip" href={f.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              <Paperclip size={12} /> {f.name}
            </a>
          ))}
        </span>
      ) : null;
    case 'relation': {
      const ids = (v as string[]) || [];
      const rel = def.databaseId ? ctx.related[def.databaseId] : null;
      return ids.length ? (
        <span className="tag-list">
          {ids.map((id) => {
            const r = rel?.rows.find((x) => x.id === id);
            return (
              <span key={id} className="relation-chip">
                <PageIcon icon={r?.icon} size={14} />
                <span className="ellipsis">{pageTitle(r?.title)}</span>
              </span>
            );
          })}
        </span>
      ) : null;
    }
    case 'created_time':
    case 'last_edited_time':
      return <span className="prop-date">{new Date(v).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>;
    case 'unique_id':
      return typeof v === 'number' ? <span>{def.prefix ? `${def.prefix}-${v}` : v}</span> : null;
    case 'formula':
    case 'rollup': {
      if (v && typeof v === 'object' && 'error' in v) return <span className="prop-error" title={v.error}>Error</span>;
      if (typeof v === 'boolean')
        return (
          <span className={'checkbox ' + (v ? 'checked' : '')} style={{ pointerEvents: 'none' }}>
            {v && '✓'}
          </span>
        );
      const t = valueText(row, def, ctx);
      return t ? <span className="prop-text">{t}</span> : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

export interface EditorProps {
  def: PropertyDef;
  row: Page;
  ctx: DbCtx;
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
  onChange: (value: any) => void;
  onDefChange: (patch: Partial<PropertyDef>) => Promise<PropertyDef | void>;
  people: User[];
  width?: number;
}

export function PropertyEditor(props: EditorProps) {
  const { def, anchor, onClose } = props;
  const w = props.width;
  let body: React.ReactNode = null;
  let placement: 'bottom-start' | 'right-start' = 'bottom-start';
  switch (def.type) {
    case 'title':
    case 'text':
      body = <TextEditor {...props} />;
      break;
    case 'number':
    case 'url':
    case 'email':
    case 'phone':
      body = <InputEditor {...props} />;
      break;
    case 'select':
    case 'status':
    case 'multi_select':
      body = <SelectEditor {...props} />;
      break;
    case 'date':
      body = <DatePicker value={getValue(props.row, def, props.ctx) || null} onChange={(v) => props.onChange(v)} />;
      break;
    case 'person':
      body = <PersonEditor {...props} />;
      break;
    case 'files':
      body = <FilesEditor {...props} />;
      break;
    case 'relation':
      body = <RelationEditor {...props} />;
      break;
    default:
      return null;
  }
  const isTextual = ['title', 'text', 'number', 'url', 'email', 'phone'].includes(def.type);
  return (
    <Popover anchor={anchor} onClose={onClose} placement={placement} offset={isTextual ? -((anchor as any).height || (anchor instanceof HTMLElement ? anchor.offsetHeight : 0)) : 4} width={isTextual ? Math.max(w || 0, 240) : undefined}>
      {body}
    </Popover>
  );
}

function TextEditor({ def, row, ctx, onChange, onClose }: EditorProps) {
  const initial = def.type === 'title' ? row.title : htmlToText(getValue(row, def, ctx) || '');
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = () => {
    if (v !== initial) onChange(def.type === 'title' ? v : v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'));
    onClose();
  };
  return (
    <textarea
      ref={ref}
      className="cell-textarea"
      autoFocus
      value={v}
      rows={Math.min(10, Math.max(1, v.split('\n').length))}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (!e.shiftKey || def.type === 'title')) {
          e.preventDefault();
          done();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          done();
        }
      }}
      data-testid="cell-editor"
    />
  );
}

function InputEditor({ def, row, ctx, onChange, onClose }: EditorProps) {
  const initial = getValue(row, def, ctx);
  const [v, setV] = useState(initial === null || initial === undefined ? '' : String(initial));
  const done = () => {
    const out = def.type === 'number' ? (v.trim() === '' ? null : Number(v)) : v.trim();
    if (out !== initial && !(def.type === 'number' && Number.isNaN(out))) onChange(out);
    onClose();
  };
  return (
    <input
      className="cell-textarea"
      autoFocus
      type={def.type === 'number' ? 'number' : 'text'}
      step="any"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done();
        if (e.key === 'Escape') {
          e.stopPropagation();
          done();
        }
      }}
      data-testid="cell-editor"
    />
  );
}

function SelectEditor({ def, row, ctx, onChange, onDefChange }: EditorProps) {
  const multi = def.type === 'multi_select';
  const raw = getValue(row, def, ctx);
  const selected: string[] = multi ? raw || [] : raw ? [raw] : [];
  const [q, setQ] = useState('');
  const [optMenu, setOptMenu] = useState<{ opt: SelectOption; el: HTMLElement } | null>(null);
  const options = def.options || [];
  const filtered = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = options.some((o) => o.name.toLowerCase() === q.trim().toLowerCase());
  const canCreate = q.trim() && !exact;
  const items = [...filtered.map((o) => ({ kind: 'opt' as const, o })), ...(canCreate ? [{ kind: 'create' as const, o: null }] : [])];

  const toggle = (id: string) => {
    if (multi) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else onChange(selected[0] === id ? null : id);
    setQ('');
  };
  const create = async () => {
    const name = q.trim();
    if (!name) return;
    const opt: SelectOption = { id: uuid().slice(0, 8), name, color: nextOptionColor(options.length) };
    if (def.type === 'status') opt.group = 'todo';
    await onDefChange({ options: [...options, opt] });
    if (multi) onChange([...selected, opt.id]);
    else onChange(opt.id);
    setQ('');
  };
  const nav = useMenuNav(items.length, (i) => {
    const it = items[i];
    if (it.kind === 'opt') toggle(it.o.id);
    else create();
  }, [q, items.length]);

  const groups = def.type === 'status' ? (['todo', 'in_progress', 'complete'] as const) : null;
  const groupLabel = { todo: 'To-do', in_progress: 'In progress', complete: 'Complete' };

  const renderOpt = (o: SelectOption) => {
    const i = items.findIndex((it) => it.o?.id === o.id);
    return (
      <div key={o.id} className={'select-option ' + (i === nav.index ? 'selected' : '')} onMouseEnter={() => nav.setIndex(i)} onClick={() => toggle(o.id)} data-testid="select-option">
        <GripVertical size={14} className="faint" />
        <Tag option={o} status={def.type === 'status'} />
        {selected.includes(o.id) && !multi && <span className="check-mark">✓</span>}
        <button
          className="icon-btn sm opt-more"
          onClick={(e) => {
            e.stopPropagation();
            setOptMenu({ opt: o, el: e.currentTarget });
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    );
  };

  return (
    <div className="select-editor" style={{ width: 300 }}>
      <div className="select-input">
        {selected.map((id) => {
          const o = options.find((x) => x.id === id);
          return o ? <Tag key={id} option={o} status={def.type === 'status'} onRemove={() => toggle(id)} /> : null;
        })}
        <input
          autoFocus
          placeholder={selected.length ? '' : 'Search for an option…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !q && selected.length) {
              toggle(selected[selected.length - 1]);
              return;
            }
            nav.onKeyDown(e);
          }}
          data-testid="select-search"
        />
      </div>
      <div className="menu" style={{ maxHeight: 300 }}>
        <div className="menu-label">{options.length ? (multi ? 'Select an option or create one' : 'Select an option or create one') : 'Type to create an option'}</div>
        {groups
          ? groups.map((g) => {
              const list = filtered.filter((o) => (o.group || 'todo') === g);
              if (!list.length) return null;
              return (
                <React.Fragment key={g}>
                  <div className="menu-label">{groupLabel[g]}</div>
                  {list.map(renderOpt)}
                </React.Fragment>
              );
            })
          : filtered.map(renderOpt)}
        {canCreate && (
          <div className={'select-option ' + (nav.index === items.length - 1 ? 'selected' : '')} onClick={create} onMouseEnter={() => nav.setIndex(items.length - 1)} data-testid="select-create">
            <span className="faint">Create</span>
            <Tag option={{ id: 'new', name: q.trim(), color: nextOptionColor(options.length) }} />
          </div>
        )}
      </div>
      {optMenu && (
        <OptionMenu
          anchor={optMenu.el}
          option={optMenu.opt}
          onClose={() => setOptMenu(null)}
          onChange={(patch) => onDefChange({ options: options.map((o) => (o.id === optMenu.opt.id ? { ...o, ...patch } : o)) })}
          onDelete={() => {
            onDefChange({ options: options.filter((o) => o.id !== optMenu.opt.id) });
            setOptMenu(null);
          }}
          status={def.type === 'status'}
        />
      )}
    </div>
  );
}

export function OptionMenu({
  anchor,
  option,
  onClose,
  onChange,
  onDelete,
  status,
}: {
  anchor: HTMLElement;
  option: SelectOption;
  onClose: () => void;
  onChange: (p: Partial<SelectOption>) => void;
  onDelete: () => void;
  status?: boolean;
}) {
  const [name, setName] = useState(option.name);
  return (
    <Popover
      anchor={anchor}
      onClose={() => {
        if (name.trim() && name !== option.name) onChange({ name: name.trim() });
        onClose();
      }}
      placement="right-start"
    >
      <div className="menu" style={{ width: 220 }}>
        <div className="menu-search">
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (name.trim()) onChange({ name: name.trim() });
                onClose();
              }
            }}
          />
        </div>
        <MenuItem icon={<Trash2 size={16} />} label="Delete" danger onClick={onDelete} />
        {status && (
          <>
            <div className="menu-label">Group</div>
            {(['todo', 'in_progress', 'complete'] as const).map((g) => (
              <MenuItem key={g} label={{ todo: 'To-do', in_progress: 'In progress', complete: 'Complete' }[g]} checked={(option.group || 'todo') === g} onClick={() => onChange({ group: g })} />
            ))}
          </>
        )}
        <div className="menu-label">Colors</div>
        {OPTION_COLORS.map((c) => (
          <MenuItem key={c} icon={<span className={`color-dot tag-${c}`} />} label={COLOR_NAMES[c]} checked={option.color === c} onClick={() => onChange({ color: c })} />
        ))}
      </div>
    </Popover>
  );
}

function PersonEditor({ def, row, ctx, onChange, people }: EditorProps) {
  const selected: string[] = getValue(row, def, ctx) || [];
  const [q, setQ] = useState('');
  const list = people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.email || '').toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const nav = useMenuNav(list.length, (i) => toggle(list[i].id), [q]);
  return (
    <div style={{ width: 300 }}>
      <div className="select-input">
        {selected.map((id) => {
          const p = ctx.people.get(id);
          return p ? (
            <span key={id} className="person-chip removable">
              <Avatar user={p} size={18} /> {p.name}
              <span className="tag-x" onClick={() => toggle(id)}>
                <X size={12} />
              </span>
            </span>
          ) : null;
        })}
        <input autoFocus placeholder="Search for people…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={nav.onKeyDown} />
      </div>
      <div className="menu" style={{ maxHeight: 280 }}>
        <div className="menu-label">Select as many as you like</div>
        {list.map((p, i) => (
          <MenuItem key={p.id} icon={<Avatar user={p} size={20} />} label={p.name} desc={p.email} checked={selected.includes(p.id)} selected={i === nav.index} onMouseEnter={() => nav.setIndex(i)} onClick={() => toggle(p.id)} />
        ))}
        {!list.length && <div className="menu-empty">No people found</div>}
      </div>
    </div>
  );
}

function FilesEditor({ def, row, ctx, onChange }: EditorProps) {
  const files: { name: string; url: string }[] = getValue(row, def, ctx) || [];
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useApp((s) => s.toast);
  return (
    <div style={{ width: 320, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {files.map((f, i) => (
        <div key={i} className="row" style={{ gap: 6 }}>
          <Paperclip size={14} className="faint" />
          <a className="grow ellipsis prop-link" href={f.url} target="_blank" rel="noreferrer">
            {f.name}
          </a>
          <button className="icon-btn sm" onClick={() => onChange(files.filter((_, j) => j !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="btn btn-outline" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'Uploading…' : 'Upload a file'}
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            const r = await api.upload(f);
            onChange([...files, { name: r.name, url: r.url }]);
          } catch (err: any) {
            toast(err.message, { kind: 'error' });
          } finally {
            setBusy(false);
          }
        }}
      />
      <form
        className="row"
        style={{ gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!link.trim()) return;
          onChange([...files, { name: link.trim().split('/').pop() || link.trim(), url: link.trim() }]);
          setLink('');
        }}
      >
        <input className="input" placeholder="Paste a link…" value={link} onChange={(e) => setLink(e.target.value)} />
        <button className="btn btn-primary" type="submit">
          Add
        </button>
      </form>
      {files.length > 0 && <div className="faint small">{files.length} file(s) {fileSize(0)}</div>}
    </div>
  );
}

function RelationEditor({ def, row, ctx, onChange }: EditorProps) {
  const selected: string[] = getValue(row, def, ctx) || [];
  const rel = def.databaseId ? ctx.related[def.databaseId] : null;
  const [q, setQ] = useState('');
  const rows = useMemo(() => (rel?.rows || []).filter((r) => pageTitle(r.title).toLowerCase().includes(q.toLowerCase())), [rel, q]);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const nav = useMenuNav(rows.length, (i) => toggle(rows[i].id), [q]);
  if (!rel) return <div className="menu-empty" style={{ width: 280 }}>Choose a related database in the property settings first.</div>;
  return (
    <div style={{ width: 320 }}>
      <div className="menu-search">
        <input className="input" autoFocus placeholder={`Link or create a page in ${pageTitle(rel.database.title)}…`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={nav.onKeyDown} />
      </div>
      <div className="menu" style={{ maxHeight: 300 }}>
        {selected.length > 0 && <div className="menu-label">Selected</div>}
        {selected.map((id) => {
          const r = rel.rows.find((x) => x.id === id);
          return <MenuItem key={'s' + id} icon={<PageIcon icon={r?.icon} size={18} />} label={pageTitle(r?.title)} right={<X size={14} />} onClick={() => toggle(id)} />;
        })}
        <div className="menu-label">{rel.database.icon} {pageTitle(rel.database.title)}</div>
        {rows
          .filter((r) => !selected.includes(r.id))
          .map((r, i) => (
            <MenuItem key={r.id} icon={<PageIcon icon={r.icon} size={18} />} label={pageTitle(r.title)} right={<Plus size={14} />} selected={i === nav.index} onMouseEnter={() => nav.setIndex(i)} onClick={() => toggle(r.id)} />
          ))}
        {!rows.length && <div className="menu-empty">No pages</div>}
      </div>
    </div>
  );
}

void ArrowUpRight;
