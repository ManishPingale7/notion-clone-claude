import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { startServer, client, signup } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv.stop();
});

test('signup, login, logout and session handling', async () => {
  const { c, user, workspaces } = await signup(srv.base, 'Ada Lovelace', 'ada@example.com');
  assert.equal(user.name, 'Ada Lovelace');
  assert.equal(workspaces.length, 1, 'a personal workspace is created');
  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  const dup = await client(srv.base).post('/api/auth/signup', { name: 'X', email: 'ADA@example.com', password: 'password123' });
  assert.equal(dup.status, 400, 'emails are unique case-insensitively');
  const short = await client(srv.base).post('/api/auth/signup', { name: 'X', email: 'x@example.com', password: 'short' });
  assert.equal(short.status, 400);
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).status, 401);
  const bad = await c.post('/api/auth/login', { email: 'ada@example.com', password: 'wrong-password' });
  assert.equal(bad.status, 401);
  const ok = await c.post('/api/auth/login', { email: 'ada@example.com', password: 'password123' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 200);
});

test('onboarding page exists and pages/blocks CRUD via transactions', async () => {
  const { c, workspaces } = await signup(srv.base, 'Bea', 'bea@example.com');
  const wsId = workspaces[0].id;
  const side = await c.get(`/api/workspaces/${wsId}/sidebar`);
  assert.ok(side.data.pages.some((p) => p.title === 'Getting Started' && p.section === 'private'));

  const created = await c.post('/api/pages', { workspaceId: wsId, title: 'Notes' });
  assert.equal(created.status, 201);
  const pageId = created.data.page.id;
  const b1 = crypto.randomUUID();
  const b2 = crypto.randomUUID();
  let r = await c.post(`/api/pages/${pageId}/transactions`, {
    ops: [
      { type: 'insert', block: { id: b1, type: 'heading_1', content: { text: 'Hello <script>alert(1)</script><b>world</b>' }, position: 1 } },
      { type: 'insert', block: { id: b2, type: 'to_do', content: { text: 'task', checked: true }, position: 2 } },
    ],
  });
  assert.equal(r.status, 200);
  r = await c.get(`/api/pages/${pageId}`);
  const h = r.data.blocks.find((b) => b.id === b1);
  assert.equal(h.content.text, 'Hello <b>world</b>', 'rich text is sanitized');
  assert.equal(r.data.blocks.find((b) => b.id === b2).content.checked, true);

  // update + nest + delete
  r = await c.post(`/api/pages/${pageId}/transactions`, {
    ops: [
      { type: 'update', id: b2, set: { parentId: b1, content: { text: 'task edited', checked: false } } },
      { type: 'update', id: b1, set: { type: 'text' } },
    ],
  });
  assert.equal(r.status, 200);
  r = await c.get(`/api/pages/${pageId}`);
  assert.equal(r.data.blocks.find((b) => b.id === b2).parentId, b1);
  assert.equal(r.data.blocks.find((b) => b.id === b1).type, 'text');
  // a block cannot become its own ancestor
  r = await c.post(`/api/pages/${pageId}/transactions`, { ops: [{ type: 'update', id: b1, set: { parentId: b2 } }] });
  assert.equal(r.status, 400);
  r = await c.post(`/api/pages/${pageId}/transactions`, { ops: [{ type: 'delete', id: b1 }] });
  r = await c.get(`/api/pages/${pageId}`);
  assert.equal(r.data.blocks.length, 0, 'deleting a block removes its children');

  // search indexes block text
  await c.post(`/api/pages/${pageId}/transactions`, { ops: [{ type: 'insert', block: { id: crypto.randomUUID(), type: 'text', content: { text: 'the quick zebra' } } }] });
  const s = await c.get(`/api/workspaces/${wsId}/search?q=zebra`);
  assert.equal(s.data.results[0].id, pageId);
  assert.match(s.data.results[0].snippet, /zebra/);
});

