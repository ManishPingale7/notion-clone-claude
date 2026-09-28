import React, { useRef, useState } from 'react';
import { ArrowUp, Check, MoreHorizontal, Trash2, Pencil, RotateCcw } from 'lucide-react';
import type { Discussion, User } from '../types';
import { api } from '../api';
import { useApp } from '../store';
import { Avatar, Popover, MenuItem } from '../components/ui';
import { InlineEditable } from '../editor/blocks/InlineEditable';
import { htmlToText, timeAgo, escapeHtml } from '../lib/format';

export function CommentComposer({
  onSubmit,
  placeholder = 'Add a comment…',
  autoFocus,
  people,
  compact,
  onCancel,
}: {
  onSubmit: (html: string) => Promise<void> | void;
  placeholder?: string;
  autoFocus?: boolean;
  people: User[];
  compact?: boolean;
  onCancel?: () => void;
}) {
  const me = useApp((s) => s.me);
  const [html, setHtml] = useState('');
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ rect: DOMRect; q: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const submit = async () => {
    if (!htmlToText(html).trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(html);
      setHtml('');
      setKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };
  const editable = () => wrapRef.current?.querySelector('.inline-editable') as HTMLElement | null;
  const onChange = (h: string) => {
    setHtml(h);
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    const before = (r.startContainer.textContent || '').slice(0, r.startOffset);
    const m = before.match(/@(\w*)$/);
    if (m) setMention({ rect: r.getBoundingClientRect(), q: m[1] });
    else setMention(null);
  };
  const pickPerson = (u: User) => {
    const el = editable();
    if (!el || !mention) return;
    const sel = window.getSelection()!;
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    const offset = r.startOffset;
    const len = mention.q.length + 1;
    const del = document.createRange();
    del.setStart(node, offset - len);
    del.setEnd(node, offset);
    del.deleteContents();
    const tpl = document.createElement('template');
    tpl.innerHTML = `<span class="mention" data-type="user" data-id="${u.id}" contenteditable="false">@${escapeHtml(u.name)}</span>&nbsp;`;
    const frag = tpl.content;
    const last = frag.lastChild!;
    del.insertNode(frag);
    const after = document.createRange();
    after.setStartAfter(last);
    sel.removeAllRanges();
    sel.addRange(after);
    setMention(null);
    setHtml(el.innerHTML);
  };
  const matches = mention ? people.filter((p) => p.name.toLowerCase().includes(mention.q.toLowerCase())).slice(0, 6) : [];
  return (
    <div className={'comment-composer ' + (compact ? 'compact' : '')} ref={wrapRef}>
      <Avatar user={me} size={24} />
      <div className="cc-input">
        <InlineEditable
          key={key}
          html={html}
          onChange={onChange}
          placeholder={placeholder}
          autoFocus={autoFocus}
          testId="comment-input"
          onKeyDown={(e) => {
            if (mention && matches.length && e.key === 'Enter') {
              e.preventDefault();
              pickPerson(matches[0]);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === 'Escape' && onCancel) onCancel();
          }}
        />
      </div>
      <button className={'cc-send ' + (htmlToText(html).trim() ? 'on' : '')} onClick={submit} disabled={busy} aria-label="Send comment" data-testid="comment-send">
        <ArrowUp size={14} strokeWidth={2.5} />
      </button>
      {mention && matches.length > 0 && (
        <Popover anchor={mention.rect} onClose={() => setMention(null)}>
          <div className="menu">
            {matches.map((u) => (
              <MenuItem key={u.id} icon={<Avatar user={u} size={20} />} label={u.name} onClick={() => pickPerson(u)} />
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

export function DiscussionThread({
  d,
  people,
  onChange,
  canComment,
  showAnchor = true,
}: {
  d: Discussion;
  people: User[];
  onChange: (list: Discussion[]) => void;
  canComment: boolean;
  showAnchor?: boolean;
}) {
  const me = useApp((s) => s.me);
  const toast = useApp((s) => s.toast);
  const [menu, setMenu] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const run = async (p: Promise<any>) => {
    try {
      const r = await p;
      if (r?.discussions) onChange(r.discussions);
    } catch (e: any) {
      toast(e.message, { kind: 'error' });
    }
  };
  return (
    <div className={'discussion ' + (d.resolved ? 'resolved' : '')} data-testid="discussion">
      {showAnchor && d.anchorText && <div className="discussion-anchor">{d.anchorText}</div>}
      {d.comments.map((c, i) => (
        <div key={c.id} className="comment">
          <div className="comment-head">
            <Avatar user={c.author} size={22} />
            <span className="comment-author">{c.author?.name}</span>
            <span className="faint comment-time">{timeAgo(c.createdAt)}</span>
            {c.editedAt && <span className="faint comment-time">(edited)</span>}
            <div className="comment-actions">
              {i === 0 && canComment && (
                <button
                  className="icon-btn sm"
                  title={d.resolved ? 'Re-open' : 'Resolve'}
                  onClick={() => run(api.patch(`/api/discussions/${d.id}`, { resolved: !d.resolved }))}
                  data-testid="resolve-discussion"
                >
                  {d.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
                </button>
              )}
              {c.author?.id === me?.id && (
                <button className="icon-btn sm" onClick={(e) => setMenu({ id: c.id, el: e.currentTarget })}>
                  <MoreHorizontal size={14} />
                </button>
              )}
            </div>
          </div>
          {editing === c.id ? (
            <div className="comment-body">
              <InlineEditable
                html={draft}
                onChange={setDraft}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    run(api.patch(`/api/comments/${c.id}`, { body: draft }));
                    setEditing(null);
                  }
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            </div>
          ) : (
            <div className="comment-body" dangerouslySetInnerHTML={{ __html: c.body }} />
          )}
        </div>
      ))}
      {canComment && !d.resolved && (
        <CommentComposer compact people={people} placeholder="Reply…" onSubmit={(body) => run(api.post(`/api/discussions/${d.id}/comments`, { body }))} />
      )}
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)}>
          <div className="menu">
            <MenuItem
              icon={<Pencil size={16} />}
              label="Edit comment"
              onClick={() => {
                const c = d.comments.find((x) => x.id === menu.id)!;
                setDraft(c.body);
                setEditing(c.id);
                setMenu(null);
              }}
            />
            <MenuItem
              icon={<Trash2 size={16} />}
              label="Delete comment"
              danger
              onClick={() => {
                run(api.del(`/api/comments/${menu.id}`));
                setMenu(null);
              }}
            />
          </div>
        </Popover>
      )}
    </div>
  );
}
