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
CREATE INDEX IF NOT EXISTS ix_board_items_sha256 ON board_items(sha256);

CREATE TABLE IF NOT EXISTS papers (
  uuid TEXT PRIMARY KEY NOT NULL,
  doi TEXT,
  title TEXT NOT NULL,
  authors TEXT,
  journal TEXT,
  year INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

-- A content-addressed blob may back more than one edition, so the digest is
-- an indexed lookup key rather than an identity.
CREATE TABLE IF NOT EXISTS paper_editions (
  uuid TEXT PRIMARY KEY NOT NULL,
  paper_uuid TEXT NOT NULL REFERENCES papers(uuid),
  file_path TEXT NOT NULL,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_paper_editions_paper_uuid ON paper_editions(paper_uuid);
CREATE INDEX IF NOT EXISTS ix_paper_editions_sha256 ON paper_editions(sha256);

CREATE TABLE IF NOT EXISTS copies (
  uuid TEXT PRIMARY KEY NOT NULL,
  paper_uuid TEXT NOT NULL REFERENCES papers(uuid),
  user_uuid TEXT NOT NULL,
  shelf_uuid TEXT REFERENCES shelves(uuid),
  edition_uuid TEXT REFERENCES paper_editions(uuid),
  edition_sha256 TEXT,
  ignored_edition_uuid TEXT REFERENCES paper_editions(uuid),
  summary TEXT,
  thought TEXT,
  marketed INTEGER NOT NULL DEFAULT 0,
  is_author INTEGER NOT NULL DEFAULT 0,
  rating_expertise INTEGER,
  rating_reading INTEGER,
  rating_liking INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_copies_paper_uuid ON copies(paper_uuid);
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

CREATE TABLE IF NOT EXISTS comments (
  uuid TEXT PRIMARY KEY NOT NULL,
  paper_uuid TEXT NOT NULL REFERENCES papers(uuid),
  user_uuid TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  edition_uuid TEXT REFERENCES paper_editions(uuid),
  page INTEGER,
  anchor_type TEXT,
  anchor TEXT,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_comments_paper_uuid ON comments(paper_uuid);
CREATE INDEX IF NOT EXISTS ix_comments_edition_uuid ON comments(edition_uuid);

CREATE TABLE IF NOT EXISTS ink_strokes (
  uuid TEXT PRIMARY KEY NOT NULL,
  group_uuid TEXT,
  edition_uuid TEXT NOT NULL REFERENCES paper_editions(uuid),
  user_uuid TEXT NOT NULL,
  page INTEGER NOT NULL,
  points TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#b3923d',
  width REAL NOT NULL DEFAULT 0.004,
  opacity REAL NOT NULL DEFAULT 1.0,
  shape TEXT NOT NULL DEFAULT 'flat',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_ink_strokes_edition_uuid ON ink_strokes(edition_uuid);

CREATE TABLE IF NOT EXISTS paper_clips (
  uuid TEXT PRIMARY KEY NOT NULL,
  edition_uuid TEXT NOT NULL REFERENCES paper_editions(uuid),
  user_uuid TEXT NOT NULL,
  page INTEGER NOT NULL,
  source TEXT NOT NULL,
  frame TEXT NOT NULL,
  floating INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_paper_clips_edition_uuid ON paper_clips(edition_uuid);
