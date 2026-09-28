import { q, tx, json } from './db.js';
import { uid, now, pickColor } from './lib/util.js';
import { blockPlainText, rowFromBlock, sanitizeContent, BLOCK_TYPES } from './lib/blocks.js';
import { hashPassword, publicUser } from './auth.js';
import { toUser } from './realtime.js';
import { defaultSchema, defaultViewConfig } from './lib/database.js';

// ---------- Serialization ----------

export function serializePage(p, extra = {}) {
  if (!p) return null;
  return {
    id: p.id,
    workspaceId: p.workspace_id,
    parentId: p.parent_id,
    parentType: p.parent_type,
    type: p.type,
    title: p.title,
    icon: p.icon,
    cover: json.parse(p.cover, null),
    properties: json.parse(p.properties, {}),
    schema: p.schema ? json.parse(p.schema, null) : null,
    format: json.parse(p.format, {}),
    isInline: !!p.is_inline,
    visibility: p.visibility,
    position: p.position,
    public: !!p.public,
    createdBy: p.created_by,
    createdAt: p.created_at,
    updatedBy: p.updated_by,
    updatedAt: p.updated_at,
    deletedAt: p.deleted_at,
    ...extra,
  };
}

export function pageMeta(p) {
  return {
    id: p.id,
    title: p.title,
    icon: p.icon,
    type: p.type,
    parentId: p.parent_id,
    parentType: p.parent_type,
    isInline: !!p.is_inline,
    deleted: !!p.deleted_at,
  };
}

export function serializeView(v) {
  return { id: v.id, databaseId: v.database_id, name: v.name, type: v.type, config: json.parse(v.config, {}), position: v.position };
}

// ---------- Users & workspaces ----------

export function createUser({ email, name, password }) {
  return tx(() => {
    const id = uid();
    const t = now();
    q.run(
      'INSERT INTO users (id, email, name, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      email.trim().toLowerCase(),
      name.trim(),
      hashPassword(password),
      pickColor(email),
      t,
    );
    const user = q.get('SELECT * FROM users WHERE id = ?', id);
    // Accept pending invitations sent to this email before the account existed.
    const invites = q.all('SELECT * FROM invites WHERE email = ?', user.email);
    let joinedWorkspace = false;
    for (const inv of invites) {
      if (inv.page_id) {
        q.run(
          'INSERT OR REPLACE INTO page_permissions (page_id, user_id, role, granted_by, created_at) VALUES (?, ?, ?, ?, ?)',
          inv.page_id,
          id,
          inv.role,
          inv.invited_by,
          t,
        );
        notify(id, { type: 'page_shared', workspaceId: inv.workspace_id, actorId: inv.invited_by, pageId: inv.page_id, data: { role: inv.role } });
      } else {
        q.run('INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', inv.workspace_id, id, inv.role, t);
        joinedWorkspace = true;
        notify(id, { type: 'workspace_joined', workspaceId: inv.workspace_id, actorId: inv.invited_by });
      }
    }
    q.run('DELETE FROM invites WHERE email = ?', user.email);
    createWorkspace(user, `${user.name.split(' ')[0]}'s Notion`, { onboarding: true });
    return { user, joinedWorkspace };
  });
}

export function createWorkspace(user, name, { onboarding = false, icon = null } = {}) {
  return tx(() => {
    const id = uid();
    const t = now();
    q.run('INSERT INTO workspaces (id, name, icon, created_by, created_at) VALUES (?, ?, ?, ?, ?)', id, name, icon, user.id, t);
    q.run('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', id, user.id, 'owner', t);
    if (onboarding) createOnboardingPage(user, id);
    return q.get('SELECT * FROM workspaces WHERE id = ?', id);
  });
}

export function workspaceMembers(workspaceId) {
  return q
    .all(
      `SELECT u.*, m.role FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at`,
      workspaceId,
    )
    .map((u) => ({ ...publicUser(u), role: u.role }));
}

