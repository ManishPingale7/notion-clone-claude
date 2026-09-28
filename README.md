# Notion clone

A full-stack clone of Notion: a block editor with nested pages, databases with six view layouts, sharing and permissions, real-time collaboration, comments, search, trash, page history and publish-to-web. It runs on a local Node server with a local SQLite database. No paid services, API keys or native builds are needed.

## Quick start

Requires **Node.js 22.13 or newer**. It uses Node's built-in `node:sqlite` module.

```bash
npm install          # installs server + client workspaces
npm run seed         # optional: demo users and an "Acme Inc" workspace
npm start            # builds the client and serves everything on http://127.0.0.1:3001
```

Demo accounts (after `npm run seed`). Both use the password `password123`:

| Email | Role |
| --- | --- |
| alice@example.com | owner of the *Acme Inc* workspace |
| bob@example.com | member of *Acme Inc* |

Or sign up with any email. Each new account gets its own workspace with a "Getting Started" page.

### Development

```bash
npm run dev          # API on :3001 (auto-restart) + Vite on http://127.0.0.1:5173 (hot reload)
```

### Tests

```bash
npm run test:api                  # backend: 10 node:test suites against a throwaway database
npx playwright install chromium   # once
npm run test:e2e                  # builds the client, starts a fresh seeded server on :3100, runs 19 browser tests
npm test                          # both
```

### Other scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Production build of the client into `client/dist` |
| `npm run serve` | Start the server without rebuilding |
| `npm run reset-db` | Delete the local database and uploads |
| `npm run typecheck` | TypeScript check of the client |

### Configuration (environment variables, all optional)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (use `0.0.0.0` to expose on your network) |
| `DATA_DIR` | `server/data` | Where the SQLite file and uploads live |
| `DB_FILE` | `$DATA_DIR/notion.db` | SQLite file path |
| `SECURE_COOKIES` | `false` | Set to `true` behind HTTPS |

Data is stored in `server/data/notion.db` (SQLite, WAL mode). Uploaded files go to `server/data/uploads/`. Everything survives page refreshes and server restarts.

## Deploy (Render, free, no card)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ManishPingale7/notion-clone-claude)

`render.yaml` defines a single free web service. It builds the client (`npm ci --include=dev && npm run build`) and runs `npm run serve`, which serves the React app, the REST API and the WebSocket endpoint from one origin. Click the button, sign in to Render with GitHub, and click **Apply**. The app is then live at `https://notion-clone-<suffix>.onrender.com`.

Free-plan caveats:
- Render's free plan has **no persistent disk**. The SQLite database and uploads live on the instance's temporary filesystem, so they reset whenever the service sleeps (after about 15 minutes idle) or redeploys. `SEED_DEMO=true` recreates the demo accounts on every boot. For durable data, attach a Render disk (paid) and set `DATA_DIR` to its mount path.
- The first request after the service has been idle takes about 30–60 seconds while it wakes up.

The server also supports a split deployment, with a static frontend on one host and the API on another. Build the client with `VITE_WS_URL=wss://<api-host>` and proxy `/api` and `/uploads` to the API host. The browser then opens the WebSocket to the API host using a short-lived single-use token from `POST /api/auth/ws-token`.

## Features

### Accounts and workspaces
- Sign up, log in, log out and change your password. Passwords are hashed with scrypt, and sessions use HTTP-only cookies.
- Profile name, avatar upload, and a light/dark/system theme saved per account. `Ctrl+Shift+L` toggles dark mode.
- Multiple workspaces with a switcher. You can create, rename, set an icon on, delete or leave a workspace.
- Members have one of two roles, **owner** or **member**. You invite people by email. If the email has no account yet, the invite is stored and applied when that person signs up.

