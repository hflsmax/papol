CREATE TABLE IF NOT EXISTS shelves (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL,
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
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS copies (
  id TEXT PRIMARY KEY NOT NULL,
  paper_id TEXT NOT NULL REFERENCES papers(id),
  user_id INTEGER NOT NULL,
  shelf_id TEXT REFERENCES shelves(id),
  edition_id TEXT REFERENCES paper_editions(id),
  edition_sha256 TEXT,
  ignored_edition_id TEXT REFERENCES paper_editions(id),
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
CREATE INDEX IF NOT EXISTS ix_copies_paper_id ON copies(paper_id);
CREATE INDEX IF NOT EXISTS ix_copies_shelf_id ON copies(shelf_id);
