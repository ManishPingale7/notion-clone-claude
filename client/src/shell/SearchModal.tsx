import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, ArrowUpDown, Type as TypeIcon } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { Modal, PageIcon, useMenuNav } from '../components/ui';
import { pageTitle, timeAgo, escapeHtml } from '../lib/format';
import type { PageMeta } from '../types';

type Result = PageMeta & { path?: string; snippet?: string | null; updatedAt?: number; visitedAt?: number };

function highlight(text: string, q: string) {
  if (!q) return escapeHtml(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>' + escapeHtml(text.slice(i + q.length));
}

export function SearchModal() {
  const { workspaceId, set } = useApp();
  const ws = useApp((s) => s.workspaces.find((w) => w.id === s.workspaceId));
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [recent, setRecent] = useState<Result[]>([]);
  const [titleOnly, setTitleOnly] = useState(false);
  const [sort, setSort] = useState<'best' | 'edited'>('best');
  const close = () => set({ searchOpen: false });

  useEffect(() => {
    api.get(`/api/workspaces/${workspaceId}/recents`).then((r) => setRecent(r.pages)).catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .get(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}${titleOnly ? '&titles=1' : ''}&limit=50`)
        .then((r) => alive && setResults(r.results))
        .catch(() => {});
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, workspaceId, titleOnly]);

  const list = q.trim() ? (sort === 'edited' ? [...results].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) : results) : recent;
  const go = (r: Result, newTab = false) => {
    close();
    if (newTab) window.open(`/p/${r.id}`, '_blank');
    else navigate(`/p/${r.id}`);
  };
  const nav = useMenuNav(list.length, (i) => go(list[i]), [q, list.length, sort]);

  return (
    <Modal onClose={close} width={755} top="10vh">
      <div className="search-modal" data-testid="search-modal">
        <div className="search-bar">
          <Search size={18} className="faint" />
          <input
            autoFocus
            placeholder={`Search or ask a question in ${ws?.name || 'your workspace'}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && list[nav.index]) {
                e.preventDefault();
                go(list[nav.index], true);
                return;
              }
              nav.onKeyDown(e);
            }}
            data-testid="search-input"
          />
        </div>
        {q.trim() && (
          <div className="search-filters">
            <button className={'filter-pill ' + (sort === 'edited' ? 'active' : '')} onClick={() => setSort(sort === 'best' ? 'edited' : 'best')}>
              <ArrowUpDown size={13} /> {sort === 'best' ? 'Sort: Best matches' : 'Sort: Last edited'}
            </button>
            <button className={'filter-pill ' + (titleOnly ? 'active' : '')} onClick={() => setTitleOnly(!titleOnly)}>
              <TypeIcon size={13} /> Title only
            </button>
          </div>
        )}
        <div className="search-results">
          <div className="menu-label">{q.trim() ? (list.length ? 'Best matches' : '') : 'Recent'}</div>
          {q.trim() && !list.length && <div className="empty-state">No results for "{q}"</div>}
          {list.map((r, i) => (
            <div key={r.id} className={'search-item ' + (i === nav.index ? 'selected' : '')} onMouseEnter={() => nav.setIndex(i)} onClick={(e) => go(r, e.metaKey || e.ctrlKey)} data-testid="search-result">
              <PageIcon icon={r.icon} type={r.type} size={20} />
              <div className="grow">
                <div className="search-title">
                  <span dangerouslySetInnerHTML={{ __html: highlight(pageTitle(r.title), q) }} />
                  {r.path && <span className="search-path"> — {r.path}</span>}
                </div>
                {r.snippet && <div className="search-snippet" dangerouslySetInnerHTML={{ __html: highlight(r.snippet, q) }} />}
              </div>
              <span className="faint small">{timeAgo(r.updatedAt || r.visitedAt)}</span>
              {i === nav.index && <CornerDownLeft size={14} className="faint" />}
            </div>
          ))}
        </div>
        <div className="search-footer faint small">
          <span>↑↓ Select</span>
          <span>↵ Open</span>
          <span>Ctrl+↵ Open in new tab</span>
        </div>
      </div>
    </Modal>
  );
}
