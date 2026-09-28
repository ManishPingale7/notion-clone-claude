import { q } from './db.js';
import { forbidden, notFound } from './lib/util.js';

// Access model (mirrors Notion):
//  * Top-level pages live either in the "Workspace" section (every workspace
//    member gets full access) or in someone's "Private" section (only the
//    creator). Access is inherited by every descendant page and database row.
//  * Any page can additionally be shared with specific people (members or
//    guests) at full / edit / comment / view level; that grant is inherited by
//    descendants as well.
//  * A page published to the web can be viewed read-only by anyone with the link.

export const ROLE_RANK = { view: 1, comment: 2, edit: 3, full: 4 };
export const maxRole = (a, b) => ((ROLE_RANK[a] || 0) >= (ROLE_RANK[b] || 0) ? a : b);
export const atLeast = (role, min) => (ROLE_RANK[role] || 0) >= ROLE_RANK[min];

export function membership(workspaceId, userId) {
  const row = q.get('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', workspaceId, userId);
  return row ? row.role : null;
}

export function requireMember(workspaceId, userId) {
  const role = membership(workspaceId, userId);
  if (!role) throw forbidden('You are not a member of this workspace');
  return role;
}

/** Workspaces the user belongs to, plus workspaces where they are a guest on some page. */
export function userWorkspaces(userId) {
  const member = q.all(
    `SELECT w.*, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY m.created_at`,
    userId,
  );
  const guest = q.all(
    `SELECT DISTINCT w.* FROM workspaces w JOIN pages p ON p.workspace_id = w.id JOIN page_permissions pp ON pp.page_id = p.id
     WHERE pp.user_id = ? AND w.id NOT IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?)`,
    userId,
    userId,
  );
  return [...member, ...guest.map((w) => ({ ...w, role: 'guest' }))];
}

/**
 * Computes the effective role for every page of a workspace for one user.
 * Returns Map<pageId, role>. Pages the user cannot see are absent.
 */
export function workspaceRoles(workspaceId, userId) {
  const pages = q.all('SELECT id, parent_id, created_by, visibility, parent_type FROM pages WHERE workspace_id = ?', workspaceId);
  const perms = q.all(
    `SELECT pp.page_id, pp.role FROM page_permissions pp JOIN pages p ON p.id = pp.page_id WHERE p.workspace_id = ? AND pp.user_id = ?`,
    workspaceId,
    userId,
  );
  const isMember = !!membership(workspaceId, userId);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const explicit = new Map(perms.map((p) => [p.page_id, p.role]));
  const memo = new Map();
  const resolve = (id, guard = 0) => {
    if (memo.has(id)) return memo.get(id);
    const p = byId.get(id);
    if (!p || guard > 200) return null;
    let role = explicit.get(id) || null;
    if (p.parent_id) {
      role = maxRole(role, resolve(p.parent_id, guard + 1));
    } else if (isMember) {
      if (p.visibility === 'workspace' || p.created_by === userId) role = 'full';
    }
    memo.set(id, role);
    return role;
  };
  const out = new Map();
  for (const p of pages) {
    const r = resolve(p.id);
    if (r) out.set(p.id, r);
  }
  return out;
}

export function pageRole(userId, pageId) {
  if (!userId) return null;
  let role = null;
  let id = pageId;
  let first = null;
  for (let guard = 0; id && guard < 200; guard++) {
    const p = q.get('SELECT id, parent_id, workspace_id, created_by, visibility FROM pages WHERE id = ?', id);
    if (!p) break;
    if (!first) first = p;
    const perm = q.get('SELECT role FROM page_permissions WHERE page_id = ? AND user_id = ?', id, userId);
    if (perm) role = maxRole(role, perm.role);
    if (!p.parent_id) {
      if (membership(p.workspace_id, userId) && (p.visibility === 'workspace' || p.created_by === userId)) role = 'full';
      break;
    }
    id = p.parent_id;
  }
  return role;
}

/** True when the page or one of its ancestors is published to the web. */
export function isPublic(pageId) {
  let id = pageId;
  for (let guard = 0; id && guard < 200; guard++) {
    const p = q.get('SELECT parent_id, public, deleted_at FROM pages WHERE id = ?', id);
    if (!p || p.deleted_at) return false;
    if (p.public) return true;
    id = p.parent_id;
  }
  return false;
}

export function loadPage(pageId) {
  const page = q.get('SELECT * FROM pages WHERE id = ?', pageId);
  if (!page) throw notFound('Page not found');
  return page;
}

/** Throws unless the user holds at least `min` on the page. Returns { page, role }. */
export function assertPageRole(user, pageId, min = 'view') {
  const page = loadPage(pageId);
  const role = pageRole(user?.id, pageId);
  if (!role || !atLeast(role, min)) {
    if (!role) throw notFound('Page not found or you do not have access');
    throw forbidden(min === 'edit' ? 'You only have ' + role + ' access to this page' : 'You do not have permission to do this');
  }
  return { page, role };
}
