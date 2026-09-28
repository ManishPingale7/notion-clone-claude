import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User as UserIcon, SlidersHorizontal, Settings, Users, X, ChevronDown } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { Modal, Avatar, Popover, MenuItem, confirmDialog } from '../components/ui';
import { EmojiPicker } from '../components/EmojiPicker';
import type { User } from '../types';

export function SettingsModal() {
  const tab = useApp((s) => s.settingsTab)!;
  const set = useApp((s) => s.set);
  const ws = useApp((s) => s.workspaces.find((w) => w.id === s.workspaceId));
  const isGuest = ws?.role === 'guest';
  const nav: [string, string, React.ReactNode, boolean?][] = [
    ['account', 'My account', <UserIcon key="a" size={16} />],
    ['preferences', 'Preferences', <SlidersHorizontal key="p" size={16} />],
    ['workspace', 'General', <Settings key="w" size={16} />, isGuest],
    ['people', 'People', <Users key="pe" size={16} />, isGuest],
  ];
  return (
    <Modal onClose={() => set({ settingsTab: null })} width={1000} top="6vh">
      <div className="settings" data-testid="settings">
        <div className="settings-nav">
          <div className="menu-label">Account</div>
          {nav.slice(0, 2).map(([k, label, icon]) => (
            <button key={k} className={'settings-nav-item ' + (tab === k ? 'on' : '')} onClick={() => set({ settingsTab: k })} data-testid={'settings-' + k}>
              {icon} {label}
            </button>
          ))}
          {!isGuest && (
            <>
              <div className="menu-label" style={{ marginTop: 12 }}>
                Workspace
              </div>
              {nav.slice(2).map(([k, label, icon]) => (
                <button key={k} className={'settings-nav-item ' + (tab === k ? 'on' : '')} onClick={() => set({ settingsTab: k })} data-testid={'settings-' + k}>
                  {icon} {label}
                </button>
              ))}
            </>
          )}
        </div>
        <div className="settings-body">
          <button className="icon-btn settings-close" onClick={() => set({ settingsTab: null })}>
            <X size={18} />
          </button>
          {tab === 'account' && <AccountTab />}
          {tab === 'preferences' && <PreferencesTab />}
          {tab === 'workspace' && !isGuest && <WorkspaceTab />}
          {tab === 'people' && !isGuest && <PeopleTab />}
        </div>
      </div>
    </Modal>
  );
}

function AccountTab() {
  const me = useApp((s) => s.me)!;
  const setMe = useApp((s) => s.setMe);
  const toast = useApp((s) => s.toast);
  const logout = useApp((s) => s.logout);
  const navigate = useNavigate();
  const [name, setName] = useState(me.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const saveName = async () => {
    if (!name.trim() || name === me.name) return;
    try {
      setMe(await api.patch('/api/auth/me', { name }));
      toast('Name updated');
    } catch (e: any) {
      toast(e.message, { kind: 'error' });
    }
  };
  return (
    <div className="settings-section">
      <h2>My account</h2>
      <div className="settings-row" style={{ alignItems: 'center', gap: 16 }}>
        <button className="avatar-upload" onClick={() => fileRef.current?.click()} title="Upload photo">
          <Avatar user={me} size={60} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = await api.upload(f);
            setMe(await api.patch('/api/auth/me', { avatarUrl: r.url }));
          }}
        />
        <div className="grow">
          <label className="settings-label">Preferred name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && saveName()} style={{ maxWidth: 260 }} data-testid="account-name" />
        </div>
        {me.avatarUrl && (
          <button className="btn" onClick={async () => setMe(await api.patch('/api/auth/me', { avatarUrl: null }))}>
            Remove photo
          </button>
        )}
      </div>
      <h3>Account security</h3>
      <div className="settings-row">
        <div className="grow">
          <div>Email</div>
          <div className="faint small">{me.email}</div>
        </div>
      </div>
      <form
        className="settings-row"
        style={{ gap: 8, flexWrap: 'wrap' }}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post('/api/auth/password', pw);
            setPw({ current: '', next: '' });
            toast('Password changed');
          } catch (err: any) {
            toast(err.message, { kind: 'error' });
          }
        }}
      >
        <div className="grow">
          <div>Password</div>
          <div className="faint small">Change the password you use to log in.</div>
        </div>
        <input className="input" type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} style={{ width: 170 }} autoComplete="current-password" />
        <input className="input" type="password" placeholder="New password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} style={{ width: 170 }} autoComplete="new-password" />
        <button className="btn btn-outline" type="submit" disabled={!pw.current || pw.next.length < 8}>
          Change password
        </button>
      </form>
      <h3>Support</h3>
      <div className="settings-row">
        <div className="grow">
          <div>Log out</div>
          <div className="faint small">Log out of this device.</div>
        </div>
        <button
          className="btn btn-outline"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          Log out
        </button>
      </div>
    </div>
  );
}

