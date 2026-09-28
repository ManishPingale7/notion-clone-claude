import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { useMenuNav, MenuItem, PageIcon } from './ui';
import { pageTitle } from '../lib/format';
import type { PageMeta } from '../types';

type Result = PageMeta & { path?: string };

/** Searchable page list used for "Move to", "Link to page", relation pickers… */
export function PagePicker({
  onPick,
  placeholder = 'Search pages…',
  exclude = [],
  filter,
  extraTop,
  onlyPages,
}: {
  onPick: (p: Result) => void;
  placeholder?: string;
  exclude?: string[];
  filter?: (p: Result) => boolean;
  extraTop?: React.ReactNode;
  onlyPages?: boolean;
}) {
  const workspaceId = useApp((s) => s.workspaceId);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.get(`/api/workspaces/${workspaceId}/search?titles=1&limit=50&q=${encodeURIComponent(q)}`);
        if (alive) setResults(r.results);
      } catch {
        /* ignore */
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, workspaceId]);
  const list = results.filter((r) => !exclude.includes(r.id) && (!filter || filter(r)) && (!onlyPages || r.parentType !== 'database'));
  const nav = useMenuNav(list.length, (i) => onPick(list[i]), [q, list.length]);
  return (
    <div style={{ width: 320, display: 'flex', flexDirection: 'column', maxHeight: 400 }}>
      <div className="menu-search">
        <input className="input" autoFocus placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={nav.onKeyDown} data-testid="page-picker-input" />
      </div>
      {extraTop}
      <div className="menu" style={{ overflowY: 'auto' }}>
        {list.length === 0 && <div className="menu-empty">No results</div>}
        {list.map((p, i) => (
          <MenuItem
            key={p.id}
            icon={<PageIcon icon={p.icon} type={p.type} size={18} />}
            label={pageTitle(p.title)}
            desc={p.path || undefined}
            selected={i === nav.index}
            onMouseEnter={() => nav.setIndex(i)}
            onClick={() => onPick(p)}
          />
        ))}
      </div>
    </div>
  );
}
