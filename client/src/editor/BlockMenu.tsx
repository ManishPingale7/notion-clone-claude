import React, { useState } from 'react';
import { Trash2, Copy, Repeat, Palette, Link, CornerUpRight, MessageSquare, ChevronRight, MessageSquareText } from 'lucide-react';
import { useEditor } from './context';
import { Popover, MenuItem } from '../components/ui';
import { PagePicker } from '../components/PagePicker';
import { TURN_INTO, BLOCK_LABELS } from './blockTypes';
import { turnInto, setColor, duplicateBlocks, deleteBlocks } from './actions';
import { isTextual } from './EditorStore';
import { api } from '../api';
import { useApp } from '../store';
import { COLORS, COLOR_NAMES, MOD, timeAgo } from '../lib/format';

export function ColorMenu({ current, onPick }: { current?: string; onPick: (c: string) => void }) {
  return (
    <div className="menu" style={{ width: 220, maxHeight: 420 }}>
      <div className="menu-label">Text color</div>
      {COLORS.map((c) => (
        <MenuItem key={c} icon={<span className={'color-swatch color-' + c}>A</span>} label={COLOR_NAMES[c] + (c === 'default' ? '' : ' text')} checked={(current || 'default') === c} onClick={() => onPick(c)} />
      ))}
      <div className="menu-label">Background color</div>
      {COLORS.map((c) => (
        <MenuItem
          key={'bg' + c}
          icon={<span className={'color-swatch ' + (c === 'default' ? '' : 'bg-' + c)}>A</span>}
          label={COLOR_NAMES[c] + ' background'}
          checked={current === c + '_background'}
          onClick={() => onPick(c === 'default' ? 'default' : c + '_background')}
        />
      ))}
    </div>
  );
}

