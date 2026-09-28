import React, { useState } from 'react';
import { Plus, MoreHorizontal, EyeOff, Eye } from 'lucide-react';
import type { Page, SelectOption } from '../../types';
import { useDb, RowTitle } from '../DatabaseView';
import { groupRows, groupValue, nextOptionColor } from '../dbUtils';
import { Tag } from '../Property';
import { CardProperties, CardPreview } from './common';
import { Popover, MenuItem, Avatar } from '../../components/ui';
import { dragState } from '../../editor/dnd';
import { uuid } from '../../lib/format';

export function BoardView() {
  const db = useDb();
  const { schema, cfg, rows, readOnly } = db;
  const gdef = cfg.groupBy ? schema.properties[cfg.groupBy] : null;
  const [drop, setDrop] = useState<{ group: string; before: string | null } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ key: string; el: HTMLElement } | null>(null);
  const [newGroup, setNewGroup] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);

  if (!gdef) {
    return (
      <div className="empty-state">
        Boards group pages by a property. Open the <b>⋯</b> menu → <b>Group</b> and pick a Select, Status, Person or Checkbox property.
        {!readOnly && (
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-outline"
              onClick={async () => {
                const def = await db.addProperty('status', { name: 'Status' });
                if (def) db.updateView({ groupBy: def.id });
              }}
            >
              Add a Status property
            </button>
          </div>
        )}
      </div>
    );
  }
  const groups = groupRows(rows, gdef.id, db.ctx, cfg) || [];
  const hidden = new Set(cfg.hiddenGroups || []);
  const visible = groups.filter((g) => !hidden.has(g.key));
  const hiddenGroups = groups.filter((g) => hidden.has(g.key));
  const sorted = (cfg.sorts || []).length > 0;
  const size = cfg.cardSize || 'medium';

  const moveCard = (rowId: string, groupKey: string, beforeId: string | null) => {
    const row = db.data.rows.find((r) => r.id === rowId);
    if (!row) return;
    const g = groups.find((x) => x.key === groupKey);
    const inGroup = g?.rows.some((r) => r.id === rowId);
    if (!inGroup) db.updateRow(rowId, { [gdef.id]: groupValue(gdef, groupKey, row.properties[gdef.id]) });
    if (sorted) return;
    const order = db.data.rows.map((r) => r.id).filter((id) => id !== rowId);
    let idx: number;
    if (beforeId) idx = order.indexOf(beforeId);
    else {
      const last = g?.rows.filter((r) => r.id !== rowId).slice(-1)[0];
      idx = last ? order.indexOf(last.id) + 1 : order.length;
    }
    order.splice(idx < 0 ? order.length : idx, 0, rowId);
    db.reorderRows(order);
  };

  const addCard = async (groupKey: string) => {
    const page = await db.addRow({ [gdef.id]: groupValue(gdef, groupKey, null) });
    if (page) setEditing(page.id);
  };

  const card = (row: Page, groupKey: string) => (
    <div
      key={row.id}
      className={`board-card size-${size} ${drop?.before === row.id && drop.group === groupKey ? 'drop-before' : ''}`}
      draggable={!readOnly && editing !== row.id}
      onDragStart={(e) => {
        dragState.rowIds = [row.id];
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.id);
      }}
      onDragEnd={() => {
        dragState.rowIds = null;
        setDrop(null);
      }}
      onDragOver={(e) => {
        if (!dragState.rowIds) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        const list = groups.find((g) => g.key === groupKey)!.rows;
        const i = list.findIndex((x) => x.id === row.id);
        setDrop({ group: groupKey, before: before ? row.id : list[i + 1]?.id || null });
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragState.rowIds && drop) moveCard(dragState.rowIds[0], drop.group, drop.before);
        dragState.rowIds = null;
        setDrop(null);
      }}
      onClick={() => editing !== row.id && db.openRow(row.id)}
      data-testid="board-card"
    >
      <CardPreview row={row} mode={cfg.cardPreview} />
      <div className="card-body">
        {editing === row.id ? (
          <input
            className="card-title-input"
            autoFocus
            placeholder="Type a name…"
            defaultValue={row.title}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (e.target.value !== row.title) db.updateRow(row.id, { title: e.target.value });
              setEditing(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(null);
            }}
            data-testid="card-title-input"
          />
        ) : (
          <div className="card-title">
            <RowTitle row={row} />
          </div>
        )}
        <CardProperties row={row} exclude={[gdef.id]} />
      </div>
    </div>
  );

  const header = (g: (typeof groups)[number]) => {
    const opt = gdef.options?.find((o) => o.id === g.key);
    const person = gdef.type === 'person' ? db.ctx.people.get(g.key) : null;
    return (
      <div className="board-col-head">
        {opt ? (
          <Tag option={opt} status={gdef.type === 'status'} />
        ) : person ? (
          <span className="person-chip">
            <Avatar user={person} size={18} /> {person.name}
          </span>
        ) : (
          <span className="group-label">{g.label}</span>
        )}
        <span className="faint count">{g.rows.length}</span>
        <div style={{ flex: 1 }} />
        {!readOnly && (
          <>
            <button className="icon-btn sm hover-only" onClick={(e) => setGroupMenu({ key: g.key, el: e.currentTarget })}>
              <MoreHorizontal size={14} />
            </button>
            <button className="icon-btn sm hover-only" onClick={() => addCard(g.key)}>
              <Plus size={14} />
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="board-view" data-testid="board-view">
      <div className="board-scroll">
        {visible.map((g) => {
          const opt = gdef.options?.find((o) => o.id === g.key);
          return (
            <div
              key={g.key}
              className={'board-col ' + (opt ? 'col-' + opt.color : 'col-default') + (drop?.group === g.key ? ' drop-target' : '')}
              onDragOver={(e) => {
                if (!dragState.rowIds) return;
                e.preventDefault();
                if (drop?.group !== g.key) setDrop({ group: g.key, before: null });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragState.rowIds) moveCard(dragState.rowIds[0], g.key, drop?.group === g.key ? drop.before : null);
                dragState.rowIds = null;
                setDrop(null);
              }}
              data-testid="board-column"
              data-group={g.label}
            >
              {header(g)}
              <div className="board-cards">
                {g.rows.map((r) => card(r, g.key))}
                {!readOnly && (
                  <button className="board-new" onClick={() => addCard(g.key)}>
                    <Plus size={14} /> New page
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!readOnly && ['select', 'status', 'multi_select'].includes(gdef.type) && (
          <div className="board-add-group">
            {addingGroup ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newGroup.trim()) return;
                  const opt: SelectOption = { id: uuid().slice(0, 8), name: newGroup.trim(), color: nextOptionColor((gdef.options || []).length), ...(gdef.type === 'status' ? { group: 'todo' as const } : {}) };
                  await db.updateDef(gdef.id, { options: [...(gdef.options || []), opt] });
                  setNewGroup('');
                  setAddingGroup(false);
                }}
              >
                <input className="input" autoFocus placeholder="Group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} onBlur={() => !newGroup && setAddingGroup(false)} />
              </form>
            ) : (
              <button className="board-new" onClick={() => setAddingGroup(true)}>
                <Plus size={14} /> Add group
              </button>
            )}
          </div>
        )}
        {hiddenGroups.length > 0 && (
          <div className="board-hidden">
            <div className="menu-label" style={{ padding: '6px 4px' }}>Hidden groups</div>
            {hiddenGroups.map((g) => (
              <button key={g.key} className="hidden-group" onClick={() => db.updateView({ hiddenGroups: (cfg.hiddenGroups || []).filter((k) => k !== g.key) })}>
                <Eye size={14} className="faint" />
                <span className="ellipsis">{g.label}</span>
                <span className="faint">{g.rows.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {groupMenu && (
        <Popover anchor={groupMenu.el} onClose={() => setGroupMenu(null)}>
          <div className="menu">
            <MenuItem
              icon={<EyeOff size={16} />}
              label="Hide group"
              onClick={() => {
                db.updateView({ hiddenGroups: [...(cfg.hiddenGroups || []), groupMenu.key] });
                setGroupMenu(null);
              }}
            />
          </div>
        </Popover>
      )}
    </div>
  );
}