/** Members plus guests (people with explicit page access) of a workspace. */
export function workspacePeople(workspaceId) {
  const members = workspaceMembers(workspaceId);
  const ids = new Set(members.map((m) => m.id));
  const guests = q
    .all(
      `SELECT DISTINCT u.* FROM page_permissions pp JOIN pages p ON p.id = pp.page_id JOIN users u ON u.id = pp.user_id WHERE p.workspace_id = ?`,
      workspaceId,
    )
    .filter((u) => !ids.has(u.id))
    .map((u) => ({ ...publicUser(u), role: 'guest' }));
  return [...members, ...guests];
}

// ---------- Pages ----------

export function nextPosition(parentId, workspaceId) {
  const row = parentId
    ? q.get('SELECT MAX(position) AS m FROM pages WHERE parent_id = ?', parentId)
    : q.get('SELECT MAX(position) AS m FROM pages WHERE parent_id IS NULL AND workspace_id = ?', workspaceId);
  return (row?.m ?? 0) + 1;
}

export function nextBlockPosition(pageId, parentBlockId = null) {
  const row = parentBlockId
    ? q.get('SELECT MAX(position) AS m FROM blocks WHERE page_id = ? AND parent_block_id = ?', pageId, parentBlockId)
    : q.get('SELECT MAX(position) AS m FROM blocks WHERE page_id = ? AND parent_block_id IS NULL', pageId);
  return (row?.m ?? 0) + 1;
}

/**
 * Creates a page (or database). When the parent is a regular page, a matching
 * `page` / `child_database` block is inserted into the parent's content so the
 * sub-page shows up inline, exactly like Notion.
 */
export function createPage(user, opts) {
  return tx(() => {
    const t = now();
    const id = opts.id || uid();
    let parentType = 'workspace';
    let parent = null;
    if (opts.parentId) {
      parent = q.get('SELECT * FROM pages WHERE id = ?', opts.parentId);
      parentType = parent.type === 'database' && !opts.forceParentPage ? 'database' : 'page';
    }
    const type = opts.type === 'database' ? 'database' : 'page';
    const schema = type === 'database' ? JSON.stringify(opts.schema || defaultSchema()) : null;
    const position = opts.position ?? nextPosition(opts.parentId, opts.workspaceId);
    q.run(
      `INSERT INTO pages (id, workspace_id, parent_id, parent_type, type, title, icon, cover, properties, schema, format, is_inline, visibility, position, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      opts.workspaceId,
      opts.parentId || null,
      parentType,
      type,
      opts.title || '',
      opts.icon || null,
      opts.cover ? JSON.stringify(opts.cover) : null,
      JSON.stringify(opts.properties || {}),
      schema,
      JSON.stringify(opts.format || {}),
      opts.isInline ? 1 : 0,
      opts.visibility === 'workspace' ? 'workspace' : 'private',
      position,
      user.id,
      t,
      user.id,
      t,
    );
    if (type === 'database') {
      const views = opts.views || [{ name: 'Table', type: 'table' }];
      views.forEach((v, i) => createView(id, v, i + 1));
    }
    let block = null;
    if (parent && parentType === 'page' && !opts.skipBlock) {
      const blockPos = opts.blockPosition ?? nextBlockPosition(parent.id, opts.parentBlockId || null);
      const blockId = opts.blockId || uid();
      q.run(
        `INSERT INTO blocks (id, page_id, parent_block_id, type, content, position, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        blockId,
        parent.id,
        opts.parentBlockId || null,
        type === 'database' ? 'child_database' : 'page',
        JSON.stringify({ pageId: id }),
        blockPos,
        user.id,
        t,
        user.id,
        t,
      );
      block = rowFromBlock(q.get('SELECT * FROM blocks WHERE id = ?', blockId));
    }
    if (opts.blocks?.length) insertBlockTree(user, id, opts.blocks);
    return { page: q.get('SELECT * FROM pages WHERE id = ?', id), block };
  });
}