test('sub-pages, trash, restore and permanent delete', async () => {
  const { c, workspaces } = await signup(srv.base, 'Cy', 'cy@example.com');
  const wsId = workspaces[0].id;
  const parent = (await c.post('/api/pages', { workspaceId: wsId, title: 'Parent' })).data.page;
  const child = await c.post('/api/pages', { parentId: parent.id, title: 'Child' });
  assert.ok(child.data.block, 'creating a sub-page inserts a page block in the parent');
  const grand = (await c.post('/api/pages', { parentId: child.data.page.id, title: 'Grandchild' })).data.page;

  await c.del(`/api/pages/${child.data.page.id}`);
  let trash = await c.get(`/api/workspaces/${wsId}/trash`);
  assert.deepEqual(trash.data.pages.map((p) => p.title), ['Child'], 'only the top of a trashed subtree is listed');
  let side = await c.get(`/api/workspaces/${wsId}/sidebar`);
  assert.ok(!side.data.pages.some((p) => p.id === grand.id), 'descendants leave the sidebar');

  await c.post(`/api/pages/${child.data.page.id}/restore`);
  side = await c.get(`/api/workspaces/${wsId}/sidebar`);
  assert.ok(side.data.pages.some((p) => p.id === grand.id), 'restore brings back descendants');

  await c.del(`/api/pages/${child.data.page.id}`);
  const perm = await c.del(`/api/pages/${child.data.page.id}/permanent`);
  assert.equal(perm.status, 200);
  assert.equal((await c.get(`/api/pages/${grand.id}`)).status, 404);
  const p = await c.get(`/api/pages/${parent.id}`);
  assert.ok(!p.data.blocks.some((b) => b.type === 'page'), 'page block removed from parent');
});

