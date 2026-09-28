import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Page } from '../../types';
import { useDb, RowTitle } from '../DatabaseView';
import { CardProperties } from './common';
import { MONTHS_LONG, parseISODate, toISODate } from '../../lib/format';
import { dragState } from '../../editor/dnd';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarView() {
  const db = useDb();
  const { rows, cfg, schema, readOnly } = db;
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [dropDay, setDropDay] = useState<string | null>(null);
  const def = cfg.dateBy ? schema.properties[cfg.dateBy] : null;
  if (!def) {
    return (
      <div className="empty-state">
        Calendar views need a date property.
        {!readOnly && (
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-outline"
              onClick={async () => {
                const d = await db.addProperty('date', { name: 'Date' });
                if (d) db.updateView({ dateBy: d.id });
              }}
            >
              Add a Date property
            </button>
          </div>
        )}
      </div>
    );
  }
  const editable = def.type === 'date' && !readOnly;
  const start = new Date(month);
  start.setDate(1 - start.getDay());
  const weeks = Math.ceil((month.getDay() + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7);
  const days: Date[] = [];
  for (let i = 0; i < weeks * 7; i++) days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = toISODate(new Date());

  const byDay = new Map<string, Page[]>();
  for (const r of rows) {
    let s: string | null = null;
    let e: string | null = null;
    if (def.type === 'date') {
      const v = r.properties[def.id];
      if (!v?.start) continue;
      s = v.start.slice(0, 10);
      e = v.end ? v.end.slice(0, 10) : s;
    } else {
      const t = def.type === 'created_time' ? r.createdAt : r.updatedAt;
      s = e = toISODate(new Date(t));
    }
    const sd = parseISODate(s!);
    const ed = parseISODate(e!);
    for (let d = new Date(sd), guard = 0; d <= ed && guard < 62; d.setDate(d.getDate() + 1), guard++) {
      const k = toISODate(d);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k)!.push(r);
    }
  }

  const moveTo = (rowId: string, day: string) => {
    const row = db.data.rows.find((r) => r.id === rowId);
    if (!row || !editable) return;
    const v = row.properties[def.id] || {};
    const oldStart = v.start ? parseISODate(v.start.slice(0, 10)) : null;
    const delta = oldStart ? parseISODate(day).getTime() - oldStart.getTime() : 0;
    const shift = (s: string) => {
      const d = new Date(parseISODate(s.slice(0, 10)).getTime() + delta);
      return toISODate(d) + (s.includes('T') ? s.slice(10) : '');
    };
    db.updateRow(rowId, { [def.id]: v.start ? { ...v, start: shift(v.start), end: v.end ? shift(v.end) : undefined } : { start: day } });
  };

  return (
    <div className="calendar-view" data-testid="calendar-view">
      <div className="cal-head">
        <div className="cal-title">
          {MONTHS_LONG[month.getMonth()]} {month.getFullYear()}
        </div>
        <div style={{ flex: 1 }} />
        <button className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <button className="btn" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          Today
        </button>
        <button className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="cal-grid">
        {DOW.map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const k = toISODate(d);
          const list = byDay.get(k) || [];
          const other = d.getMonth() !== month.getMonth();
          return (
            <div
              key={k}
              className={`cal-day ${other ? 'other' : ''} ${dropDay === k ? 'drop' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}`}
              onDragOver={(e) => {
                if (!dragState.rowIds || !editable) return;
                e.preventDefault();
                setDropDay(k);
              }}
              onDragLeave={() => setDropDay(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragState.rowIds) moveTo(dragState.rowIds[0], k);
                dragState.rowIds = null;
                setDropDay(null);
              }}
              data-date={k}
            >
              <div className="cal-day-head">
                {editable && (
                  <button className="icon-btn sm cal-add" onClick={() => db.addRow({ [def.id]: { start: k } }, { open: true })} data-testid="cal-add">
                    <Plus size={14} />
                  </button>
                )}
                <span className={'cal-num ' + (k === today ? 'today' : '')}>{d.getDate() === 1 ? `${MONTHS_LONG[d.getMonth()].slice(0, 3)} ${d.getDate()}` : d.getDate()}</span>
              </div>
              {list.map((r) => (
                <div
                  key={r.id}
                  className="cal-card"
                  draggable={editable}
                  onDragStart={(e) => {
                    dragState.rowIds = [r.id];
                    e.dataTransfer.setData('text/plain', r.id);
                  }}
                  onClick={() => db.openRow(r.id)}
                  data-testid="cal-card"
                >
                  <RowTitle row={r} />
                  <CardProperties row={r} exclude={[def.id]} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
