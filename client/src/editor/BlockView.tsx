import React, { memo, useState } from 'react';
import { Plus, GripVertical, ChevronRight, MessageSquare } from 'lucide-react';
import type { Block } from '../types';
import { useEditor, useStoreValue, shallowArrayEq } from './context';
import { RichText } from './RichText';
import { dragState } from './dnd';
import { BlockMenu } from './BlockMenu';
import { CodeBlock } from './blocks/CodeBlock';
import { MediaBlock } from './blocks/MediaBlock';
import { BookmarkBlock, EmbedBlock } from './blocks/BookmarkBlock';
import { PageBlock, ChildDatabaseBlock } from './blocks/PageBlock';
import { EquationBlock } from './blocks/EquationBlock';
import { TableBlock } from './blocks/TableBlock';
import { TocBlock, BreadcrumbBlock } from './blocks/MiscBlocks';
import { EmojiPicker } from '../components/EmojiPicker';
import { Popover, Tooltip } from '../components/ui';
import { MOD } from '../lib/format';

const PLACEHOLDERS: Record<string, string> = {
  heading_1: 'Heading 1',
  heading_2: 'Heading 2',
  heading_3: 'Heading 3',
  bulleted_list: 'List',
  numbered_list: 'List',
  to_do: 'To-do',
  toggle: 'Toggle',
  quote: 'Empty quote',
  callout: 'Type something…',
};

function toRoman(n: number) {
  const map: [number, string][] = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) (out += s), (n -= v);
  return out;
}

function listMarker(n: number, depth: number) {
  const m = depth % 3;
  if (m === 0) return `${n}.`;
  if (m === 1) return `${String.fromCharCode(96 + (((n - 1) % 26) + 1))}.`;
  return `${toRoman(n)}.`;
}

export function BlockChildren({ parentId, depth = 0 }: { parentId: string | null; depth?: number }) {
  const { store } = useEditor();
  const ids = useStoreValue(store, () => store.children(parentId).map((b) => b.id), shallowArrayEq);
  const types = useStoreValue(store, () => store.children(parentId).map((b) => b.type), shallowArrayEq);
  let n = 0;
  return (
    <>
      {ids.map((id, i) => {
        n = types[i] === 'numbered_list' ? n + 1 : 0;
        return <BlockView key={id} id={id} number={n} depth={depth} />;
      })}
    </>
  );
}