test('permissions: private pages, sharing roles, guests and workspace members', async () => {
  const alice = await signup(srv.base, 'Alice', 'alice-t@example.com');
  const bob = await signup(srv.base, 'Bob', 'bob-t@example.com');
  const wsId = alice.workspaces[0].id;
  const priv = (await alice.c.post('/api/pages', { workspaceId: wsId, title: 'Secret' })).data.page;

  assert.equal((await bob.c.get(`/api/pages/${priv.id}`)).status, 404, 'others cannot read a private page');
  assert.equal((await bob.c.get(`/api/workspaces/${wsId}/sidebar`)).status, 403, 'non-members cannot list workspace');

  // share as view-only -> bob is a guest
  let r = await alice.c.post(`/api/pages/${priv.id}/permissions`, { email: 'bob-t@example.com', role: 'view' });
  assert.equal(r.status, 201);
  r = await bob.c.get(`/api/pages/${priv.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.role, 'view');
  r = await bob.c.post(`/api/pages/${priv.id}/transactions`, { ops: [{ type: 'insert', block: { id: crypto.randomUUID(), type: 'text', content: { text: 'hack' } } }] });
  assert.equal(r.status, 403, 'viewers cannot edit');
  r = await bob.c.post(`/api/pages/${priv.id}/discussions`, { body: 'nope' });
  assert.equal(r.status, 403, 'viewers cannot comment');
  const bobSide = await bob.c.get(`/api/workspaces/${wsId}/sidebar`);
  assert.equal(bobSide.status, 200, 'guests can load the sidebar of the workspace they were invited to');
  assert.deepEqual(bobSide.data.pages.map((p) => [p.title, p.section]), [['Secret', 'shared']]);
  const bobWs = await bob.c.get('/api/workspaces');
  assert.ok(bobWs.data.workspaces.some((w) => w.id === wsId && w.role === 'guest'));

  // upgrade to edit; sub-pages inherit
  await alice.c.patch(`/api/pages/${priv.id}/permissions/${bob.user.id}`, { role: 'edit' });
  const sub = (await alice.c.post('/api/pages', { parentId: priv.id, title: 'Inner' })).data.page;
  r = await bob.c.post(`/api/pages/${sub.id}/transactions`, { ops: [{ type: 'insert', block: { id: crypto.randomUUID(), type: 'text', content: { text: 'bob was here' } } }] });
  assert.equal(r.status, 200, 'editor access is inherited by sub-pages');
  r = await bob.c.post(`/api/pages/${priv.id}/permissions`, { email: 'alice-t@example.com', role: 'view' });
  assert.equal(r.status, 403, 'only full access can share');

  // revoke
  await alice.c.del(`/api/pages/${priv.id}/permissions/${bob.user.id}`);
  assert.equal((await bob.c.get(`/api/pages/${sub.id}`)).status, 404);

  // workspace section pages are visible to members
  const shared = (await alice.c.post('/api/pages', { workspaceId: wsId, title: 'Team page', visibility: 'workspace' })).data.page;
  assert.equal((await bob.c.get(`/api/pages/${shared.id}`)).status, 404);
  r = await alice.c.post(`/api/workspaces/${wsId}/members`, { email: 'bob-t@example.com' });
  assert.equal(r.status, 201);
  r = await bob.c.get(`/api/pages/${shared.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.role, 'full');
  assert.equal((await bob.c.get(`/api/pages/${priv.id}`)).status, 404, 'membership does not reveal private pages');
  // members cannot change workspace settings
  assert.equal((await bob.c.patch(`/api/workspaces/${wsId}`, { name: 'x' })).status, 403);
  // notifications were created for bob
  const n = await bob.c.get('/api/notifications');
  assert.ok(n.data.notifications.some((x) => x.type === 'workspace_joined'));
});

test('invites for unknown emails are applied at signup', async () => {
  const owner = await signup(srv.base, 'Owner', 'owner-i@example.com');
  const wsId = owner.workspaces[0].id;
  const page = (await owner.c.post('/api/pages', { workspaceId: wsId, title: 'For Dana' })).data.page;
  await owner.c.post(`/api/pages/${page.id}/permissions`, { email: 'dana@example.com', role: 'comment' });
  await owner.c.post(`/api/workspaces/${wsId}/members`, { email: 'erin@example.com' });
  const dana = await signup(srv.base, 'Dana', 'dana@example.com');
  const r = await dana.c.get(`/api/pages/${page.id}`);
  assert.equal(r.data.role, 'comment');
  const erin = await signup(srv.base, 'Erin', 'erin@example.com');
  assert.ok(erin.workspaces.some((w) => w.id === wsId && w.role === 'member'));
});

test('databases: schema, rows, properties, views and validation', async () => {
  const { c, workspaces, user } = await signup(srv.base, 'Dee', 'dee@example.com');
  const wsId = workspaces[0].id;
  const db = (await c.post('/api/pages', { workspaceId: wsId, type: 'database', title: 'Tasks', viewType: 'board' })).data.page;
  let d = (await c.get(`/api/databases/${db.id}`)).data;
  assert.equal(d.views[0].type, 'board');
  let r = await c.post(`/api/databases/${db.id}/properties`, { type: 'select', name: 'Priority', options: [{ id: 'hi', name: 'High', color: 'red' }] });
  assert.equal(r.status, 201);
  const prio = r.data.property;
  r = await c.post(`/api/databases/${db.id}/properties`, { type: 'number', name: 'Points' });
  const pts = r.data.property;
  r = await c.post(`/api/databases/${db.id}/properties`, { type: 'unique_id', name: 'ID' });
  const uid = r.data.property;

  const row = (await c.post('/api/pages', { parentId: db.id, title: 'Write docs', properties: { [prio.id]: 'hi', [pts.id]: '5', bogus: 1 } })).data.page;
  assert.equal(row.parentType, 'database');
  assert.equal(row.properties[prio.id], 'hi');
  assert.equal(row.properties[pts.id], 5, 'numbers are coerced');
  assert.equal(row.properties[uid.id], 1, 'unique ids are assigned');
  assert.equal(row.properties.bogus, undefined);
  r = await c.patch(`/api/pages/${row.id}`, { properties: { [prio.id]: 'not-an-option', [pts.id]: 8 } });
  assert.equal(r.data.page.properties[prio.id], null, 'invalid select values are rejected');
  assert.equal(r.data.page.properties[pts.id], 8);
  const row2 = (await c.post('/api/pages', { parentId: db.id, title: 'Second' })).data.page;
  assert.equal(row2.properties[uid.id], 2);

  // change type number -> text converts values
  r = await c.patch(`/api/databases/${db.id}/properties/${pts.id}`, { type: 'text' });
  d = (await c.get(`/api/databases/${db.id}`)).data;
  assert.equal(d.rows.find((x) => x.id === row.id).properties[pts.id], '8');

  // person property notifies assignee (self-assignment does not)
  const pp = (await c.post(`/api/databases/${db.id}/properties`, { type: 'person', name: 'Owner' })).data.property;
  await c.patch(`/api/pages/${row.id}`, { properties: { [pp.id]: [user.id] } });

  // views
  r = await c.post(`/api/databases/${db.id}/views`, { type: 'table', name: 'Everything' });
  assert.equal(r.status, 201);
  r = await c.patch(`/api/views/${r.data.view.id}`, { config: { sorts: [{ property: 'title', direction: 'asc' }] } });
  assert.deepEqual(r.data.view.config.sorts, [{ property: 'title', direction: 'asc' }]);
  // delete property cleans views
  await c.del(`/api/databases/${db.id}/properties/${prio.id}`);
  d = (await c.get(`/api/databases/${db.id}`)).data;
  assert.ok(!d.database.schema.properties[prio.id]);
  assert.equal((await c.del(`/api/databases/${db.id}/properties/title`)).status, 400, 'title cannot be deleted');
  // reorder
  await c.post(`/api/databases/${db.id}/reorder`, { ids: [row2.id, row.id] });
  d = (await c.get(`/api/databases/${db.id}`)).data;
  assert.deepEqual(d.rows.map((x) => x.title), ['Second', 'Write docs']);
  // rows are searchable, markdown export works
  const s = await c.get(`/api/workspaces/${wsId}/search?q=write`);
  assert.ok(s.data.results.some((x) => x.id === row.id));
  const exp = await fetch(srv.base + `/api/pages/${db.id}/export`, { headers: { Cookie: c.cookie } });
  assert.match(await exp.text(), /\| Name \|/);
});

test('publish to web gives anonymous read-only access', async () => {
  const { c, workspaces } = await signup(srv.base, 'Pub', 'pub@example.com');
  const page = (await c.post('/api/pages', { workspaceId: workspaces[0].id, title: 'Public doc' })).data.page;
  const sub = (await c.post('/api/pages', { parentId: page.id, title: 'Public child' })).data.page;
  const anon = client(srv.base);
  assert.equal((await anon.get(`/api/public/pages/${page.id}`)).status, 404);
  await c.patch(`/api/pages/${page.id}/publish`, { public: true });
  const r = await anon.get(`/api/public/pages/${page.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.page.title, 'Public doc');
  assert.equal((await anon.get(`/api/public/pages/${sub.id}`)).status, 200, 'sub-pages are published too');
  assert.equal((await anon.get(`/api/pages/${page.id}`)).status, 401, 'the private API still requires login');
});

test('comments, mentions and notifications', async () => {
  const a = await signup(srv.base, 'Ann', 'ann@example.com');
  const b = await signup(srv.base, 'Ben', 'ben@example.com');
  const wsId = a.workspaces[0].id;
  await a.c.post(`/api/workspaces/${wsId}/members`, { email: 'ben@example.com' });
  const page = (await a.c.post('/api/pages', { workspaceId: wsId, title: 'Plan', visibility: 'workspace' })).data.page;
  const mention = `<span class="mention" data-type="user" data-id="${b.user.id}" contenteditable="false">@Ben</span> please review`;
  await a.c.post(`/api/pages/${page.id}/transactions`, { ops: [{ type: 'insert', block: { id: crypto.randomUUID(), type: 'text', content: { text: mention } } }] });
  let n = (await b.c.get('/api/notifications')).data;
  assert.ok(n.notifications.some((x) => x.type === 'mention' && x.page.id === page.id));
  const unreadBefore = n.unread;

  const d = await b.c.post(`/api/pages/${page.id}/discussions`, { body: 'Looks good!' });
  assert.equal(d.status, 201);
  const disc = d.data.discussions[0];
  n = (await a.c.get('/api/notifications')).data;
  assert.ok(n.notifications.some((x) => x.type === 'comment'), 'page owner is notified about comments');
  await a.c.post(`/api/discussions/${disc.id}/comments`, { body: 'Thanks' });
  const resolved = await a.c.patch(`/api/discussions/${disc.id}`, { resolved: true });
  assert.equal(resolved.data.discussions[0].resolved, true);
  assert.equal((await a.c.patch(`/api/comments/${disc.comments[0].id}`, { body: 'edit' })).status, 403, 'cannot edit others’ comments');

  await b.c.post('/api/notifications/read', { all: true });
  n = (await b.c.get('/api/notifications')).data;
  assert.ok(unreadBefore > 0);
  assert.equal(n.unread, 0);
});

test('page history snapshots can be restored', async () => {
  const { c, workspaces } = await signup(srv.base, 'Hal', 'hal@example.com');
  const page = (await c.post('/api/pages', { workspaceId: workspaces[0].id, title: 'Versioned' })).data.page;
  const id = crypto.randomUUID();
  await c.post(`/api/pages/${page.id}/transactions`, { ops: [{ type: 'insert', block: { id, type: 'text', content: { text: 'v1' } } }] });
  // second edit snapshots the state after v1 only after 5 minutes; force via restore endpoint semantics:
  let h = (await c.get(`/api/pages/${page.id}/history`)).data.versions;
  assert.equal(h.length, 1, 'first edit captured the pre-edit snapshot');
  await c.post(`/api/pages/${page.id}/transactions`, { ops: [{ type: 'update', id, set: { content: { text: 'v2' } } }] });
  const r = await c.post(`/api/pages/${page.id}/history/${h[0].id}/restore`);
  assert.equal(r.status, 200);
  const p = (await c.get(`/api/pages/${page.id}`)).data;
  assert.equal(p.blocks.length, 0, 'restored to the empty initial version');
  h = (await c.get(`/api/pages/${page.id}/history`)).data.versions;
  assert.equal(h.length, 2, 'restoring snapshots the current content first');
});

test('realtime: block ops are broadcast to other subscribers', async () => {
  const a = await signup(srv.base, 'Rae', 'rae@example.com');
  const page = (await a.c.post('/api/pages', { workspaceId: a.workspaces[0].id, title: 'Live' })).data.page;
  const ws = new WebSocket(srv.base.replace('http', 'ws') + '/ws?clientId=listener', { headers: { Cookie: a.c.cookie } });
  const messages = [];
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ws.on('message', (m) => messages.push(JSON.parse(m.toString())));
  ws.send(JSON.stringify({ type: 'subscribe', rooms: ['page:' + page.id] }));
  await new Promise((r) => setTimeout(r, 100));
  await a.c.post(`/api/pages/${page.id}/transactions`, { ops: [{ type: 'insert', block: { id: crypto.randomUUID(), type: 'text', content: { text: 'hi' } } }] });
  await new Promise((r) => setTimeout(r, 200));
  ws.close();
  const op = messages.find((m) => m.type === 'ops');
  assert.ok(op, 'received ops broadcast');
  assert.equal(op.ops[0].block.content.text, 'hi');

  // unauthenticated sockets are rejected
  const bad = new WebSocket(srv.base.replace('http', 'ws') + '/ws');
  const code = await new Promise((resolve) => {
    bad.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    bad.on('error', () => resolve('error'));
  });
  assert.equal(code, 401);
});
