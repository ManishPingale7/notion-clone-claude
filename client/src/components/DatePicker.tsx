import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTHS_LONG, parseISODate, toISODate, formatDateValue } from '../lib/format';
import { Switch } from './ui';

export interface DateValue {
  start: string;
  end?: string;
  includeTime?: boolean;
}

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function DatePicker({ value, onChange, allowRange = true, allowTime = true }: { value: DateValue | null; onChange: (v: DateValue | null) => void; allowRange?: boolean; allowTime?: boolean }) {
  const initial = value?.start ? parseISODate(value.start) : new Date();
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [editingEnd, setEditingEnd] = useState(false);
  const [startText, setStartText] = useState(value?.start ? formatDateValue({ start: value.start.slice(0, 10) }) : '');
  const hasEnd = !!value?.end;
  const includeTime = !!value?.includeTime;
  const today = toISODate(new Date());

  const days: Date[] = [];
  const first = new Date(month);
  first.setDate(1 - first.getDay());
  for (let i = 0; i < 42; i++) days.push(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));

  const timeOf = (s?: string) => (s && s.includes('T') ? s.slice(11, 16) : '09:00');
  const withTime = (d: string, existing?: string) => (includeTime ? `${d}T${timeOf(existing)}` : d);

  const pick = (d: Date) => {
    const iso = toISODate(d);
    if (hasEnd && editingEnd && value) {
      const s = value.start.slice(0, 10);
      if (iso < s) onChange({ ...value, start: withTime(iso, value.start), end: withTime(s, value.end) });
      else onChange({ ...value, end: withTime(iso, value.end) });
      setEditingEnd(false);
    } else if (hasEnd && value) {
      onChange({ ...value, start: withTime(iso, value.start), end: value.end && value.end.slice(0, 10) < iso ? withTime(iso, value.end) : value.end });
      setEditingEnd(true);
    } else {
      onChange({ ...(value || {}), start: withTime(iso, value?.start) });
      setStartText(formatDateValue({ start: iso }));
    }
  };

  const inRange = (iso: string) => value?.end && iso >= value.start.slice(0, 10) && iso <= value.end.slice(0, 10);

  return (
    <div className="date-picker" data-testid="date-picker">
      <div className="dp-inputs">
        <input
          className={'input ' + (!editingEnd ? 'dp-active' : '')}
          value={startText}
          placeholder="Start date"
          onFocus={() => setEditingEnd(false)}
          onChange={(e) => setStartText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const d = new Date(startText);
              if (!Number.isNaN(d.getTime())) {
                pick(d);
                setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
              }
            }
          }}
        />
        {includeTime && value?.start && (
          <input className="input dp-time" type="time" value={timeOf(value.start)} onChange={(e) => onChange({ ...value, start: `${value.start.slice(0, 10)}T${e.target.value}` })} />
        )}
      </div>
      {hasEnd && value?.end && (
        <div className="dp-inputs">
          <input className={'input ' + (editingEnd ? 'dp-active' : '')} readOnly value={formatDateValue({ start: value.end.slice(0, 10) })} onFocus={() => setEditingEnd(true)} />
          {includeTime && <input className="input dp-time" type="time" value={timeOf(value.end)} onChange={(e) => onChange({ ...value, end: `${value.end!.slice(0, 10)}T${e.target.value}` })} />}
        </div>
      )}
      <div className="dp-head">
        <span className="dp-month">
          {MONTHS_LONG[month.getMonth()].slice(0, 3)} {month.getFullYear()}
        </span>
        <button className="btn dp-today" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          Today
        </button>
        <button className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <button className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="dp-grid">
        {DOW.map((d) => (
          <div key={d} className="dp-dow">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const iso = toISODate(d);
          const selected = value?.start?.slice(0, 10) === iso || value?.end?.slice(0, 10) === iso;
          return (
            <button
              key={iso}
              className={`dp-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${iso === today ? 'today' : ''} ${selected ? 'selected' : ''} ${inRange(iso) ? 'in-range' : ''}`}
              onClick={() => pick(d)}
              data-date={iso}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="dp-options">
        {allowRange && (
          <label className="dp-option" onClick={() => value && onChange(hasEnd ? { ...value, end: undefined } : { ...value, end: value.start })}>
            <span>End date</span>
            <Switch on={hasEnd} onChange={() => {}} />
          </label>
        )}
        {allowTime && (
          <label
            className="dp-option"
            onClick={() => {
              if (!value) return;
              if (includeTime) onChange({ start: value.start.slice(0, 10), end: value.end?.slice(0, 10), includeTime: false });
              else onChange({ start: `${value.start.slice(0, 10)}T09:00`, end: value.end ? `${value.end.slice(0, 10)}T10:00` : undefined, includeTime: true });
            }}
          >
            <span>Include time</span>
            <Switch on={includeTime} onChange={() => {}} />
          </label>
        )}
        <button className="dp-option dp-clear" onClick={() => onChange(null)}>
          Clear
        </button>
      </div>
    </div>
  );
}
