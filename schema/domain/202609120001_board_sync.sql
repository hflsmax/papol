-- Canonical synchronized board schema. The server temporarily carries legacy
-- integer compatibility keys in addition to these columns; the desktop uses
-- this final UUID shape directly.
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL,
  shelf_id TEXT REFERENCES shelves(id),
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS board_groups (
  id TEXT PRIMARY KEY NOT NULL,
  board_id TEXT NOT NULL REFERENCES boards(id),
  kind TEXT NOT NULL DEFAULT 'booklet',
  title TEXT NOT NULL,
  header TEXT,
  auto_arrange INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_board_groups_board_id ON board_groups(board_id);

CREATE TABLE IF NOT EXISTS board_items (
  id TEXT PRIMARY KEY NOT NULL,
  board_id TEXT NOT NULL REFERENCES boards(id),
  group_id TEXT REFERENCES board_groups(id),
  kind TEXT NOT NULL,
  content TEXT,
  excerpt_text TEXT,
  file_path TEXT,
  blob_sha256 TEXT,
  original_filename TEXT,
  mime_type TEXT,
  source_url TEXT,
  source_label TEXT,
  staged INTEGER NOT NULL DEFAULT 0,
  text_align TEXT NOT NULL DEFAULT 'left',
  position INTEGER NOT NULL DEFAULT 0,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 300,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_board_items_board_id ON board_items(board_id);
CREATE INDEX IF NOT EXISTS ix_board_items_group_id ON board_items(group_id);
CREATE INDEX IF NOT EXISTS ix_board_items_blob_sha256 ON board_items(blob_sha256);
