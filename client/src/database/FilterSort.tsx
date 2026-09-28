import React, { useState } from 'react';
import { ArrowUpDown, ChevronDown, Plus, Trash2, X, GripVertical } from 'lucide-react';
import type { DbSchema, Filter, PropertyDef, Sort, User, ViewConfig } from '../types';
import { Popover, MenuItem, Avatar } from '../components/ui';
import { operatorsFor, propIcon } from './dbUtils';
import { Tag } from './Property';
import { DatePicker } from '../components/DatePicker';
import { formatDateValue, uuid } from '../lib/format';

export function PropertyPicker({ schema, onPick, exclude = [], placeholder = 'Filter by…' }: { schema: DbSchema; onPick: (def: PropertyDef) => void; exclude?: string[]; placeholder?: string }) {
  const [q, setQ] = useState('');
  const list = schema.order.map((id) => schema.properties[id]).filter((p) => p && !exclude.includes(p.id) && p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ width: 260 }}>
      <div className="menu-search">
        <input className="input" autoFocus placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} data-testid="property-picker-input" />
      </div>
      <div className="menu" style={{ maxHeight: 300 }}>
        {list.map((p) => (
          <MenuItem key={p.id} icon={propIcon(p.type)} label={p.name} onClick={() => onPick(p)} testId={'pick-prop-' + p.name} />
        ))}
        {!list.length && <div className="menu-empty">No properties</div>}
      </div>
    </div>
  );
}

export function defaultOperator(def: PropertyDef) {
  return operatorsFor(def.type)[0].op;
}

export function newFilter(def: PropertyDef): Filter {
  return { id: uuid().slice(0, 8), property: def.id, operator: defaultOperator(def), value: def.type === 'checkbox' ? undefined : ['select', 'status', 'multi_select', 'person'].includes(def.type) ? [] : '' };
}