export function BlockMenu({ anchor, blockId, onClose }: { anchor: DOMRect; blockId: string; onClose: () => void }) {
  const ctx = useEditor();
  const { store } = ctx;
  const toast = useApp((s) => s.toast);
  const people = useApp((s) => s.people);
  const [sub, setSub] = useState<{ kind: 'turn' | 'color' | 'move'; rect: DOMRect } | null>(null);
  const [q, setQ] = useState('');
  const ids = store.selected.has(blockId) ? store.selectedTopLevel() : [blockId];
  const block = store.get(blockId);
  if (!block) return null;
  const allText = ids.every((id) => {
    const b = store.get(id);
    return b && isTextual(b.type);
  });
  const editor = block.updatedBy ? people[block.updatedBy] || ctx.people.find((p) => p.id === block.updatedBy) : null;

  const close = () => {
    setSub(null);
    onClose();
  };

  const items: { key: string; label: string; icon: React.ReactNode; right?: React.ReactNode; run?: (e: React.MouseEvent) => void; sub?: 'turn' | 'color' | 'move'; danger?: boolean; hide?: boolean }[] = [
    { key: 'turn', label: 'Turn into', icon: <Repeat size={16} />, sub: 'turn', hide: !allText, right: <ChevronRight size={14} /> },
    { key: 'color', label: 'Color', icon: <Palette size={16} />, sub: 'color', right: <ChevronRight size={14} /> },
    {
      key: 'link',
      label: 'Copy link to block',
      icon: <Link size={16} />,
      right: <span>Alt+Shift+L</span>,
      run: () => {
        navigator.clipboard?.writeText(`${location.origin}/p/${store.pageId}#${blockId}`);
        toast('Copied link to clipboard');
        close();
      },
    },
    {
      key: 'dup',
      label: 'Duplicate',
      icon: <Copy size={16} />,
      right: <span>{MOD}D</span>,
      run: () => {
        const n = duplicateBlocks(store, ids);
        store.setSelected(n);
        close();
      },
    },
    { key: 'move', label: 'Move to', icon: <CornerUpRight size={16} />, sub: 'move', right: <span>{MOD}Shift+P</span> },
    {
      key: 'caption',
      label: 'Caption',
      icon: <MessageSquareText size={16} />,
      hide: !['image', 'video', 'audio', 'file', 'bookmark', 'code'].includes(block.type) || ids.length > 1,
      run: () => {
        store.setContent(blockId, { caption: block.content.caption || ' ' });
        close();
      },
    },
    {
      key: 'comment',
      label: 'Comment',
      icon: <MessageSquare size={16} />,
      right: <span>{MOD}Shift+M</span>,
      hide: !ctx.canComment || ctx.publicMode,
      run: () => {
        const el = document.querySelector(`[data-block-id="${blockId}"]`);
        ctx.openDiscussion(blockId, (el || document.body).getBoundingClientRect());
        close();
      },
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <Trash2 size={16} />,
      right: <span>Del</span>,
      danger: true,
      run: () => {
        deleteBlocks(store, ids);
        close();
      },
    },
  ];
  const visible = items.filter((i) => !i.hide && (!q || i.label.toLowerCase().includes(q.toLowerCase())));
  const filteredTurn = q ? TURN_INTO.filter((t) => t.label.toLowerCase().includes(q.toLowerCase())) : [];

  return (
    <Popover anchor={anchor} onClose={close} placement="left-start" offset={6}>
      <div style={{ width: 265 }} data-testid="block-menu">
        <div className="menu-search">
          <input className="input" autoFocus placeholder="Search actions…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="menu" style={{ paddingTop: 0 }}>
          <div className="menu-label">{ids.length > 1 ? `${ids.length} blocks` : BLOCK_LABELS[block.type] || block.type.replace(/_/g, ' ')}</div>
          {visible.map((it) => (
            <MenuItem
              key={it.key}
              icon={it.icon}
              label={it.label}
              right={it.right}
              danger={it.danger}
              onMouseEnter={(e) => {
                if (it.sub) setSub({ kind: it.sub, rect: e.currentTarget.getBoundingClientRect() });
                else setSub(null);
              }}
              onClick={(e) => {
                if (it.sub) setSub({ kind: it.sub, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                else it.run?.(e);
              }}
              testId={'block-menu-' + it.key}
            />
          ))}
          {filteredTurn.length > 0 && allText && (
            <>
              <div className="menu-label">Turn into</div>
              {filteredTurn.map((t) => (
                <MenuItem
                  key={t.label}
                  icon={t.icon}
                  label={t.label}
                  onClick={() => {
                    turnInto(store, ids, t.type, t.content);
                    close();
                  }}
                />
              ))}
            </>
          )}
        </div>
        {editor && block.updatedAt && (
          <div className="menu-footer">
            <div>Last edited by {editor.name}</div>
            <div>{timeAgo(block.updatedAt)}</div>
          </div>
        )}
      </div>
      {sub && sub.kind === 'turn' && (
        <Popover anchor={sub.rect} onClose={() => setSub(null)} placement="right-start">
          <div className="menu" style={{ width: 220 }} data-testid="turn-into-menu">
            {TURN_INTO.map((t) => (
              <MenuItem
                key={t.label}
                icon={t.icon}
                label={t.label}
                checked={block.type === t.type && !!block.content.toggleable === !!t.content?.toggleable}
                onClick={() => {
                  turnInto(store, ids, t.type, t.content);
                  close();
                }}
              />
            ))}
          </div>
        </Popover>
      )}
      {sub && sub.kind === 'color' && (
        <Popover anchor={sub.rect} onClose={() => setSub(null)} placement="right-start">
          <ColorMenu
            current={block.content.color}
            onPick={(c) => {
              setColor(store, ids, c);
              close();
            }}
          />
        </Popover>
      )}
      {sub && sub.kind === 'move' && (
        <Popover anchor={sub.rect} onClose={() => setSub(null)} placement="right-start">
          <PagePicker
            placeholder="Move blocks to…"
            exclude={[store.pageId]}
            filter={(p) => p.type === 'page'}
            onlyPages
            onPick={async (p) => {
              close();
              try {
                await store.flush();
                await api.post(`/api/pages/${store.pageId}/move-blocks`, { targetPageId: p.id, blockIds: ids });
                store.applyRemote(ids.map((id) => ({ type: 'delete' as const, id })));
                store.clearSelection();
                toast(`Moved to ${p.title || 'Untitled'}`, { action: { label: 'Open', run: () => ctx.navigate(p.id) } });
              } catch (e: any) {
                toast(e.message, { kind: 'error' });
              }
            }}
          />
        </Popover>
      )}
    </Popover>
  );
}
