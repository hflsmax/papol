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
