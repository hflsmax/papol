use rusqlite::{Connection, OptionalExtension, Transaction};

const DOMAIN: &str = include_str!("../../../../schema/domain/202609120001_initial.sql");

// A replica written before notes, ink and clips shared a table applied the
// domain DDL under its own migration id and will not see the new one, so the
// rows are carried across here. Geometry that lived in its own columns moves
// into `body`; an anchor's kind moves inside the anchor, where it always
// belonged. Running this twice is harmless — the inserts select from tables
// that the last statements drop.
//
// It creates the table it fills, rather than trusting the domain schema to
// have done it. That schema is applied once and recorded, so a replica from
// the previous release never sees a table added to it afterwards — which is
// exactly this table, and why the application aborted on every launch until
// this migration carried its own copy of the shape it needs.
//
// Re-running the whole schema instead would fix this table and break the next
// one: CREATE TABLE IF NOT EXISTS leaves an existing table alone, so a column
// added later never arrives, while an index declared on that column is still
// attempted — and fails. A migration carrying its own DDL is what keeps each
// change independent of every change after it.
const UNIFY_ANNOTATIONS: &str = r#"
CREATE TABLE IF NOT EXISTS annotations (
  uuid TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  paper_uuid TEXT NOT NULL REFERENCES papers(uuid),
  edition_uuid TEXT REFERENCES paper_editions(uuid),
  page INTEGER,
  group_uuid TEXT,
  content TEXT NOT NULL DEFAULT '',
  name TEXT,
  body TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_annotations_edition
  ON annotations(edition_uuid, user_uuid, kind);
CREATE INDEX IF NOT EXISTS ix_annotations_paper
  ON annotations(paper_uuid, user_uuid, kind);

INSERT INTO annotations
  (uuid, kind, user_uuid, paper_uuid, edition_uuid, page, group_uuid,
   content, name, body, created_at, updated_at, revision, deleted_at)
SELECT uuid, 'note', user_uuid, paper_uuid, edition_uuid, page, NULL,
       content, name,
       CASE WHEN anchor IS NULL OR anchor_type IS NULL THEN '{}'
            ELSE json_object('anchor', json_insert(anchor, '$.type', anchor_type)) END,
       created_at, updated_at, revision, deleted_at
  FROM comments;

INSERT INTO annotations
  (uuid, kind, user_uuid, paper_uuid, edition_uuid, page, group_uuid,
   content, name, body, created_at, updated_at, revision, deleted_at)
SELECT s.uuid, 'ink', s.user_uuid, e.paper_uuid, s.edition_uuid, s.page,
       s.group_uuid, '', NULL,
       json_object('points', json(s.points), 'color', s.color, 'width', s.width,
                   'opacity', s.opacity, 'shape', s.shape),
       s.created_at, s.updated_at, s.revision, s.deleted_at
  FROM ink_strokes s JOIN paper_editions e ON e.uuid = s.edition_uuid;

INSERT INTO annotations
  (uuid, kind, user_uuid, paper_uuid, edition_uuid, page, group_uuid,
   content, name, body, created_at, updated_at, revision, deleted_at)
SELECT c.uuid, 'clip', c.user_uuid, e.paper_uuid, c.edition_uuid, c.page, NULL,
       '', NULL,
       json_object('source', json(c.source), 'frame', json(c.frame),
                   'floating', json(CASE WHEN c.floating THEN 'true' ELSE 'false' END)),
       c.created_at, c.updated_at, c.revision, c.deleted_at
  FROM paper_clips c JOIN paper_editions e ON e.uuid = c.edition_uuid;

DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS ink_strokes;
DROP TABLE IF EXISTS paper_clips;
"#;

const LOCAL: &str = r#"
CREATE TABLE IF NOT EXISTS _local_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
CREATE TABLE IF NOT EXISTS _local_accounts (
  account_uuid TEXT PRIMARY KEY NOT NULL,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS _local_sync_state (
  account_uuid TEXT PRIMARY KEY NOT NULL,
  pull_cursor INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS _local_outbox (
  local_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  account_uuid TEXT NOT NULL,
  client_uuid TEXT NOT NULL,
  mutation_uuid TEXT NOT NULL UNIQUE,
  changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  state TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS ix_local_outbox_account_sequence
  ON _local_outbox(account_uuid, local_sequence);
CREATE INDEX IF NOT EXISTS ix_local_outbox_account_state_sequence
  ON _local_outbox(account_uuid, state, local_sequence);
CREATE TABLE IF NOT EXISTS _local_conflicts (
  uuid TEXT PRIMARY KEY NOT NULL,
  account_uuid TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_uuid TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS _local_blobs (
  sha256 TEXT PRIMARY KEY NOT NULL,
  relative_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT,
  durability TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT
);
CREATE TABLE IF NOT EXISTS _local_blob_refs (
  table_name TEXT NOT NULL,
  row_uuid TEXT NOT NULL,
  sha256 TEXT NOT NULL REFERENCES _local_blobs(sha256),
  PRIMARY KEY(table_name, row_uuid)
);
CREATE INDEX IF NOT EXISTS ix_local_blob_refs_sha256 ON _local_blob_refs(sha256);
"#;

// A copy no longer keeps its own copy of its shelf's visibility — the shelf
// is asked instead — so the column goes. A replica written earlier applied
// the domain DDL under its own migration id and will not see the new shape,
// and it may hold the column under either spelling, so both are dropped.
const DROP_COPY_VISIBILITY: &str = "ALTER TABLE copies DROP COLUMN marketed;";
const DROP_COPY_IS_PUBLIC: &str = "ALTER TABLE copies DROP COLUMN is_public;";

// Notes, ink and clips on a PDF opened from the file system, kept on this
// device by the file's content hash until the paper is added to a nook.
const LOCAL_ANNOTATIONS: &str = r#"
CREATE TABLE IF NOT EXISTS _local_annotations (
  uuid TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL,
  row_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_local_annotations_sha256
  ON _local_annotations(sha256, created_at);
"#;

// Editions are gone: a paper is one PDF, named by its content hash. A replica
// written when a paper could have several is taken apart along that line, the
// same way and to the same shape as the service does it, so the two agree
// about which paper a copy sits on before the next sync.
//
// One paper per distinct file. The first file of a paper keeps that paper's
// UUID, so everything already pointing at it goes on pointing at the same row;
// every later file becomes a paper of its own, cloning the shared metadata.
// Whatever named an edition is carried to the paper that edition became.
//
// SQLite will not drop a column named in a foreign key, and every column
// retiring here is one, so the three tables are rebuilt rather than altered.
const FOLD_EDITIONS: &str = r#"
CREATE TABLE _paper_file AS
  SELECT paper_uuid AS old_paper_uuid,
         COALESCE(sha256, 'edition:' || uuid) AS file_key,
         MIN(created_at || '|' || uuid) AS rank_key
    FROM paper_editions
   GROUP BY paper_uuid, COALESCE(sha256, 'edition:' || uuid);

ALTER TABLE _paper_file ADD COLUMN new_paper_uuid TEXT;

UPDATE _paper_file SET new_paper_uuid = CASE
  WHEN rank_key = (SELECT MIN(rank_key) FROM _paper_file other
                    WHERE other.old_paper_uuid = _paper_file.old_paper_uuid)
  THEN old_paper_uuid
  ELSE lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
             || substr(hex(randomblob(2)), 2) || '-'
             || substr('89ab', 1 + (abs(random()) % 4), 1)
             || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
END;

CREATE TABLE _edition_paper (
  edition_uuid TEXT PRIMARY KEY NOT NULL,
  paper_uuid TEXT NOT NULL
);
INSERT INTO _edition_paper
  SELECT e.uuid, f.new_paper_uuid
    FROM paper_editions e
    JOIN _paper_file f
      ON f.old_paper_uuid = e.paper_uuid
     AND f.file_key = COALESCE(e.sha256, 'edition:' || e.uuid);

INSERT INTO papers
  (uuid, doi, title, authors, journal, year, created_at, updated_at,
   revision, deleted_at)
SELECT f.new_paper_uuid, p.doi, p.title, p.authors, p.journal, p.year,
       p.created_at, p.updated_at, p.revision, p.deleted_at
  FROM _paper_file f JOIN papers p ON p.uuid = f.old_paper_uuid
 WHERE f.new_paper_uuid <> f.old_paper_uuid;

ALTER TABLE papers ADD COLUMN file_path TEXT;
ALTER TABLE papers ADD COLUMN sha256 TEXT;
UPDATE papers SET (file_path, sha256) = (
  SELECT e.file_path, e.sha256
    FROM _edition_paper m JOIN paper_editions e ON e.uuid = m.edition_uuid
   WHERE m.paper_uuid = papers.uuid
   ORDER BY e.created_at, e.uuid LIMIT 1)
WHERE uuid IN (SELECT paper_uuid FROM _edition_paper);
CREATE INDEX IF NOT EXISTS ix_papers_sha256 ON papers(sha256);

CREATE TABLE _new_copies (
  uuid TEXT PRIMARY KEY NOT NULL,
  paper_uuid TEXT NOT NULL REFERENCES papers(uuid),
  user_uuid TEXT NOT NULL,
  shelf_uuid TEXT REFERENCES shelves(uuid),
  summary TEXT,
  thought TEXT,
  is_author INTEGER NOT NULL DEFAULT 0,
  rating_expertise INTEGER,
  rating_reading INTEGER,
  rating_liking INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
INSERT INTO _new_copies
  SELECT c.uuid, COALESCE(m.paper_uuid, c.paper_uuid), c.user_uuid, c.shelf_uuid,
         c.summary, c.thought, c.is_author, c.rating_expertise, c.rating_reading,
         c.rating_liking, c.created_at, c.updated_at, c.revision, c.deleted_at
    FROM copies c
    LEFT JOIN _edition_paper m ON m.edition_uuid = c.edition_uuid;
DROP TABLE copies;
ALTER TABLE _new_copies RENAME TO copies;
CREATE INDEX IF NOT EXISTS ix_copies_paper_uuid ON copies(paper_uuid);
CREATE INDEX IF NOT EXISTS ix_copies_shelf_uuid ON copies(shelf_uuid);

CREATE TABLE _new_annotations (
  uuid TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  paper_uuid TEXT NOT NULL REFERENCES papers(uuid),
  page INTEGER,
  group_uuid TEXT,
  content TEXT NOT NULL DEFAULT '',
  name TEXT,
  body TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
INSERT INTO _new_annotations
  SELECT a.uuid, a.kind, a.user_uuid, COALESCE(m.paper_uuid, a.paper_uuid),
         a.page, a.group_uuid, a.content, a.name, a.body, a.created_at,
         a.updated_at, a.revision, a.deleted_at
    FROM annotations a
    LEFT JOIN _edition_paper m ON m.edition_uuid = a.edition_uuid;
DROP TABLE annotations;
ALTER TABLE _new_annotations RENAME TO annotations;
CREATE INDEX IF NOT EXISTS ix_annotations_paper
  ON annotations(paper_uuid, user_uuid, kind);

INSERT OR REPLACE INTO _local_blob_refs (table_name, row_uuid, sha256)
  SELECT 'papers', m.paper_uuid, r.sha256
    FROM _local_blob_refs r
    JOIN _edition_paper m ON m.edition_uuid = r.row_uuid
   WHERE r.table_name = 'paper_editions';
DELETE FROM _local_blob_refs WHERE table_name = 'paper_editions';

DROP TABLE paper_editions;
DROP TABLE _edition_paper;
DROP TABLE _paper_file;
"#;

pub fn run(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS _local_schema_migrations (\
               migration_id TEXT PRIMARY KEY NOT NULL,\
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\
             );",
        )
        .map_err(|error| error.to_string())?;
    apply_sql(&transaction, "202609120001_domain", DOMAIN)?;
    apply_sql(&transaction, "202609120001_local", LOCAL)?;
    apply_sql(
        &transaction,
        "202609130001_local_annotations",
        LOCAL_ANNOTATIONS,
    )?;
    // A replica created after the unification never had the three tables, so
    // there is nothing to carry across; record the migration and move on.
    let legacy_annotations = transaction
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='comments'",
            [],
            |_| Ok(true),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(false);
    apply_sql(
        &transaction,
        "202609150001_unify_annotations",
        if legacy_annotations {
            UNIFY_ANNOTATIONS
        } else {
            ""
        },
    )?;
    // A replica created after this change never had the column under either
    // name; record the migration and move on.
    let column = |name: &str| -> Result<bool, String> {
        transaction
            .query_row(
                "SELECT 1 FROM pragma_table_info('copies') WHERE name=?1",
                [name],
                |_| Ok(true),
            )
            .optional()
            .map_err(|error| error.to_string())
            .map(|value| value.unwrap_or(false))
    };
    let sql = if column("marketed")? {
        DROP_COPY_VISIBILITY
    } else if column("is_public")? {
        DROP_COPY_IS_PUBLIC
    } else {
        ""
    };
    apply_sql(&transaction, "202609150002_shelf_owns_visibility", sql)?;
    // A replica created after editions were folded away never had the table;
    // record the migration and move on.
    let had_editions = transaction
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='paper_editions'",
            [],
            |_| Ok(true),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(false);
    apply_sql(
        &transaction,
        "202609160001_fold_editions",
        if had_editions { FOLD_EDITIONS } else { "" },
    )?;
    transaction.commit().map_err(|error| error.to_string())
}

fn applied(transaction: &Transaction<'_>, migration_id: &str) -> Result<bool, String> {
    transaction
        .query_row(
            "SELECT 1 FROM _local_schema_migrations WHERE migration_id=?1",
            [migration_id],
            |_| Ok(true),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(|error| error.to_string())
}

fn apply_sql(transaction: &Transaction<'_>, migration_id: &str, sql: &str) -> Result<(), String> {
    if applied(transaction, migration_id)? {
        return Ok(());
    }
    transaction
        .execute_batch(sql)
        .map_err(|error| format!("Migration {migration_id} failed: {error}"))?;
    transaction
        .execute(
            "INSERT INTO _local_schema_migrations(migration_id) VALUES (?1)",
            [migration_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A replica exactly as the previous release left it: notes, ink and clips
    /// in three tables, a copy carrying its own visibility and pinned to an
    /// edition, and its migration ids already recorded — that last part being
    /// what stops a schema change from reaching it.
    const PREVIOUS_RELEASE: &str = r#"
CREATE TABLE _local_schema_migrations (
  migration_id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE papers (
  uuid TEXT PRIMARY KEY NOT NULL, doi TEXT, title TEXT NOT NULL,
  authors TEXT, journal TEXT, year INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE paper_editions (
  uuid TEXT PRIMARY KEY NOT NULL, paper_uuid TEXT NOT NULL,
  file_path TEXT NOT NULL, sha256 TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE TABLE copies (
  uuid TEXT PRIMARY KEY NOT NULL, paper_uuid TEXT NOT NULL, user_uuid TEXT NOT NULL,
  shelf_uuid TEXT, edition_uuid TEXT, edition_sha256 TEXT,
  ignored_edition_uuid TEXT, summary TEXT, thought TEXT,
  marketed INTEGER NOT NULL DEFAULT 0, is_author INTEGER NOT NULL DEFAULT 0,
  rating_expertise INTEGER, rating_reading INTEGER, rating_liking INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE comments (
  uuid TEXT PRIMARY KEY NOT NULL, paper_uuid TEXT NOT NULL, edition_uuid TEXT,
  user_uuid TEXT NOT NULL, page INTEGER, content TEXT NOT NULL DEFAULT '',
  anchor_type TEXT, anchor TEXT, name TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE ink_strokes (
  uuid TEXT PRIMARY KEY NOT NULL, edition_uuid TEXT NOT NULL, user_uuid TEXT NOT NULL,
  page INTEGER NOT NULL, group_uuid TEXT, points TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#b3923d', width REAL NOT NULL DEFAULT 0.004,
  opacity REAL NOT NULL DEFAULT 1.0, shape TEXT NOT NULL DEFAULT 'flat',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE paper_clips (
  uuid TEXT PRIMARY KEY NOT NULL, edition_uuid TEXT NOT NULL, user_uuid TEXT NOT NULL,
  page INTEGER NOT NULL, source TEXT NOT NULL, frame TEXT NOT NULL,
  floating INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE shelves (
  uuid TEXT PRIMARY KEY NOT NULL, user_uuid TEXT NOT NULL, name TEXT NOT NULL,
  color TEXT NOT NULL, is_public INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE _local_blobs (
  sha256 TEXT PRIMARY KEY NOT NULL, bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE _local_blob_refs (
  table_name TEXT NOT NULL, row_uuid TEXT NOT NULL,
  sha256 TEXT NOT NULL REFERENCES _local_blobs(sha256),
  PRIMARY KEY(table_name, row_uuid)
);

INSERT INTO _local_schema_migrations(migration_id) VALUES
  ('202609120001_domain'), ('202609120001_local'),
  ('202609130001_local_annotations');
INSERT INTO shelves VALUES ('s1','u1','Nook','#123456',0,1,0,
   '2026-01-01','2026-01-01',1,NULL);
INSERT INTO papers VALUES
  ('p1','10.0/x','A paper','["Ann"]','A journal',2026,
   '2026-01-01','2026-01-01',1,NULL);
-- Two files of one paper: the one the copy reads, and a later one nobody took.
INSERT INTO paper_editions VALUES ('e1','p1','p1.pdf','abc','2026-01-01','2026-01-01',1,NULL);
INSERT INTO paper_editions VALUES ('e2','p1','p2.pdf','def','2026-01-02','2026-01-02',1,NULL);
INSERT INTO copies VALUES
  ('c1','p1','u1','s1','e1','abc',NULL,NULL,NULL,1,0,NULL,NULL,NULL,
   '2026-01-01','2026-01-01',1,NULL);
INSERT INTO _local_blobs VALUES ('abc',10);
INSERT INTO _local_blob_refs VALUES ('paper_editions','e1','abc');
INSERT INTO comments VALUES
  ('n1','p1','e1','u1',3,'A note','point','{"x":0.2,"y":0.4}','Nib',
   '2026-01-01','2026-01-01',1,NULL);
INSERT INTO ink_strokes VALUES
  ('i1','e1','u1',2,NULL,'[{"x":0.1,"y":0.2}]','#b3923d',0.004,1.0,'round',
   '2026-01-01','2026-01-01',1,NULL);
INSERT INTO paper_clips VALUES
  ('k1','e1','u1',4,'{"x":0,"y":0,"w":1,"h":1}','{"x":0,"y":0,"w":1,"h":1}',0,
   '2026-01-01','2026-01-01',1,NULL);
"#;

    fn count(connection: &Connection, sql: &str) -> i64 {
        connection.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    fn has_table(connection: &Connection, name: &str) -> bool {
        count(
            connection,
            &format!("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{name}'"),
        ) > 0
    }

    #[test]
    fn a_replica_from_the_previous_release_upgrades_instead_of_refusing_to_start() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(PREVIOUS_RELEASE).unwrap();

        // This is the whole point: it used to fail here, and the application
        // aborted before it could draw a window.
        run(&mut connection).expect("a replica from the previous release must upgrade");

        assert_eq!(count(&connection, "SELECT COUNT(*) FROM annotations"), 3);
        for kind in ["note", "ink", "clip"] {
            assert_eq!(
                count(
                    &connection,
                    &format!("SELECT COUNT(*) FROM annotations WHERE kind='{kind}'"),
                ),
                1,
                "the {kind} did not come across",
            );
        }
        // The annotations kept what made them annotations rather than arriving empty.
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM annotations WHERE kind='ink' \
                 AND json_extract(body,'$.points') IS NOT NULL",
            ),
            1,
        );
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM annotations WHERE kind='note' \
                 AND json_extract(body,'$.anchor.type')='point'",
            ),
            1,
        );
        for table in ["comments", "ink_strokes", "paper_clips"] {
            assert!(!has_table(&connection, table), "{table} was left behind");
        }
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM pragma_table_info('copies') WHERE name='marketed'",
            ),
            0,
        );

        // Editions are folded away: each file became a paper of its own, and
        // the copy stayed on the file it was reading.
        assert!(!has_table(&connection, "paper_editions"));
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM papers"), 2);
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM papers WHERE uuid='p1' AND sha256='abc' \
                 AND file_path='p1.pdf'",
            ),
            1,
            "the first file kept the paper's own uuid",
        );
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM papers WHERE uuid<>'p1' AND sha256='def' \
                 AND title='A paper'",
            ),
            1,
            "the second file became a paper of its own",
        );
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM copies WHERE paper_uuid='p1'"),
            1,
        );
        // Every annotation followed its file, and none was left behind.
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM annotations WHERE paper_uuid='p1'"),
            3,
        );
        for column in ["edition_uuid", "edition_sha256", "ignored_edition_uuid"] {
            assert_eq!(
                count(
                    &connection,
                    &format!(
                        "SELECT COUNT(*) FROM pragma_table_info('copies') WHERE name='{column}'"
                    ),
                ),
                0,
                "copies still carries {column}",
            );
        }
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM pragma_table_info('annotations') WHERE name='edition_uuid'",
            ),
            0,
        );
        // The blob the copy reads is still spoken for, under the paper.
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM _local_blob_refs \
                 WHERE table_name='papers' AND row_uuid='p1' AND sha256='abc'",
            ),
            1,
        );
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM _local_blob_refs WHERE table_name='paper_editions'",
            ),
            0,
        );
    }

    #[test]
    fn running_twice_over_the_same_replica_changes_nothing_further() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(PREVIOUS_RELEASE).unwrap();
        run(&mut connection).unwrap();
        run(&mut connection).expect("a second start must be quiet");
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM annotations"), 3);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM papers"), 2);
    }

    #[test]
    fn a_fresh_replica_starts_on_the_current_schema() {
        let mut connection = Connection::open_in_memory().unwrap();
        run(&mut connection).unwrap();
        assert!(has_table(&connection, "annotations"));
        for table in ["comments", "ink_strokes", "paper_clips", "paper_editions"] {
            assert!(!has_table(&connection, table));
        }
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM pragma_table_info('papers') WHERE name='sha256'",
            ),
            1,
        );
    }
}
