import React, { useContext } from 'react';
import { PublicDataContext } from '../../lib/publicCtx';
import { ArrowUpRight, Lock } from 'lucide-react';
import type { Block } from '../../types';
import { useEditor } from '../context';
import { useApp } from '../../store';
import { PageIcon } from '../../components/ui';
import { pageTitle } from '../../lib/format';
import { DatabaseView } from '../../database/DatabaseView';

export function usePageMeta(pageId: string) {
  const ctx = useEditor();
  const global = useApp((s) => s.pageMeta[pageId]);
  const local = ctx.pages[pageId];
  if (!global && !local) return undefined;
  return { ...local, ...global, deleted: global?.deleted ?? local?.deleted, noAccess: local?.noAccess && !global };
}

export function PageBlock({ block }: { block: Block }) {
  const ctx = useEditor();
  const meta = usePageMeta(block.content.pageId);
  if (block.type === 'page' && (!meta || meta.deleted)) {
    return meta?.deleted ? null : <div className="page-link faint">Loading…</div>;
  }
  const noAccess = !meta || meta.noAccess;
  const deleted = meta?.deleted;
  return (
    <div
      className={'page-link ' + (noAccess || deleted ? 'disabled' : '')}
      role="link"
      data-testid="page-block"
      onClick={() => !noAccess && !deleted && ctx.navigate(block.content.pageId)}
    >
      <span className="page-link-icon">
        {noAccess ? <Lock size={16} strokeWidth={1.6} /> : <PageIcon icon={meta?.icon} type={meta?.type} size={20} />}
        {block.type === 'link_to_page' && !noAccess && <ArrowUpRight className="link-arrow" size={10} strokeWidth={3} />}
      </span>
      <span className="page-link-title">{noAccess ? 'No access' : deleted ? 'Deleted page' : pageTitle(meta?.title)}</span>
    </div>
  );
}

export function ChildDatabaseBlock({ block }: { block: Block }) {
  const ctx = useEditor();
  const meta = usePageMeta(block.content.pageId);
  const pub = useContext(PublicDataContext);
  if (ctx.publicMode) {
    const d = pub[block.content.pageId];
    if (!d) return null;
    return (
      <div className="inline-db" contentEditable={false}>
        <DatabaseView databaseId={block.content.pageId} inline publicMode publicData={d} />
      </div>
    );
  }
  if (!meta || meta.deleted) return null;
  if (meta.noAccess) return <div className="page-link disabled"><Lock size={16} /> No access</div>;
  if (!meta.isInline) return <PageBlock block={block} />;
  return (
    <div className="inline-db" contentEditable={false}>
      <DatabaseView databaseId={block.content.pageId} inline readOnly={ctx.readOnly} publicMode={ctx.publicMode} />
    </div>
  );
}