function PreferencesTab() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = { light: 'Light', dark: 'Dark', system: 'Use system setting' }[theme];
  return (
    <div className="settings-section">
      <h2>Preferences</h2>
      <div className="settings-row">
        <div className="grow">
          <div>Appearance</div>
          <div className="faint small">Customize how Notion looks on your device.</div>
        </div>
        <button className="btn" onClick={(e) => setAnchor(e.currentTarget)} data-testid="theme-select">
          {label} <ChevronDown size={14} />
        </button>
        {anchor && (
          <Popover anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-end">
            <div className="menu">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <MenuItem
                  key={t}
                  label={{ light: 'Light', dark: 'Dark', system: 'Use system setting' }[t]}
                  checked={theme === t}
                  onClick={() => {
                    setTheme(t);
                    setAnchor(null);
                  }}
                  testId={'theme-' + t}
                />
              ))}
            </div>
          </Popover>
        )}
      </div>
      <div className="settings-row">
        <div className="grow">
          <div>Keyboard shortcuts</div>
          <div className="faint small">
            Ctrl+K search · Ctrl+\ toggle sidebar · Ctrl+Shift+L dark mode · / commands · Ctrl+Z / Ctrl+Shift+Z undo / redo
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkspaceTab() {
  const ws = useApp((s) => s.workspaces.find((w) => w.id === s.workspaceId))!;
  const refresh = useApp((s) => s.refreshWorkspaces);
  const toast = useApp((s) => s.toast);
  const set = useApp((s) => s.set);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const navigate = useNavigate();
  const [name, setName] = useState(ws.name);
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const isOwner = ws.role === 'owner';
  const save = async (patch: Record<string, unknown>) => {
    try {
      await api.patch(`/api/workspaces/${ws.id}`, patch);
      await refresh();
    } catch (e: any) {
      toast(e.message, { kind: 'error' });
    }
  };
  return (
    <div className="settings-section">
      <h2>Workspace settings</h2>
      <label className="settings-label">Name</label>
      <input className="input" value={name} disabled={!isOwner} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== ws.name && save({ name })} style={{ maxWidth: 320 }} data-testid="workspace-name" />
      <div className="faint small" style={{ margin: '6px 0 18px' }}>
        You can use your organization or company name. Keep it simple.
      </div>
      <label className="settings-label">Icon</label>
      <button className="ws-icon-picker" disabled={!isOwner} onClick={(e) => setIconAnchor(e.currentTarget)}>
        <span className="ws-icon lg">{ws.icon || ws.name.charAt(0).toUpperCase()}</span>
      </button>
      {iconAnchor && (
        <Popover anchor={iconAnchor} onClose={() => setIconAnchor(null)}>
          <EmojiPicker
            allowUpload={false}
            onPick={(i) => {
              save({ icon: i });
              setIconAnchor(null);
            }}
            onRemove={() => {
              save({ icon: null });
              setIconAnchor(null);
            }}
          />
        </Popover>
      )}
      <h3 style={{ marginTop: 32 }}>Danger zone</h3>
      <div className="settings-row">
        <div className="grow">
          <div>{isOwner ? 'Delete workspace' : 'Leave workspace'}</div>
          <div className="faint small">{isOwner ? 'Permanently deletes the workspace and every page in it.' : 'You will lose access to all workspace pages.'}</div>
        </div>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (!(await confirmDialog({ title: isOwner ? `Delete ${ws.name}?` : `Leave ${ws.name}?`, body: 'This cannot be undone.', confirm: isOwner ? 'Delete workspace' : 'Leave', danger: true }))) return;
            try {
              if (isOwner) await api.del(`/api/workspaces/${ws.id}`);
              else await api.post(`/api/workspaces/${ws.id}/leave`);
              await refresh();
              const first = useApp.getState().workspaces[0];
              if (first) setWorkspace(first.id);
              set({ settingsTab: null });
              navigate('/');
            } catch (e: any) {
              toast(e.message, { kind: 'error' });
            }
          }}
          data-testid="delete-workspace"
        >
          {isOwner ? 'Delete workspace' : 'Leave workspace'}
        </button>
      </div>
    </div>
  );
}

