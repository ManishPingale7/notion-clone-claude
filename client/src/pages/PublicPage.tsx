import React, { useEffect, useState } from 'react';
import { PublicDataContext } from '../lib/publicCtx';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { api } from '../api';
import { ReadOnlyBlocks } from '../editor/ReadOnlyBlocks';
import { DatabaseView } from '../database/DatabaseView';
import { PageIcon, Loading } from '../components/ui';
import { coverCss, pageTitle } from '../lib/format';
import { PropertyDisplay } from '../database/Property';
import { makeCtx, propIcon } from '../database/dbUtils';
import type { Block, DatabaseData, DbSchema, Page, PageMeta } from '../types';
import { applyTheme, useApp } from '../store';

interface PublicData {
  page: Page;
  blocks: Block[];
  pages: Record<string, PageMeta>;
  database: { id: string; title: string; icon: string | null; schema: DbSchema } | null;
  data: DatabaseData | null;
  inline: Record<string, DatabaseData>;
  ancestors: PageMeta[];
  workspace: { id: string; name: string; icon: string | null };
}


export function PublicPage() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const me = useApp((s) => s.me);
  const [data, setData] = useState<PublicData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    setData(null);
    setError(null);
    api
      .get(`/api/public/pages/${pageId}`)
      .then((d) => {
        setData(d);
        document.title = `${pageTitle(d.page.title)}`;
      })
      .catch((e) => setError(e.message));
  }, [pageId]);
  if (error)
    return (
      <div className="public-error">
        <div style={{ fontSize: 40 }}>🌐</div>
        <h2>This page is not published</h2>
        <p className="faint">The owner may have unpublished it, or the link is wrong.</p>
        <Link to="/" className="btn btn-outline">
          Go to Notion
        </Link>
      </div>
    );
  if (!data) return <Loading />;
  const p = data.page;
  const go = (id: string) => navigate(`/share/${id}`);
  return (
    <PublicDataContext.Provider value={data.inline}>
      <div className="public-page" data-testid="public-page">
        <div className="topbar public-topbar">
          <div className="breadcrumbs">
            {[...data.ancestors, p].map((a, i) => (
              <React.Fragment key={a.id}>
                {i > 0 && <span className="crumb-sep">/</span>}
                <button className="crumb" onClick={() => go(a.id)}>
                  {a.icon && <PageIcon icon={a.icon} size={16} />}
                  <span className="ellipsis">{pageTitle(a.title)}</span>
                </button>
              </React.Fragment>
            ))}
          </div>
          <div className="topbar-right">
            <button
              className="icon-btn"
              onClick={() => {
                applyTheme(dark ? 'light' : 'dark');
                setDark(!dark);
              }}
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {me ? (
              <Link className="btn btn-outline" to={`/p/${p.id}`}>
                Open in app
              </Link>
            ) : (
              <Link className="btn btn-outline" to="/login">
                Log in
              </Link>
            )}
          </div>
        </div>
        <div className="page-scroller">
          <div className={`page-body ${p.format.fullWidth || p.type === 'database' ? 'full-width' : ''} ${p.format.font === 'serif' ? 'font-serif' : p.format.font === 'mono' ? 'font-mono' : ''}`}>
            <div className={'page-header ' + (p.cover ? 'has-cover ' : '') + (p.icon ? 'has-icon' : '')}>
              {p.cover && <div className="page-cover" style={coverCss(p.cover)} />}
              <div className="page-header-inner">
                {p.icon && (
                  <div className="page-icon">
                    <PageIcon icon={p.icon} size={78} />
                  </div>
                )}
                <div className="page-title">{pageTitle(p.title)}</div>
              </div>
            </div>
            <div className="page-content">
              {data.database && p.parentType === 'database' && <PublicRowProps page={p} schema={data.database.schema} />}
              {p.type === 'database' && data.data ? (
                <DatabaseView databaseId={p.id} publicMode publicData={data.data} fullPage />
              ) : (
                <ReadOnlyBlocks blocks={data.blocks} pages={data.pages} pageId={p.id} workspaceId={data.workspace.id} navigate={go} publicMode ancestors={data.ancestors} self={{ id: p.id, title: p.title, icon: p.icon }} />
              )}
            </div>
          </div>
        </div>
      </div>
    </PublicDataContext.Provider>
  );
}

function PublicRowProps({ page, schema }: { page: Page; schema: DbSchema }) {
  const ctx = makeCtx({ database: { schema } as any, rows: [page], people: [], related: {}, views: [], previews: {}, role: 'view' } as DatabaseData, schema);
  return (
    <div className="page-properties">
      {schema.order
        .map((id) => schema.properties[id])
        .filter((d) => d && d.type !== 'title')
        .map((def) => (
          <div key={def.id} className="prop-row">
            <div className="prop-label">
              <span className="prop-label-icon">{propIcon(def.type)}</span>
              <span className="ellipsis">{def.name}</span>
            </div>
            <div className="prop-value readonly">
              <PropertyDisplay def={def} row={page} ctx={ctx} wrap />
            </div>
          </div>
        ))}
      <div className="page-properties-divider" />
    </div>
  );
}
