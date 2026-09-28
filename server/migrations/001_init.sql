-- Initial schema for the Notion clone.
-- Pages and blocks mirror Notion's model: a page owns a tree of blocks; a
-- database is a page whose children (rows) are pages with property values.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url    TEXT,
  color         TEXT NOT NULL,
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_members_user ON workspace_members(user_id);

-- Invitations for email addresses that do not have an account yet. They are
-- converted into memberships / page permissions when that email signs up.
CREATE TABLE invites (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL COLLATE NOCASE,
  page_id      TEXT,
  role         TEXT NOT NULL,
  invited_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_invites_email ON invites(email);

CREATE TABLE pages (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES pages(id) ON DELETE CASCADE,
  parent_type  TEXT NOT NULL CHECK (parent_type IN ('workspace', 'page', 'database')),
  type         TEXT NOT NULL DEFAULT 'page' CHECK (type IN ('page', 'database')),
  title        TEXT NOT NULL DEFAULT '',
  icon         TEXT,
  cover        TEXT,
  properties   TEXT NOT NULL DEFAULT '{}',
  schema       TEXT,
  format       TEXT NOT NULL DEFAULT '{}',
  is_inline    INTEGER NOT NULL DEFAULT 0,
  visibility   TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'workspace')),
  position     REAL NOT NULL DEFAULT 0,
  search_text  TEXT NOT NULL DEFAULT '',
  public       INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  updated_by   TEXT REFERENCES users(id),
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  deleted_by   TEXT REFERENCES users(id)
);
CREATE INDEX idx_pages_workspace ON pages(workspace_id);
CREATE INDEX idx_pages_parent ON pages(parent_id);

CREATE TABLE blocks (
  id              TEXT PRIMARY KEY,
  page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  parent_block_id TEXT,
  type            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '{}',
  position        REAL NOT NULL DEFAULT 0,
  created_by      TEXT REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  updated_by      TEXT REFERENCES users(id),
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_blocks_page ON blocks(page_id);

CREATE TABLE page_permissions (
  page_id    TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('full', 'edit', 'comment', 'view')),
  granted_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (page_id, user_id)
);
CREATE INDEX idx_perms_user ON page_permissions(user_id);

CREATE TABLE favorites (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  position REAL NOT NULL,
  PRIMARY KEY (user_id, page_id)
);

CREATE TABLE recents (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id    TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  visited_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, page_id)
);

CREATE TABLE db_views (
  id          TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('table', 'board', 'list', 'gallery', 'calendar', 'timeline')),
  config      TEXT NOT NULL DEFAULT '{}',
  position    REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_views_db ON db_views(database_id);

CREATE TABLE discussions (
  id          TEXT PRIMARY KEY,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  block_id    TEXT,
  anchor_text TEXT,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_discussions_page ON discussions(page_id);

CREATE TABLE comments (
  id            TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  edited_at     INTEGER
);
CREATE INDEX idx_comments_discussion ON comments(discussion_id);

CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  actor_id     TEXT REFERENCES users(id),
  page_id      TEXT REFERENCES pages(id) ON DELETE CASCADE,
  data         TEXT NOT NULL DEFAULT '{}',
  read         INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);

CREATE TABLE page_snapshots (
  id         TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  icon       TEXT,
  blocks     TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_snapshots_page ON page_snapshots(page_id, created_at);

CREATE TABLE uploads (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  stored_as  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