export function filterSummary(f: Filter, def: PropertyDef, people: User[]) {
  const op = operatorsFor(def.type).find((o) => o.op === f.operator);
  if (op?.noValue) return op.label;
  const v = f.value;
  if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '';
  if (Array.isArray(v)) {
    const names = v.map((id) => def.options?.find((o) => o.id === id)?.name || people.find((p) => p.id === id)?.name || id);
    return (f.operator === 'is_not' || f.operator === 'not_contains' ? 'Not ' : '') + names.join(', ');
  }
  if (def.type === 'date' || def.type === 'created_time' || def.type === 'last_edited_time') {
    const rel: Record<string, string> = { today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday', one_week_ago: 'One week ago', one_week_from_now: 'One week from now' };
    return `${op?.label.replace('Is ', '')} ${rel[v] || formatDateValue({ start: v })}`;
  }
  return `${op && op.op !== 'contains' ? op.label + ' ' : ''}${v}`;
}

export function FilterEditor({ anchor, filter, def, people, onChange, onDelete, onClose }: { anchor: HTMLElement | DOMRect; filter: Filter; def: PropertyDef; people: User[]; onChange: (f: Filter) => void; onDelete: () => void; onClose: () => void }) {
  const [opAnchor, setOpAnchor] = useState<HTMLElement | null>(null);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const ops = operatorsFor(def.type);
  const op = ops.find((o) => o.op === filter.operator) || ops[0];
  const isDate = ['date', 'created_time', 'last_edited_time'].includes(def.type);
  const list = Array.isArray(filter.value) ? (filter.value as string[]) : filter.value ? [filter.value] : [];
  const toggle = (id: string) => onChange({ ...filter, value: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  return (
    <Popover anchor={anchor} onClose={onClose} width={300}>
      <div className="filter-editor" data-testid="filter-editor">
        <div className="fe-head">
          <span className="faint">{def.name}</span>
          <button className="fe-op" onClick={(e) => setOpAnchor(e.currentTarget)}>
            {op.label.toLowerCase()} <ChevronDown size={12} />
          </button>
          <div style={{ flex: 1 }} />
          <button className="icon-btn sm" onClick={onDelete} title="Delete filter" data-testid="delete-filter">
            <Trash2 size={14} />
          </button>
        </div>
        {!op.noValue && (
          <div className="fe-body">
            {['select', 'status', 'multi_select'].includes(def.type) ? (
              <div className="menu" style={{ padding: 0, maxHeight: 240 }}>
                {(def.options || []).map((o) => (
                  <div key={o.id} className="select-option" onClick={() => toggle(o.id)}>
                    <span className={'checkbox ' + (list.includes(o.id) ? 'checked' : '')} style={{ width: 14, height: 14 }}>
                      {list.includes(o.id) && '✓'}
                    </span>
                    <Tag option={o} status={def.type === 'status'} />
                  </div>
                ))}
                {!(def.options || []).length && <div className="menu-empty">No options</div>}
              </div>
            ) : ['person', 'created_by', 'last_edited_by'].includes(def.type) ? (
              <div className="menu" style={{ padding: 0, maxHeight: 240 }}>
                {people.map((p) => (
                  <MenuItem key={p.id} icon={<Avatar user={p} size={18} />} label={p.name} checked={list.includes(p.id)} onClick={() => toggle(p.id)} />
                ))}
              </div>
            ) : isDate ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <select className="input" value={['today', 'tomorrow', 'yesterday', 'one_week_ago', 'one_week_from_now'].includes(filter.value) ? filter.value : 'exact'} onChange={(e) => onChange({ ...filter, value: e.target.value === 'exact' ? '' : e.target.value })}>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="one_week_ago">One week ago</option>
                  <option value="one_week_from_now">One week from now</option>
                  <option value="exact">Exact date</option>
                </select>
                {!['today', 'tomorrow', 'yesterday', 'one_week_ago', 'one_week_from_now'].includes(filter.value) && (
                  <button className="input" style={{ textAlign: 'left' }} onClick={(e) => setDateAnchor(e.currentTarget)}>
                    {filter.value ? formatDateValue({ start: filter.value }) : 'Pick a date'}
                  </button>
                )}
              </div>
            ) : (
              <input
                className="input"
                autoFocus
                type={def.type === 'number' ? 'number' : 'text'}
                placeholder="Type a value…"
                value={filter.value ?? ''}
                onChange={(e) => onChange({ ...filter, value: e.target.value })}
                data-testid="filter-value"
              />
            )}
          </div>
        )}
      </div>
      {opAnchor && (
        <Popover anchor={opAnchor} onClose={() => setOpAnchor(null)}>
          <div className="menu">
            {ops.map((o) => (
              <MenuItem
                key={o.op}
                label={o.label}
                checked={o.op === filter.operator}
                onClick={() => {
                  onChange({ ...filter, operator: o.op });
                  setOpAnchor(null);
                }}
              />
            ))}
          </div>
        </Popover>
      )}
      {dateAnchor && (
        <Popover anchor={dateAnchor} onClose={() => setDateAnchor(null)}>
          <DatePicker
            allowRange={false}
            allowTime={false}
            value={filter.value ? { start: filter.value } : null}
            onChange={(v) => {
              onChange({ ...filter, value: v?.start || '' });
              setDateAnchor(null);
            }}
          />
        </Popover>
      )}
    </Popover>
  );
}

export function SortMenu({ anchor, sorts, schema, onChange, onClose }: { anchor: HTMLElement | DOMRect; sorts: Sort[]; schema: DbSchema; onChange: (s: Sort[]) => void; onClose: () => void }) {
  const [pick, setPick] = useState<{ el: HTMLElement; index: number | null } | null>(null);
  const [dirAnchor, setDirAnchor] = useState<{ el: HTMLElement; index: number } | null>(null);
  if (!sorts.length) {
    return (
      <Popover anchor={anchor} onClose={onClose}>
        <PropertyPicker
          schema={schema}
          placeholder="Sort by…"
          onPick={(p) => {
            onChange([{ property: p.id, direction: 'asc' }]);
          }}
        />
      </Popover>
    );
  }
  return (
    <Popover anchor={anchor} onClose={onClose} width={360}>
      <div className="sort-menu" data-testid="sort-menu">
        {sorts.map((s, i) => {
          const def = schema.properties[s.property];
          return (
            <div key={i} className="sort-row">
              <GripVertical size={14} className="faint" />
              <button className="btn btn-outline sort-prop" onClick={(e) => setPick({ el: e.currentTarget, index: i })}>
                {def && propIcon(def.type)} <span className="ellipsis">{def?.name || 'Property'}</span> <ChevronDown size={12} />
              </button>
              <button className="btn btn-outline" onClick={(e) => setDirAnchor({ el: e.currentTarget, index: i })}>
                {s.direction === 'asc' ? 'Ascending' : 'Descending'} <ChevronDown size={12} />
              </button>
              <button className="icon-btn sm" onClick={() => onChange(sorts.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            </div>
          );
        })}
        <div className="menu" style={{ padding: '4px 0 0' }}>
          <MenuItem icon={<Plus size={16} />} label="Add sort" onClick={(e) => setPick({ el: e.currentTarget as HTMLElement, index: null })} />
          <MenuItem icon={<Trash2 size={16} />} label="Delete sort" onClick={() => (onChange([]), onClose())} />
        </div>
      </div>
      {pick && (
        <Popover anchor={pick.el} onClose={() => setPick(null)}>
          <PropertyPicker
            schema={schema}
            placeholder="Sort by…"
            exclude={sorts.map((s) => s.property).filter((_, j) => j !== pick.index)}
            onPick={(p) => {
              if (pick.index === null) onChange([...sorts, { property: p.id, direction: 'asc' }]);
              else onChange(sorts.map((s, j) => (j === pick.index ? { ...s, property: p.id } : s)));
              setPick(null);
            }}
          />
        </Popover>
      )}
      {dirAnchor && (
        <Popover anchor={dirAnchor.el} onClose={() => setDirAnchor(null)}>
          <div className="menu">
            {(['asc', 'desc'] as const).map((d) => (
              <MenuItem
                key={d}
                label={d === 'asc' ? 'Ascending' : 'Descending'}
                checked={sorts[dirAnchor.index].direction === d}
                onClick={() => {
                  onChange(sorts.map((s, j) => (j === dirAnchor.index ? { ...s, direction: d } : s)));
                  setDirAnchor(null);
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </Popover>
  );
}

export function FilterBar({ cfg, schema, people, update, readOnly, openFilterId, setOpenFilterId }: { cfg: ViewConfig; schema: DbSchema; people: User[]; update: (patch: Partial<ViewConfig>) => void; readOnly: boolean; openFilterId: string | null; setOpenFilterId: (id: string | null) => void }) {
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const filters = (cfg.filters || []).filter((f) => schema.properties[f.property]);
  const sorts = (cfg.sorts || []).filter((s) => schema.properties[s.property]);
  const pillRefs = React.useRef<Record<string, HTMLElement | null>>({});
  if (!filters.length && !sorts.length) return null;
  const openFilter = filters.find((f) => f.id === openFilterId);
  return (
    <div className="filter-bar" data-testid="filter-bar">
      {sorts.length > 0 && (
        <button className="filter-pill active" onClick={(e) => setSortAnchor(e.currentTarget)}>
          <ArrowUpDown size={14} />
          {sorts.length === 1 ? schema.properties[sorts[0].property]?.name : `${sorts.length} sorts`}
          <ChevronDown size={12} />
        </button>
      )}
      {sorts.length > 0 && filters.length > 0 && <div className="filter-sep" />}
      {filters.length > 1 && (
        <button className="filter-pill" onClick={() => !readOnly && update({ filterOp: cfg.filterOp === 'or' ? 'and' : 'or' })} title="Toggle how filters combine">
          Match {cfg.filterOp === 'or' ? 'any' : 'all'}
        </button>
      )}
      {filters.map((f) => {
        const def = schema.properties[f.property];
        const summary = filterSummary(f, def, people);
        return (
          <button key={f.id} ref={(el) => { pillRefs.current[f.id] = el; }} className={'filter-pill ' + (summary ? 'active' : '')} onClick={() => setOpenFilterId(f.id)} data-testid="filter-pill">
            {propIcon(def.type)}
            <span className="ellipsis" style={{ maxWidth: 200 }}>
              {def.name}
              {summary ? `: ${summary}` : ''}
            </span>
            <ChevronDown size={12} />
          </button>
        );
      })}
      {!readOnly && (
        <button className="filter-add" onClick={(e) => setAddAnchor(e.currentTarget)}>
          <Plus size={14} /> Add filter
        </button>
      )}
      {sortAnchor && <SortMenu anchor={sortAnchor} sorts={sorts} schema={schema} onChange={(s) => update({ sorts: s })} onClose={() => setSortAnchor(null)} />}
      {addAnchor && (
        <Popover anchor={addAnchor} onClose={() => setAddAnchor(null)}>
          <PropertyPicker
            schema={schema}
            onPick={(p) => {
              const f = newFilter(p);
              update({ filters: [...(cfg.filters || []), f] });
              setAddAnchor(null);
              setTimeout(() => setOpenFilterId(f.id), 30);
            }}
          />
        </Popover>
      )}
      {openFilter && pillRefs.current[openFilter.id] && (
        <FilterEditor
          anchor={pillRefs.current[openFilter.id]!}
          filter={openFilter}
          def={schema.properties[openFilter.property]}
          people={people}
          onChange={(nf) => update({ filters: (cfg.filters || []).map((x) => (x.id === nf.id ? nf : x)) })}
          onDelete={() => {
            update({ filters: (cfg.filters || []).filter((x) => x.id !== openFilter.id) });
            setOpenFilterId(null);
          }}
          onClose={() => setOpenFilterId(null)}
        />
      )}
    </div>
  );
}
