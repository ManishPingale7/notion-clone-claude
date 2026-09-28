import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Page } from '../../types';
import { useDb, RowTitle } from '../DatabaseView';
import { MONTHS_LONG, parseISODate, toISODate } from '../../lib/format';

const DAY_W = { day: 60, week: 28, month: 10 } as const;

export function TimelineView() {
  const db = useDb();
  const { rows, cfg, schema, readOnly } = db;
  const [scale, setScale] = useState<'day' | 'week' | 'month'>('week');
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; start: string; end: string } | null>(null);
  const def = cfg.dateBy ? schema.properties[cfg.dateBy] : null;
  const dayW = DAY_W[scale];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const origin = new Date(today.getTime() - 60 * 864e5);
  const totalDays = 240;

  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = 60 * dayW - 200;
  }, [dayW, def?.id]);

  if (!def || def.type !== 'date') {
    return (
      <div className="empty-state">
        Timeline views need a date property.
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

  const dayIndex = (iso: string) => Math.round((parseISODate(iso.slice(0, 10)).getTime() - origin.getTime()) / 864e5);
  const isoAt = (i: number) => toISODate(new Date(origin.getTime() + i * 864e5));

  const startDrag = (e: React.MouseEvent, row: Page, mode: 'move' | 'end' | 'start') => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const v = row.properties[def.id];
    const s0 = dayIndex(v.start);
    const e0 = dayIndex(v.end || v.start);
    const x0 = e.clientX;
    let cur = { id: row.id, start: v.start.slice(0, 10), end: (v.end || v.start).slice(0, 10) };
    let moved = false;
    const move = (ev: MouseEvent) => {
      const dd = Math.round((ev.clientX - x0) / dayW);
      if (dd !== 0) moved = true;
      let s = s0;
      let en = e0;
      if (mode === 'move') {
        s += dd;
        en += dd;
      } else if (mode === 'end') en = Math.max(s0, e0 + dd);
      else s = Math.min(e0, s0 + dd);
      cur = { id: row.id, start: isoAt(s), end: isoAt(en) };
      setDrag(cur);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      if (!moved) {
        db.openRow(row.id);
        return;
      }
      db.updateRow(row.id, { [def.id]: { ...v, start: cur.start, end: cur.end !== cur.start ? cur.end : undefined } });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const headers: { label: string; left: number; width: number }[] = [];
  let cursor = new Date(origin);
  while (cursor.getTime() < origin.getTime() + totalDays * 864e5) {
    const mStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const mEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const left = Math.max(0, Math.round((mStart.getTime() - origin.getTime()) / 864e5));
    const right = Math.min(totalDays, Math.round((mEnd.getTime() - origin.getTime()) / 864e5));
    headers.push({ label: `${MONTHS_LONG[cursor.getMonth()]} ${cursor.getFullYear()}`, left: left * dayW, width: (right - left) * dayW });
    cursor = mEnd;
  }
  const todayIdx = Math.round((today.getTime() - origin.getTime()) / 864e5);

  return (
    <div className="timeline-view" data-testid="timeline-view">
      <div className="tl-toolbar">
        <div className="segmented">
          {(['day', 'week', 'month'] as const).map((s) => (
            <button key={s} className={scale === s ? 'on' : ''} onClick={() => setScale(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => scroller.current && (scroller.current.scrollLeft = todayIdx * dayW - 200)}>
          Today
        </button>
      </div>
      <div className="tl-body">
        <div className="tl-names">
          <div className="tl-names-head">Name</div>
          {rows.map((r) => (
            <div key={r.id} className="tl-name" onClick={() => db.openRow(r.id)}>
              <RowTitle row={r} />
            </div>
          ))}
          {!readOnly && (
            <button className="db-new-row" onClick={() => db.addRow({ [def.id]: { start: toISODate(today) } }, { open: true })}>
              <Plus size={14} /> New page
            </button>
          )}
        </div>
        <div className="tl-scroll" ref={scroller}>
          <div className="tl-canvas" style={{ width: totalDays * dayW }}>
            <div className="tl-months">
              {headers.map((h) => (
                <div key={h.label} className="tl-month" style={{ left: h.left, width: h.width }}>
                  {h.label}
                </div>
              ))}
            </div>
            <div className="tl-days">
              {Array.from({ length: totalDays }, (_, i) => {
                const d = new Date(origin.getTime() + i * 864e5);
                const show = scale === 'day' || (scale === 'week' && (d.getDay() === 1 || i === todayIdx)) || (scale === 'month' && d.getDate() === 1);
                return (
                  <div key={i} className={'tl-day ' + (i === todayIdx ? 'today' : '') + (d.getDay() === 0 || d.getDay() === 6 ? ' weekend' : '')} style={{ left: i * dayW, width: dayW }}>
                    {show ? d.getDate() : ''}
                  </div>
                );
              })}
            </div>
            <div className="tl-today-line" style={{ left: todayIdx * dayW + dayW / 2 }} />
            {rows.map((r) => {
              const v = r.properties[def.id];
              const d = drag?.id === r.id ? drag : v?.start ? { start: v.start, end: v.end || v.start } : null;
              return (
                <div
                  key={r.id}
                  className="tl-row"
                  onDoubleClick={(e) => {
                    if (readOnly || v?.start) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const idx = Math.floor((e.clientX - rect.left) / dayW);
                    db.updateRow(r.id, { [def.id]: { start: isoAt(idx) } });
                  }}
                >
                  {d ? (
                    <div className="tl-bar" style={{ left: dayIndex(d.start) * dayW + 2, width: Math.max(1, dayIndex(d.end) - dayIndex(d.start) + 1) * dayW - 4 }} onMouseDown={(e) => startDrag(e, r, 'move')} data-testid="timeline-bar">
                      {!readOnly && <span className="tl-handle left" onMouseDown={(e) => startDrag(e, r, 'start')} />}
                      <span className="ellipsis">{r.title || 'Untitled'}</span>
                      {!readOnly && <span className="tl-handle right" onMouseDown={(e) => startDrag(e, r, 'end')} />}
                    </div>
                  ) : (
                    <span className="tl-unscheduled faint">{readOnly ? 'No date' : 'Double-click to schedule'}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