/** Inserts simple nested block specs: { type, content, children } */
export function insertBlockTree(user, pageId, specs, parentBlockId = null) {
  const t = now();
  specs.forEach((spec, i) => {
    if (!spec || !BLOCK_TYPES.has(spec.type) || ['page', 'child_database'].includes(spec.type)) return;
    const id = uid();
    q.run(
      `INSERT INTO blocks (id, page_id, parent_block_id, type, content, position, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      pageId,
      parentBlockId,
      spec.type,
      JSON.stringify(sanitizeContent(spec.type, spec.content || {})),
      i + 1,
      user.id,
      t,
      user.id,
      t,
    );
    if (spec.children?.length) insertBlockTree(user, pageId, spec.children, id);
  });
  refreshSearchText(pageId);
}

export function refreshSearchText(pageId) {
  const blocks = q.all('SELECT type, content FROM blocks WHERE page_id = ? ORDER BY position', pageId);
  const text = blocks
    .map((b) => blockPlainText(b.type, json.parse(b.content, {})))
    .filter(Boolean)
    .join('\n')
    .slice(0, 100000);
  q.run('UPDATE pages SET search_text = ? WHERE id = ?', text, pageId);
}

export function touchPage(pageId, userId) {
  q.run('UPDATE pages SET updated_at = ?, updated_by = ? WHERE id = ?', now(), userId, pageId);
}

/** All descendant page ids (sub-pages, databases, rows), depth-first. */
export function descendantIds(pageId) {
  const out = [];
  const stack = [pageId];
  while (stack.length) {
    const id = stack.pop();
    for (const c of q.all('SELECT id FROM pages WHERE parent_id = ?', id)) {
      out.push(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

export function ancestors(pageId) {
  const out = [];
  let p = q.get('SELECT * FROM pages WHERE id = ?', pageId);
  for (let g = 0; p?.parent_id && g < 200; g++) {
    p = q.get('SELECT * FROM pages WHERE id = ?', p.parent_id);
    if (p) out.unshift(p);
  }
  return out;
}

export function trashPage(user, pageId) {
  return tx(() => {
    const t = now();
    const ids = [pageId, ...descendantIds(pageId)];
    for (const id of ids) {
      q.run('UPDATE pages SET deleted_at = COALESCE(deleted_at, ?), deleted_by = COALESCE(deleted_by, ?) WHERE id = ?', t, user.id, id);
    }
    // Remember which pages were trashed together so restore brings the whole subtree back.
    q.run('UPDATE pages SET deleted_at = ? WHERE id = ?', t, pageId);
    return ids;
  });
}

export function restorePage(user, pageId) {
  return tx(() => {
    const page = q.get('SELECT * FROM pages WHERE id = ?', pageId);
    if (!page) return [];
    const ids = [pageId, ...descendantIds(pageId)];
    for (const id of ids) {
      const p = q.get('SELECT deleted_at FROM pages WHERE id = ?', id);
      if (p.deleted_at && p.deleted_at >= page.deleted_at - 1000) q.run('UPDATE pages SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', id);
    }
    q.run('UPDATE pages SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', pageId);
    // If the parent page was deleted permanently or is still in trash, move to top level.
    if (page.parent_id) {
      const parent = q.get('SELECT * FROM pages WHERE id = ?', page.parent_id);
      if (!parent || parent.deleted_at) {
        q.run(`UPDATE pages SET parent_id = NULL, parent_type = 'workspace', visibility = ? WHERE id = ?`, parent?.visibility || 'private', pageId);
      } else if (parent.type === 'page') {
        const exists = q.get(`SELECT id FROM blocks WHERE page_id = ? AND type IN ('page','child_database') AND json_extract(content, '$.pageId') = ?`, parent.id, pageId);
        if (!exists) {
          const t = now();
          q.run(
            `INSERT INTO blocks (id, page_id, parent_block_id, type, content, position, created_by, created_at, updated_by, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
            uid(),
            parent.id,
            page.type === 'database' ? 'child_database' : 'page',
            JSON.stringify({ pageId }),
            nextBlockPosition(parent.id),
            user.id,
            t,
            user.id,
            t,
          );
        }
      }
    }
    return ids;
  });
}

