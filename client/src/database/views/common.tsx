import React, { useState } from 'react';
import type { Page, PropertyDef } from '../../types';
import { useDb } from '../DatabaseView';
import { PropertyDisplay, PropertyEditor } from '../Property';
import { getValue, visibleProps, COMPUTED } from '../dbUtils';
import { coverCss, htmlToText } from '../../lib/format';

export interface CellEdit {
  rowId: string;
  propId: string;
  anchor: HTMLElement | DOMRect;
  width?: number;
}

/** Hook + host element for editing a single property value in a popover. */
export function useCellEditor() {
  const [edit, setEdit] = useState<CellEdit | null>(null);
  const db = useDb();
  const open = (row: Page, def: PropertyDef, el: HTMLElement) => {
    if (db.readOnly || COMPUTED.has(def.type)) return;
    if (def.type === 'checkbox') {
      db.updateRow(row.id, { [def.id]: !getValue(row, def, db.ctx) });
      return;
    }
    setEdit({ rowId: row.id, propId: def.id, anchor: el.getBoundingClientRect(), width: el.getBoundingClientRect().width });
  };
  const host = edit ? <CellEditorHost edit={edit} onClose={() => setEdit(null)} /> : null;
  return { open, host, editing: edit };
}

function CellEditorHost({ edit, onClose }: { edit: CellEdit; onClose: () => void }) {
  const db = useDb();
  const row = db.data.rows.find((r) => r.id === edit.rowId);
  const def = db.schema.properties[edit.propId];
  if (!row || !def) return null;
  return (
    <PropertyEditor
      def={def}
      row={row}
      ctx={db.ctx}
      anchor={edit.anchor}
      width={edit.width}
      people={db.data.people}
      onClose={onClose}
      onChange={(v) => {
        db.updateRow(row.id, { [def.id]: v });
        if (def.type === 'select' || def.type === 'status') onClose();
      }}
      onDefChange={(patch) => db.updateDef(def.id, patch)}
    />
  );
}

/** Non-empty visible properties shown on board / gallery / list cards. */
export function CardProperties({ row, exclude = [], inline }: { row: Page; exclude?: string[]; inline?: boolean }) {
  const db = useDb();
  const props = visibleProps(db.cfg, db.schema).filter((p) => p.def.type !== 'title' && !exclude.includes(p.def.id));
  const items = props
    .map((p) => {
      const v = getValue(row, p.def, db.ctx);
      const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (p.def.type === 'checkbox' && false);
      if (empty) return null;
      return (
        <div key={p.def.id} className="card-prop" title={p.def.name}>
          <PropertyDisplay def={p.def} row={row} ctx={db.ctx} wrap={!inline} />
        </div>
      );
    })
    .filter(Boolean);
  if (!items.length) return null;
  return <div className={inline ? 'card-props-inline' : 'card-props'}>{items}</div>;
}

export function CardPreview({ row, mode }: { row: Page; mode?: 'none' | 'cover' | 'content' }) {
  const db = useDb();
  if (!mode || mode === 'none') return null;
  if (mode === 'cover') {
    if (!row.cover) return null;
    return <div className="card-cover" style={coverCss(row.cover)} />;
  }
  if (row.cover) return <div className="card-cover" style={coverCss(row.cover)} />;
  const blocks = db.data.previews?.[row.id] || [];
  const img = blocks.find((b) => b.type === 'image' && b.content.url);
  if (img) return <div className="card-cover" style={{ backgroundImage: `url("${img.content.url}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />;
  const lines = blocks.filter((b) => b.content?.text).slice(0, 6);
  return (
    <div className="card-content-preview">
      {lines.map((b, i) => (
        <div key={i} className={'ccp-line ccp-' + b.type}>
          {b.type === 'to_do' && <span className={'ccp-check ' + (b.content.checked ? 'on' : '')} />}
          {b.type === 'bulleted_list' && '• '}
          {htmlToText(b.content.text)}
        </div>
      ))}
    </div>
  );
}
