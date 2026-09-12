-- Read dependencies use permanent UUID identity locally. The server retains
-- integer compatibility keys while existing REST routes are phased out.
CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY NOT NULL,
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

CREATE TABLE IF NOT EXISTS paper_editions (
  id TEXT PRIMARY KEY NOT NULL,
  paper_id TEXT NOT NULL REFERENCES papers(id),
  file_path TEXT NOT NULL,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_paper_editions_paper_id ON paper_editions(paper_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_paper_editions_sha256 ON paper_editions(sha256);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY NOT NULL,
  paper_id TEXT NOT NULL REFERENCES papers(id),
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  edition_id TEXT REFERENCES paper_editions(id),
  page INTEGER,
  anchor_type TEXT,
  anchor TEXT,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_comments_paper_id ON comments(paper_id);
CREATE INDEX IF NOT EXISTS ix_comments_edition_id ON comments(edition_id);

CREATE TABLE IF NOT EXISTS ink_strokes (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT,
  edition_id TEXT NOT NULL REFERENCES paper_editions(id),
  user_id INTEGER NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_ink_strokes_edition_id ON ink_strokes(edition_id);

CREATE TABLE IF NOT EXISTS paper_clips (
  id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL REFERENCES paper_editions(id),
  user_id INTEGER NOT NULL,
  page INTEGER NOT NULL,
  source TEXT NOT NULL,
  frame TEXT NOT NULL,
  floating INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_paper_clips_edition_id ON paper_clips(edition_id);