### Sidebar and navigation
- Sections: **Favorites**, **Workspace** (shared with every member), **Shared** (pages others shared with you) and **Private**.
- A nested page tree. Hover shows the expand arrow, "…" and "+". The page menu covers favorite, copy link, duplicate, rename (with an icon picker), move to, trash and open in new tab.
- Drag pages to reorder them, nest them or move them between sections. You can also drop editor blocks onto a sidebar page to move them there.
- The sidebar can be resized (drag its edge) and collapsed (`Ctrl+\`). When collapsed it opens on hover. On phones it is an overlay.
- **Home** shows a greeting, recently visited pages and favorites. **Inbox** shows notifications. **Trash** lets you search, restore and permanently delete.
- **Search** (`Ctrl+K` / `Ctrl+P`) covers page titles and body text. Results show highlighted snippets and page paths. You can sort by best match or last edited, filter to titles only, and navigate with the keyboard.

### Pages
- Icons (emoji picker with search, random, or an uploaded/linked image) and covers (gradient/colour gallery, upload or link, and reposition).
- Breadcrumbs, "Edited X ago", favorite toggle, and presence avatars of other people on the page.
- The page menu offers:
  - Font (Default, Serif, Mono), small text, full width, and lock page.
  - Copy link, duplicate (including sub-pages), move to, and move to Trash.
  - Version history, Markdown export, and word count.
- Version history: snapshots are taken automatically at most every 5 minutes while you edit. You can preview any version and restore it.
- Backlinks: "N backlinks" lists the pages that mention this page.
- An empty page offers "Get started with": an empty page, or a Table, Board, List, Gallery, Calendar or Timeline database.

### Block editor
- **Block types:**
  - Text, Heading 1–3, and toggle headings.
  - Bulleted, numbered (1. / a. / i. by depth) and to-do lists, toggle lists, quotes and callouts (with an emoji icon).
  - Dividers, and code blocks with syntax highlighting for 28 languages, copy and wrap.
  - Images (upload or link, resizable, with captions), video (upload, or YouTube/Vimeo/Loom embeds), audio and files.
  - Web bookmarks (with a fetched title, description and image when online), embeds, and block equations (KaTeX).
  - Simple tables (add/insert/delete rows and columns, header row/column), table of contents and breadcrumbs.
  - Sub-pages, links to pages, and inline databases.
  - 2/3/4-column layouts. You can also drag a block to the left or right edge of another block to create columns.
- **The `/` menu** lists every block type, databases, mentions, dates, colours, and text/background colours. It supports fuzzy search, arrow keys and Enter.
- **Markdown shortcuts:** `#`, `##`, `###`, `-`/`*`, `1.`, `[]`, `>` (toggle), `"` (quote), `---`, ` ``` `, plus inline `**bold**`, `*italic*`, `` `code` `` and `~strike~`.
- **Formatting toolbar** on text selection: Turn into, comment, link, bold, italic, underline, strikethrough, inline code, and 9 text colours plus 9 background colours. Shortcuts: `Ctrl+B`/`I`/`U`/`E`/`K`, `Ctrl+Shift+S`.
- **Mentions:** `@` for people (notifies them), pages (live titles) and dates. `[[` links to a page and can create a new sub-page.
- **Keyboard:**
  - Enter splits a block. Backspace merges blocks or turns a block back into text. Delete merges forward.
  - Tab / Shift+Tab indent and outdent. Arrow keys move between blocks and keep the caret's column.
  - `Ctrl+D` duplicates, `Ctrl+Shift+↑/↓` moves a block, `Ctrl+Enter` checks a to-do or opens a toggle, and `Ctrl+Alt+0…9` turns a block into another type.
  - `Esc` selects the current block. `Ctrl+A` twice selects all blocks.
  - `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo across typing and structural changes.
- **Block handle (⋮⋮):** drag to reorder or nest, or click for a menu with Turn into, Color, Copy link to block, Duplicate, Move to another page, Caption, Comment and Delete. The "+" button adds a block below; Alt-click adds one above.
- **Multi-block selection:** drag across blocks, drag out from text into other blocks, or use Shift+arrows. Then delete, duplicate, indent, copy, cut or paste the selection.
- **Paste:**
  - Multi-line Markdown and HTML (from web pages and documents) become real blocks.
  - Pasting a URL onto selected text creates a link.
  - Pasted images or files are uploaded.
  - Blocks copied inside the app paste with their structure intact.
- Drag files from your computer onto the page to upload them.

### Databases
- Full-page databases, and inline databases created with `/table`, `/board` and similar commands.
- **Property types:**
  - Title, Text, Number (plain, commas, %, $, €, £, ¥, ₹), Select, Multi-select, Status (To-do / In progress / Complete groups).
  - Date (ranges, times and formats), Person, Files & media, Checkbox, URL, Email, Phone.
  - **Formula** (a formula language modelled on Notion's: `prop()`, maths, `if`, `concat`, `dateBetween`, `formatDate`, `round` and more, with a live preview), **Relation** to another database, and **Rollup** (show, count, sum, average, min, max, percent checked…).
  - Created time/by, Last edited time/by, and a unique **ID** with an optional prefix.
- **Property menu:** rename, change type (values are converted), edit options (rename, colour, status group, delete), sort, filter, hide, wrap, duplicate and delete. Columns can be resized and reordered by dragging.
- **Views** (you can add as many as you like per database, and each has its own settings):
  - **Table:** inline cell editing, row selection with bulk delete, drag to reorder rows, and a calculation footer (count, sum, average, median, min, max, range, percentages, earliest/latest date…).
  - **Board:** columns grouped by Select, Status, Multi-select, Person or Checkbox. Drag cards between columns and within a column, add or hide groups, and choose card previews.
  - **List**, **Gallery** (card size; preview from the cover or page content), **Calendar** (month grid; drag to reschedule; "+" on a day), and **Timeline** (day, week or month scale; drag bars to move them; resize from either end).
- Filters (combined with AND or OR, with operators suited to each type), multi-level sorts, grouping in table/list/gallery, and a per-view search. New rows automatically get values that satisfy the view's active filters.
- Rows are pages. They open in a **side peek**, **centre peek** or **full page** (set per view), with an editable property panel and a full block editor underneath.

### Sharing and permissions
- Each top-level page is either **Private** (only you) or **Workspace** (every member gets full access). Sub-pages and database rows inherit access from their parent.
- The **Share** menu invites people by email with one of four roles:
  - **Full access** (can edit and share)
  - **Can edit**
  - **Can comment**
  - **Can view**

  Invited people who are not workspace members become **guests** and only see what was shared with them, under "Shared". Roles can be changed or removed, and access inherited from a parent page is shown. The server enforces all roles: viewers get read-only pages, and commenters can comment but not edit.
- **General access** switches a top-level page between "Only people invited" and "Everyone at <workspace>".
- **Publish to web** creates a public read-only link at `/share/<pageId>`. Its sub-pages and inline databases are published too. You can copy the link or unpublish it.

### Collaboration
- WebSocket rooms deliver edits live: blocks, titles, icons, database rows and views, the sidebar tree, comments and notifications.
- Presence: the topbar shows avatars of other people on the page, and each block shows a coloured marker when someone else is editing it.
- **Comments:**
  - Page-level discussions sit under the title.
  - You can comment on a block, or on a text selection, which is highlighted in the page.
  - A comments side panel has Open and Resolved tabs. You can reply, edit, delete and resolve comments, and `@mention` people in them.
- **Inbox:** notifications for mentions, comments on your pages or threads, page shares, workspace invites, and being assigned in a Person property. You can mark them read and archive them.

### Responsive layout
- On screens narrower than 800 px, the sidebar becomes an overlay that closes after you navigate.
- Page padding shrinks, peeks become full screen, and the settings, history and comments panels restack for small screens.

## Differences from Notion (known gaps)

- **Notion AI, Notion Calendar, Mail, Sites domains, integrations/API, SSO and billing** are not implemented. They depend on paid or proprietary services.
- **Concurrent editing within the same block** uses last-writer-wins per block. Remote updates keep your caret position, but two people typing in the *same* paragraph at the same instant can overwrite each other's keystrokes. Notion merges them at the character level.
- Toggle open/closed state is stored per browser, not per account.
- There are no page templates, synced blocks, database templates, buttons, automations, charts, forms, or teamspaces beyond the single "Workspace" section.
- Inline equations (inside a paragraph) are not supported. Block equations are.
- The simple table is a single block with rich-text cells. Unlike Notion, it cannot be converted to a database.
- Relations are one-way. Rollups work on relations to *other* databases.
- Search is a substring search over titles and text, not ranked full-text search.
- Import (Markdown, HTML, CSV or other Notion exports) is not implemented. Export is Markdown only (pages, and databases as a Markdown table).
- Bookmark previews need internet access. Offline, a bookmark shows just the URL.
- Only Chromium is covered by the automated tests. The UI uses standard APIs and should work in Firefox and Safari, but that is untested.

## Architecture

```
notion-clone/
├── server/                 Node.js (ESM) + Express + node:sqlite + ws
│   ├── migrations/         SQL migrations (applied automatically on start)
│   ├── src/
│   │   ├── app.js          Express app, route mounting, static client
│   │   ├── index.js        HTTP server + WebSocket hub bootstrap
│   │   ├── db.js           SQLite connection, migrations, tx() helper
│   │   ├── auth.js         scrypt hashing, sessions (cookie), middleware
│   │   ├── permissions.js  Role resolution (private/workspace roots, inherited shares, guests, public)
│   │   ├── realtime.js     WebSocket rooms (ws:, page:, user:), presence
│   │   ├── services.js     Page/workspace/database domain logic
│   │   ├── lib/            Block schema + sanitizing, database props, Markdown export
│   │   └── routes/         auth, workspaces, pages (+block transactions, sharing, history), databases, comments, notifications, uploads, public
│   └── test/               node:test API suite
├── client/                 React 19 + TypeScript + Vite + zustand
│   └── src/
│       ├── editor/         Block editor (EditorStore, RichText, BlockView, menus, block renderers)
│       ├── database/       Database views, property editors, filters/sorts, formula engine
│       ├── page/           PageView, Share menu, comments, history
│       ├── shell/          App shell, sidebar, search, settings, inbox, trash, home
│       └── styles/         Design tokens and CSS (light + dark)
├── e2e/                    Playwright browser tests
└── scripts/                dev runner, e2e server launcher
```

### Key design decisions

- **Data model mirrors Notion's:**
  - A page has a tree of **blocks**. A block has a `type`, a JSON `content` and a `parent_block_id`, and is ordered by a fractional `position`.
  - A **database is a page** with a `schema`. Its **rows are pages** whose `properties` hold values keyed by property id.
  - A sub-page is both a row in `pages` and a `page` block in its parent's content, so it appears in the sidebar tree *and* in the page body.
- **Edits are transactions, like Notion's `submitTransaction`:**
  - The client's `EditorStore` records every change as insert/update/delete ops, with before/after snapshots for undo/redo.
  - It coalesces fast typing into single updates and flushes batches to `POST /api/pages/:id/transactions`.
  - The server checks permissions, validates block types and parent/child cycles, and sanitizes rich text with an allow-list.
  - It then applies the batch atomically in SQLite, refreshes the search text, and broadcasts the applied ops to the page's WebSocket room. The client that made the change is skipped using its client id.
- **Rich text** is stored as a small HTML subset (`b i u s code a span[data-color|data-bg] mention spans`). Each block is its own `contentEditable`. Caret offsets are tracked in text characters, so remote updates and re-renders keep the cursor in place.
- **Permissions** are resolved on the server for every request:
  - Owner-private or workspace-wide access at the root page.
  - The highest explicit grant on the page or any of its ancestors.
  - Guests are users with grants but no workspace membership.
  - Unauthorized page reads return 404, so a page's existence isn't leaked.
- **SQLite via `node:sqlite`** gives a zero-setup, durable store without native compilation, which keeps local setup to `npm install`. Migrations are plain SQL files.
- **Realtime** uses one WebSocket per tab with ref-counted room subscriptions, automatic reconnect with backoff, and a full resync after reconnecting.
- **Styling** is hand-written CSS using Notion's colour tokens (text, background and select-tag palettes for light and dark), 16 px / 1.5 body text, a 708 px content column and 96 px page padding, a 240 px resizable sidebar, and Notion-style menus and shadows. Icons come from `lucide-react`.

## Test coverage

- **API (`npm run test:api`, 10 suites):**
  - Auth and sessions.
  - Block transactions: sanitizing, nesting, cycle prevention and cascading deletes.
  - Search.
  - Sub-pages, and trash/restore/permanent delete.
  - The full permission matrix: private pages, viewer vs editor, inheritance, revocation, workspace membership, guests, and owner-only settings.
  - Invites applied at signup.
  - Database schema and value validation, unique IDs, type conversion, views and reordering.
  - Publish to web.
  - Comments, mentions and notifications.
  - Version history restore.
  - WebSocket broadcast and rejection of unauthenticated sockets.
- **Browser (`npm run test:e2e`, 19 Playwright tests, Chromium):**
  - Sign up, log out and log in, including redirecting back to the requested page.
  - Markdown shortcuts, the slash menu, inline formatting, undo/redo, the block menu, split/merge/indent, sub-pages, `@` mentions, search, backlinks, and page options.
  - Inline databases: rows, a new Select property, filter, sort, a board view grouped by Select, dragging cards, and persistence.
  - Row side peek editing, and converting an empty page into a database.
  - List, gallery, calendar and timeline views, and formulas.
  - Image upload.
  - Two-user real-time editing, presence and comments.
  - Sharing view → edit → revoke with a guest.
  - Publish and unpublish.
  - Trash, sidebar operations including drag-to-nest, comments on a text selection, and version history.
  - Inviting a member through Settings.