function PeopleTab() {
  const ws = useApp((s) => s.workspaces.find((w) => w.id === s.workspaceId))!;
  const me = useApp((s) => s.me)!;
  const toast = useApp((s) => s.toast);
  const [people, setPeople] = useState<(User & { role: string })[]>([]);
  const [invites, setInvites] = useState<{ id: string; email: string; role: string }[]>([]);
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<'member' | 'owner'>('member');
  const [roleMenu, setRoleMenu] = useState<{ user: User & { role: string }; el: HTMLElement } | null>(null);
  const isOwner = ws.role === 'owner';
  const load = () =>
    api.get(`/api/workspaces/${ws.id}/members`).then((r) => {
      setPeople(r.people);
      setInvites(r.invites);
    });
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id]);
  const members = people.filter((p) => p.role !== 'guest');
  const guests = people.filter((p) => p.role === 'guest');
  return (
    <div className="settings-section">
      <h2>People</h2>
      <form
        className="invite-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const list = emails.split(/[,\s]+/).filter(Boolean);
          if (!list.length) return;
          try {
            const r = await api.post(`/api/workspaces/${ws.id}/members`, { emails: list, role });
            setEmails('');
            toast(r.added.length ? `Added ${r.added.map((u: User) => u.name).join(', ')}` : 'Invitation saved — they will join when they sign up');
            load();
          } catch (err: any) {
            toast(err.message, { kind: 'error' });
          }
        }}
      >
        <input className="input" placeholder="Search names or emails, separated by commas" value={emails} onChange={(e) => setEmails(e.target.value)} data-testid="invite-emails" />
        {isOwner && (
          <select className="input" style={{ width: 120 }} value={role} onChange={(e) => setRole(e.target.value as any)}>
            <option value="member">Member</option>
            <option value="owner">Owner</option>
          </select>
        )}
        <button className="btn btn-primary" type="submit" disabled={!emails.trim()} data-testid="invite-submit">
          Invite
        </button>
      </form>
      <h3>Members · {members.length}</h3>
      <div className="people-table">
        {members.map((p) => (
          <div key={p.id} className="people-row" data-testid="member-row">
            <Avatar user={p} size={28} />
            <div className="grow">
              <div>
                {p.name} {p.id === me.id && <span className="faint">(You)</span>}
              </div>
              <div className="faint small">{p.email}</div>
            </div>
            <button className="btn" disabled={!isOwner} onClick={(e) => setRoleMenu({ user: p, el: e.currentTarget })}>
              {p.role === 'owner' ? 'Workspace owner' : 'Member'} {isOwner && <ChevronDown size={12} />}
            </button>
          </div>
        ))}
        {invites.map((i) => (
          <div key={i.id} className="people-row">
            <Avatar user={{ name: i.email, color: '#aaa' }} size={28} />
            <div className="grow">
              <div>{i.email}</div>
              <div className="faint small">Invitation pending — joins on sign up</div>
            </div>
            <button
              className="btn"
              onClick={async () => {
                await api.del(`/api/workspaces/${ws.id}/invites/${i.id}`);
                load();
              }}
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
      {guests.length > 0 && (
        <>
          <h3>Guests · {guests.length}</h3>
          <div className="people-table">
            {guests.map((p) => (
              <div key={p.id} className="people-row">
                <Avatar user={p} size={28} />
                <div className="grow">
                  <div>{p.name}</div>
                  <div className="faint small">{p.email}</div>
                </div>
                {isOwner && (
                  <button
                    className="btn"
                    onClick={async () => {
                      await api.del(`/api/workspaces/${ws.id}/members/${p.id}`);
                      load();
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {roleMenu && (
        <Popover anchor={roleMenu.el} onClose={() => setRoleMenu(null)} placement="bottom-end">
          <div className="menu" style={{ width: 240 }}>
            {(['owner', 'member'] as const).map((r) => (
              <MenuItem
                key={r}
                label={r === 'owner' ? 'Workspace owner' : 'Member'}
                desc={r === 'owner' ? 'Can change workspace settings and invite members' : 'Cannot change workspace settings'}
                tall
                checked={roleMenu.user.role === r}
                onClick={async () => {
                  setRoleMenu(null);
                  try {
                    await api.patch(`/api/workspaces/${ws.id}/members/${roleMenu.user.id}`, { role: r });
                    load();
                  } catch (e: any) {
                    toast(e.message, { kind: 'error' });
                  }
                }}
              />
            ))}
            <div className="menu-divider" />
            <MenuItem
              label={roleMenu.user.id === me.id ? 'Leave workspace' : 'Remove from workspace'}
              danger
              onClick={async () => {
                const u = roleMenu.user;
                setRoleMenu(null);
                if (!(await confirmDialog({ title: `Remove ${u.name}?`, body: 'They will lose access to workspace pages.', confirm: 'Remove', danger: true }))) return;
                try {
                  await api.del(`/api/workspaces/${ws.id}/members/${u.id}`);
                  load();
                } catch (e: any) {
                  toast(e.message, { kind: 'error' });
                }
              }}
            />
          </div>
        </Popover>
      )}
    </div>
  );
}
