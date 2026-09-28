import { api } from '../api';
import { useApp } from '../store';
import type { Page } from '../types';

const app = () => useApp.getState();

export async function createPage(opts: {
  parentId?: string | null;
  workspaceId?: string;
  title?: string;
  visibility?: 'private' | 'workspace';
  type?: 'page' | 'database';
  viewType?: string;
  isInline?: boolean;
  properties?: Record<string, unknown>;
  position?: number;
  icon?: string | null;
}): Promise<Page> {
  const s = app();
  const r = await api.post('/api/pages', { workspaceId: opts.workspaceId || s.workspaceId, ...opts });
  s.mergeMeta([{ id: r.page.id, title: r.page.title, icon: r.page.icon, type: r.page.type, parentId: r.page.parentId, isInline: r.page.isInline }]);
  if (opts.parentId) s.setExpanded(opts.parentId, true);
  s.loadSidebar();
  return r.page;
}

export async function trashPage(id: string, title?: string) {
  const s = app();
  try {
    await api.del(`/api/pages/${id}`);
    s.mergeMeta([{ id, deleted: true }]);
    s.loadSidebar();
    s.toast(`Moved "${title || 'Untitled'}" to trash`, {
      action: {
        label: 'Undo',
        run: () => restorePage(id),
      },
    });
    return true;
  } catch (e: any) {
    s.toast(e.message, { kind: 'error' });
    return false;
  }
}

export async function restorePage(id: string) {
  const s = app();
  await api.post(`/api/pages/${id}/restore`);
  s.mergeMeta([{ id, deleted: false }]);
  s.loadSidebar();
}

export async function duplicatePage(id: string) {
  const s = app();
  try {
    const r = await api.post(`/api/pages/${id}/duplicate`);
    s.loadSidebar();
    s.toast('Page duplicated');
    return r.page as Page;
  } catch (e: any) {
    s.toast(e.message, { kind: 'error' });
    return null;
  }
}

export async function toggleFavorite(id: string, on: boolean) {
  const s = app();
  if (on) await api.post(`/api/pages/${id}/favorite`);
  else await api.del(`/api/pages/${id}/favorite`);
  s.loadSidebar();
}

export async function movePage(id: string, parentId: string | null, extra: { position?: number; visibility?: 'private' | 'workspace' } = {}) {
  const s = app();
  try {
    await api.post(`/api/pages/${id}/move`, { parentId, ...extra });
    if (parentId) s.setExpanded(parentId, true);
    s.loadSidebar();
    return true;
  } catch (e: any) {
    s.toast(e.message, { kind: 'error' });
    return false;
  }
}

export function copyLink(id: string) {
  navigator.clipboard?.writeText(`${location.origin}/p/${id}`);
  app().toast('Copied link to clipboard');
}

export async function renamePage(id: string, title: string) {
  const s = app();
  s.mergeMeta([{ id, title }]);
  s.set({ sidebarPages: s.sidebarPages.map((p) => (p.id === id ? { ...p, title } : p)) });
  await api.patch(`/api/pages/${id}`, { title });
}

export async function setPageIcon(id: string, icon: string | null) {
  const s = app();
  s.mergeMeta([{ id, icon }]);
  s.set({ sidebarPages: s.sidebarPages.map((p) => (p.id === id ? { ...p, icon } : p)) });
  await api.patch(`/api/pages/${id}`, { icon });
}
