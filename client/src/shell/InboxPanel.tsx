import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, CheckCheck, X, Inbox as InboxIcon } from 'lucide-react';
import { api } from '../api';
import { realtime } from '../realtime';
import { useApp } from '../store';
import type { Notification } from '../types';
import { Avatar, PageIcon, Tooltip } from '../components/ui';
import { pageTitle, timeAgo } from '../lib/format';

function describe(n: Notification) {
  const who = n.actor?.name || 'Someone';
  const page = n.page ? pageTitle(n.page.title) : '';
  switch (n.type) {
    case 'mention':
      return <><b>{who}</b> mentioned you in <b>{page}</b></>;
    case 'comment':
      return <><b>{who}</b> commented in <b>{page}</b></>;
    case 'comment_mention':
      return <><b>{who}</b> mentioned you in a comment in <b>{page}</b></>;
    case 'page_shared':
      return <><b>{who}</b> invited you to <b>{page}</b></>;
    case 'assigned':
      return <><b>{who}</b> added you to <b>{n.data.property || 'a property'}</b> in <b>{page}</b></>;
    case 'workspace_joined':
      return <><b>{who}</b> added you to the workspace <b>{n.workspace?.name}</b></>;
    default:
      return <><b>{who}</b> updated <b>{page}</b></>;
  }
}

export function InboxPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'inbox' | 'archived'>('inbox');
  const [items, setItems] = useState<Notification[]>([]);
  const loadUnread = useApp((s) => s.loadUnread);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const workspaceId = useApp((s) => s.workspaceId);
  const navigate = useNavigate();
  const load = () => api.get(`/api/notifications${tab === 'archived' ? '?archived=1' : ''}`).then((r) => setItems(r.notifications));
  useEffect(() => {
    load();
    const off = realtime.on((m) => m.type === 'notification' && load());
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const open = async (n: Notification) => {
    if (!n.read) await api.post('/api/notifications/read', { ids: [n.id] });
    loadUnread();
    if (n.workspace && n.workspace.id !== workspaceId && n.type === 'workspace_joined') setWorkspace(n.workspace.id);
    if (n.page) navigate(`/p/${n.page.id}`);
    else if (n.workspace) {
      setWorkspace(n.workspace.id);
      navigate('/');
    }
    load();
  };
  return (
    <aside className="inbox-panel" data-testid="inbox">
      <div className="inbox-head">
        <span style={{ fontWeight: 600 }}>Inbox</span>
        <div style={{ flex: 1 }} />
        <Tooltip label="Mark all as read">
          <button
            className="icon-btn sm"
            onClick={async () => {
              await api.post('/api/notifications/read', { all: true });
              loadUnread();
              load();
            }}
          >
            <CheckCheck size={16} />
          </button>
        </Tooltip>
        <Tooltip label="Archive all">
          <button
            className="icon-btn sm"
            onClick={async () => {
              await api.post('/api/notifications/archive', { all: true });
              loadUnread();
              load();
            }}
          >
            <Archive size={16} />
          </button>
        </Tooltip>
        <button className="icon-btn sm" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="inbox-tabs">
        <button className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>
          Inbox
        </button>
        <button className={tab === 'archived' ? 'on' : ''} onClick={() => setTab('archived')}>
          Archived
        </button>
      </div>
      <div className="inbox-list">
        {!items.length && (
          <div className="empty-state">
            <InboxIcon size={32} strokeWidth={1.3} />
            <div style={{ marginTop: 8 }}>You're all caught up</div>
            <div className="small">Mentions, comments, and invites will show up here.</div>
          </div>
        )}
        {items.map((n) => (
          <div key={n.id} className={'inbox-item ' + (n.read ? '' : 'unread')} onClick={() => open(n)} data-testid="inbox-item">
            <Avatar user={n.actor} size={28} />
            <div className="grow">
              <div className="inbox-text">{describe(n)}</div>
              {n.data.text && <div className="inbox-snippet">{n.data.text}</div>}
              {n.page && (
                <div className="inbox-page">
                  <PageIcon icon={n.page.icon} type={n.page.type} size={14} /> {pageTitle(n.page.title)}
                </div>
              )}
              <div className="faint small">{timeAgo(n.createdAt)}</div>
            </div>
            {tab === 'inbox' && (
              <button
                className="icon-btn sm inbox-archive"
                onClick={async (e) => {
                  e.stopPropagation();
                  await api.post('/api/notifications/archive', { ids: [n.id] });
                  loadUnread();
                  load();
                }}
                title="Archive"
              >
                <Archive size={14} />
              </button>
            )}
            {!n.read && <span className="unread-dot" />}
          </div>
        ))}
      </div>
    </aside>
  );
}
