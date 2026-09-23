-- The synchronized schema, shared by the server and the desktop replica.

CREATE TABLE IF NOT EXISTS shelves (
  uuid TEXT PRIMARY KEY NOT NULL,
  user_uuid TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  uuid TEXT PRIMARY KEY NOT NULL,
  user_uuid TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS boards (
  uuid TEXT PRIMARY KEY NOT NULL,
  user_uuid TEXT NOT NULL,
  shelf_uuid TEXT REFERENCES shelves(uuid),
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS board_groups (
  uuid TEXT PRIMARY KEY NOT NULL,
  board_uuid TEXT NOT NULL REFERENCES boards(uuid),
  kind TEXT NOT NULL DEFAULT 'booklet',
  title TEXT NOT NULL,
  header TEXT,
  auto_arrange INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_board_groups_board_uuid ON board_groups(board_uuid);

CREATE TABLE IF NOT EXISTS board_items (
  uuid TEXT PRIMARY KEY NOT NULL,
  board_uuid TEXT NOT NULL REFERENCES boards(uuid),
  group_uuid TEXT REFERENCES board_groups(uuid),
  kind TEXT NOT NULL,
  content TEXT,
  excerpt_text TEXT,
  file_path TEXT,
  sha256 TEXT,
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
CREATE INDEX IF NOT EXISTS ix_board_items_board_uuid ON board_items(board_uuid);
CREATE INDEX IF NOT EXISTS ix_board_items_group_uuid ON board_items(group_uuid);

-- A paper is one PDF and what is known about it, and the digest of that PDF
-- is its key. Not a column beside a UUID: the only name it has. Everyone
-- holding the bytes arrives at the same answer without asking, which is why
-- a replica and the service can agree about which paper this is without
-- negotiating — and why two files printing one DOI are two papers.
CREATE TABLE IF NOT EXISTS papers (
  sha256 TEXT PRIMARY KEY NOT NULL,
  doi TEXT,
  title TEXT NOT NULL,
  authors TEXT,
  journal TEXT,
  year INTEGER,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS copies (
  uuid TEXT PRIMARY KEY NOT NULL,
  paper_sha256 TEXT NOT NULL REFERENCES papers(sha256),
  user_uuid TEXT NOT NULL,
  shelf_uuid TEXT REFERENCES shelves(uuid),
  summary TEXT,
  thought TEXT,
  is_author INTEGER NOT NULL DEFAULT 0,
  rating_expertise INTEGER,
  rating_reading INTEGER,
  rating_liking INTEGER,
  thought_public INTEGER NOT NULL DEFAULT 1,
  ratings_public INTEGER NOT NULL DEFAULT 1,
  summary_public INTEGER NOT NULL DEFAULT 0,
  tags_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_copies_paper_sha256 ON copies(paper_sha256);
CREATE INDEX IF NOT EXISTS ix_copies_shelf_uuid ON copies(shelf_uuid);

CREATE TABLE IF NOT EXISTS copy_tags (
  uuid TEXT PRIMARY KEY NOT NULL,
  copy_uuid TEXT NOT NULL REFERENCES copies(uuid),
  tag_uuid TEXT NOT NULL REFERENCES tags(uuid),
  user_uuid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  UNIQUE(copy_uuid, tag_uuid)
);
CREATE INDEX IF NOT EXISTS ix_copy_tags_copy_uuid ON copy_tags(copy_uuid);
CREATE INDEX IF NOT EXISTS ix_copy_tags_tag_uuid ON copy_tags(tag_uuid);

-- Everything a user leaves on a paper: a note, a stroke of ink, a clipped
-- view. They differ in what they draw, not in what they are, so they share a
-- table and say which they are in `kind`.
--
-- The columns here are the ones every kind answers: whose it is, which
-- paper, which page, and the words a user can read back. What
-- is particular to one kind — an anchor, a polyline and its nib, a source
-- rectangle and where it sits — is geometry, and geometry was already stored
-- as JSON text before this table existed. It lives in `body`.
CREATE TABLE IF NOT EXISTS annotations (
  uuid TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  paper_sha256 TEXT NOT NULL REFERENCES papers(sha256),
  -- Null only for a note about the paper that was never put on a page.
  page INTEGER,
  -- Several stored paths can be one logical mark: text painted across lines
  -- is drawn as separate strokes but picked up and erased as one.
  group_uuid TEXT,
  content TEXT NOT NULL DEFAULT '',
  name TEXT,
  body TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_annotations_paper
  ON annotations(paper_sha256, user_uuid, kind);
