import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Plus, ChevronsRight, FileText, Star } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { PageIcon, Avatar } from '../components/ui';
import { greeting, pageTitle, timeAgo, coverCss } from '../lib/format';
import { createPage } from '../page/pageActions';
import type { Cover, PageMeta, User } from '../types';

type Recent = PageMeta & { cover: Cover | null; visitedAt: number; updatedAt: number; updatedBy: User | null };

export function HomeView() {
  const me = useApp((s) => s.me)!;
  const workspaceId = useApp((s) => s.workspaceId);
  const favorites = useApp((s) => s.favorites);
  const isMember = useApp((s) => s.isMember);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const setSidebarOpen = useApp((s) => s.setSidebarOpen);
  const navigate = useNavigate();
  const [recent, setRecent] = useState<Recent[] | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    api.get(`/api/workspaces/${workspaceId}/recents`).then((r) => setRecent(r.pages)).catch(() => setRecent([]));
  }, [workspaceId]);

  return (
    <div className="page-view mode-full">
      <div className="topbar">
        {!sidebarOpen && (
          <button className="icon-btn" onClick={() => setSidebarOpen(true)} data-testid="open-sidebar">
            <ChevronsRight size={18} />
          </button>
        )}
        <div className="breadcrumbs">
          <span className="crumb">Home</span>
        </div>
      </div>
      <div className="page-scroller">
        <div className="home" data-testid="home">
          <h1 className="home-greeting">
            {greeting()}, {me.name.split(' ')[0]}
          </h1>
          <section>
            <div className="home-label">
              <Clock size={14} /> Recently visited
            </div>
            <div className="home-cards">
              {recent?.map((p) => (
                <button key={p.id} className="home-card" onClick={() => navigate(`/p/${p.id}`)} data-testid="home-card">
                  <div className="home-card-cover" style={p.cover ? coverCss(p.cover) : undefined} />
                  <div className="home-card-icon">
                    <PageIcon icon={p.icon} type={p.type} size={26} />
                  </div>
                  <div className="home-card-title">{pageTitle(p.title)}</div>
                  <div className="home-card-meta">
                    {p.updatedBy && <Avatar user={p.updatedBy} size={16} />}
                    <span>{timeAgo(p.visitedAt)}</span>
                  </div>
                </button>
              ))}
              {isMember && (
                <button
                  className="home-card new"
                  onClick={async () => {
                    const p = await createPage({ visibility: 'private' });
                    navigate(`/p/${p.id}`);
                  }}
                  data-testid="home-new-page"
                >
                  <div className="home-card-cover" />
                  <div className="home-card-icon">
                    <Plus size={22} />
                  </div>
                  <div className="home-card-title">New page</div>
                </button>
              )}
            </div>
            {recent && recent.length === 0 && <div className="faint small" style={{ marginTop: 8 }}>Pages you visit will show up here.</div>}
          </section>
          {favorites.length > 0 && (
            <section>
              <div className="home-label">
                <Star size={14} /> Favorites
              </div>
              <div className="home-list">
                {favorites.map((f) => (
                  <button key={f.id} className="home-list-item" onClick={() => navigate(`/p/${f.id}`)}>
                    <PageIcon icon={f.icon} type={f.type} size={18} />
                    <span className="ellipsis">{pageTitle(f.title)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section>
            <div className="home-label">
              <FileText size={14} /> Tips
            </div>
            <div className="home-tips">
              <div>
                Press <kbd>Ctrl</kbd> + <kbd>K</kbd> to search every page.
              </div>
              <div>
                Type <kbd>/</kbd> in any page to insert blocks, databases and more.
              </div>
              <div>
                Use <b>Share</b> to invite teammates or publish a page to the web.
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