export function duplicatePage(user, pageId, { parentId, workspaceId, titleSuffix = ' (1)', position } = {}) {
  return tx(() => {
    const src = q.get('SELECT * FROM pages WHERE id = ?', pageId);
    const idMap = new Map();
    const copy = (p, newParentId, isRoot) => {
      const newId = uid();
      idMap.set(p.id, newId);
      const t = now();
      q.run(
        `INSERT INTO pages (id, workspace_id, parent_id, parent_type, type, title, icon, cover, properties, schema, format, is_inline, visibility, position, search_text, created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId,
        workspaceId || p.workspace_id,
        newParentId,
        newParentId ? (isRoot ? p.parent_type : p.parent_type) : 'workspace',
        p.type,
        isRoot ? p.title + titleSuffix : p.title,
        p.icon,
        p.cover,
        p.properties,
        p.schema,
        p.format,
        p.is_inline,
        p.visibility,
        isRoot ? (position ?? p.position + 0.5) : p.position,
        p.search_text,
        user.id,
        t,
        user.id,
        t,
      );
      for (const v of q.all('SELECT * FROM db_views WHERE database_id = ?', p.id)) {
        q.run('INSERT INTO db_views (id, database_id, name, type, config, position) VALUES (?, ?, ?, ?, ?, ?)', uid(), newId, v.name, v.type, v.config, v.position);
      }
      for (const c of q.all('SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL', p.id)) copy(c, newId, false);
      return newId;
    };
    const newRoot = copy(src, parentId !== undefined ? parentId : src.parent_id, true);
    // Copy blocks, remapping block ids and references to duplicated sub-pages.
    for (const [oldPageId, newPageId] of idMap) {
      const blocks = q.all('SELECT * FROM blocks WHERE page_id = ?', oldPageId);
      const bmap = new Map(blocks.map((b) => [b.id, uid()]));
      for (const b of blocks) {
        let content = json.parse(b.content, {});
        if ((b.type === 'page' || b.type === 'child_database') && content.pageId) {
          if (!idMap.has(content.pageId)) continue; // trashed sub-page: skip
          content = { ...content, pageId: idMap.get(content.pageId) };
        }
        const t = now();
        q.run(
          `INSERT INTO blocks (id, page_id, parent_block_id, type, content, position, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          bmap.get(b.id),
          newPageId,
          b.parent_block_id ? bmap.get(b.parent_block_id) || null : null,
          b.type,
          JSON.stringify(content),
          b.position,
          user.id,
          t,
          user.id,
          t,
        );
      }
    }
    // Database rows reference property ids of their own schema; schemas were copied verbatim so ids stay valid.
    const parent = src.parent_id ? q.get('SELECT * FROM pages WHERE id = ?', src.parent_id) : null;
    if (parent && parent.type === 'page' && (parentId === undefined || parentId === src.parent_id)) {
      const srcBlock = q.get(`SELECT * FROM blocks WHERE page_id = ? AND json_extract(content, '$.pageId') = ?`, parent.id, src.id);
      const t = now();
      q.run(
        `INSERT INTO blocks (id, page_id, parent_block_id, type, content, position, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid(),
        parent.id,
        srcBlock?.parent_block_id || null,
        src.type === 'database' ? 'child_database' : 'page',
        JSON.stringify({ pageId: newRoot }),
        srcBlock ? srcBlock.position + 0.001 : nextBlockPosition(parent.id),
        user.id,
        t,
        user.id,
        t,
      );
    }
    return newRoot;
  });
}

export function createView(databaseId, { name, type, config }, position) {
  const id = uid();
  const db = q.get('SELECT schema FROM pages WHERE id = ?', databaseId);
  const schema = json.parse(db?.schema, defaultSchema());
  const cfg = { ...defaultViewConfig(type, schema), ...(config || {}) };
  const pos = position ?? (q.get('SELECT MAX(position) AS m FROM db_views WHERE database_id = ?', databaseId)?.m ?? 0) + 1;
  q.run('INSERT INTO db_views (id, database_id, name, type, config, position) VALUES (?, ?, ?, ?, ?, ?)', id, databaseId, name || cap(type), type, JSON.stringify(cfg), pos);
  return q.get('SELECT * FROM db_views WHERE id = ?', id);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Notifications ----------

export function notify(userId, { type, workspaceId, actorId, pageId, data }) {
  if (!userId || userId === actorId) return;
  const id = uid();
  q.run(
    'INSERT INTO notifications (id, user_id, workspace_id, type, actor_id, page_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    userId,
    workspaceId || null,
    type,
    actorId || null,
    pageId || null,
    JSON.stringify(data || {}),
    now(),
  );
  toUser(userId, { type: 'notification' });
}

// ---------- Snapshots (page history) ----------

const SNAPSHOT_INTERVAL = 5 * 60 * 1000;

export function maybeSnapshot(pageId, userId, force = false) {
  const last = q.get('SELECT created_at FROM page_snapshots WHERE page_id = ? ORDER BY created_at DESC LIMIT 1', pageId);
  if (!force && last && now() - last.created_at < SNAPSHOT_INTERVAL) return;
  const page = q.get('SELECT title, icon FROM pages WHERE id = ?', pageId);
  const blocks = q.all('SELECT * FROM blocks WHERE page_id = ?', pageId).map(rowFromBlock);
  q.run(
    'INSERT INTO page_snapshots (id, page_id, title, icon, blocks, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    uid(),
    pageId,
    page.title,
    page.icon,
    JSON.stringify(blocks),
    userId,
    now(),
  );
}

// ---------- Onboarding ----------

function createOnboardingPage(user, workspaceId) {
  const R = (text) => ({ type: 'text', content: { text } });
  createPage(user, {
    workspaceId,
    title: 'Getting Started',
    icon: '👋',
    visibility: 'private',
    blocks: [
      { type: 'text', content: { text: '👋 Welcome to Notion!' } },
      { type: 'text', content: { text: 'Here are the basics:' } },
      { type: 'to_do', content: { text: 'Click anywhere and just start typing' } },
      { type: 'to_do', content: { text: 'Hit <code>/</code> to see all the types of content you can add - headers, videos, sub pages, etc.' } },
      { type: 'to_do', content: { text: 'Highlight any text, and use the menu that pops up to <b>style</b> <i>your</i> <s>writing</s> <code>however</code> <span data-color="blue">you</span> <span data-bg="yellow">like</span>' } },
      { type: 'to_do', content: { text: 'See the <code>⋮⋮</code> to the left of this checkbox on hover? Click and drag to move this line' } },
      { type: 'to_do', content: { text: 'Click the <code>+ New Page</code> button at the bottom of your sidebar to add a new page' } },
      { type: 'to_do', content: { text: 'Click <code>Share</code> in the top right to invite collaborators to this page' } },
      {
        type: 'toggle',
        content: { text: 'Toggle lists hide content inside. Click the arrow to open.' },
        children: [R('You can put anything inside a toggle — text, images, even other pages.')],
      },
      { type: 'heading_2', content: { text: 'Have a question?' } },
      { type: 'callout', content: { text: 'Press <code>Ctrl</code> + <code>K</code> to search across every page in your workspace.', icon: '🔎', color: 'gray_background' } },
    ],
  });
}

export function ensureDemoUser({ email, name, password }) {
  const existing = q.get('SELECT * FROM users WHERE email = ?', email);
  if (existing) return existing;
  return createUser({ email, name, password }).user;
}
