CREATE TABLE IF NOT EXISTS copy_tags (
  id TEXT PRIMARY KEY NOT NULL,
  copy_id TEXT NOT NULL REFERENCES copies(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  UNIQUE(copy_id, tag_id)
);
CREATE INDEX IF NOT EXISTS ix_copy_tags_copy_id ON copy_tags(copy_id);
CREATE INDEX IF NOT EXISTS ix_copy_tags_tag_id ON copy_tags(tag_id);
