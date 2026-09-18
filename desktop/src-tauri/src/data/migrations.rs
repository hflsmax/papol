use rusqlite::{Connection, OptionalExtension, Transaction};

const DOMAIN: &str = include_str!("../../../../schema/domain/202609120001_initial.sql");

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

// The shapes that mean this library was written before a paper became its
// file, on 2026-09-17.
//
// Everything that used to carry a replica across that line — folding away
// editions, gathering notes, ink and clips into one table, closing the
// pairs the old DOI-keyed import left behind, and making the digest the key
// — has been deleted. Five hundred lines that every later change had to be
// read against, for a shape no replica this build can still be in.
//
// A replica is a copy. Everything in it came from the service and the
// service still has it, so the answer to a library this build cannot read
// is to throw it away and take the snapshot again — which is what the next
// sync does first anyway. Nothing is lost by it that was not already lost:
// a replica on that schema belongs to a build the service refuses outright
// (`PROTOCOL_MINIMUM_VERSION`), so whatever is waiting in its outbox has
// had nowhere to go for as long as it has been there.
//
// Refusing to open is the other answer, and the worse one: it leaves a
// person with an application that will not start and a file to go and find
// in their Library folder.
const BEFORE_THE_DIGEST: [&str; 4] =
    ["paper_editions", "comments", "ink_strokes", "paper_clips"];

fn discard_a_library_this_build_cannot_read(
    transaction: &Transaction<'_>,
) -> Result<(), String> {
    let has_table = |name: &str| -> Result<bool, String> {
        transaction
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                [name],
                |_| Ok(true),
            )
            .optional()
            .map_err(|error| error.to_string())
            .map(|value| value.unwrap_or(false))
    };
    let mut unreadable = false;
    for name in BEFORE_THE_DIGEST {
        unreadable |= has_table(name)?;
    }
    if has_table("papers")? {
        unreadable |= transaction
            .query_row(
                "SELECT 1 FROM pragma_table_info('papers') WHERE name='uuid'",
                [],
                |_| Ok(true),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or(false);
    }
    if !unreadable {
        return Ok(());
    }

    let names: Vec<String> = {
        let mut statement = transaction
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' \
                 AND name NOT LIKE 'sqlite_%'",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<_, _>>()
            .map_err(|error| error.to_string())?
    };
    for name in names {
        transaction
            .execute_batch(&format!("DROP TABLE IF EXISTS \"{name}\";"))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn run(connection: &mut Connection) -> Result<(), String> {
    // A migration takes tables apart and puts them back, so for its length
    // the references between them are in pieces by design. Enforcing them
    // mid-rebuild only asks whether a half-finished schema is consistent,
    // which it is not and does not need to be — what matters is that it is
    // consistent when the work is done. Off before the transaction, because
    // SQLite ignores this pragma inside one.
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|error| error.to_string())?;
    let outcome = migrate_within(connection);
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|error| error.to_string())?;
    outcome
}

fn migrate_within(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    // Ahead of the bookkeeping table, which a discard would otherwise
    // drop out from under the migrations about to be recorded in it.
    discard_a_library_this_build_cannot_read(&transaction)?;
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

    /// A library written before a paper became its file: notes, ink and
    /// clips in three tables, a copy pinned to an edition, and its
    /// migration ids already recorded — that last part being what stops
    /// the domain DDL from reaching it.
    const BEFORE_THE_DIGEST_LIBRARY: &str = r#"
CREATE TABLE _local_schema_migrations (
  migration_id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO _local_schema_migrations (migration_id) VALUES ('202609120001_domain');
CREATE TABLE papers (
  uuid TEXT PRIMARY KEY NOT NULL, doi TEXT, title TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO papers VALUES ('p1',NULL,'Held','2026-01-01','2026-01-01');
CREATE TABLE paper_editions (
  uuid TEXT PRIMARY KEY NOT NULL, paper_uuid TEXT NOT NULL,
  file_path TEXT NOT NULL, sha256 TEXT
);
CREATE TABLE comments (
  uuid TEXT PRIMARY KEY NOT NULL, paper_uuid TEXT NOT NULL,
  user_uuid TEXT NOT NULL, content TEXT NOT NULL DEFAULT ''
);
CREATE TABLE _local_outbox (
  local_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  account_uuid TEXT NOT NULL, client_uuid TEXT NOT NULL,
  mutation_uuid TEXT NOT NULL UNIQUE, changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  state TEXT NOT NULL DEFAULT 'pending'
);
INSERT INTO _local_outbox (account_uuid, client_uuid, mutation_uuid, changes_json)
  VALUES ('u1','c1','m1','[]');
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
    fn a_library_this_build_cannot_read_is_thrown_away_and_made_again() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(BEFORE_THE_DIGEST_LIBRARY).unwrap();

        run(&mut connection).expect("an unreadable library must not stop the app");

        // The shapes it could not read are gone, and today's are here.
        for table in ["paper_editions", "comments", "ink_strokes", "paper_clips"] {
            assert!(!has_table(&connection, table), "{table} survived");
        }
        assert!(has_table(&connection, "annotations"));
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM pragma_table_info('papers') WHERE name='sha256'",
            ),
            1,
        );
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM pragma_table_info('papers') WHERE name='uuid'",
            ),
            0,
        );
        // Nothing of the old library is carried: it is a replica, and the
        // next sync takes the snapshot again.
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM papers"), 0);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM _local_outbox"), 0);
    }

    #[test]
    fn a_library_keyed_by_the_digest_is_left_alone() {
        let mut connection = Connection::open_in_memory().unwrap();
        run(&mut connection).unwrap();
        connection
            .execute_batch(
                "INSERT INTO papers (sha256, title, file_path, created_at, updated_at) \
                 VALUES ('a','Kept','a.pdf','2026-01-01','2026-01-01');",
            )
            .unwrap();

        run(&mut connection).expect("a second start must be quiet");

        assert_eq!(count(&connection, "SELECT COUNT(*) FROM papers"), 1);
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
