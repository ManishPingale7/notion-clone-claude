import React from 'react';
import type { Block } from '../../types';
import { useEditor, useStoreValue } from '../context';
import { htmlToText, pageTitle } from '../../lib/format';
import { PageIcon } from '../../components/ui';

export function TocBlock({ block }: { block: Block }) {
  const { store } = useEditor();
  const headings = useStoreValue(
    store,
    () =>
      store
        .visibleOrder()
        .filter((b) => b.type.startsWith('heading_'))
        .map((b) => `${b.id}|${b.type}|${htmlToText(b.content.text)}`)
        .join('\n'),
  );
  const items = headings ? headings.split('\n').map((l) => l.split('|')) : [];
  const color = block.content.color;
  return (
    <div className="toc" data-color={color && !color.endsWith('_background') ? color : undefined}>
      {items.length === 0 && <div className="faint">Add headings to create a table of contents.</div>}
      {items.map(([id, type, text]) => (
        <a
          key={id}
          className={'toc-item level-' + type.slice(-1)}
          onClick={(e) => {
            e.preventDefault();
            const el = document.querySelector(`[data-block-id="${id}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el?.classList.add('flash');
            setTimeout(() => el?.classList.remove('flash'), 1200);
          }}
          href={'#' + id}
        >
          {text || 'Untitled'}
        </a>
      ))}
    </div>
  );
}

export function BreadcrumbBlock() {
  const ctx = useEditor();
  const items = [...ctx.ancestors.filter((a) => a.accessible !== false), ctx.pageMetaSelf];
  return (
    <div className="breadcrumb-block">
      {items.map((p, i) => (
        <React.Fragment key={p.id}>
          {i > 0 && <span className="faint">/</span>}
          <span className="crumb" onClick={() => ctx.navigate(p.id)}>
            <PageIcon icon={p.icon} type={p.type} size={16} />
            <span>{pageTitle(p.title)}</span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}
