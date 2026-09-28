// Creates two demo accounts sharing an "Acme Inc" workspace with a few example
// pages and a project-tracker database, so the app can be evaluated quickly.
// Safe to run more than once: it does nothing if the demo users already exist.
import { openDb, q, json } from './db.js';
import { createUser, createWorkspace, createPage, createView } from './services.js';
import { now } from './lib/util.js';

openDb();

const PASSWORD = 'password123';
if (q.get('SELECT id FROM users WHERE email = ?', 'alice@example.com')) {
  console.log('Demo data already present. Log in as alice@example.com / bob@example.com with password "password123".');
  process.exit(0);
}

const { user: alice } = createUser({ email: 'alice@example.com', name: 'Alice Chen', password: PASSWORD });
const { user: bob } = createUser({ email: 'bob@example.com', name: 'Bob Martinez', password: PASSWORD });
const ws = createWorkspace(alice, 'Acme Inc', { icon: '🚀' });
q.run('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', ws.id, bob.id, 'member', now());

const P = (text) => ({ type: 'text', content: { text } });

const { page: wiki } = createPage(alice, {
  workspaceId: ws.id,
  title: 'Team Wiki',
  icon: '📚',
  visibility: 'workspace',
  cover: { type: 'color', value: 'gradient_2', position: 50 },
  blocks: [
    { type: 'callout', content: { icon: '💡', text: 'Everything the team needs to know lives here. Edit freely — changes sync live for everyone.', color: 'blue_background' } },
    { type: 'heading_2', content: { text: 'How we work' } },
    { type: 'bulleted_list', content: { text: 'We write things down. Decisions go in <b>Meeting Notes</b>.' } },
    { type: 'bulleted_list', content: { text: 'Projects are tracked in the <b>Projects</b> database below.' } },
    { type: 'bulleted_list', content: { text: 'Ask questions in comments — mention people with <code>@</code>.' } },
    { type: 'heading_2', content: { text: 'Engineering setup' } },
    { type: 'numbered_list', content: { text: 'Clone the repository' } },
    { type: 'numbered_list', content: { text: 'Run <code>npm install</code>' } },
    { type: 'numbered_list', content: { text: 'Start the dev server with <code>npm run dev</code>' } },
    { type: 'code', content: { language: 'bash', text: 'git clone git@github.com:acme/app.git\ncd app && npm install\nnpm run dev' } },
    { type: 'quote', content: { text: 'Simple things should be simple, complex things should be possible. — Alan Kay' } },
    { type: 'divider', content: {} },
  ],
});
q.run('UPDATE pages SET cover = ? WHERE id = ?', JSON.stringify({ type: 'color', value: 'gradient_2', position: 50 }), wiki.id);

createPage(alice, {
  workspaceId: ws.id,
  parentId: wiki.id,
  title: 'Onboarding checklist',
  icon: '✅',
  blocks: [
    { type: 'to_do', content: { text: 'Set up your laptop', checked: true } },
    { type: 'to_do', content: { text: 'Read the Team Wiki' } },
    { type: 'to_do', content: { text: 'Say hi in #general' } },
    { type: 'toggle', content: { text: 'Useful links' }, children: [P('<a href="https://www.notion.so/help">Notion Help Center</a>')] },
  ],
});

