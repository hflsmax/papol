use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};

// The synchronized schema, shared with the service.
//
// One file, describing the shape Papol has now. There is deliberately no
// second file describing a shape it used to have: a replica written under an
// earlier schema is not carried forward, it is thrown away and pulled again.
// The service holds every synchronized row, so nothing is lost by that — and
// what it buys is a schema that reads as the shape of the thing, rather than
// as the history of how it got here.
const DOMAIN: &str = include_str!("../../../../schema/domain/domain.sql");

// What only this computer holds: which accounts have signed in here, the
// changes not yet sent, the conflicts nobody has looked at, the files kept
// for reading on a train. None of it is synchronized, and none of it
// outlives a replica the service has moved past.
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

-- Notes, ink and clips on a PDF opened from the file system, kept on this
-- device by the file's content hash until the paper is added to a nook.
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

// Where a replica records which schema wrote it.
const FINGERPRINT_KEY: &str = "schema_fingerprint";

/// The name of the schema this build writes.
///
/// A digest of the DDL rather than a number somebody maintains. The schema
/// changing is the one thing this has to notice, and reading the name off
/// the text means there is nothing to remember to bump: edit the SQL and
/// every replica written under the old text stops being recognized, which
/// is the whole mechanism.
pub fn fingerprint() -> String {
    let mut digest = Sha256::new();
    digest.update(DOMAIN.as_bytes());
    digest.update(LOCAL.as_bytes());
    hex::encode(digest.finalize())
}

/// Whether this replica is one this build can read.
///
/// Three answers collapse into two. A file with nothing in it is about to
/// become a replica of this schema, so it is recognized. A file recording
/// this build's fingerprint is one, so it is too. Anything else — an older
/// schema, or a replica from before replicas recorded what wrote them — is
/// not, and the caller throws it away rather than guessing which of the
/// shapes Papol has had over the years this one is.
///
/// Fails closed: a file that cannot be read well enough to answer is not
/// recognized. Discarding a replica costs a re-synchronization; opening the
/// wrong one costs whatever the mismatch quietly does to the rows.
pub fn recognizes(connection: &Connection) -> bool {
    let empty = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count == 0)
        .unwrap_or(false);
    if empty {
        return true;
    }
    connection
        .query_row(
            "SELECT value FROM _local_settings WHERE key=?1",
            [FINGERPRINT_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .is_some_and(|recorded| recorded == fingerprint())
}

/// Write the schema, and the record of which schema it is.
///
/// Every statement is `IF NOT EXISTS`, so this runs against a replica that
/// already has the shape as readily as against an empty file. What it will
/// not do is reshape anything: by the time it is called, the replica is
/// either new or already this schema's, because `recognizes` said so.
pub fn apply(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute_batch(DOMAIN)
        .map_err(|error| format!("The shared schema could not be written: {error}"))?;
    transaction
        .execute_batch(LOCAL)
        .map_err(|error| format!("The local schema could not be written: {error}"))?;
    transaction
        .execute(
            "INSERT INTO _local_settings(key,value) VALUES (?1,?2) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (FINGERPRINT_KEY, fingerprint()),
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}
