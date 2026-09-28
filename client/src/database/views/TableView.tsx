import React, { useEffect, useRef, useState } from 'react';
import { Plus, GripVertical, PanelRight, ChevronDown, Trash2, X } from 'lucide-react';
import type { Page, PropertyDef } from '../../types';
import { useDb, NewRowButton } from '../DatabaseView';
import { PropertyDisplay } from '../Property';
import { PropertyMenu, AddPropertyMenu } from '../PropertyMenu';
import { visibleProps, propIcon, calcOptions, calculate, calcLabel, groupRows, groupValue, type Group } from '../dbUtils';
import { useCellEditor } from './common';
import { Popover, MenuItem } from '../../components/ui';
import { Tag } from '../Property';
import { dragState } from '../../editor/dnd';

const DEFAULT_WIDTH: Record<string, number> = { title: 280, checkbox: 100, number: 140, date: 200 };

export function TableView() {
  const db = useDb();
  const { schema, cfg, rows, readOnly } = db;
  const cols = visibleProps(cfg, schema);
  const allProps = visibleProps(cfg, schema, true);
  const cell = useCellEditor();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [headerMenu, setHeaderMenu] = useState<{ def: PropertyDef; el: HTMLElement } | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [pendingMenu, setPendingMenu] = useState<string | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [calcMenu, setCalcMenu] = useState<{ def: PropertyDef; el: HTMLElement } | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dropRow, setDropRow] = useState<{ id: string; before: boolean } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const headerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const widthOf = (id: string, type: string) => widths[id] ?? allProps.find((p) => p.def.id === id)?.width ?? DEFAULT_WIDTH[type] ?? 200;
  const totalWidth = cols.reduce((s, c) => s + widthOf(c.def.id, c.def.type), 0) + 36;

  useEffect(() => {
    if (pendingMenu && headerRefs.current[pendingMenu]) {
      const def = schema.properties[pendingMenu];
      if (def) setHeaderMenu({ def, el: headerRefs.current[pendingMenu]! });
      setPendingMenu(null);
    }
  }, [pendingMenu, schema]);

  const startResize = (e: React.MouseEvent, def: PropertyDef) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = widthOf(def.id, def.type);
    let w = start;
    const move = (ev: MouseEvent) => {
      w = Math.max(80, start + ev.clientX - startX);
      setWidths((x) => ({ ...x, [def.id]: w }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      db.updateView({ properties: allProps.map((p) => ({ id: p.def.id, visible: p.visible, width: p.def.id === def.id ? Math.round(w) : p.width })) });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const reorderCol = (from: string, to: string) => {
    const list = allProps.map((p) => ({ id: p.def.id, visible: p.visible, width: p.width }));
    const i = list.findIndex((p) => p.id === from);
    const [item] = list.splice(i, 1);
    const j = list.findIndex((p) => p.id === to);
    list.splice(j, 0, item);
    db.updateView({ properties: list });
  };

  const sorted = (cfg.sorts || []).length > 0;
  const onRowDrop = (targetId: string, before: boolean, groupKey?: string) => {
    const ids = dragState.rowIds;
    setDropRow(null);
    if (!ids?.length) return;
    if (groupKey !== undefined && cfg.groupBy) {
      const gdef = schema.properties[cfg.groupBy];
      for (const id of ids) {
        const row = db.data.rows.find((r) => r.id === id);
        if (row) db.updateRow(id, { [gdef.id]: groupValue(gdef, groupKey, row.properties[gdef.id]) });
      }
    }
    if (sorted) return;
    const order = db.data.rows.map((r) => r.id).filter((id) => !ids.includes(id));
    let idx = order.indexOf(targetId);
    if (idx < 0) idx = order.length;
    else if (!before) idx++;
    order.splice(idx, 0, ...ids);
    db.reorderRows(order);
    dragState.rowIds = null;
  };

  const renderRow = (row: Page, groupKey?: string) => (
    <div
      key={row.id}
      className={`tr ${selected.has(row.id) ? 'selected' : ''} ${dropRow?.id === row.id ? (dropRow.before ? 'drop-before' : 'drop-after') : ''}`}
      data-row-id={row.id}
      onDragOver={(e) => {
        if (!dragState.rowIds) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setDropRow({ id: row.id, before: e.clientY < r.top + r.height / 2 });
      }}
      onDragLeave={() => setDropRow(null)}
      onDrop={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onRowDrop(row.id, e.clientY < r.top + r.height / 2, groupKey);
      }}
      data-testid="table-row"
    >
      {!readOnly && (
        <div className="row-gutter">
          <span
            className="row-drag"
            draggable
            onDragStart={(e) => {
              dragState.rowIds = selected.has(row.id) ? [...selected] : [row.id];
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', row.id);
            }}
            onDragEnd={() => (dragState.rowIds = null)}
          >
            <GripVertical size={14} />
          </span>
          <span
            className={'checkbox row-check ' + (selected.has(row.id) ? 'checked' : '')}
            onClick={() => {
              const next = new Set(selected);
              if (next.has(row.id)) next.delete(row.id);
              else next.add(row.id);
              setSelected(next);
            }}
            data-testid="row-select"
          >
            {selected.has(row.id) && '✓'}
          </span>
        </div>
      )}
      {cols.map(({ def }) => (
        <div
          key={def.id}
          className={`td td-${def.type} ${cfg.wrap || def.wrap ? 'wrap' : ''}`}
          style={{ width: widthOf(def.id, def.type) }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a, .open-btn')) return;
            cell.open(row, def, e.currentTarget);
          }}
          data-prop={def.name}
        >
          {def.type === 'title' ? (
            <div className="title-cell">
              {row.icon && <span className="title-icon">{row.icon.startsWith('/') || row.icon.startsWith('http') ? <img src={row.icon} alt="" width={16} /> : row.icon}</span>}
              <span className={'title-text ' + (row.title ? '' : 'faint')}>{row.title || (readOnly ? 'Untitled' : '')}</span>
              <button
                className="open-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  db.openRow(row.id);
                }}
                data-testid="open-row"
              >
                <PanelRight size={12} /> Open
              </button>
            </div>
          ) : (
            <PropertyDisplay def={def} row={row} ctx={db.ctx} wrap={cfg.wrap || def.wrap} />
          )}
        </div>
      ))}
      <div className="td td-filler" />
    </div>
  );

  const groups: Group[] | null = cfg.groupBy ? groupRows(rows, cfg.groupBy, db.ctx, cfg) : null;

  return (
    <div className="table-view">
      {selected.size > 0 && !readOnly && (
        <div className="bulk-bar" data-testid="bulk-bar">
          <span>{selected.size} selected</span>
          <button
            className="btn"
            onClick={() => {
              db.deleteRows([...selected]);
              setSelected(new Set());
            }}
            data-testid="bulk-delete"
          >
            <Trash2 size={14} /> Delete
          </button>
          <button className="icon-btn sm" onClick={() => setSelected(new Set())}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="table-scroll">
        <div className="table" style={{ minWidth: totalWidth }} role="table">
          <div className="tr thead">
            {!readOnly && (
              <div className="row-gutter">
                <span
                  className={'checkbox row-check head ' + (selected.size && selected.size === rows.length ? 'checked' : '')}
                  onClick={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}
                >
                  {selected.size > 0 && selected.size === rows.length && '✓'}
                </span>
              </div>
            )}
            {cols.map(({ def }) => (
              <div
                key={def.id}
                ref={(el) => { headerRefs.current[def.id] = el; }}
                className={'th ' + (dragCol === def.id ? 'dragging' : '')}
                style={{ width: widthOf(def.id, def.type) }}
                draggable={!readOnly && def.type !== 'title'}
                onDragStart={() => setDragCol(def.id)}
                onDragEnd={() => setDragCol(null)}
                onDragOver={(e) => dragCol && e.preventDefault()}
                onDrop={() => {
                  if (dragCol && dragCol !== def.id && def.type !== 'title') reorderCol(dragCol, def.id);
                  setDragCol(null);
                }}
                onClick={(e) => setHeaderMenu({ def, el: e.currentTarget })}
                data-testid="table-header"
              >
                <span className="th-icon">{propIcon(def.type)}</span>
                <span className="ellipsis">{def.name}</span>
                {!readOnly && <span className="col-resize" onMouseDown={(e) => startResize(e, def)} onClick={(e) => e.stopPropagation()} />}
              </div>
            ))}
            {!readOnly && (
              <div className="th th-add" onClick={(e) => setAddAnchor(e.currentTarget)} data-testid="add-property">
                <Plus size={16} />
              </div>
            )}
            <div className="th th-filler" />
          </div>
          {groups
            ? groups
                .filter((g) => !(cfg.hiddenGroups || []).includes(g.key))
                .map((g) => {
                  const gdef = schema.properties[cfg.groupBy!];
                  const opt = gdef.options?.find((o) => o.id === g.key);
                  const isCollapsed = collapsed.has(g.key);
                  return (
                    <div key={g.key} className="table-group">
                      <div className="table-group-head" onDragOver={(e) => dragState.rowIds && e.preventDefault()} onDrop={() => onRowDrop('', false, g.key)}>
                        <button
                          className="icon-btn sm"
                          onClick={() => {
                            const next = new Set(collapsed);
                            if (isCollapsed) next.delete(g.key);
                            else next.add(g.key);
                            setCollapsed(next);
                          }}
                        >
                          <ChevronDown size={14} style={{ transform: isCollapsed ? 'rotate(-90deg)' : undefined }} />
                        </button>
                        {opt ? <Tag option={opt} status={gdef.type === 'status'} /> : <span className="group-label">{g.label}</span>}
                        <span className="faint">{g.rows.length}</span>
                        {!readOnly && (
                          <button className="icon-btn sm" onClick={() => db.addRow({ [gdef.id]: groupValue(gdef, g.key, null) })}>
                            <Plus size={14} />
                          </button>
                        )}
                      </div>
                      {!isCollapsed && g.rows.map((r) => renderRow(r, g.key))}
                      {!isCollapsed && !readOnly && <NewRowButton onClick={() => db.addRow({ [gdef.id]: groupValue(gdef, g.key, null) })} />}
                    </div>
                  );
                })
            : rows.map((r) => renderRow(r))}
          {!groups && !readOnly && <NewRowButton onClick={() => db.addRow()} />}
          <div className="tr tfoot">
            {!readOnly && <div className="row-gutter" />}
            {cols.map(({ def }) => {
              const key = cfg.calcs?.[def.id] || (def.type === 'title' ? 'count_all' : 'none');
              const value = calculate(key, rows, def, db.ctx);
              return (
                <div key={def.id} className={'tf ' + (key !== 'none' ? 'has-calc' : '')} style={{ width: widthOf(def.id, def.type) }} onClick={(e) => setCalcMenu({ def, el: e.currentTarget })}>
                  {key !== 'none' ? (
                    <>
                      <span className="calc-label">{calcLabel(key)}</span> <span className="calc-value">{value}</span>
                    </>
                  ) : (
                    <span className="calc-empty">
                      Calculate <ChevronDown size={12} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {cell.host}
      {headerMenu && (
        <PropertyMenu
          anchor={headerMenu.el}
          def={schema.properties[headerMenu.def.id] || headerMenu.def}
          data={db.data}
          readOnly={readOnly}
          onClose={() => setHeaderMenu(null)}
          updateDef={(patch) => db.updateDef(headerMenu.def.id, patch)}
          deleteDef={() => db.deleteProperty(headerMenu.def.id)}
          duplicateDef={() => db.duplicateProperty(headerMenu.def.id)}
          onSort={(dir) => db.toggleSort(headerMenu.def.id, dir)}
          onFilter={() => db.openFilterFor(headerMenu.def.id)}
          onHide={() => db.updateView({ properties: allProps.map((p) => ({ id: p.def.id, visible: p.def.id === headerMenu.def.id ? false : p.visible, width: p.width })) })}
          wrap={!!headerMenu.def.wrap}
          onWrap={readOnly ? undefined : () => db.updateDef(headerMenu.def.id, { wrap: !headerMenu.def.wrap })}
        />
      )}
      {addAnchor && (
        <AddPropertyMenu
          anchor={addAnchor}
          onClose={() => setAddAnchor(null)}
          onAdd={async (type) => {
            const def = await db.addProperty(type);
            if (def) setPendingMenu(def.id);
          }}
        />
      )}
      {calcMenu && (
        <Popover anchor={calcMenu.el} onClose={() => setCalcMenu(null)} placement="top-start">
          <div className="menu" style={{ maxHeight: 320 }}>
            {calcOptions(calcMenu.def.type).map((o) => (
              <MenuItem
                key={o.key}
                label={o.label}
                checked={(cfg.calcs?.[calcMenu.def.id] || (calcMenu.def.type === 'title' ? 'count_all' : 'none')) === o.key}
                onClick={() => {
                  db.updateView({ calcs: { ...(cfg.calcs || {}), [calcMenu.def.id]: o.key } });
                  setCalcMenu(null);
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
