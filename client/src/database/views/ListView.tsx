import React from 'react';
import { FileText } from 'lucide-react';
import type { Page } from '../../types';
import { useDb, NewRowButton } from '../DatabaseView';
import { CardProperties } from './common';
import { groupRows, groupValue } from '../dbUtils';
import { Tag } from '../Property';
import { PageIcon } from '../../components/ui';
import { pageTitle } from '../../lib/format';

export function ListView() {
  const db = useDb();
  const { rows, readOnly, cfg, schema } = db;
  const item = (row: Page) => (
    <div key={row.id} className="list-row" onClick={() => db.openRow(row.id)} data-testid="list-row">
      <span className="list-icon">{row.icon ? <PageIcon icon={row.icon} size={18} /> : <FileText size={18} strokeWidth={1.6} className="faint" />}</span>
      <span className={'list-title ' + (row.title ? '' : 'faint')}>{pageTitle(row.title)}</span>
      <div style={{ flex: 1 }} />
      <CardProperties row={row} inline />
    </div>
  );
  const groups = cfg.groupBy ? groupRows(rows, cfg.groupBy, db.ctx, cfg) : null;
  const gdef = cfg.groupBy ? schema.properties[cfg.groupBy] : null;
  return (
    <div className="list-view">
      {groups && gdef
        ? groups.map((g) => {
            const opt = gdef.options?.find((o) => o.id === g.key);
            return (
              <div key={g.key} className="list-group">
                <div className="table-group-head">
                  {opt ? <Tag option={opt} status={gdef.type === 'status'} /> : <span className="group-label">{g.label}</span>}
                  <span className="faint">{g.rows.length}</span>
                </div>
                {g.rows.map(item)}
                {!readOnly && <NewRowButton onClick={() => db.addRow({ [gdef.id]: groupValue(gdef, g.key, null) }, { open: true })} />}
              </div>
            );
          })
        : rows.map(item)}
      {!groups && !readOnly && <NewRowButton onClick={() => db.addRow({}, { open: true })} />}
      {!rows.length && readOnly && <div className="empty-state">No pages</div>}
    </div>
  );
}