// Projects database (full page) with a board view
const opt = (id, name, color) => ({ id, name, color });
const schema = {
  properties: {
    title: { id: 'title', name: 'Project', type: 'title' },
    status: { id: 'status', name: 'Status', type: 'status', options: [
      { id: 'not-started', name: 'Not started', color: 'default', group: 'todo' },
      { id: 'in-progress', name: 'In progress', color: 'blue', group: 'in_progress' },
      { id: 'done', name: 'Done', color: 'green', group: 'complete' },
    ] },
    owner: { id: 'owner', name: 'Owner', type: 'person' },
    priority: { id: 'priority', name: 'Priority', type: 'select', options: [opt('high', 'High', 'red'), opt('medium', 'Medium', 'yellow'), opt('low', 'Low', 'gray')] },
    due: { id: 'due', name: 'Due date', type: 'date', dateFormat: 'relative' },
    tags: { id: 'tags', name: 'Tags', type: 'multi_select', options: [opt('web', 'Web', 'blue'), opt('mobile', 'Mobile', 'purple'), opt('infra', 'Infra', 'orange'), opt('design', 'Design', 'pink')] },
    budget: { id: 'budget', name: 'Budget', type: 'number', format: 'dollar' },
    done: { id: 'shipped', name: 'Shipped', type: 'checkbox' },
  },
  order: ['title', 'status', 'owner', 'priority', 'due', 'tags', 'budget', 'shipped'],
};
schema.properties.shipped = schema.properties.done;
delete schema.properties.done;
const { page: projects } = createPage(alice, {
  workspaceId: ws.id,
  parentId: wiki.id,
  type: 'database',
  title: 'Projects',
  icon: '🎯',
  schema,
  views: [{ name: 'All projects', type: 'table' }],
});
const board = createView(projects.id, { name: 'Board', type: 'board', config: { groupBy: 'status' } });
createView(projects.id, { name: 'Calendar', type: 'calendar', config: { dateBy: 'due' } });
void board;
const day = (d) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.toISOString().slice(0, 10);
};
const rows = [
  ['Website redesign', 'in-progress', [alice.id], 'high', day(5), ['web', 'design'], 12000, false],
  ['Mobile app v2', 'not-started', [bob.id], 'medium', day(21), ['mobile'], 30000, false],
  ['Migrate to Postgres', 'in-progress', [bob.id], 'high', day(2), ['infra'], 8000, false],
  ['Brand refresh', 'done', [alice.id], 'low', day(-7), ['design'], 5000, true],
  ['Customer portal', 'not-started', [], 'medium', day(40), ['web'], 15000, false],
];
rows.forEach(([title, status, owner, priority, due, tags, budget, shipped], i) => {
  createPage(alice, {
    workspaceId: ws.id,
    parentId: projects.id,
    title,
    position: i + 1,
    properties: { status, owner, priority, due: { start: due }, tags, budget, shipped },
    blocks: [
      { type: 'heading_3', content: { text: 'Goals' } },
      P(`Deliver <b>${title}</b> on time and on budget.`),
      { type: 'to_do', content: { text: 'Kick-off meeting', checked: i % 2 === 0 } },
    ],
  });
});

createPage(bob, {
  workspaceId: ws.id,
  title: 'Meeting Notes',
  icon: '🗓️',
  visibility: 'workspace',
  blocks: [
    { type: 'heading_1', content: { text: 'Weekly sync' } },
    P(`Attendees: <span class="mention" data-type="user" data-id="${alice.id}" contenteditable="false">@${alice.name}</span>, <span class="mention" data-type="user" data-id="${bob.id}" contenteditable="false">@${bob.name}</span>`),
    { type: 'heading_3', content: { text: 'Decisions' } },
    { type: 'bulleted_list', content: { text: 'Ship the website redesign behind a feature flag' } },
    { type: 'bulleted_list', content: { text: 'Postgres migration happens this weekend' } },
    { type: 'heading_3', content: { text: 'Action items' } },
    { type: 'to_do', content: { text: 'Alice: share design specs' } },
    { type: 'to_do', content: { text: 'Bob: write migration runbook' } },
  ],
});

createPage(alice, {
  workspaceId: ws.id,
  title: 'Personal notes',
  icon: '🔒',
  visibility: 'private',
  blocks: [P('Only Alice can see this page — it lives in her Private section.')],
});

console.log('Seeded demo data:');
console.log('  alice@example.com / password123  (owner of "Acme Inc")');
console.log('  bob@example.com   / password123  (member of "Acme Inc")');
void json;
