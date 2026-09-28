import React, { useEffect, useState } from 'react';
import { Link as LinkIcon, Globe, Lock, Users, ChevronDown, Check, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { Avatar, Popover, MenuItem, Spinner } from '../components/ui';
import type { Role, User } from '../types';

interface ShareData {
  role: Role;
  visibility: 'private' | 'workspace';
  rootId: string;
  isRoot: boolean;
  owner: User | null;
  workspace: { id: string; name: string; icon: string | null };
  people: { user: User; role: Role; inheritedFrom: { id: string; title: string } | null; isGuest: boolean }[];
  invites: { id: string; email: string; role: Role }[];
  public: boolean;
  publicAncestor: { id: string; title: string } | null;
}

export const ROLE_LABELS: Record<Role, string> = { full: 'Full access', edit: 'Can edit', comment: 'Can comment', view: 'Can view' };
const ROLE_DESC: Record<Role, string> = {
  full: 'Edit, suggest, comment, and share with others',
  edit: 'Edit, suggest, and comment',
  comment: 'Suggest and comment',
  view: 'Cannot edit or share with others',
};

function RolePicker({ value, onChange, onRemove, disabled }: { value: Role; onChange: (r: Role) => void; onRemove?: () => void; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" className="role-btn" disabled={disabled} onClick={(e) => setAnchor(e.currentTarget)} data-testid="role-picker">
        {ROLE_LABELS[value]}
        {!disabled && <ChevronDown size={12} />}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-end">
          <div className="menu" style={{ width: 280 }}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <MenuItem
                key={r}
                label={ROLE_LABELS[r]}
                desc={ROLE_DESC[r]}
                tall
                checked={r === value}
                onClick={() => {
                  setAnchor(null);
                  onChange(r);
                }}
              />
            ))}
            {onRemove && (
              <>
                <div className="menu-divider" />
                <MenuItem
                  label="Remove"
                  danger
                  onClick={() => {
                    setAnchor(null);
                    onRemove();
                  }}
                />
              </>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

export function ShareMenu({ pageId, anchor, onClose }: { pageId: string; anchor: HTMLElement; onClose: () => void }) {
  const me = useApp((s) => s.me)!;
  const toast = useApp((s) => s.toast);
  const [tab, setTab] = useState<'share' | 'publish'>('share');
  const [data, setData] = useState<ShareData | null>(null);
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<Role>('edit');
  const [generalAnchor, setGeneralAnchor] = useState<HTMLElement | null>(null);

  const load = () => api.get(`/api/pages/${pageId}/permissions`).then(setData).catch((e) => toast(e.message, { kind: 'error' }));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const run = async (p: Promise<any>) => {
    try {
      const r = await p;
      if (r && r.people) setData(r);
      else load();
    } catch (e: any) {
      toast(e.message, { kind: 'error' });
    }
  };
  const canShare = data?.role === 'full';
  const link = `${location.origin}/p/${pageId}`;
  const publicLink = `${location.origin}/share/${pageId}`;

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const list = emails.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    await run(api.post(`/api/pages/${pageId}/permissions`, { emails: list, role }));
    setEmails('');
    toast(list.length === 1 ? `Invited ${list[0]}` : `Invited ${list.length} people`);
  };

  return (
    <Popover anchor={anchor} onClose={onClose} placement="bottom-end" width={480}>
      <div className="share-menu" data-testid="share-menu">
        <div className="share-tabs">
          <button className={tab === 'share' ? 'on' : ''} onClick={() => setTab('share')}>
            Share
          </button>
          <button className={tab === 'publish' ? 'on' : ''} onClick={() => setTab('publish')} data-testid="publish-tab">
            Publish
          </button>
        </div>
        {!data ? (
          <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
            <Spinner />
          </div>
        ) : tab === 'share' ? (
          <div className="share-body">
            {canShare && (
              <form className="share-invite" onSubmit={invite}>
                <input className="input" placeholder="Email, separated by commas" value={emails} onChange={(e) => setEmails(e.target.value)} data-testid="share-email" />
                <RolePicker value={role} onChange={setRole} />
                <button className="btn btn-primary" type="submit" disabled={!emails.trim()} data-testid="share-invite">
                  Invite
                </button>
              </form>
            )}
            <div className="share-section-label">People with access</div>
            <div className="share-people">
              {data.owner && (
                <div className="share-person">
                  <Avatar user={data.owner} size={28} />
                  <div className="grow">
                    <div>
                      {data.owner.name} {data.owner.id === me.id && <span className="faint">(You)</span>}
                    </div>
                    <div className="faint small">{data.owner.email}</div>
                  </div>
                  <span className="faint small">Full access</span>
                </div>
              )}
              {data.visibility === 'workspace' && (
                <div className="share-person">
                  <span className="ws-icon" style={{ width: 28, height: 28, fontSize: 16 }}>
                    {data.workspace.icon || data.workspace.name.charAt(0)}
                  </span>
                  <div className="grow">
                    <div>Everyone at {data.workspace.name}</div>
                    <div className="faint small">All workspace members</div>
                  </div>
                  <span className="faint small">Full access</span>
                </div>
              )}
              {data.people.map((p) => (
                <div className="share-person" key={p.user.id} data-testid="share-person">
                  <Avatar user={p.user} size={28} />
                  <div className="grow">
                    <div>
                      {p.user.name} {p.user.id === me.id && <span className="faint">(You)</span>}
                      {p.isGuest && <span className="guest-badge">Guest</span>}
                    </div>
                    <div className="faint small">{p.inheritedFrom ? `Access from ${p.inheritedFrom.title || 'Untitled'}` : p.user.email}</div>
                  </div>
                  <RolePicker
                    value={p.role}
                    disabled={!canShare}
                    onChange={(r) => run(api.patch(`/api/pages/${pageId}/permissions/${p.user.id}`, { role: r }))}
                    onRemove={p.inheritedFrom ? undefined : () => run(api.del(`/api/pages/${pageId}/permissions/${p.user.id}`))}
                  />
                </div>
              ))}
              {data.invites.map((i) => (
                <div className="share-person" key={i.id}>
                  <Avatar user={{ name: i.email, color: '#999' }} size={28} />
                  <div className="grow">
                    <div>{i.email}</div>
                    <div className="faint small">Invited — will get access when they sign up</div>
                  </div>
                  {canShare && (
                    <button className="btn" onClick={() => run(api.del(`/api/pages/${pageId}/invites/${i.id}`))}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="share-section-label">General access</div>
            <div className="share-person">
              <span className="general-icon">{data.visibility === 'workspace' ? <Users size={16} /> : <Lock size={16} />}</span>
              <div className="grow">
                <button className="general-btn" disabled={!canShare || !data.isRoot} onClick={(e) => setGeneralAnchor(e.currentTarget)} data-testid="general-access">
                  {data.visibility === 'workspace' ? `Everyone at ${data.workspace.name}` : 'Only people invited'}
                  {canShare && data.isRoot && <ChevronDown size={12} />}
                </button>
                <div className="faint small">
                  {data.visibility === 'workspace' ? 'Anyone in the workspace can find and access this page' : 'Only people with access can open this page'}
                  {!data.isRoot && ' (inherited from the top-level page)'}
                </div>
              </div>
            </div>
            {generalAnchor && (
              <Popover anchor={generalAnchor} onClose={() => setGeneralAnchor(null)}>
                <div className="menu" style={{ width: 280 }}>
                  <MenuItem
                    icon={<Lock size={16} />}
                    label="Only people invited"
                    checked={data.visibility === 'private'}
                    onClick={() => {
                      setGeneralAnchor(null);
                      run(api.patch(`/api/pages/${pageId}/general-access`, { visibility: 'private' }));
                    }}
                  />
                  <MenuItem
                    icon={<Users size={16} />}
                    label={`Everyone at ${data.workspace.name}`}
                    checked={data.visibility === 'workspace'}
                    onClick={() => {
                      setGeneralAnchor(null);
                      run(api.patch(`/api/pages/${pageId}/general-access`, { visibility: 'workspace' }));
                    }}
                  />
                </div>
              </Popover>
            )}
            <div className="share-footer">
              <span className="faint small">Your role: {ROLE_LABELS[data.role]}</span>
              <button
                className="btn btn-outline"
                onClick={() => {
                  navigator.clipboard?.writeText(link);
                  toast('Copied link to clipboard');
                }}
                data-testid="copy-link"
              >
                <LinkIcon size={14} /> Copy link
              </button>
            </div>
          </div>
        ) : (
          <div className="share-body publish-body">
            {data.public || data.publicAncestor ? (
              <>
                <div className="publish-live">
                  <Globe size={16} /> <span>{data.publicAncestor && !data.public ? `Published through "${data.publicAncestor.title || 'Untitled'}"` : 'This page is live on the web'}</span>
                </div>
                <div className="publish-link">
                  <input className="input" readOnly value={publicLink} data-testid="public-link" />
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      navigator.clipboard?.writeText(publicLink);
                      toast('Copied web link');
                    }}
                  >
                    Copy
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  {data.public && canShare && (
                    <button className="btn btn-outline" onClick={() => run(api.patch(`/api/pages/${pageId}/publish`, { public: false }))} data-testid="unpublish">
                      Unpublish
                    </button>
                  )}
                  <a className="btn btn-primary" href={publicLink} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> View site
                  </a>
                </div>
              </>
            ) : (
              <div className="publish-empty">
                <Globe size={32} strokeWidth={1.4} className="faint" />
                <div style={{ fontWeight: 600, fontSize: 15 }}>Publish to web</div>
                <div className="faint small" style={{ maxWidth: 320, textAlign: 'center' }}>
                  Create a website with Notion. Anyone with the link will be able to view this page and its sub-pages.
                </div>
                <button className="btn btn-primary btn-block" disabled={!canShare} onClick={() => run(api.patch(`/api/pages/${pageId}/publish`, { public: true }))} data-testid="publish">
                  Publish
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}

void Check;