export const BlockView = memo(function BlockView({ id, number, depth }: { id: string; number: number; depth: number }) {
  const ctx = useEditor();
  const { store, readOnly } = ctx;
  const block = useStoreValue(store, () => store.get(id));
  const selected = useStoreValue(store, () => store.selected.has(id));
  const open = useStoreValue(store, () => {
    const b = store.get(id);
    return b ? store.isOpen(b) : false;
  });
  const hasChildren = useStoreValue(store, () => store.children(id).length > 0);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  if (!block) return null;

  const discussions = (ctx.discussionsByBlock[id] || []).filter((d) => !d.resolved);
  const presence = ctx.presenceByBlock[id];
  const color = block.content.color as string | undefined;
  const colorAttrs: Record<string, string> = {};
  if (color) {
    if (color.endsWith('_background')) colorAttrs['data-bg'] = color.replace('_background', '');
    else colorAttrs['data-color'] = color;
  }

  if (block.type === 'column_list') {
    return (
      <div className={'block-wrap column-list ' + (selected ? 'selected' : '')} data-block-id={id}>
        <ColumnList id={id} depth={depth} />
      </div>
    );
  }

  const toggleable = block.type === 'toggle' || (block.type.startsWith('heading_') && block.content.toggleable);
  const showChildren = block.type !== 'callout' && block.type !== 'quote' && store.hasChildrenArea(block) && (!toggleable || open);

  const onHandleDragStart = (e: React.DragEvent) => {
    const ids = store.selected.has(id) ? store.selectedTopLevel() : [id];
    dragState.blockIds = ids;
    dragState.pageId = store.pageId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ids.join(','));
    const el = (e.currentTarget as HTMLElement).closest('.block-wrap') as HTMLElement;
    if (el) e.dataTransfer.setDragImage(el, 0, 10);
    if (!store.selected.has(id)) store.setSelected([id]);
  };

  const addBelow = (e: React.MouseEvent) => {
    let newId = '';
    const insertAbove = e.altKey;
    store.transact((tx) => {
      newId = tx.insert({ type: 'text', content: { text: '' } }, insertAbove ? { before: id } : { after: id }).id;
    });
    store.requestFocus({ id: newId, at: 0 });
    setTimeout(() => {
      const el = store.editables.get(newId);
      if (el) {
        el.focus();
        document.execCommand('insertText', false, '/');
      }
    }, 30);
  };

  const content = (() => {
    switch (block.type) {
      case 'text':
        return <RichText block={block} className="t-text" placeholder={`Write something, or press '/' for commands…`} />;
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        return (
          <div className="row-flex">
            {toggleable && <ToggleArrow open={open} onClick={() => store.setOpen(id, !open)} big={block.type !== 'heading_3'} />}
            <RichText block={block} className={'t-' + block.type} placeholder={PLACEHOLDERS[block.type]} alwaysPlaceholder />
          </div>
        );
      case 'bulleted_list':
        return (
          <div className="row-flex">
            <div className="list-marker bullet">{['•', '◦', '▪'][depth % 3]}</div>
            <RichText block={block} className="t-text" placeholder="List" />
          </div>
        );
      case 'numbered_list':
        return (
          <div className="row-flex">
            <div className="list-marker number">{listMarker(number || 1, depth)}</div>
            <RichText block={block} className="t-text" placeholder="List" />
          </div>
        );
      case 'to_do':
        return (
          <div className={'row-flex todo ' + (block.content.checked ? 'checked' : '')}>
            <div className="todo-box-wrap">
              <span
                className={'checkbox ' + (block.content.checked ? 'checked' : '')}
                role="checkbox"
                aria-checked={!!block.content.checked}
                onClick={() => !readOnly && store.setContent(id, { checked: !block.content.checked })}
              >
                {block.content.checked && (
                  <svg viewBox="0 0 14 14" width="12" height="12">
                    <polygon fill="currentColor" points="5.5 11.9993304 14 3.49933039 12.5 2 5.5 8.99933039 1.5 4.9968652 0 6.49933039" />
                  </svg>
                )}
              </span>
            </div>
            <RichText block={block} className="t-text" placeholder="To-do" />
          </div>
        );
      case 'toggle':
        return (
          <div className="row-flex">
            <ToggleArrow open={open} onClick={() => store.setOpen(id, !open)} />
            <RichText block={block} className="t-text" placeholder="Toggle" />
          </div>
        );
      case 'quote':
        return (
          <div className="quote">
            <RichText block={block} className="t-quote" placeholder="Empty quote" />
            {hasChildren && (
              <div className="nested">
                <BlockChildren parentId={id} depth={depth + 1} />
              </div>
            )}
          </div>
        );
      case 'callout':
        return (
          <div className={'callout ' + (color ? '' : 'callout-default')} {...(color?.endsWith('_background') ? { 'data-bg': color.replace('_background', '') } : {})}>
            <button className="callout-icon" onClick={(e) => !readOnly && setIconAnchor(e.currentTarget)} disabled={readOnly}>
              {block.content.icon || '💡'}
            </button>
            <div className="callout-body">
              <RichText block={block} className="t-text" placeholder="Type something…" />
              {hasChildren && <BlockChildren parentId={id} depth={depth + 1} />}
            </div>
            {iconAnchor && (
              <Popover anchor={iconAnchor} onClose={() => setIconAnchor(null)}>
                <EmojiPicker
                  onPick={(emoji) => {
                    store.setContent(id, { icon: emoji });
                    setIconAnchor(null);
                  }}
                  onRemove={() => {
                    store.setContent(id, { icon: '💡' });
                    setIconAnchor(null);
                  }}
                />
              </Popover>
            )}
          </div>
        );
      case 'divider':
        return (
          <div className="divider-block" onClick={() => store.setSelected([id])}>
            <div className="divider-line" />
          </div>
        );
      case 'code':
        return <CodeBlock block={block} />;
      case 'image':
      case 'video':
      case 'audio':
      case 'file':
        return <MediaBlock block={block} />;
      case 'bookmark':
        return <BookmarkBlock block={block} />;
      case 'embed':
        return <EmbedBlock block={block} />;
      case 'page':
      case 'link_to_page':
        return <PageBlock block={block} />;
      case 'child_database':
        return <ChildDatabaseBlock block={block} />;
      case 'equation':
        return <EquationBlock block={block} />;
      case 'table':
        return <TableBlock block={block} />;
      case 'table_of_contents':
        return <TocBlock block={block} />;
      case 'breadcrumb':
        return <BreadcrumbBlock />;
      default:
        return <div className="faint">Unsupported block</div>;
    }
  })();

  return (
    <div
      className={`block-wrap type-${block.type} ${selected ? 'selected' : ''} ${presence ? 'has-presence' : ''}`}
      data-block-id={id}
      style={presence ? ({ '--presence-color': presence[0].color } as React.CSSProperties) : undefined}
    >
      <div className={'block-row ' + (color && !color.endsWith('_background') ? '' : '')} {...(block.type === 'callout' ? {} : colorAttrs)}>
        {!readOnly && (
          <div className="block-gutter" contentEditable={false}>
            <Tooltip label={<><div>Click to add below</div><div className="faint" style={{ color: 'rgba(255,255,255,.55)' }}>Alt-click to add a block above</div></>}>
              <button className="gutter-btn" onClick={addBelow} aria-label="Add block">
                <Plus size={16} strokeWidth={1.8} />
              </button>
            </Tooltip>
            <Tooltip label={<><div>Drag to move</div><div style={{ color: 'rgba(255,255,255,.55)' }}>Click to open menu</div></>}>
              <button
                className="gutter-btn drag-handle"
                draggable
                onDragStart={onHandleDragStart}
                onClick={(e) => {
                  if (!store.selected.has(id)) store.setSelected([id]);
                  setMenuAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                }}
                aria-label="Block menu"
                data-testid="block-handle"
              >
                <GripVertical size={16} strokeWidth={1.8} />
              </button>
            </Tooltip>
          </div>
        )}
        <div className="block-content">{content}</div>
        {discussions.length > 0 && (
          <button className="block-comments" onClick={(e) => ctx.openDiscussion(id, e.currentTarget.getBoundingClientRect())}>
            <MessageSquare size={14} strokeWidth={1.8} />
            <span>{discussions.reduce((n, d) => n + d.comments.length, 0)}</span>
          </button>
        )}
        {presence && (
          <div className="block-presence" title={presence.map((p) => p.name).join(', ')}>
            {presence.slice(0, 2).map((p, i) => (
              <span key={i} className="avatar" style={{ width: 18, height: 18, fontSize: 10, background: p.color }}>
                {p.name.charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </div>
      {showChildren && (hasChildren || (toggleable && open)) && (
        <div className={'block-children ' + (toggleable ? 'toggle-children' : '')}>
          {hasChildren ? (
            <BlockChildren parentId={id} depth={depth + 1} />
          ) : (
            !readOnly && (
              <div
                className="empty-toggle"
                onClick={() => {
                  let nid = '';
                  store.transact((tx) => (nid = tx.insert({ type: 'text', content: { text: '' } }, { parentId: id }).id));
                  store.requestFocus({ id: nid, at: 0 });
                }}
              >
                Empty toggle. Click or drop blocks inside.
              </div>
            )
          )}
        </div>
      )}
      {menuAnchor && <BlockMenu anchor={menuAnchor} blockId={id} onClose={() => setMenuAnchor(null)} />}
    </div>
  );
});

function ToggleArrow({ open, onClick, big }: { open: boolean; onClick: () => void; big?: boolean }) {
  return (
    <div className={'toggle-arrow-wrap ' + (big ? 'big' : '')} contentEditable={false}>
      <button className={'toggle-arrow ' + (open ? 'open' : '')} onClick={onClick} aria-label={open ? 'Collapse' : 'Expand'} data-testid="toggle-arrow">
        <svg viewBox="0 0 100 100" width="12" height="12">
          <polygon points="5.9,88.2 50,11.8 94.1,88.2" fill="currentColor" transform="rotate(90 50 50)" />
        </svg>
      </button>
    </div>
  );
}

function ColumnList({ id, depth }: { id: string; depth: number }) {
  const { store } = useEditor();
  const cols = useStoreValue(store, () => store.children(id).map((b) => b.id), shallowArrayEq);
  return (
    <div className="columns">
      {cols.map((cid) => (
        <div key={cid} className="column" data-column-id={cid}>
          <BlockChildren parentId={cid} depth={depth} />
        </div>
      ))}
    </div>
  );
}

void ChevronRight;
void MOD;
