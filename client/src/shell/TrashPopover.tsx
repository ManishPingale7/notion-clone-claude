import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Trash2, Search } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { Popover, PageIcon, Tooltip, confirmDialog, Spinner } from '../components/ui';
import { pageTitle, timeAgo } from '../lib/format';
import type { PageMeta } from '../types';

type TrashItem = PageMeta & { deletedAt: number; parentTitle: string | null; role: string };

export function TrashPopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const workspaceId = useApp((s) => s.workspaceId);
  const toast = useApp((s) => s.toast);
  const loadSidebar = useApp((s) => s.loadSidebar);
  const mergeMeta = useApp((s) => s.mergeMeta);
  const navigate = useNavigate();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [q, setQ] = useState('');
  const load = () => api.get(`/api/workspaces/${workspaceId}/trash`).then((r) => setItems(r.pages));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
  const list = (items || []).filter((p) => pageTitle(p.title).toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover anchor={anchor} onClose={onClose} placement="right-start" width={420}>
      <div className="trash-popover" data-testid="trash">
        <div className="menu-search row" style={{ gap: 6 }}>
          <div className="search-input-wrap">
            <Search size={14} className="faint" />
            <input autoFocus placeholder="Search pages in Trash" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="trash-list">
          {!items && (
            <div style={{ padding: 20, display: 'flex', justifyContent: 'center' }}>
              <Spinner />
            </div>
          )}
          {items && !list.length && (
            <div className="empty-state">
              <Trash2 size={28} strokeWidth={1.4} />
              <div>No pages in Trash</div>
            </div>
          )}
          {list.map((p) => (
            <div key={p.id} className="trash-item" onClick={() => (navigate(`/p/${p.id}`), onClose())} data-testid="trash-item">
              <PageIcon icon={p.icon} type={p.type} size={18} />
              <div className="grow">
                <div className="ellipsis">{pageTitle(p.title)}</div>
                <div className="faint small ellipsis">
                  {p.parentTitle ? `${p.parentTitle} · ` : ''}Deleted {timeAgo(p.deletedAt)}
                </div>
              </div>
              <Tooltip label="Restore">
                <button
                  className="icon-btn sm"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await api.post(`/api/pages/${p.id}/restore`);
                    mergeMeta([{ id: p.id, deleted: false }]);
                    toast(`Restored ${pageTitle(p.title)}`);
                    load();
                    loadSidebar();
                  }}
                  data-testid="trash-restore"
                >
                  <RotateCcw size={15} />
                </button>
              </Tooltip>
              {p.role === 'full' && (
                <Tooltip label="Delete from Trash">
                  <button
                    className="icon-btn sm"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!(await confirmDialog({ title: 'Are you sure you want to delete this page from Trash?', confirm: 'Yes. Delete this page', danger: true }))) return;
                      await api.del(`/api/pages/${p.id}/permanent`);
                      load();
                    }}
                    data-testid="trash-delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
        <div className="menu-footer">Pages in Trash can be restored at any time.</div>
      </div>
    </Popover>
  );
}
