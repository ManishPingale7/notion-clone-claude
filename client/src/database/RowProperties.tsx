import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import type { DatabaseData, DbSchema, Page, PropertyDef, PropertyType, User } from '../types';
import { api } from '../api';
import { realtime } from '../realtime';
import { useApp } from '../store';
import { makeCtx, propIcon, COMPUTED, getValue } from './dbUtils';
import { PropertyDisplay, PropertyEditor } from './Property';
import { PropertyMenu, AddPropertyMenu } from './PropertyMenu';

export function RowProperties({ page, databaseId, schema: initialSchema, people, readOnly, onChange }: { page: Page; databaseId: string; schema: DbSchema; people: User[]; readOnly: boolean; onChange: (patch: Partial<Page>) => void }) {
  const [data, setData] = useState<DatabaseData | null>(null);
  const [row, setRow] = useState<Page>(page);
  const [edit, setEdit] = useState<{ def: PropertyDef; anchor: DOMRect; width: number } | null>(null);
  const [menu, setMenu] = useState<{ def: PropertyDef; el: HTMLElement } | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [showEmpty, setShowEmpty] = useState(true);
  const toast = useApp((s) => s.toast);

  const load = useCallback(() => {
    api.get(`/api/databases/${databaseId}`).then(setData).catch(() => {});
  }, [databaseId]);
  useEffect(load, [load]);
  useEffect(() => setRow(page), [page]);
  useEffect(() => {
    const unsub = realtime.subscribe('page:' + databaseId);
    const off = realtime.on((m) => {
      if (m.pageId === databaseId && m.type === 'db.changed') load();
    });
    return () => {
      off();
      unsub();
    };
  }, [databaseId, load]);

  const schema = data?.database.schema || initialSchema;
  const ctx = useMemo(() => (data ? makeCtx({ ...data, rows: data.rows.map((r) => (r.id === row.id ? row : r)) }, schema) : { schema, people: new Map(people.map((p) => [p.id, p])), related: {} }), [data, schema, people, row]);
  const defs = schema.order.map((id) => schema.properties[id]).filter((d) => d && d.type !== 'title');

  const setValue = (def: PropertyDef, v: any) => {
    const next = { ...row, properties: { ...row.properties, [def.id]: v }, updatedAt: Date.now() };
    setRow(next);
    onChange({ properties: next.properties, updatedAt: next.updatedAt });
    api.patch(`/api/pages/${row.id}`, { properties: { [def.id]: v } }).catch((e) => toast(e.message, { kind: 'error' }));
  };
  const updateDef = async (id: string, patch: Partial<PropertyDef> & { type?: PropertyType }) => {
    try {
      const r = await api.patch(`/api/databases/${databaseId}/properties/${id}`, patch);
      load();
      return r.property;
    } catch (e: any) {
      toast(e.message, { kind: 'error' });
    }
  };
  const isEmpty = (def: PropertyDef) => {
    const v = getValue(row, def, ctx as any);
    return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (def.type === 'checkbox' && false);
  };
  const emptyCount = defs.filter((d) => isEmpty(d) && !COMPUTED.has(d.type)).length;
  const shown = showEmpty ? defs : defs.filter((d) => !isEmpty(d) || COMPUTED.has(d.type));

  return (
    <div className="page-properties" data-testid="row-properties">
      {shown.map((def) => (
        <div key={def.id} className="prop-row" data-prop={def.name}>
          <button className="prop-label" onClick={(e) => data && setMenu({ def, el: e.currentTarget })}>
            <span className="prop-label-icon">{propIcon(def.type)}</span>
            <span className="ellipsis">{def.name}</span>
          </button>
          <div
            className={'prop-value ' + (readOnly || COMPUTED.has(def.type) ? 'readonly' : '')}
            onClick={(e) => {
              if (readOnly || COMPUTED.has(def.type)) return;
              if ((e.target as HTMLElement).closest('a')) return;
              if (def.type === 'checkbox') return setValue(def, !row.properties[def.id]);
              const r = e.currentTarget.getBoundingClientRect();
              setEdit({ def, anchor: r, width: r.width });
            }}
            data-testid="prop-value"
          >
            {isEmpty(def) && def.type !== 'checkbox' ? <span className="faint">Empty</span> : <PropertyDisplay def={def} row={row} ctx={ctx as any} wrap />}
          </div>
        </div>
      ))}
      {emptyCount > 0 && (
        <button className="prop-more" onClick={() => setShowEmpty(!showEmpty)}>
          <ChevronDown size={14} style={{ transform: showEmpty ? 'rotate(180deg)' : undefined }} /> {showEmpty ? 'Hide empty properties' : `${emptyCount} more properties`}
        </button>
      )}
      {!readOnly && (
        <button className="prop-more" onClick={(e) => setAddAnchor(e.currentTarget)} data-testid="add-row-property">
          <Plus size={14} /> Add a property
        </button>
      )}
      <div className="page-properties-divider" />
      {edit && (
        <PropertyEditor
          def={schema.properties[edit.def.id] || edit.def}
          row={row}
          ctx={ctx as any}
          anchor={edit.anchor}
          width={edit.width}
          people={data?.people || people}
          onClose={() => setEdit(null)}
          onChange={(v) => {
            setValue(edit.def, v);
            if (edit.def.type === 'select' || edit.def.type === 'status') setEdit(null);
          }}
          onDefChange={(patch) => updateDef(edit.def.id, patch)}
        />
      )}
      {menu && data && (
        <PropertyMenu
          anchor={menu.el}
          def={schema.properties[menu.def.id] || menu.def}
          data={data}
          readOnly={readOnly}
          onClose={() => setMenu(null)}
          updateDef={(patch) => updateDef(menu.def.id, patch)}
          deleteDef={async () => {
            await api.del(`/api/databases/${databaseId}/properties/${menu.def.id}`);
            load();
          }}
          duplicateDef={async () => {
            await api.post(`/api/databases/${databaseId}/properties/${menu.def.id}/duplicate`);
            load();
          }}
        />
      )}
      {addAnchor && (
        <AddPropertyMenu
          anchor={addAnchor}
          onClose={() => setAddAnchor(null)}
          onAdd={async (type) => {
            try {
              await api.post(`/api/databases/${databaseId}/properties`, { type });
              load();
            } catch (e: any) {
              toast(e.message, { kind: 'error' });
            }
          }}
        />
      )}
    </div>
  );
}
