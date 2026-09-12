use rusqlite::{Connection, OptionalExtension, Transaction};

const DOMAIN_BOARD_SYNC: &str =
    include_str!("../../../../schema/domain/202609120001_board_sync.sql");
const DOMAIN_ANNOTATIONS: &str =
    include_str!("../../../../schema/domain/202609120002_annotations.sql");
const DOMAIN_NOOK: &str = include_str!("../../../../schema/domain/202609120003_nook.sql");
const DOMAIN_COPY_TAGS: &str = include_str!("../../../../schema/domain/202609120004_copy_tags.sql");

const LOCAL_INFRASTRUCTURE: &str = r#"
CREATE TABLE IF NOT EXISTS _local_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
CREATE TABLE IF NOT EXISTS _local_sync_state (
  account_id INTEGER PRIMARY KEY NOT NULL,
  pull_cursor INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS _local_outbox (
  local_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL UNIQUE,
  changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS ix_local_outbox_account_sequence
  ON _local_outbox(account_id, local_sequence);
CREATE TABLE IF NOT EXISTS _local_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"#;

const LOCAL_BLOB_REFERENCES: &str = r#"
CREATE TABLE IF NOT EXISTS _local_blob_refs (
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  sha256 TEXT NOT NULL REFERENCES _local_blobs(sha256),
  PRIMARY KEY(table_name, row_id)
);
CREATE INDEX IF NOT EXISTS ix_local_blob_refs_sha256 ON _local_blob_refs(sha256);
"#;

const LOCAL_BLOB_LIFECYCLE: &str = r#"
ALTER TABLE _local_blobs ADD COLUMN last_accessed_at TEXT;
UPDATE _local_blobs SET last_accessed_at=created_at WHERE last_accessed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_local_blobs_eviction
  ON _local_blobs(durability, last_accessed_at, created_at);
"#;

const LOCAL_ACCOUNTS: &str = r#"
CREATE TABLE IF NOT EXISTS _local_accounts (
  account_id INTEGER PRIMARY KEY NOT NULL,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"#;

const LOCAL_OUTBOX_STATE: &str = r#"
ALTER TABLE _local_outbox ADD COLUMN state TEXT NOT NULL DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS ix_local_outbox_account_state_sequence
  ON _local_outbox(account_id, state, local_sequence);
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

    apply_legacy_board_blob_column(&transaction)?;
    apply_sql(
        &transaction,
        "202609120001_domain_board_sync",
        DOMAIN_BOARD_SYNC,
    )?;
    apply_sql(
        &transaction,
        "202609120002_domain_annotations",
        DOMAIN_ANNOTATIONS,
    )?;
    apply_sql(&transaction, "202609120003_domain_nook", DOMAIN_NOOK)?;
    apply_sql(
        &transaction,
        "202609120004_domain_copy_tags",
        DOMAIN_COPY_TAGS,
    )?;
    apply_sql(
        &transaction,
        "202609120002_local_infrastructure",
        LOCAL_INFRASTRUCTURE,
    )?;
    apply_sql(
        &transaction,
        "202609120003_local_blob_references",
        LOCAL_BLOB_REFERENCES,
    )?;
    apply_sql(
        &transaction,
        "202609120004_local_blob_lifecycle",
        LOCAL_BLOB_LIFECYCLE,
    )?;
    apply_sql(&transaction, "202609120005_local_accounts", LOCAL_ACCOUNTS)?;
    apply_sql(
        &transaction,
        "202609120006_local_outbox_state",
        LOCAL_OUTBOX_STATE,
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

fn record(transaction: &Transaction<'_>, migration_id: &str) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO _local_schema_migrations(migration_id) VALUES (?1)",
            [migration_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_sql(transaction: &Transaction<'_>, migration_id: &str, sql: &str) -> Result<(), String> {
    if applied(transaction, migration_id)? {
        return Ok(());
    }
    transaction
        .execute_batch(sql)
        .map_err(|error| format!("Migration {migration_id} failed: {error}"))?;
    record(transaction, migration_id)
}

fn apply_legacy_board_blob_column(transaction: &Transaction<'_>) -> Result<(), String> {
    const MIGRATION_ID: &str = "202609120000_legacy_board_item_blob_sha256";
    if applied(transaction, MIGRATION_ID)? {
        return Ok(());
    }
    let columns = transaction
        .prepare("PRAGMA table_info(board_items)")
        .map_err(|error| error.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if !columns.is_empty() && !columns.iter().any(|column| column == "blob_sha256") {
        transaction
            .execute("ALTER TABLE board_items ADD COLUMN blob_sha256 TEXT", [])
            .map_err(|error| format!("Migration {MIGRATION_ID} failed: {error}"))?;
    }
    record(transaction, MIGRATION_ID)
}
