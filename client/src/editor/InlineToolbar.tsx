import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, Underline, Strikethrough, Code, Link2, MessageSquare, ChevronDown } from 'lucide-react';
import { useEditor } from './context';
import { Popover, MenuItem, Tooltip } from '../components/ui';
import { ColorMenu } from './BlockMenu';
import { TURN_INTO, BLOCK_LABELS } from './blockTypes';
import { turnInto } from './actions';
import { activeFormats, applyColor, setLink, toggleWrap, wrapDiscussion } from './inline';
import { MOD, uuid } from '../lib/format';

interface ToolbarState {
  blockId: string;
  rect: DOMRect;
}

export function InlineToolbar() {
  const ctx = useEditor();
  const { store } = ctx;
  const [state, setState] = useState<ToolbarState | null>(null);
  const [sub, setSub] = useState<{ kind: 'color' | 'turn' | 'link'; anchor: HTMLElement } | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const savedRange = useRef<Range | null>(null);
  const mouseDown = useRef(false);
  const [, force] = useState(0);

  useEffect(() => {
    const compute = () => {
      if (mouseDown.current) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        if (!sub) setState(null);
        return;
      }
      const node = sel.anchorNode;
      const el = (node?.nodeType === 1 ? (node as Element) : node?.parentElement)?.closest('.rich[data-editable-id]') as HTMLElement | null;
      if (!el || !el.isContentEditable) {
        if (!sub) setState(null);
        return;
      }
      const focusEl = (sel.focusNode?.nodeType === 1 ? (sel.focusNode as Element) : sel.focusNode?.parentElement)?.closest('.rich[data-editable-id]');
      if (focusEl !== el) return;
      const id = el.dataset.editableId!;
      if (!store.blocks.has(id)) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      setState({ blockId: id, rect });
    };
    const onSel = () => compute();
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.inline-toolbar, .popover')) return;
      mouseDown.current = true;
      setState(null);
      setSub(null);
    };
    const onUp = () => {
      if (!mouseDown.current) return;
      mouseDown.current = false;
      setTimeout(compute, 0);
    };
    const onLinkShortcut = () => {
      compute();
      setTimeout(() => {
        const btn = document.querySelector('.inline-toolbar [data-tb="link"]') as HTMLElement | null;
        if (btn) openLink(btn);
      }, 10);
    };
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseup', onUp, true);
    window.addEventListener('editor:link', onLinkShortcut);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('editor:link', onLinkShortcut);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, sub]);

  if (!state || ctx.readOnly) return null;
  const el = store.editables.get(state.blockId);
  const block = store.get(state.blockId);
  if (!el || !block) return null;
  const fmt = activeFormats(el);
  const commit = () => {
    ctx.commitText(state.blockId);
    force((n) => n + 1);
  };
  const exec = (cmd: string) => {
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(cmd);
    commit();
  };
  function openLink(anchor: HTMLElement) {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const a = (sel?.anchorNode?.parentElement as HTMLElement | null)?.closest('a');
    setLinkUrl(a?.getAttribute('href') || '');
    setSub({ kind: 'link', anchor });
  }

  const top = Math.max(8, state.rect.top - 44);
  const left = Math.max(8, Math.min(state.rect.left, window.innerWidth - 470));
  const btn = (key: string, icon: React.ReactNode, label: string, kbd: string | undefined, on: boolean, run: (e: React.MouseEvent<HTMLButtonElement>) => void) => (
    <Tooltip label={label} kbd={kbd} placement="top" key={key}>
      <button className={'tb-btn ' + (on ? 'on' : '')} data-tb={key} onMouseDown={(e) => e.preventDefault()} onClick={run}>
        {icon}
      </button>
    </Tooltip>
  );

  return createPortal(
    <>
      <div className="inline-toolbar" style={{ top, left }} data-testid="inline-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <button className="tb-btn tb-text" onClick={(e) => setSub({ kind: 'turn', anchor: e.currentTarget })}>
          {BLOCK_LABELS[block.type] || 'Text'} <ChevronDown size={12} />
        </button>
        <div className="tb-sep" />
        {ctx.canComment && !ctx.publicMode &&
          btn('comment', <MessageSquare size={15} />, 'Comment', MOD + 'Shift+M', false, () => {
            const id = uuid();
            const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
            const text = wrapDiscussion(el, id);
            commit();
            window.getSelection()?.removeAllRanges();
            setState(null);
            ctx.startInlineComment(state.blockId, id, text, r);
          })}
        {btn('link', <Link2 size={15} />, 'Link', MOD + 'K', fmt.link, (e) => openLink(e.currentTarget))}
        <div className="tb-sep" />
        {btn('bold', <Bold size={15} strokeWidth={2.4} />, 'Bold', MOD + 'B', fmt.bold, () => exec('bold'))}
        {btn('italic', <Italic size={15} />, 'Italicize', MOD + 'I', fmt.italic, () => exec('italic'))}
        {btn('underline', <Underline size={15} />, 'Underline', MOD + 'U', fmt.underline, () => exec('underline'))}
        {btn('strike', <Strikethrough size={15} />, 'Strike-through', MOD + 'Shift+S', fmt.strike, () => exec('strikeThrough'))}
        {btn('code', <Code size={15} />, 'Mark as code', MOD + 'E', fmt.code, () => {
          toggleWrap(el, 'code');
          commit();
        })}
        <div className="tb-sep" />
        <Tooltip label="Text color" placement="top">
          <button className="tb-btn tb-color" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setSub({ kind: 'color', anchor: e.currentTarget })}>
            <span style={{ textDecoration: 'underline', fontWeight: 600 }}>A</span>
            <ChevronDown size={12} />
          </button>
        </Tooltip>
      </div>
      {sub?.kind === 'color' && (
        <Popover anchor={sub.anchor} onClose={() => setSub(null)}>
          <ColorMenu
            onPick={(c) => {
              applyColor(el, c);
              commit();
              setSub(null);
            }}
          />
        </Popover>
      )}
      {sub?.kind === 'turn' && (
        <Popover anchor={sub.anchor} onClose={() => setSub(null)}>
          <div className="menu" style={{ width: 220 }}>
            {TURN_INTO.map((t) => (
              <MenuItem
                key={t.label}
                icon={t.icon}
                label={t.label}
                checked={block.type === t.type && !!block.content.toggleable === !!t.content?.toggleable}
                onClick={() => {
                  turnInto(store, [block.id], t.type, t.content);
                  setSub(null);
                  setState(null);
                }}
              />
            ))}
          </div>
        </Popover>
      )}
      {sub?.kind === 'link' && (
        <Popover anchor={sub.anchor} onClose={() => setSub(null)}>
          <form
            style={{ padding: 8, width: 340, display: 'flex', flexDirection: 'column', gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              setLink(el, linkUrl.trim() || null, savedRange.current);
              commit();
              setSub(null);
            }}
          >
            <input className="input" autoFocus placeholder="Paste link or search pages" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} data-testid="link-input" />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              {fmt.link && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setLink(el, null, savedRange.current);
                    commit();
                    setSub(null);
                  }}
                >
                  Remove link
                </button>
              )}
              <button className="btn btn-primary" type="submit">
                Link
              </button>
            </div>
          </form>
        </Popover>
      )}
    </>,
    document.body,
  );
}
