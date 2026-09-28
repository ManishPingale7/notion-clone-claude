import { create } from 'zustand';
import { api } from './api';
import type { PageMeta, SidebarPage, User, Workspace } from './types';

type Theme = 'light' | 'dark' | 'system';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  kind?: 'error' | 'info';
}

interface AppState {
  me: User | null;
  loaded: boolean;
  workspaces: Workspace[];
  workspaceId: string | null;
  sidebarPages: SidebarPage[];
  favorites: { id: string; title: string; icon: string | null; type: string }[];
  isMember: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  theme: Theme;
  searchOpen: boolean;
  settingsTab: string | null;
  inboxOpen: boolean;
  unread: number;
  toasts: Toast[];
  pageMeta: Record<string, PageMeta>;
  expanded: Record<string, boolean>;
  people: Record<string, User>;

  loadMe(): Promise<void>;
  setMe(data: { user: User; workspaces: Workspace[] }): void;
  logout(): Promise<void>;
  setWorkspace(id: string): void;
  refreshWorkspaces(): Promise<void>;
  loadSidebar(): Promise<void>;
  loadUnread(): Promise<void>;
  setSidebarOpen(open: boolean): void;
  setSidebarWidth(w: number): void;
  setTheme(t: Theme): void;
  toast(message: string, opts?: Partial<Omit<Toast, 'id' | 'message'>>): void;
  dismissToast(id: number): void;
  mergeMeta(pages: Record<string, PageMeta> | PageMeta[]): void;
  setExpanded(id: string, v: boolean): void;
  mergePeople(list: User[]): void;
  set(partial: Partial<AppState>): void;
}

const ls = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string) {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  },
};

export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

let toastSeq = 1;

export const useApp = create<AppState>((set, get) => ({
  me: null,
  loaded: false,
  workspaces: [],
  workspaceId: ls.get('workspaceId'),
  sidebarPages: [],
  favorites: [],
  isMember: true,
  sidebarOpen: ls.get('sidebarOpen') !== 'false' && window.innerWidth > 800,
  sidebarWidth: Number(ls.get('sidebarWidth')) || 240,
  theme: (ls.get('theme') as Theme) || 'system',
  searchOpen: false,
  settingsTab: null,
  inboxOpen: false,
  unread: 0,
  toasts: [],
  pageMeta: {},
  expanded: JSON.parse(ls.get('expanded') || '{}'),
  people: {},

  async loadMe() {
    try {
      const data = await api.get('/api/auth/me');
      get().setMe(data);
    } catch {
      set({ me: null, loaded: true });
    }
  },
  setMe({ user, workspaces }) {
    let workspaceId = get().workspaceId;
    if (!workspaceId || !workspaces.some((w) => w.id === workspaceId)) workspaceId = workspaces[0]?.id || null;
    if (workspaceId) ls.set('workspaceId', workspaceId);
    const theme = (user.settings?.theme as Theme) || get().theme;
    applyTheme(theme);
    ls.set('theme', theme);
    set({ me: user, workspaces, workspaceId, loaded: true, theme, people: { ...get().people, [user.id]: user } });
  },
  async logout() {
    await api.post('/api/auth/logout');
    set({ me: null, workspaces: [], sidebarPages: [], favorites: [], pageMeta: {} });
  },
  setWorkspace(id) {
    ls.set('workspaceId', id);
    set({ workspaceId: id, sidebarPages: [], favorites: [] });
    get().loadSidebar();
  },
  async refreshWorkspaces() {
    const { workspaces } = await api.get('/api/workspaces');
    let { workspaceId } = get();
    if (!workspaces.some((w: Workspace) => w.id === workspaceId)) {
      workspaceId = workspaces[0]?.id || null;
      if (workspaceId) ls.set('workspaceId', workspaceId);
    }
    set({ workspaces, workspaceId });
  },
  async loadSidebar() {
    const wsId = get().workspaceId;
    if (!wsId) return;
    try {
      const data = await api.get(`/api/workspaces/${wsId}/sidebar`);
      if (get().workspaceId !== wsId) return;
      const meta: Record<string, PageMeta> = {};
      for (const p of data.pages as SidebarPage[]) meta[p.id] = { id: p.id, title: p.title, icon: p.icon, type: p.type, parentId: p.parentId };
      set({ sidebarPages: data.pages, favorites: data.favorites, isMember: data.isMember, pageMeta: { ...get().pageMeta, ...meta } });
    } catch (e: any) {
      if (e?.status === 403) await get().refreshWorkspaces();
    }
  },
  async loadUnread() {
    try {
      const data = await api.get('/api/notifications');
      set({ unread: data.unread });
    } catch {
      /* ignore */
    }
  },
  setSidebarOpen(open) {
    ls.set('sidebarOpen', String(open));
    set({ sidebarOpen: open });
  },
  setSidebarWidth(w) {
    const width = Math.max(200, Math.min(480, w));
    ls.set('sidebarWidth', String(width));
    set({ sidebarWidth: width });
  },
  setTheme(t) {
    ls.set('theme', t);
    applyTheme(t);
    set({ theme: t });
    api.patch('/api/auth/me', { settings: { theme: t } }).catch(() => {});
  },
  toast(message, opts = {}) {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, message, ...opts }] });
    setTimeout(() => get().dismissToast(id), opts.action ? 6000 : 3500);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  mergeMeta(pages) {
    const list = Array.isArray(pages) ? pages : Object.values(pages);
    if (!list.length) return;
    const next = { ...get().pageMeta };
    for (const p of list) next[p.id] = { ...next[p.id], ...p };
    set({ pageMeta: next });
  },
  setExpanded(id, v) {
    const expanded = { ...get().expanded, [id]: v };
    ls.set('expanded', JSON.stringify(expanded));
    set({ expanded });
  },
  mergePeople(list) {
    const people = { ...get().people };
    for (const p of list) people[p.id] = { ...people[p.id], ...p };
    set({ people });
  },
  set(partial) {
    set(partial);
  },
}));

export const currentWorkspace = () => {
  const s = useApp.getState();
  return s.workspaces.find((w) => w.id === s.workspaceId) || null;
};
