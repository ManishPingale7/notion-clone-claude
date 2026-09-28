import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../store';
import { realtime } from '../realtime';
import { Sidebar } from './Sidebar';
import { SearchModal } from './SearchModal';
import { SettingsModal } from './SettingsModal';
import { InboxPanel } from './InboxPanel';
import { HomeView } from './HomeView';
import { PageView } from '../page/PageView';
import { hasOpenPopover } from '../components/ui';

export function AppShell() {
  const { pageId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const s = useApp();
  const [inboxOpen, setInboxOpen] = useState(false);
  const [hoverSidebar, setHoverSidebar] = useState(false);
  const sidebarTimer = useRef(0);
  const isNarrow = useIsNarrow();

  // realtime connection & workspace room
  useEffect(() => {
    realtime.connect();
    return () => realtime.disconnect();
  }, []);

  useEffect(() => {
    if (!s.workspaceId) return;
    s.loadSidebar();
    s.loadUnread();
    const unsub = realtime.subscribe('ws:' + s.workspaceId);
    let t = 0;
    const off = realtime.on((m) => {
      if (m.type === 'pages.changed' || m.type === 'favorites.changed' || m.type === 'reconnected') {
        window.clearTimeout(t);
        t = window.setTimeout(() => useApp.getState().loadSidebar(), 150);
      } else if (m.type === 'workspaces.changed' || m.type === 'workspace.updated') {
        useApp.getState().refreshWorkspaces().then(() => useApp.getState().loadSidebar());
      } else if (m.type === 'notification') {
        useApp.getState().loadUnread();
      } else if (m.type === 'workspace.deleted') {
        useApp.getState().refreshWorkspaces();
        navigate('/');
      }
    });
    return () => {
      off();
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.workspaceId]);

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'p' || e.key === 'K' || e.key === 'P')) {
        e.preventDefault();
        useApp.getState().set({ searchOpen: true });
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        const st = useApp.getState();
        st.setSidebarOpen(!st.sidebarOpen);
      } else if (mod && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        const st = useApp.getState();
        const dark = document.documentElement.dataset.theme === 'dark';
        st.setTheme(dark ? 'light' : 'dark');
      } else if (e.key === 'Escape' && params.get('p') && !hasOpenPopover() && !(document.activeElement as HTMLElement)?.isContentEditable) {
        closePeek();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const peekId = params.get('p');
  const peekStyle = params.get('peek') === 'center' ? 'center' : 'side';
  const closePeek = () => {
    const next = new URLSearchParams(params);
    next.delete('p');
    next.delete('peek');
    setParams(next);
  };
  const sidebarVisible = s.sidebarOpen && !isNarrow;

  return (
    <div className={'app ' + (sidebarVisible ? 'with-sidebar' : 'no-sidebar')}>
      {sidebarVisible && <Sidebar onOpenInbox={() => setInboxOpen((v) => !v)} />}
      {!sidebarVisible && (
        <>
          <div
            className="sidebar-hover-zone"
            onMouseEnter={() => {
              window.clearTimeout(sidebarTimer.current);
              setHoverSidebar(true);
            }}
          />
          {(hoverSidebar || (isNarrow && s.sidebarOpen)) && (
            <div
              className={'sidebar-float ' + (isNarrow && s.sidebarOpen ? 'mobile' : '')}
              onMouseLeave={() => {
                sidebarTimer.current = window.setTimeout(() => setHoverSidebar(false), 200);
              }}
              onMouseEnter={() => window.clearTimeout(sidebarTimer.current)}
            >
              <Sidebar
                peekFloating
                onOpenInbox={() => {
                  setInboxOpen((v) => !v);
                  setHoverSidebar(false);
                }}
              />
            </div>
          )}
          {isNarrow && s.sidebarOpen && <div className="mobile-scrim" onClick={() => s.setSidebarOpen(false)} />}
        </>
      )}
      {inboxOpen && <InboxPanel onClose={() => setInboxOpen(false)} />}
      <main className="main" onClick={() => isNarrow && s.sidebarOpen && s.setSidebarOpen(false)}>
        {pageId ? <PageView key={pageId} pageId={pageId} /> : <HomeView />}
      </main>
      {peekId && (
        <PeekLayer style={peekStyle} onClose={closePeek}>
          <PageView
            key={peekId}
            pageId={peekId}
            mode="peek"
            peekStyle={peekStyle}
            onClosePeek={closePeek}
            onPeekStyle={(st) => {
              if (st === 'full') {
                navigate(`/p/${peekId}`);
                return;
              }
              const next = new URLSearchParams(params);
              if (st === 'center') next.set('peek', 'center');
              else next.delete('peek');
              setParams(next);
            }}
          />
        </PeekLayer>
      )}
      {s.searchOpen && <SearchModal />}
      {s.settingsTab && <SettingsModal />}
    </div>
  );
}

function PeekLayer({ style, onClose, children }: { style: 'side' | 'center'; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (style !== 'side') return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.peek-side, .popover, .modal, .overlay, .toasts, .tooltip, .db-view, .inline-toolbar')) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [style, onClose]);
  if (style === 'center') {
    return (
      <div className="peek-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="peek-center" data-testid="peek">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="peek-side" data-testid="peek">
      {children}
    </div>
  );
}

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 800);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 800);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return narrow;
}
