import React from 'react';
import { Plus } from 'lucide-react';
import type { Page } from '../../types';
import { useDb, RowTitle } from '../DatabaseView';
import { CardProperties, CardPreview } from './common';
import { groupRows, groupValue } from '../dbUtils';
import { Tag } from '../Property';

export function GalleryView() {
  const db = useDb();
  const { rows, readOnly, cfg, schema } = db;
  const size = cfg.cardSize || 'medium';
  const preview = cfg.cardPreview || 'content';
  const card = (row: Page) => (
    <div key={row.id} className="gallery-card" onClick={() => db.openRow(row.id)} data-testid="gallery-card">
      {preview !== 'none' && (
        <div className="gallery-preview">
          <CardPreview row={row} mode={preview} />
        </div>
      )}
      <div className="card-body">
        <div className="card-title">
          <RowTitle row={row} />
        </div>
        <CardProperties row={row} />
      </div>
    </div>
  );
  const grid = (list: Page[], extra?: Record<string, any>) => (
    <div className={'gallery-grid size-' + size}>
      {list.map(card)}
      {!readOnly && (
        <button className="gallery-new" onClick={() => db.addRow(extra || {}, { open: true })} data-testid="gallery-new">
          <Plus size={16} /> New page
        </button>
      )}
    </div>
  );
  const groups = cfg.groupBy ? groupRows(rows, cfg.groupBy, db.ctx, cfg) : null;
  const gdef = cfg.groupBy ? schema.properties[cfg.groupBy] : null;
  return (
    <div className="gallery-view">
      {groups && gdef
        ? groups.map((g) => {
            const opt = gdef.options?.find((o) => o.id === g.key);
            return (
              <div key={g.key} className="list-group">
                <div className="table-group-head">
                  {opt ? <Tag option={opt} status={gdef.type === 'status'} /> : <span className="group-label">{g.label}</span>}
                  <span className="faint">{g.rows.length}</span>
                </div>
                {grid(g.rows, { [gdef.id]: groupValue(gdef, g.key, null) })}
              </div>
            );
          })
        : grid(rows)}
    </div>
  );
}
