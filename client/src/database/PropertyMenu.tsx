import React, { useState } from 'react';
import { ArrowUp, ArrowDown, Filter as FilterIcon, EyeOff, Copy, Trash2, ChevronRight, WrapText, Plus, Settings2 } from 'lucide-react';
import type { DatabaseData, PropertyDef, PropertyType, SelectOption } from '../types';
import { Popover, MenuItem, Switch, confirmDialog } from '../components/ui';
import { PROPERTY_TYPES, propIcon, COMPUTED, nextOptionColor } from './dbUtils';
import { Tag, OptionMenu } from './Property';
import { safeEvaluate } from './formula';
import { PagePicker } from '../components/PagePicker';
import { pageTitle, uuid } from '../lib/format';

export function TypePicker({ onPick, current, exclude = [] }: { onPick: (t: PropertyType) => void; current?: PropertyType; exclude?: PropertyType[] }) {
  const [q, setQ] = useState('');
  const list = PROPERTY_TYPES.filter((t) => !exclude.includes(t.type) && t.label.toLowerCase().includes(q.toLowerCase()));
  let lastGroup: string | undefined = 'x';
  return (
    <div style={{ width: 260 }} data-testid="type-picker">
      <div className="menu-search">
        <input className="input" autoFocus placeholder="Search for a property type…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="menu" style={{ maxHeight: 380 }}>
        {list.map((t) => {
          const header = t.group !== lastGroup ? t.group || 'Type' : null;
          lastGroup = t.group;
          return (
            <React.Fragment key={t.type}>
              {header && <div className="menu-label">{header}</div>}
              <MenuItem icon={t.icon} label={t.label} checked={current === t.type} onClick={() => onPick(t.type)} testId={'type-' + t.type} />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

const NUMBER_FORMATS: [string, string][] = [
  ['number', 'Number'], ['number_with_commas', 'Number with commas'], ['percent', 'Percent'], ['dollar', 'US dollar'],
  ['euro', 'Euro'], ['pound', 'Pound'], ['yen', 'Yen'], ['rupee', 'Rupee'],
];
const DATE_FORMATS: [string, string][] = [['full', 'Full date'], ['relative', 'Relative'], ['us', 'Month/Day/Year'], ['eu', 'Day/Month/Year'], ['iso', 'Year-Month-Day']];
const ROLLUP_FNS: [string, string][] = [
  ['show_original', 'Show original'], ['count', 'Count all'], ['count_values', 'Count values'], ['count_unique', 'Count unique values'],
  ['sum', 'Sum'], ['average', 'Average'], ['min', 'Min'], ['max', 'Max'], ['percent_checked', 'Percent checked'], ['percent_empty', 'Percent empty'],
];

interface Props {
  anchor: HTMLElement | DOMRect;
  def: PropertyDef;
  data: DatabaseData;
  onClose: () => void;
  updateDef: (patch: Partial<PropertyDef> & { type?: PropertyType }) => Promise<any>;
  deleteDef: () => void;
  duplicateDef: () => void;
  onSort?: (dir: 'asc' | 'desc') => void;
  onFilter?: () => void;
  onHide?: () => void;
  wrap?: boolean;
  onWrap?: () => void;
  readOnly?: boolean;
  startInEdit?: boolean;
}

export function PropertyMenu({ anchor, def, data, onClose, updateDef, deleteDef, duplicateDef, onSort, onFilter, onHide, wrap, onWrap, readOnly, startInEdit }: Props) {
  const [name, setName] = useState(def.name);
  const [sub, setSub] = useState<{ kind: 'type' | 'edit'; rect: DOMRect } | null>(startInEdit ? { kind: 'edit', rect: anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : (anchor as DOMRect) } : null);
  const isTitle = def.type === 'title';
  const commitName = () => {
    if (name.trim() && name !== def.name) updateDef({ name: name.trim() });
  };
  const configurable = ['select', 'multi_select', 'status', 'number', 'formula', 'relation', 'rollup', 'date', 'unique_id'].includes(def.type);
  return (
    <Popover
      anchor={anchor}
      onClose={() => {
        commitName();
        onClose();
      }}
      width={260}
    >
      <div className="menu" data-testid="property-menu">
        <div className="menu-search row" style={{ gap: 6 }}>
          <span className="prop-name-icon">{propIcon(def.type)}</span>
          <input
            className="input"
            autoFocus
            value={name}
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitName();
                onClose();
              }
            }}
            data-testid="property-name"
          />
        </div>
        {!readOnly && configurable && (
          <MenuItem icon={<Settings2 size={16} />} label="Edit property" right={<ChevronRight size={14} />} onClick={(e) => setSub({ kind: 'edit', rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })} testId="edit-property" />
        )}
        {!readOnly && !isTitle && (
          <MenuItem
            icon={propIcon(def.type)}
            label="Change type"
            right={
              <>
                <span>{PROPERTY_TYPES.find((t) => t.type === def.type)?.label}</span>
                <ChevronRight size={14} />
              </>
            }
            onClick={(e) => setSub({ kind: 'type', rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
            testId="change-type"
          />
        )}
        <div className="menu-divider" />
        {onFilter && <MenuItem icon={<FilterIcon size={16} />} label="Filter" onClick={() => (onFilter(), onClose())} />}
        {onSort && <MenuItem icon={<ArrowUp size={16} />} label="Sort ascending" onClick={() => (onSort('asc'), onClose())} testId="sort-asc" />}
        {onSort && <MenuItem icon={<ArrowDown size={16} />} label="Sort descending" onClick={() => (onSort('desc'), onClose())} testId="sort-desc" />}
        {onHide && !isTitle && <MenuItem icon={<EyeOff size={16} />} label="Hide in view" onClick={() => (onHide(), onClose())} />}
        {onWrap && <MenuItem icon={<WrapText size={16} />} label="Wrap column" right={<Switch on={!!wrap} onChange={() => {}} />} onClick={onWrap} />}
        {!readOnly && !isTitle && (
          <>
            <div className="menu-divider" />
            <MenuItem icon={<Copy size={16} />} label="Duplicate property" onClick={() => (duplicateDef(), onClose())} />
            <MenuItem
              icon={<Trash2 size={16} />}
              label="Delete property"
              danger
              testId="delete-property"
              onClick={async () => {
                onClose();
                if (await confirmDialog({ title: `Delete the "${def.name}" property?`, body: 'Its values will be removed from every row.', confirm: 'Delete property', danger: true })) deleteDef();
              }}
            />
          </>
        )}
      </div>
      {sub?.kind === 'type' && (
        <Popover anchor={sub.rect} onClose={() => setSub(null)} placement="right-start">
          <TypePicker
            current={def.type}
            onPick={async (t) => {
              setSub(null);
              await updateDef({ type: t });
              if (['formula', 'relation', 'rollup'].includes(t)) setSub({ kind: 'edit', rect: sub.rect });
            }}
          />
        </Popover>
      )}
      {sub?.kind === 'edit' && (
        <Popover anchor={sub.rect} onClose={() => setSub(null)} placement="right-start">
          <PropertyConfig def={def} data={data} updateDef={updateDef} />
        </Popover>
      )}
    </Popover>
  );
}

function PropertyConfig({ def, data, updateDef }: { def: PropertyDef; data: DatabaseData; updateDef: (p: any) => Promise<any> }) {
  const [expr, setExpr] = useState(def.expression || '');
  const [newOpt, setNewOpt] = useState('');
  const [optMenu, setOptMenu] = useState<{ opt: SelectOption; el: HTMLElement } | null>(null);
  const [relPicker, setRelPicker] = useState<HTMLElement | null>(null);
  const [prefix, setPrefix] = useState(def.prefix || '');
  const schema = data.database.schema!;
  const sampleRow = data.rows[0];
  const preview = def.type === 'formula' && sampleRow
    ? safeEvaluate(expr, (n) => {
        const p = Object.values(schema.properties).find((x) => x.name === n);
        if (!p) throw new Error(`Property "${n}" not found`);
        if (p.type === 'title') return sampleRow.title;
        const v = sampleRow.properties[p.id];
        if (p.type === 'select' || p.type === 'status') return p.options?.find((o) => o.id === v)?.name || '';
        if (p.type === 'date') return v?.start ? new Date(v.start) : null;
        return v ?? null;
      })
    : null;
  const options = def.options || [];

  return (
    <div className="menu prop-config" style={{ width: 300 }} data-testid="property-config">
      {(def.type === 'select' || def.type === 'multi_select' || def.type === 'status') && (
        <>
          <div className="menu-label">Options</div>
          {options.map((o) => (
            <div key={o.id} className="select-option" onClick={(e) => setOptMenu({ opt: o, el: e.currentTarget })}>
              <Tag option={o} status={def.type === 'status'} />
              {def.type === 'status' && <span className="faint small" style={{ marginLeft: 'auto' }}>{{ todo: 'To-do', in_progress: 'In progress', complete: 'Complete' }[o.group || 'todo']}</span>}
            </div>
          ))}
          <form
            className="menu-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newOpt.trim()) return;
              updateDef({ options: [...options, { id: uuid().slice(0, 8), name: newOpt.trim(), color: nextOptionColor(options.length), ...(def.type === 'status' ? { group: 'todo' } : {}) }] });
              setNewOpt('');
            }}
          >
            <input className="input" placeholder="Add an option…" value={newOpt} onChange={(e) => setNewOpt(e.target.value)} data-testid="add-option" />
          </form>
        </>
      )}
      {def.type === 'number' && (
        <>
          <div className="menu-label">Number format</div>
          {NUMBER_FORMATS.map(([k, label]) => (
            <MenuItem key={k} label={label} checked={(def.format || 'number') === k} onClick={() => updateDef({ format: k })} />
          ))}
        </>
      )}
      {def.type === 'date' && (
        <>
          <div className="menu-label">Date format</div>
          {DATE_FORMATS.map(([k, label]) => (
            <MenuItem key={k} label={label} checked={(def.dateFormat || 'full') === k} onClick={() => updateDef({ dateFormat: k })} />
          ))}
        </>
      )}
      {def.type === 'unique_id' && (
        <div style={{ padding: '6px 12px' }}>
          <div className="menu-label" style={{ padding: '0 0 4px' }}>Prefix</div>
          <input className="input" value={prefix} placeholder="e.g. TASK" onChange={(e) => setPrefix(e.target.value)} onBlur={() => updateDef({ prefix })} />
        </div>
      )}
      {def.type === 'formula' && (
        <div style={{ padding: '6px 12px 10px' }}>
          <div className="menu-label" style={{ padding: '0 0 4px' }}>Formula</div>
          <textarea
            className="input formula-input"
            autoFocus
            value={expr}
            placeholder='prop("Budget") * 2'
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                updateDef({ expression: expr });
              }
            }}
            data-testid="formula-input"
          />
          <div className="faint small" style={{ margin: '6px 0' }}>
            {preview?.error ? <span style={{ color: 'var(--red-text)' }}>{preview.error}</span> : preview ? <>Preview: {String(preview.value instanceof Date ? preview.value.toDateString() : preview.value ?? '')}</> : 'Use prop("Name") to reference other properties.'}
          </div>
          <div className="formula-props">
            {schema.order
              .map((id) => schema.properties[id])
              .filter((p) => p && p.id !== def.id)
              .map((p) => (
                <button key={p.id} className="formula-chip" onClick={() => setExpr((x) => x + `prop("${p.name}")`)}>
                  {propIcon(p.type)} {p.name}
                </button>
              ))}
          </div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={() => updateDef({ expression: expr })} data-testid="formula-save">
            Done
          </button>
        </div>
      )}
      {def.type === 'relation' && (
        <div style={{ padding: '6px 12px 10px' }}>
          <div className="menu-label" style={{ padding: '0 0 4px' }}>Related to</div>
          <button className="btn btn-outline btn-block" onClick={(e) => setRelPicker(e.currentTarget)} data-testid="relation-db">
            {def.databaseId ? pageTitle(data.related[def.databaseId]?.database.title) : 'Select a database'}
          </button>
        </div>
      )}
      {def.type === 'rollup' && (
        <div style={{ padding: '6px 0 10px' }}>
          <div className="menu-label">Relation</div>
          {schema.order
            .map((id) => schema.properties[id])
            .filter((p) => p?.type === 'relation')
            .map((p) => (
              <MenuItem key={p.id} label={p.name} checked={def.relation === p.id} onClick={() => updateDef({ relation: p.id, target: 'title' })} />
            ))}
          {!Object.values(schema.properties).some((p) => p.type === 'relation') && <div className="menu-empty">Add a relation property first.</div>}
          {def.relation && schema.properties[def.relation]?.databaseId && (
            <>
              <div className="menu-label">Property</div>
              {(() => {
                const rel = data.related[schema.properties[def.relation!].databaseId!];
                if (!rel) return <div className="menu-empty">Related database unavailable</div>;
                return rel.database.schema.order.map((id) => {
                  const p = rel.database.schema.properties[id];
                  return p ? <MenuItem key={id} icon={propIcon(p.type)} label={p.name} checked={(def.target || 'title') === id} onClick={() => updateDef({ target: id })} /> : null;
                });
              })()}
              <div className="menu-label">Calculate</div>
              {ROLLUP_FNS.map(([k, label]) => (
                <MenuItem key={k} label={label} checked={(def.fn || 'show_original') === k} onClick={() => updateDef({ fn: k })} />
              ))}
            </>
          )}
        </div>
      )}
      {optMenu && (
        <OptionMenu
          anchor={optMenu.el}
          option={optMenu.opt}
          status={def.type === 'status'}
          onClose={() => setOptMenu(null)}
          onChange={(patch) => updateDef({ options: options.map((o) => (o.id === optMenu.opt.id ? { ...o, ...patch } : o)) })}
          onDelete={() => {
            updateDef({ options: options.filter((o) => o.id !== optMenu.opt.id) });
            setOptMenu(null);
          }}
        />
      )}
      {relPicker && (
        <Popover anchor={relPicker} onClose={() => setRelPicker(null)} placement="right-start">
          <PagePicker
            placeholder="Search databases…"
            filter={(p) => p.type === 'database'}
            onPick={(p) => {
              setRelPicker(null);
              updateDef({ databaseId: p.id });
            }}
          />
        </Popover>
      )}
    </div>
  );
}

export function AddPropertyMenu({ anchor, onClose, onAdd }: { anchor: HTMLElement | DOMRect; onClose: () => void; onAdd: (type: PropertyType) => void }) {
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <TypePicker
        onPick={(t) => {
          onAdd(t);
          onClose();
        }}
      />
    </Popover>
  );
}

void COMPUTED;
void Plus;
