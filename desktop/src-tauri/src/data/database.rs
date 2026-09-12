use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

const REGISTRY: &str = include_str!("../../../../schema/sync_registry.json");
pub const DEFAULT_CACHE_LIMIT_BYTES: i64 = 2 * 1024 * 1024 * 1024;
const MAX_PENDING_BLOB_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DataChange {
    pub table: String,
    pub id: String,
    pub operation: String,
    #[serde(default)]
    pub values: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QueuedChange {
    pub table: String,
    pub id: String,
    pub base_revision: i64,
    pub operation: String,
    pub values: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MutationReceipt {
    pub client_id: String,
    pub mutation_id: String,
    pub local_sequence: i64,
    pub rows: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BlobRecord {
    pub sha256: String,
    pub size: usize,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecoveryExport {
    pub path: String,
    pub size: u64,
    pub mutations: usize,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutboxMutation {
    pub protocol_version: i64,
    pub client_id: String,
    pub mutation_id: String,
    pub local_sequence: i64,
    pub changes: Vec<QueuedChange>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoteChange {
    pub table: String,
    pub id: String,
    pub revision: i64,
    pub operation: String,
    pub row: Map<String, Value>,
}

pub struct LocalStore {
    connection: Mutex<Connection>,
    blob_directory: PathBuf,
}

impl LocalStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        let blob_directory = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("blobs");
        std::fs::create_dir_all(&blob_directory).map_err(|error| error.to_string())?;
        let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
        connection
            .execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
            .map_err(|error| error.to_string())?;
        super::migrations::run(&mut connection)?;
        recover_staged_blob_removals(&connection, &blob_directory)?;
        Ok(Self {
            connection: Mutex::new(connection),
            blob_directory,
        })
    }

    pub fn mutate(
        &self,
        account_id: i64,
        changes: Vec<DataChange>,
    ) -> Result<MutationReceipt, String> {
        if changes.is_empty() {
            return Err("A mutation needs at least one row change".into());
        }
        validate_import_batch(&changes)?;
        let registry: Value = serde_json::from_str(REGISTRY).map_err(|error| error.to_string())?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let client_id = local_client_id(&transaction)?;
        let mutation_id = Uuid::new_v4().to_string();
        let mut queued = Vec::new();
        let mut rows = Vec::new();

        for change in changes {
            Uuid::parse_str(&change.id).map_err(|_| "Synchronized row IDs must be UUIDs")?;
            let rule = registry["tables"]
                .get(&change.table)
                .ok_or_else(|| format!("{} is not synchronized", change.table))?;
            if rule["read_only"].as_bool() == Some(true) {
                return Err(format!("{} is read-only on this device", change.table));
            }
            let writable: HashSet<&str> = rule["client_writable"]
                .as_array()
                .ok_or("Invalid embedded sync registry")?
                .iter()
                .filter_map(Value::as_str)
                .collect();
            if let Some(field) = change
                .values
                .keys()
                .find(|field| !writable.contains(field.as_str()))
            {
                return Err(format!("Client cannot write {}.{field}", change.table));
            }
            validate_domain_values(&change)?;
            let blob_digest = change
                .values
                .get(if change.table == "paper_editions" {
                    "sha256"
                } else {
                    "blob_sha256"
                })
                .and_then(Value::as_str);
            if blob_digest.is_some_and(|digest| !self.has_blob(digest)) {
                return Err("A local file mutation must reference an imported blob".into());
            }
            validate_ownership(&transaction, account_id, &change)?;
            let old_revision: Option<i64> = transaction
                .query_row(
                    &format!("SELECT revision FROM {} WHERE id=?1", change.table),
                    [&change.id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            let base_revision = old_revision.unwrap_or(0);
            if rule["create_only"].as_bool() == Some(true)
                && (old_revision.is_some() || change.operation != "upsert")
            {
                return Err(format!("{} rows can only be created locally", change.table));
            }
            let revision = base_revision + 1;
            apply_local_change(
                &transaction,
                account_id,
                &change,
                revision,
                old_revision.is_none(),
            )?;
            validate_local_row(&transaction, &change.table, &change.id)?;
            refresh_blob_reference(&transaction, &change.table, &change.id)?;
            let row = read_row(&transaction, &change.table, &change.id)?;
            let values =
                if rule["conflict"].as_str() == Some("whole_row") && change.operation != "delete" {
                    row.as_object()
                        .ok_or("Local synchronized row is not an object")?
                        .iter()
                        .filter(|(field, _)| writable.contains(field.as_str()))
                        .map(|(field, value)| (field.clone(), value.clone()))
                        .collect()
                } else {
                    change.values.clone()
                };
            queued.push(QueuedChange {
                table: change.table.clone(),
                id: change.id.clone(),
                base_revision,
                operation: change.operation.clone(),
                values,
            });
            rows.push(row);
        }

        let changes_json = serde_json::to_string(&queued).map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO _local_outbox(account_id,client_id,mutation_id,changes_json) VALUES (?1,?2,?3,?4)",
                params![account_id, client_id, mutation_id, changes_json],
            )
            .map_err(|error| error.to_string())?;
        let local_sequence = transaction.last_insert_rowid();
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(MutationReceipt {
            client_id,
            mutation_id,
            local_sequence,
            rows,
        })
    }

    pub fn query(&self, account_id: i64, name: &str, parameters: Value) -> Result<Value, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        match name {
            "boards" => query_boards(&connection, account_id),
            "board" => {
                let id = parameters["id"]
                    .as_str()
                    .ok_or("board query requires an id")?;
                query_board(&connection, account_id, id)
            }
            "board_group" => {
                let id = parameters["id"]
                    .as_str()
                    .ok_or("board_group query requires an id")?;
                query_board_group(&connection, account_id, id)
            }
            "comments" => {
                query_annotations(&connection, account_id, "comments", "paper_id", parameters)
            }
            "ink" => query_annotations(
                &connection,
                account_id,
                "ink_strokes",
                "edition_id",
                parameters,
            ),
            "clips" => query_annotations(
                &connection,
                account_id,
                "paper_clips",
                "edition_id",
                parameters,
            ),
            "shelves" => query_owned_rows(&connection, account_id, "shelves", "position,name,id"),
            "tags" => query_owned_rows(&connection, account_id, "tags", "name,id"),
            "copies" => query_owned_rows(&connection, account_id, "copies", "updated_at DESC,id"),
            "copy_tags" => query_owned_rows(&connection, account_id, "copy_tags", "created_at,id"),
            "nook" => query_nook(&connection, account_id),
            "papers" => query_papers(&connection, account_id),
            "paper" => {
                let id = parameters["id"]
                    .as_str()
                    .ok_or("paper query requires an id")?;
                query_paper(&connection, account_id, id)
            }
            "paper_by_pdf" => {
                let sha256 = parameters["sha256"]
                    .as_str()
                    .ok_or("paper query requires sha256")?;
                query_paper_by_pdf(&connection, account_id, sha256)
            }
            "sync_status" => query_sync_status(&connection, account_id),
            "storage_status" => query_storage_status(&connection),
            "account" => query_local_account(&connection, account_id),
            _ => Err(format!("Unknown local query: {name}")),
        }
    }

    pub fn local_setting(&self, key: &str) -> Result<Option<String>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection
            .query_row(
                "SELECT value FROM _local_settings WHERE key=?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn set_local_setting(&self, key: &str, value: &str) -> Result<(), String> {
        if key != "sync_mode" {
            return Err("Unknown local setting".into());
        }
        if !matches!(value, "automatic" | "manual") {
            return Err("Sync mode must be automatic or manual".into());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection
            .execute(
                "INSERT INTO _local_settings(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, value],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn set_local_account(&self, account_id: i64, profile: Value) -> Result<(), String> {
        if account_id < 1 || profile["id"].as_i64() != Some(account_id) {
            return Err("Local account profile identity does not match".into());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection.execute(
            "INSERT INTO _local_accounts(account_id,profile_json,updated_at) VALUES (?1,?2,?3) \
             ON CONFLICT(account_id) DO UPDATE SET profile_json=excluded.profile_json,updated_at=excluded.updated_at",
            params![account_id, profile.to_string(), chrono_text()],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn next_outbox(&self, account_id: i64) -> Result<Option<OutboxMutation>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection
            .query_row(
                "SELECT local_sequence,client_id,mutation_id,changes_json FROM _local_outbox \
                 WHERE account_id=?1 AND state='pending' ORDER BY local_sequence LIMIT 1",
                [account_id],
                |row| {
                    let changes_json: String = row.get(3)?;
                    let changes = serde_json::from_str(&changes_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            changes_json.len(),
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                    Ok(OutboxMutation {
                        protocol_version: 1,
                        local_sequence: row.get(0)?,
                        client_id: row.get(1)?,
                        mutation_id: row.get(2)?,
                        changes,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn record_outbox_error(
        &self,
        account_id: i64,
        local_sequence: i64,
        message: &str,
        blocked: bool,
    ) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection
            .execute(
                "UPDATE _local_outbox SET attempts=attempts+1,last_error=?3,state=?4 \
             WHERE account_id=?1 AND local_sequence=?2",
                params![
                    account_id,
                    local_sequence,
                    message,
                    if blocked { "blocked" } else { "pending" }
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn client_id(&self) -> Result<String, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        local_client_id(&connection)
    }

    pub fn accept_push(
        &self,
        account_id: i64,
        local_sequence: i64,
        rows: Vec<Map<String, Value>>,
        conflicts: Vec<Value>,
        aliases: Map<String, Value>,
    ) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch("PRAGMA defer_foreign_keys=ON;")
            .map_err(|error| error.to_string())?;
        apply_identity_aliases(&transaction, account_id, &aliases)?;
        for mut row in rows {
            let table = row
                .remove("table")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or("Push result row is missing its table")?;
            let row_id = row
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Push result row is missing its id")?
                .to_owned();
            let blob_sha256 = row
                .get(if table == "paper_editions" {
                    "sha256"
                } else {
                    "blob_sha256"
                })
                .and_then(Value::as_str)
                .map(str::to_owned);
            validate_remote_ownership(&transaction, account_id, &table, &row)?;
            apply_remote_row(&transaction, &table, row)?;
            refresh_blob_reference(&transaction, &table, &row_id)?;
            if let Some(sha256) = blob_sha256 {
                transaction
                    .execute(
                        "UPDATE _local_blobs SET durability='pinned' WHERE sha256=?1",
                        [sha256],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        for conflict in conflicts {
            let table = conflict["table"].as_str().unwrap_or("unknown");
            let row_id = conflict["id"].as_str().unwrap_or("unknown");
            let resolved_at = matches!(
                conflict["resolution"].as_str(),
                Some("client_won" | "server_won")
            )
            .then(chrono_text);
            transaction.execute(
                "INSERT INTO _local_conflicts(account_id,table_name,row_id,details_json,resolved_at) VALUES (?1,?2,?3,?4,?5)",
                params![account_id, table, row_id, conflict.to_string(), resolved_at],
            ).map_err(|error| error.to_string())?;
        }
        transaction
            .execute(
                "DELETE FROM _local_outbox WHERE account_id=?1 AND local_sequence=?2",
                params![account_id, local_sequence],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn apply_pull(
        &self,
        account_id: i64,
        changes: Vec<RemoteChange>,
        cursor: i64,
    ) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for change in changes {
            if change.row.get("id").and_then(Value::as_str) != Some(change.id.as_str()) {
                return Err("Pulled row identity does not match its envelope".into());
            }
            if change.row.get("revision").and_then(Value::as_i64) != Some(change.revision) {
                return Err("Pulled row revision does not match its envelope".into());
            }
            if change.operation != "upsert" && change.operation != "delete" {
                return Err("Unknown pulled operation".into());
            }
            validate_remote_ownership(&transaction, account_id, &change.table, &change.row)?;
            let table = change.table;
            let id = change.id;
            apply_remote_row(&transaction, &table, change.row)?;
            refresh_blob_reference(&transaction, &table, &id)?;
        }
        transaction.execute(
            "INSERT INTO _local_sync_state(account_id,pull_cursor,last_synced_at,last_error) VALUES (?1,?2,?3,NULL) ON CONFLICT(account_id) DO UPDATE SET pull_cursor=excluded.pull_cursor,last_synced_at=excluded.last_synced_at,last_error=NULL",
            params![account_id, cursor, chrono_text()],
        ).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn apply_snapshot(
        &self,
        account_id: i64,
        rows: Vec<Map<String, Value>>,
    ) -> Result<usize, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let count = rows.len();
        let pending: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM _local_outbox WHERE account_id=?1",
                [account_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if pending == 0 {
            // A snapshot is the complete server mirror for these account-owned
            // tables. Mark the previous mirror stale inside this transaction;
            // rows present below are immediately restored by their upsert.
            // Never do this around queued local work: its rows and dependencies
            // must remain intact until the server has accepted or rejected it.
            let stale_at = chrono_text();
            for table in [
                "comments",
                "ink_strokes",
                "paper_clips",
                "copy_tags",
                "copies",
                "shelves",
                "tags",
            ] {
                transaction
                    .execute(
                        &format!(
                            "UPDATE {table} SET deleted_at=?1 WHERE user_id=?2 AND deleted_at IS NULL"
                        ),
                        params![stale_at, account_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        for mut row in rows {
            let table = row
                .remove("table")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or("Snapshot row is missing its table")?;
            let id = row
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Snapshot row is missing its id")?
                .to_owned();
            validate_remote_ownership(&transaction, account_id, &table, &row)?;
            apply_remote_row(&transaction, &table, row)?;
            refresh_blob_reference(&transaction, &table, &id)?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(count)
    }

    pub fn pull_cursor(&self, account_id: i64) -> Result<i64, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection
            .query_row(
                "SELECT pull_cursor FROM _local_sync_state WHERE account_id=?1",
                [account_id],
                |row| row.get(0),
            )
            .optional()
            .map(|value| value.unwrap_or(0))
            .map_err(|error| error.to_string())
    }

    pub fn record_sync_error(&self, account_id: i64, message: &str) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection.execute(
            "INSERT INTO _local_sync_state(account_id,last_error) VALUES (?1,?2) ON CONFLICT(account_id) DO UPDATE SET last_error=excluded.last_error",
            params![account_id, message],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn import_blob(
        &self,
        bytes: &[u8],
        mime_type: Option<String>,
    ) -> Result<BlobRecord, String> {
        if bytes.len() > MAX_PENDING_BLOB_BYTES {
            return Err("Offline files may be at most 25 MB".into());
        }
        self.store_blob(bytes, mime_type, "pending")
    }

    pub fn import_remote_blob(
        &self,
        expected_sha256: &str,
        bytes: &[u8],
        mime_type: Option<String>,
    ) -> Result<(), String> {
        use sha2::{Digest, Sha256};

        let actual_sha256 = format!("{:x}", Sha256::digest(bytes));
        if actual_sha256 != expected_sha256 {
            return Err("Downloaded blob failed SHA-256 verification".into());
        }
        let stored = self.store_blob(bytes, mime_type, "cache")?;
        debug_assert_eq!(stored.sha256, expected_sha256);
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        refresh_blob_references_for_digest(&connection, expected_sha256)?;
        drop(connection);
        self.prune_cache(DEFAULT_CACHE_LIMIT_BYTES)?;
        Ok(())
    }

    fn store_blob(
        &self,
        bytes: &[u8],
        mime_type: Option<String>,
        durability: &str,
    ) -> Result<BlobRecord, String> {
        use sha2::{Digest, Sha256};

        let sha256 = format!("{:x}", Sha256::digest(bytes));
        let destination = self.blob_directory.join(&sha256);
        let created = !destination.exists();
        if created {
            let temporary = self
                .blob_directory
                .join(format!(".{sha256}.{}.tmp", Uuid::new_v4()));
            if let Err(error) = std::fs::write(&temporary, bytes)
                .and_then(|()| std::fs::rename(&temporary, &destination))
            {
                let _ = std::fs::remove_file(&temporary);
                return Err(error.to_string());
            }
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let recorded = connection.execute(
            "INSERT INTO _local_blobs(sha256,relative_path,size,mime_type,durability,last_accessed_at) VALUES (?1,?1,?2,?3,?4,?5) ON CONFLICT(sha256) DO UPDATE SET size=excluded.size,mime_type=COALESCE(excluded.mime_type,_local_blobs.mime_type),last_accessed_at=excluded.last_accessed_at,durability=CASE WHEN _local_blobs.durability IN ('pending','pinned') THEN _local_blobs.durability ELSE excluded.durability END",
            params![sha256, bytes.len() as i64, mime_type, durability, chrono_text()],
        );
        if let Err(error) = recorded {
            if created {
                let _ = std::fs::remove_file(&destination);
            }
            return Err(error.to_string());
        }
        Ok(BlobRecord {
            sha256,
            size: bytes.len(),
            mime_type,
        })
    }

    pub fn read_blob(&self, sha256: &str) -> Result<Vec<u8>, String> {
        if sha256.len() != 64
            || !sha256
                .chars()
                .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
        {
            return Err("Invalid blob identifier".into());
        }
        let bytes = std::fs::read(self.blob_directory.join(sha256))
            .map_err(|_| "Blob is not available offline".to_string())?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection
            .execute(
                "UPDATE _local_blobs SET last_accessed_at=?2 WHERE sha256=?1",
                params![sha256, chrono_text()],
            )
            .map_err(|error| error.to_string())?;
        Ok(bytes)
    }

    pub fn has_blob(&self, sha256: &str) -> bool {
        self.blob_directory.join(sha256).is_file()
    }

    pub fn prune_cache(&self, max_bytes: i64) -> Result<usize, String> {
        if max_bytes < 0 {
            return Err("Cache limit cannot be negative".into());
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let total: i64 = connection
            .query_row(
                "SELECT COALESCE(SUM(size),0) FROM _local_blobs WHERE durability='cache'",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if total <= max_bytes {
            return Ok(0);
        }
        let candidates = {
            let mut statement = connection
                .prepare(
                    "SELECT sha256,size FROM _local_blobs WHERE durability='cache' \
                     ORDER BY COALESCE(last_accessed_at,created_at),created_at,sha256",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };
        let mut remaining = total;
        let mut removed = Vec::new();
        for (sha256, size) in candidates {
            if remaining <= max_bytes {
                break;
            }
            remaining -= size;
            removed.push(sha256);
        }
        let mut staged = Vec::new();
        for sha256 in &removed {
            match stage_blob_removal(&self.blob_directory, sha256) {
                Ok(Some(path)) => staged.push((sha256.clone(), path)),
                Ok(None) => {}
                Err(error) => {
                    restore_staged_blobs(&self.blob_directory, &staged);
                    return Err(error);
                }
            }
        }
        let database_result = (|| {
            let transaction = connection
                .transaction()
                .map_err(|error| error.to_string())?;
            for sha256 in &removed {
                transaction
                    .execute("DELETE FROM _local_blob_refs WHERE sha256=?1", [sha256])
                    .map_err(|error| error.to_string())?;
                transaction
                    .execute("DELETE FROM _local_blobs WHERE sha256=?1", [sha256])
                    .map_err(|error| error.to_string())?;
            }
            transaction.commit().map_err(|error| error.to_string())
        })();
        if let Err(error) = database_result {
            restore_staged_blobs(&self.blob_directory, &staged);
            return Err(error);
        }
        for (_, path) in staged {
            let _ = std::fs::remove_file(path);
        }
        Ok(removed.len())
    }

    pub fn discard_unreferenced_blob(&self, sha256: &str) -> Result<bool, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let durability: Option<String> = connection
            .query_row(
                "SELECT durability FROM _local_blobs WHERE sha256=?1",
                [sha256],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if durability.as_deref() != Some("pending") {
            return Ok(false);
        }
        let referenced: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM _local_blob_refs WHERE sha256=?1",
                [sha256],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let queued = {
            let mut statement = connection
                .prepare("SELECT changes_json FROM _local_outbox")
                .map_err(|error| error.to_string())?;
            let encoded = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            encoded.iter().any(|value| {
                serde_json::from_str::<Vec<QueuedChange>>(value).is_ok_and(|changes| {
                    changes.iter().any(|change| {
                        change
                            .values
                            .values()
                            .any(|value| value.as_str() == Some(sha256))
                    })
                })
            })
        };
        if referenced > 0 || queued {
            return Ok(false);
        }
        let staged = stage_blob_removal(&self.blob_directory, sha256)?;
        if let Err(error) = connection.execute("DELETE FROM _local_blobs WHERE sha256=?1", [sha256])
        {
            if let Some(path) = staged.as_ref() {
                restore_staged_blobs(&self.blob_directory, &[(sha256.to_owned(), path.clone())]);
            }
            return Err(error.to_string());
        }
        drop(connection);
        if let Some(path) = staged {
            let _ = std::fs::remove_file(path);
        }
        Ok(true)
    }

    pub fn export_recovery(
        &self,
        account_id: i64,
        destination: &Path,
    ) -> Result<RecoveryExport, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let mutations = {
            let mut statement = connection.prepare(
                "SELECT local_sequence,client_id,mutation_id,changes_json,created_at,attempts,last_error,state \
                 FROM _local_outbox WHERE account_id=?1 ORDER BY local_sequence",
            ).map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([account_id], |row| {
                    let encoded: String = row.get(3)?;
                    let changes: Value = serde_json::from_str(&encoded).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            encoded.len(),
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                    Ok(json!({
                        "local_sequence": row.get::<_, i64>(0)?,
                        "client_id": row.get::<_, String>(1)?,
                        "mutation_id": row.get::<_, String>(2)?,
                        "changes": changes,
                        "created_at": row.get::<_, String>(4)?,
                        "attempts": row.get::<_, i64>(5)?,
                        "last_error": row.get::<_, Option<String>>(6)?,
                        "state": row.get::<_, String>(7)?,
                    }))
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };
        let conflicts = {
            let mut statement = connection
                .prepare(
                    "SELECT table_name,row_id,details_json,created_at,resolved_at \
                 FROM _local_conflicts WHERE account_id=?1 ORDER BY id",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement.query_map([account_id], |row| {
                let details: String = row.get(2)?;
                Ok(json!({
                    "table": row.get::<_, String>(0)?,
                    "id": row.get::<_, String>(1)?,
                    "details": serde_json::from_str::<Value>(&details).unwrap_or(json!(details)),
                    "created_at": row.get::<_, String>(3)?,
                    "resolved_at": row.get::<_, Option<String>>(4)?,
                }))
            }).map_err(|error| error.to_string())?
              .collect::<Result<Vec<_>, _>>()
              .map_err(|error| error.to_string())?;
            rows
        };
        let mut digests = HashSet::new();
        let mut recovery_rows = BTreeMap::new();
        for mutation in &mutations {
            for change in mutation["changes"].as_array().into_iter().flatten() {
                if let (Some(table), Some(id)) = (change["table"].as_str(), change["id"].as_str()) {
                    if let Ok(row) = read_row(&connection, table, id) {
                        recovery_rows.insert(format!("{table}:{id}"), row);
                    }
                }
                for field in ["blob_sha256", "sha256"] {
                    if let Some(digest) = change["values"][field].as_str() {
                        digests.insert(digest.to_owned());
                    }
                }
            }
        }
        let account = connection
            .query_row(
                "SELECT profile_json FROM _local_accounts WHERE account_id=?1",
                [account_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .and_then(|encoded| serde_json::from_str::<Value>(&encoded).ok());
        let manifest = json!({
            "format": "papol-offline-recovery-v1",
            "exported_at": chrono_text(),
            "account_id": account_id,
            "account": account,
            "mutations": mutations,
            "rows": recovery_rows.into_values().collect::<Vec<_>>(),
            "conflicts": conflicts,
        });
        drop(connection);

        let temporary = destination.with_extension("zip.partial");
        let result = (|| {
            let file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
            let mut archive = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            archive
                .start_file("manifest.json", options)
                .map_err(|error| error.to_string())?;
            archive
                .write_all(
                    serde_json::to_string_pretty(&manifest)
                        .map_err(|error| error.to_string())?
                        .as_bytes(),
                )
                .map_err(|error| error.to_string())?;
            let mut files = 0;
            for digest in digests {
                let bytes = self
                    .read_blob(&digest)
                    .map_err(|error| format!("Recovery file {digest} is missing: {error}"))?;
                archive
                    .start_file(format!("blobs/{digest}"), options)
                    .map_err(|error| error.to_string())?;
                archive
                    .write_all(&bytes)
                    .map_err(|error| error.to_string())?;
                files += 1;
            }
            archive.finish().map_err(|error| error.to_string())?;
            std::fs::rename(&temporary, destination).map_err(|error| error.to_string())?;
            Ok::<usize, String>(files)
        })();
        let files = match result {
            Ok(files) => files,
            Err(error) => {
                let _ = std::fs::remove_file(&temporary);
                return Err(error);
            }
        };
        let size = destination
            .metadata()
            .map_err(|error| error.to_string())?
            .len();
        Ok(RecoveryExport {
            path: destination.to_string_lossy().into_owned(),
            size,
            mutations: manifest["mutations"].as_array().map_or(0, Vec::len),
            files,
        })
    }

    #[cfg(test)]
    fn outbox_count(&self) -> i64 {
        self.connection
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM _local_outbox", [], |row| row.get(0))
            .unwrap()
    }
}

fn validate_import_batch(changes: &[DataChange]) -> Result<(), String> {
    let new_papers: HashSet<&str> = changes
        .iter()
        .filter(|change| change.table == "papers")
        .map(|change| change.id.as_str())
        .collect();
    let new_editions: HashSet<&str> = changes
        .iter()
        .filter(|change| change.table == "paper_editions")
        .map(|change| change.id.as_str())
        .collect();
    if new_papers.is_empty() && new_editions.is_empty() {
        return Ok(());
    }
    for paper_id in new_papers {
        let edition = changes
            .iter()
            .find(|change| {
                change.table == "paper_editions"
                    && change.values.get("paper_id").and_then(Value::as_str) == Some(paper_id)
            })
            .ok_or("A local paper import needs an edition")?;
        let owned_copy = changes.iter().any(|change| {
            change.table == "copies"
                && change.values.get("paper_id").and_then(Value::as_str) == Some(paper_id)
                && change.values.get("edition_id").and_then(Value::as_str)
                    == Some(edition.id.as_str())
        });
        if !owned_copy {
            return Err("A local paper import needs an owned copy".into());
        }
    }
    for edition_id in new_editions {
        if !changes.iter().any(|change| {
            change.table == "copies"
                && change.values.get("edition_id").and_then(Value::as_str) == Some(edition_id)
        }) {
            return Err("A local edition import must attach to an owned copy".into());
        }
    }
    Ok(())
}

fn local_client_id(connection: &Connection) -> Result<String, String> {
    let existing: Option<String> = connection
        .query_row(
            "SELECT value FROM _local_settings WHERE key='sync_client_id'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(value) = existing.filter(|value| Uuid::parse_str(value).is_ok()) {
        return Ok(value);
    }
    let value = Uuid::new_v4().to_string();
    connection
        .execute(
            "INSERT INTO _local_settings(key,value) VALUES ('sync_client_id',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [&value],
        )
        .map_err(|error| error.to_string())?;
    Ok(value)
}

fn validate_ownership(
    connection: &Connection,
    account_id: i64,
    change: &DataChange,
) -> Result<(), String> {
    if change.table == "copy_tags" {
        for (field, table) in [("copy_id", "copies"), ("tag_id", "tags")] {
            let parent_id = change
                .values
                .get(field)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    connection
                        .query_row(
                            &format!("SELECT {field} FROM copy_tags WHERE id=?1"),
                            [&change.id],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()
                        .ok()
                        .flatten()
                })
                .ok_or_else(|| format!("copy_tags.{field} is required"))?;
            let owner: Option<i64> = connection
                .query_row(
                    &format!("SELECT user_id FROM {table} WHERE id=?1 AND deleted_at IS NULL"),
                    [parent_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if owner != Some(account_id) {
                return Err("A copy tag can only join rows owned by this account".into());
            }
        }
    }
    if matches!(change.table.as_str(), "boards" | "copies") {
        if let Some(shelf_id) = change.values.get("shelf_id").and_then(Value::as_str) {
            let owner: Option<i64> = connection
                .query_row(
                    "SELECT user_id FROM shelves WHERE id=?1 AND deleted_at IS NULL",
                    [shelf_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if owner != Some(account_id) {
                return Err("A row can only use a shelf owned by this account".into());
            }
        }
    }
    if matches!(
        change.table.as_str(),
        "comments" | "ink_strokes" | "paper_clips" | "copies" | "copy_tags" | "shelves" | "tags"
    ) {
        let owner: Option<i64> = connection
            .query_row(
                &format!("SELECT user_id FROM {} WHERE id=?1", change.table),
                [&change.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if owner.is_some_and(|owner| owner != account_id) {
            return Err("A local mutation cannot modify another account's row".into());
        }
        return Ok(());
    }
    let board_id: Option<String> = if change.table == "boards" {
        Some(change.id.clone())
    } else {
        change
            .values
            .get("board_id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| {
                connection
                    .query_row(
                        &format!("SELECT board_id FROM {} WHERE id=?1", change.table),
                        [&change.id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .ok()
                    .flatten()
            })
    };
    if let Some(board_id) = board_id.as_deref() {
        let owner: Option<i64> = connection
            .query_row(
                "SELECT user_id FROM boards WHERE id=?1",
                [board_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if owner.is_some_and(|owner| owner != account_id) {
            return Err("A local mutation cannot modify another account's board".into());
        }
    }
    Ok(())
}

fn validate_domain_values(change: &DataChange) -> Result<(), String> {
    if change.table == "papers" {
        let title = change
            .values
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if title.is_empty() || title.chars().count() > 500 {
            return Err("Paper title must be 1–500 characters".into());
        }
    } else if change.table == "paper_editions" {
        let digest = change
            .values
            .get("sha256")
            .and_then(Value::as_str)
            .ok_or("A local edition needs its SHA-256")?;
        if digest.len() != 64 || !digest.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("A local edition needs a valid SHA-256".into());
        }
        if change
            .values
            .get("paper_id")
            .and_then(Value::as_str)
            .is_none()
        {
            return Err("A local edition needs its paper".into());
        }
    } else if change.table == "board_items" {
        if let Some(source_url) = change.values.get("source_url").and_then(Value::as_str) {
            let url = reqwest::Url::parse(source_url).map_err(|_| "Board link is invalid")?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Board links must be http or https URLs without credentials".into());
            }
        }
    } else if change.table == "shelves" {
        if let Some(name) = change.values.get("name").and_then(Value::as_str) {
            if name.trim().is_empty() || name.chars().count() > 40 {
                return Err("Shelf name must be 1–40 characters".into());
            }
        }
        if let Some(color) = change.values.get("color").and_then(Value::as_str) {
            if color.len() != 7
                || !color.starts_with('#')
                || !color[1..].chars().all(|c| c.is_ascii_hexdigit())
            {
                return Err("Invalid shelf color".into());
            }
        }
    } else if change.table == "tags" {
        if let Some(name) = change.values.get("name").and_then(Value::as_str) {
            if name.trim().is_empty() || name.chars().count() > 60 {
                return Err("Tag name must be 1–60 characters".into());
            }
        }
    }
    Ok(())
}

fn validate_local_row(connection: &Connection, table: &str, id: &str) -> Result<(), String> {
    if !matches!(table, "comments" | "ink_strokes" | "paper_clips") {
        return Ok(());
    }
    let value = read_row(connection, table, id)?;
    let row = value.as_object().ok_or("Invalid annotation row")?;
    if table == "comments" {
        if row
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .count()
            > 4000
            || row
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .count()
                > 120
        {
            return Err("Note text is too long".into());
        }
        let anchor = row.get("anchor").and_then(Value::as_str);
        let page = row.get("page").and_then(Value::as_i64);
        if anchor.is_none() != row.get("anchor_type").and_then(Value::as_str).is_none() {
            return Err("A note anchor needs its type and coordinates".into());
        }
        if anchor.is_none() != page.is_none() || page.is_some_and(|value| value < 1) {
            return Err("A located note needs a positive page and an anchor".into());
        }
        if anchor.is_none()
            && row
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            return Err("An unlocated note needs text".into());
        }
        if let Some(encoded) = anchor {
            if row.get("anchor_type").and_then(Value::as_str) != Some("point") {
                return Err("Unknown note anchor type".into());
            }
            let point: Value = serde_json::from_str(encoded).map_err(|_| "Invalid note anchor")?;
            for axis in ["x", "y"] {
                if !point[axis]
                    .as_f64()
                    .is_some_and(|coordinate| (0.0..=1.0).contains(&coordinate))
                {
                    return Err("Note coordinates must be within the page".into());
                }
            }
        }
        return Ok(());
    }
    if row
        .get("page")
        .and_then(Value::as_i64)
        .is_none_or(|page| page < 1)
    {
        return Err("Annotation page must be positive".into());
    }
    if table == "ink_strokes" {
        let points: Value = serde_json::from_str(
            row.get("points")
                .and_then(Value::as_str)
                .ok_or("Ink needs points")?,
        )
        .map_err(|_| "Invalid ink points")?;
        let points = points.as_array().ok_or("Ink points must be an array")?;
        if points.is_empty() || points.len() > 4000 {
            return Err("Ink needs between 1 and 4000 points".into());
        }
        if points.iter().any(|point| {
            ["x", "y"].iter().any(|axis| {
                !point[*axis]
                    .as_f64()
                    .is_some_and(|coordinate| (0.0..=1.0).contains(&coordinate))
            })
        }) {
            return Err("Ink coordinates must be within the page".into());
        }
        let width = row.get("width").and_then(Value::as_f64).unwrap_or(0.0);
        let opacity = row.get("opacity").and_then(Value::as_f64).unwrap_or(0.0);
        let color = row.get("color").and_then(Value::as_str).unwrap_or("");
        if !(0.0 < width
            && width <= 0.1
            && 0.0 < opacity
            && opacity <= 1.0
            && color.len() == 7
            && color.starts_with('#')
            && color[1..]
                .chars()
                .all(|character| character.is_ascii_hexdigit())
            && matches!(
                row.get("shape").and_then(Value::as_str),
                Some("flat" | "round")
            ))
        {
            return Err("Invalid ink style".into());
        }
        return Ok(());
    }
    let source: Value = serde_json::from_str(
        row.get("source")
            .and_then(Value::as_str)
            .ok_or("Clip needs a source")?,
    )
    .map_err(|_| "Invalid clip source")?;
    let frame: Value = serde_json::from_str(
        row.get("frame")
            .and_then(Value::as_str)
            .ok_or("Clip needs a frame")?,
    )
    .map_err(|_| "Invalid clip frame")?;
    let number = |value: &Value, key: &str| value[key].as_f64();
    let (sx, sy, sw, sh) = (
        number(&source, "x"),
        number(&source, "y"),
        number(&source, "w"),
        number(&source, "h"),
    );
    if !matches!((sx, sy, sw, sh), (Some(x), Some(y), Some(w), Some(h))
        if (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y)
        && w > 0.0 && h > 0.0 && x + w <= 1.000001 && y + h <= 1.000001)
    {
        return Err("Clip source must stay within its page".into());
    }
    let (fx, fy, fw, fh) = (
        number(&frame, "x"),
        number(&frame, "y"),
        number(&frame, "w"),
        number(&frame, "h"),
    );
    if !matches!((fx, fy, fw, fh), (Some(x), Some(y), Some(w), Some(h))
        if (-10.0..=10.0).contains(&x) && (-10.0..=10.0).contains(&y)
        && w > 0.0 && w <= 10.0 && h > 0.0 && h <= 10.0)
    {
        return Err("Invalid clip frame".into());
    }
    Ok(())
}

fn validate_remote_ownership(
    connection: &Connection,
    account_id: i64,
    table: &str,
    row: &Map<String, Value>,
) -> Result<(), String> {
    if table == "boards" {
        if row.get("user_id").and_then(Value::as_i64) != Some(account_id) {
            return Err("Server returned a board for a different account".into());
        }
        return Ok(());
    }
    if table == "papers" {
        return Ok(());
    }
    if table == "paper_editions" {
        let paper_id = row
            .get("paper_id")
            .and_then(Value::as_str)
            .ok_or("Server edition row is missing its paper")?;
        let exists: Option<i64> = connection
            .query_row("SELECT 1 FROM papers WHERE id=?1", [paper_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        return exists
            .map(|_| ())
            .ok_or_else(|| "Server edition has no local paper".into());
    }
    if matches!(
        table,
        "comments" | "ink_strokes" | "paper_clips" | "copies" | "copy_tags" | "shelves" | "tags"
    ) {
        if row.get("user_id").and_then(Value::as_i64) != Some(account_id) {
            return Err("Server returned an annotation for a different account".into());
        }
        return Ok(());
    }
    if !matches!(table, "board_groups" | "board_items") {
        return Err(format!("Server sent an unregistered table: {table}"));
    }
    let board_id = row
        .get("board_id")
        .and_then(Value::as_str)
        .ok_or("Server child row is missing its board")?;
    let owner: Option<i64> = connection
        .query_row(
            "SELECT user_id FROM boards WHERE id=?1",
            [board_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if owner != Some(account_id) {
        return Err("Server returned a child row for a different account".into());
    }
    Ok(())
}

fn json_to_sql(value: &Value) -> Result<SqlValue, String> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(value) => Ok(SqlValue::Integer(i64::from(*value))),
        Value::Number(value) => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| value.as_f64().map(SqlValue::Real))
            .ok_or_else(|| "Unsupported number".into()),
        Value::String(value) => Ok(SqlValue::Text(value.clone())),
        _ => Err("Synchronized columns must be scalar values".into()),
    }
}

fn apply_identity_aliases(
    transaction: &rusqlite::Transaction<'_>,
    account_id: i64,
    aliases: &Map<String, Value>,
) -> Result<(), String> {
    // Collapse the most dependent identities first. A duplicate imported
    // copy may still point at the temporary paper ID; removing/merging it
    // before the paper alias avoids violating UNIQUE(paper_id,user_id).
    for (old_id, new_value) in aliases {
        let new_id = new_value
            .as_str()
            .ok_or("Server alias target must be a UUID")?;
        let old_exists: Option<i64> = transaction
            .query_row("SELECT 1 FROM copy_tags WHERE id=?1", [old_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if old_exists.is_none() {
            continue;
        }
        let canonical_exists: Option<i64> = transaction
            .query_row("SELECT 1 FROM copy_tags WHERE id=?1", [new_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if canonical_exists.is_some() {
            transaction
                .execute("DELETE FROM copy_tags WHERE id=?1", [old_id])
                .map_err(|error| error.to_string())?;
        } else {
            transaction
                .execute(
                    "UPDATE copy_tags SET id=?1 WHERE id=?2",
                    params![new_id, old_id],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    for (old_id, new_value) in aliases {
        let new_id = new_value
            .as_str()
            .ok_or("Server alias target must be a UUID")?;
        let old_exists: Option<i64> = transaction
            .query_row("SELECT 1 FROM copies WHERE id=?1", [old_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if old_exists.is_none() {
            continue;
        }
        let canonical_exists: Option<i64> = transaction
            .query_row("SELECT 1 FROM copies WHERE id=?1", [new_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if canonical_exists.is_some() {
            transaction
                .execute(
                    "DELETE FROM copy_tags WHERE copy_id=?1 AND tag_id IN \
                 (SELECT tag_id FROM copy_tags WHERE copy_id=?2)",
                    params![old_id, new_id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction
            .execute(
                "UPDATE copy_tags SET copy_id=?1 WHERE copy_id=?2",
                params![new_id, old_id],
            )
            .map_err(|error| error.to_string())?;
        if canonical_exists.is_some() {
            transaction
                .execute("DELETE FROM copies WHERE id=?1", [old_id])
                .map_err(|error| error.to_string())?;
        } else {
            transaction
                .execute(
                    "UPDATE copies SET id=?1 WHERE id=?2",
                    params![new_id, old_id],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    for (old_id, new_value) in aliases {
        let new_id = new_value
            .as_str()
            .ok_or("Server alias target must be a UUID")?;
        Uuid::parse_str(new_id).map_err(|_| "Server alias target must be a UUID")?;
        let old_paper: Option<i64> = transaction
            .query_row("SELECT 1 FROM papers WHERE id=?1", [old_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if old_paper.is_some() {
            let canonical_exists: Option<i64> = transaction
                .query_row("SELECT 1 FROM papers WHERE id=?1", [new_id], |row| {
                    row.get(0)
                })
                .optional()
                .map_err(|error| error.to_string())?;
            if canonical_exists.is_none() {
                transaction
                    .execute(
                        "UPDATE papers SET id=?1 WHERE id=?2",
                        params![new_id, old_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
            for (table, column) in [
                ("paper_editions", "paper_id"),
                ("copies", "paper_id"),
                ("comments", "paper_id"),
            ] {
                transaction
                    .execute(
                        &format!("UPDATE {table} SET {column}=?1 WHERE {column}=?2"),
                        params![new_id, old_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
            if canonical_exists.is_some() {
                transaction
                    .execute("DELETE FROM papers WHERE id=?1", [old_id])
                    .map_err(|error| error.to_string())?;
            }
            continue;
        }
        let old_edition: Option<i64> = transaction
            .query_row(
                "SELECT 1 FROM paper_editions WHERE id=?1",
                [old_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if old_edition.is_some() {
            let canonical_exists: Option<i64> = transaction
                .query_row(
                    "SELECT 1 FROM paper_editions WHERE id=?1",
                    [new_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if canonical_exists.is_none() {
                transaction
                    .execute(
                        "UPDATE paper_editions SET id=?1 WHERE id=?2",
                        params![new_id, old_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
            for (table, column) in [
                ("copies", "edition_id"),
                ("copies", "ignored_edition_id"),
                ("comments", "edition_id"),
                ("ink_strokes", "edition_id"),
                ("paper_clips", "edition_id"),
            ] {
                transaction
                    .execute(
                        &format!("UPDATE {table} SET {column}=?1 WHERE {column}=?2"),
                        params![new_id, old_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
            transaction.execute(
                "UPDATE _local_blob_refs SET row_id=?1 WHERE table_name='paper_editions' AND row_id=?2",
                params![new_id, old_id],
            ).map_err(|error| error.to_string())?;
            if canonical_exists.is_some() {
                transaction
                    .execute("DELETE FROM paper_editions WHERE id=?1", [old_id])
                    .map_err(|error| error.to_string())?;
            }
            continue;
        }
        let old_copy: Option<i64> = transaction
            .query_row("SELECT 1 FROM copies WHERE id=?1", [old_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if old_copy.is_some() {
            let canonical_exists: Option<i64> = transaction
                .query_row("SELECT 1 FROM copies WHERE id=?1", [new_id], |row| {
                    row.get(0)
                })
                .optional()
                .map_err(|error| error.to_string())?;
            if canonical_exists.is_some() {
                transaction
                    .execute(
                        "DELETE FROM copy_tags WHERE copy_id=?1 AND tag_id IN \
                     (SELECT tag_id FROM copy_tags WHERE copy_id=?2)",
                        params![old_id, new_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
            transaction
                .execute(
                    "UPDATE copy_tags SET copy_id=?1 WHERE copy_id=?2",
                    params![new_id, old_id],
                )
                .map_err(|error| error.to_string())?;
            if canonical_exists.is_some() {
                transaction
                    .execute("DELETE FROM copies WHERE id=?1", [old_id])
                    .map_err(|error| error.to_string())?;
            } else {
                transaction
                    .execute(
                        "UPDATE copies SET id=?1 WHERE id=?2",
                        params![new_id, old_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
            continue;
        }
        let old_copy_tag: Option<i64> = transaction
            .query_row("SELECT 1 FROM copy_tags WHERE id=?1", [old_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if old_copy_tag.is_some() {
            let canonical_exists: Option<i64> = transaction
                .query_row("SELECT 1 FROM copy_tags WHERE id=?1", [new_id], |row| {
                    row.get(0)
                })
                .optional()
                .map_err(|error| error.to_string())?;
            if canonical_exists.is_some() {
                transaction
                    .execute("DELETE FROM copy_tags WHERE id=?1", [old_id])
                    .map_err(|error| error.to_string())?;
            } else {
                transaction
                    .execute(
                        "UPDATE copy_tags SET id=?1 WHERE id=?2",
                        params![new_id, old_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    let mut statement = transaction
        .prepare("SELECT local_sequence,changes_json FROM _local_outbox WHERE account_id=?1")
        .map_err(|error| error.to_string())?;
    let queued = statement
        .query_map([account_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);
    for (sequence, encoded) in queued {
        let mut changes: Vec<QueuedChange> =
            serde_json::from_str(&encoded).map_err(|error| error.to_string())?;
        let mut changed = false;
        for change in &mut changes {
            if let Some(target) = aliases.get(&change.id).and_then(Value::as_str) {
                change.id = target.to_owned();
                changed = true;
            }
            for value in change.values.values_mut() {
                if let Some(target) = value.as_str().and_then(|id| aliases.get(id)) {
                    *value = target.clone();
                    changed = true;
                }
            }
        }
        if changed {
            transaction
                .execute(
                    "UPDATE _local_outbox SET changes_json=?1 WHERE local_sequence=?2",
                    params![
                        serde_json::to_string(&changes).map_err(|error| error.to_string())?,
                        sequence
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn refresh_blob_reference(
    connection: &Connection,
    table: &str,
    row_id: &str,
) -> Result<(), String> {
    let blob_column = match table {
        "board_items" => "blob_sha256",
        "paper_editions" => "sha256",
        _ => return Ok(()),
    };
    connection
        .execute(
            "DELETE FROM _local_blob_refs WHERE table_name=?1 AND row_id=?2",
            params![table, row_id],
        )
        .map_err(|error| error.to_string())?;
    let reference: Option<(Option<String>, Option<String>)> = connection
        .query_row(
            &format!("SELECT {blob_column},deleted_at FROM {table} WHERE id=?1"),
            [row_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some((Some(sha256), None)) = reference {
        let available: Option<i64> = connection
            .query_row(
                "SELECT 1 FROM _local_blobs WHERE sha256=?1",
                [&sha256],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if available.is_some() {
            connection
                .execute(
                    "INSERT INTO _local_blob_refs(table_name,row_id,sha256) VALUES (?1,?2,?3)",
                    params![table, row_id, sha256],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn refresh_blob_references_for_digest(connection: &Connection, sha256: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR REPLACE INTO _local_blob_refs(table_name,row_id,sha256) \
             SELECT 'board_items',id,blob_sha256 FROM board_items \
             WHERE blob_sha256=?1 AND deleted_at IS NULL",
            [sha256],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR REPLACE INTO _local_blob_refs(table_name,row_id,sha256) \
             SELECT 'paper_editions',id,sha256 FROM paper_editions \
             WHERE sha256=?1 AND deleted_at IS NULL",
            [sha256],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_remote_row(
    transaction: &rusqlite::Transaction<'_>,
    table: &str,
    row: Map<String, Value>,
) -> Result<(), String> {
    let registry: Value = serde_json::from_str(REGISTRY).map_err(|error| error.to_string())?;
    if registry["tables"].get(table).is_none() {
        return Err(format!("Server sent an unregistered table: {table}"));
    }
    let columns: HashSet<String> = transaction
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?
        .query_map([], |row| row.get(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|error| error.to_string())?;
    if let Some(field) = row.keys().find(|field| !columns.contains(*field)) {
        return Err(format!("Server sent unknown {table}.{field}"));
    }
    if !row.contains_key("id") || !row.contains_key("revision") {
        return Err("Server row is missing id or revision".into());
    }
    let mut fields: BTreeMap<String, SqlValue> = row
        .iter()
        .map(|(key, value)| Ok((key.clone(), json_to_sql(value)?)))
        .collect::<Result<_, String>>()?;
    let names: Vec<_> = fields.keys().cloned().collect();
    let placeholders: Vec<_> = (1..=names.len()).map(|index| format!("?{index}")).collect();
    let updates: Vec<_> = names
        .iter()
        .filter(|name| name.as_str() != "id")
        .map(|name| format!("{name}=excluded.{name}"))
        .collect();
    let values: Vec<_> = names
        .iter()
        .map(|name| fields.remove(name).unwrap())
        .collect();
    transaction.execute(
        &format!(
            "INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT(id) DO UPDATE SET {} WHERE excluded.revision >= {table}.revision",
            names.join(","), placeholders.join(","), updates.join(","),
        ),
        params_from_iter(values),
    ).map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_local_change(
    transaction: &rusqlite::Transaction<'_>,
    account_id: i64,
    change: &DataChange,
    revision: i64,
    inserting: bool,
) -> Result<(), String> {
    let now = chrono_text();
    if change.operation == "delete" {
        if inserting {
            return Err("Cannot delete a row that is not in the local database".into());
        }
        transaction
            .execute(
                &format!(
                    "UPDATE {} SET deleted_at=?1,updated_at=?1,revision=?2 WHERE id=?3",
                    change.table
                ),
                params![now, revision, change.id],
            )
            .map_err(|error| error.to_string())?;
        touch_parent_board(transaction, change, &now)?;
        return Ok(());
    }
    if !matches!(change.operation.as_str(), "upsert" | "patch") {
        return Err("Operation must be upsert, patch, or delete".into());
    }
    if inserting && change.operation == "patch" {
        return Err("Cannot patch a row that is not in the local database".into());
    }

    let mut fields: BTreeMap<String, SqlValue> = change
        .values
        .iter()
        .map(|(key, value)| Ok((key.clone(), json_to_sql(value)?)))
        .collect::<Result<_, String>>()?;
    fields.remove("deleted_at");
    fields.insert("revision".into(), SqlValue::Integer(revision));
    fields.insert("updated_at".into(), SqlValue::Text(now.clone()));
    fields.insert("deleted_at".into(), SqlValue::Null);
    if inserting {
        fields.insert("id".into(), SqlValue::Text(change.id.clone()));
        fields.insert("created_at".into(), SqlValue::Text(now));
        if matches!(
            change.table.as_str(),
            "boards"
                | "comments"
                | "ink_strokes"
                | "paper_clips"
                | "copies"
                | "copy_tags"
                | "shelves"
                | "tags"
        ) {
            fields.insert("user_id".into(), SqlValue::Integer(account_id));
        }
        let columns: Vec<_> = fields.keys().cloned().collect();
        let placeholders: Vec<_> = (1..=columns.len())
            .map(|index| format!("?{index}"))
            .collect();
        let values: Vec<_> = columns
            .iter()
            .map(|column| fields[column].clone())
            .collect();
        transaction
            .execute(
                &format!(
                    "INSERT INTO {} ({}) VALUES ({})",
                    change.table,
                    columns.join(","),
                    placeholders.join(",")
                ),
                params_from_iter(values),
            )
            .map_err(|error| error.to_string())?;
    } else {
        let columns: Vec<_> = fields.keys().cloned().collect();
        let assignments: Vec<_> = columns
            .iter()
            .enumerate()
            .map(|(index, column)| format!("{column}=?{}", index + 1))
            .collect();
        let mut values: Vec<_> = columns
            .iter()
            .map(|column| fields[column].clone())
            .collect();
        values.push(SqlValue::Text(change.id.clone()));
        transaction
            .execute(
                &format!(
                    "UPDATE {} SET {} WHERE id=?{}",
                    change.table,
                    assignments.join(","),
                    values.len()
                ),
                params_from_iter(values),
            )
            .map_err(|error| error.to_string())?;
    }
    touch_parent_board(transaction, change, &chrono_text())?;
    Ok(())
}

fn touch_parent_board(
    transaction: &rusqlite::Transaction<'_>,
    change: &DataChange,
    now: &str,
) -> Result<(), String> {
    if !matches!(change.table.as_str(), "board_groups" | "board_items") {
        return Ok(());
    }
    transaction
        .execute(
            &format!(
                "UPDATE boards SET updated_at=?1 WHERE id=(SELECT board_id FROM {} WHERE id=?2)",
                change.table
            ),
            params![now, change.id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn read_row(connection: &Connection, table: &str, id: &str) -> Result<Value, String> {
    let mut statement = connection
        .prepare(&format!("SELECT * FROM {table} WHERE id=?1"))
        .map_err(|error| error.to_string())?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| (*name).into())
        .collect();
    statement
        .query_row([id], |row| {
            let mut value = Map::new();
            for (index, name) in names.iter().enumerate() {
                let field = match row.get_ref(index)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(value) => json!(value),
                    rusqlite::types::ValueRef::Real(value) => json!(value),
                    rusqlite::types::ValueRef::Text(value) => {
                        Value::String(String::from_utf8_lossy(value).into_owned())
                    }
                    rusqlite::types::ValueRef::Blob(_) => Value::Null,
                };
                value.insert(name.clone(), field);
            }
            Ok(Value::Object(value))
        })
        .map_err(|error| error.to_string())
}

fn query_boards(connection: &Connection, account_id: i64) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT id FROM boards WHERE user_id=?1 AND deleted_at IS NULL ORDER BY updated_at DESC,id")
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([account_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|id| {
            let mut board = read_row(connection, "boards", &id)?;
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM board_items WHERE board_id=?1 AND deleted_at IS NULL AND staged=0",
                    [&id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            board.as_object_mut().ok_or("Invalid local board")?.insert(
                "item_count".into(), json!(count),
            );
            Ok(board)
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn query_board(connection: &Connection, account_id: i64, id: &str) -> Result<Value, String> {
    let owner: Option<i64> = connection
        .query_row(
            "SELECT user_id FROM boards WHERE id=?1 AND deleted_at IS NULL",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if owner != Some(account_id) {
        return Err("Board not found".into());
    }
    let mut board = read_row(connection, "boards", id)?;
    let object = board.as_object_mut().ok_or("Invalid local board")?;
    object.insert("can_edit".into(), Value::Bool(true));
    object.insert("guid".into(), Value::String(id.into()));
    object.insert("items".into(), query_items(connection, id, false)?);
    object.insert("staged_items".into(), query_items(connection, id, true)?);
    object.insert("groups".into(), query_groups(connection, id)?);
    Ok(board)
}

fn query_items(connection: &Connection, board_id: &str, staged: bool) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT id FROM board_items WHERE board_id=?1 AND deleted_at IS NULL AND staged=?2 ORDER BY created_at,id")
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map(params![board_id, staged], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|id| read_row(connection, "board_items", &id))
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn query_groups(connection: &Connection, board_id: &str) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT id FROM board_groups WHERE board_id=?1 AND deleted_at IS NULL ORDER BY created_at,id")
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([board_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|id| {
            let mut group = read_row(connection, "board_groups", &id)?;
            let mut members = connection
                .prepare("SELECT id FROM board_items WHERE group_id=?1 AND deleted_at IS NULL ORDER BY position,created_at,id")
                .map_err(|error| error.to_string())?;
            let item_ids = members
                .query_map([&id], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            group.as_object_mut().ok_or("Invalid local group")?.insert(
                "item_ids".into(),
                Value::Array(item_ids.into_iter().map(Value::String).collect()),
            );
            Ok(group)
        })
        .collect::<Result<Vec<_>, String>>()
        .map(Value::Array)
}

fn query_board_group(connection: &Connection, account_id: i64, id: &str) -> Result<Value, String> {
    let board_id: Option<String> = connection
        .query_row(
            "SELECT board_id FROM board_groups WHERE id=?1 AND deleted_at IS NULL",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let board_id = board_id.ok_or("Board group not found")?;
    let owner: i64 = connection
        .query_row(
            "SELECT user_id FROM boards WHERE id=?1",
            [&board_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if owner != account_id {
        return Err("Board group not found".into());
    }
    Ok(json!({
        "group": read_row(connection, "board_groups", id)?,
        "items": query_group_items(connection, id)?,
    }))
}

fn query_group_items(connection: &Connection, group_id: &str) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT id FROM board_items WHERE group_id=?1 AND deleted_at IS NULL ORDER BY position,created_at,id")
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([group_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|id| read_row(connection, "board_items", &id))
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn query_annotations(
    connection: &Connection,
    account_id: i64,
    table: &str,
    parent_column: &str,
    parameters: Value,
) -> Result<Value, String> {
    let parent_id = parameters["parent_id"]
        .as_str()
        .ok_or("Annotation query requires parent_id")?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT id FROM {table} WHERE user_id=?1 AND {parent_column}=?2 AND deleted_at IS NULL ORDER BY created_at,id"
        ))
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map(params![account_id, parent_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let rows = ids
        .into_iter()
        .map(|id| {
            let mut value = read_row(connection, table, &id)?;
            let row = value.as_object_mut().ok_or("Invalid annotation row")?;
            for field in match table {
                "ink_strokes" => &["points"][..],
                "paper_clips" => &["source", "frame"][..],
                _ => &[][..],
            } {
                if let Some(encoded) = row.get(*field).and_then(Value::as_str).map(str::to_owned) {
                    row.insert(
                        (*field).into(),
                        serde_json::from_str(&encoded)
                            .map_err(|_| "Invalid local annotation JSON")?,
                    );
                }
            }
            if table == "comments" {
                let anchor_type = row
                    .get("anchor_type")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                if let (Some(kind), Some(encoded)) = (
                    anchor_type,
                    row.get("anchor").and_then(Value::as_str).map(str::to_owned),
                ) {
                    let mut anchor: Map<String, Value> =
                        serde_json::from_str(&encoded).map_err(|_| "Invalid local note anchor")?;
                    anchor.insert("type".into(), Value::String(kind));
                    row.insert("anchor".into(), Value::Object(anchor));
                }
            }
            Ok(value)
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Value::Array(rows))
}

fn query_owned_rows(
    connection: &Connection,
    account_id: i64,
    table: &str,
    order: &str,
) -> Result<Value, String> {
    if !matches!(table, "shelves" | "tags" | "copies" | "copy_tags") {
        return Err("Unsupported owned-row query".into());
    }
    let mut statement = connection
        .prepare(&format!(
            "SELECT id FROM {table} WHERE user_id=?1 AND deleted_at IS NULL ORDER BY {order}"
        ))
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([account_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|id| read_row(connection, table, &id))
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn query_nook(connection: &Connection, account_id: i64) -> Result<Value, String> {
    Ok(json!({
        "shelves": query_owned_rows(connection, account_id, "shelves", "position,name,id")?,
        "tags": query_owned_rows(connection, account_id, "tags", "name,id")?,
        "copies": query_owned_rows(connection, account_id, "copies", "updated_at DESC,id")?,
        "copy_tags": query_owned_rows(connection, account_id, "copy_tags", "created_at,id")?,
    }))
}

fn paper_view(connection: &Connection, account_id: i64, paper_id: &str) -> Result<Value, String> {
    let copy_id: String = connection
        .query_row(
            "SELECT id FROM copies WHERE user_id=?1 AND paper_id=?2 AND deleted_at IS NULL",
            params![account_id, paper_id],
            |row| row.get(0),
        )
        .map_err(|_| "Paper not found".to_string())?;
    let mut paper = read_row(connection, "papers", paper_id)?;
    let copy = read_row(connection, "copies", &copy_id)?;
    let object = paper.as_object_mut().ok_or("Invalid local paper")?;
    let copy = copy.as_object().ok_or("Invalid local copy")?;
    object.insert("copy_sync_id".into(), json!(copy_id));
    for field in [
        "shelf_id",
        "summary",
        "thought",
        "marketed",
        "is_author",
        "rating_expertise",
        "rating_reading",
        "rating_liking",
        "edition_sha256",
    ] {
        object.insert(
            field.into(),
            copy.get(field).cloned().unwrap_or(Value::Null),
        );
    }
    if let Some(edition_id) = copy.get("edition_id").and_then(Value::as_str) {
        let edition = read_row(connection, "paper_editions", edition_id)?;
        let edition_row = edition.as_object().ok_or("Invalid local edition")?;
        object.insert("edition_id".into(), json!(edition_id));
        object.insert("edition_sync_id".into(), json!(edition_id));
        object.insert(
            "file_path".into(),
            edition_row.get("file_path").cloned().unwrap_or(Value::Null),
        );
        object.insert(
            "edition_sha256".into(),
            edition_row.get("sha256").cloned().unwrap_or(Value::Null),
        );
        object.insert("editions".into(), Value::Array(vec![edition]));
    }
    let mut statement = connection
        .prepare(
            "SELECT tags.id FROM copy_tags JOIN tags ON tags.id=copy_tags.tag_id \
         WHERE copy_tags.copy_id=?1 AND copy_tags.deleted_at IS NULL AND tags.deleted_at IS NULL \
         ORDER BY tags.name,tags.id",
        )
        .map_err(|error| error.to_string())?;
    let tag_ids = statement
        .query_map([&copy_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    object.insert(
        "tags".into(),
        Value::Array(
            tag_ids
                .into_iter()
                .map(|id| read_row(connection, "tags", &id))
                .collect::<Result<Vec<_>, _>>()?,
        ),
    );
    object.insert("viewer_has_entry".into(), Value::Bool(true));
    object.insert(
        "viewer_is_reader".into(),
        Value::Bool(copy.get("marketed").and_then(Value::as_i64) == Some(1)),
    );
    Ok(paper)
}

fn query_papers(connection: &Connection, account_id: i64) -> Result<Value, String> {
    let mut statement = connection.prepare(
        "SELECT paper_id FROM copies WHERE user_id=?1 AND deleted_at IS NULL ORDER BY created_at DESC,id"
    ).map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([account_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|id| paper_view(connection, account_id, &id))
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn query_paper(connection: &Connection, account_id: i64, id: &str) -> Result<Value, String> {
    paper_view(connection, account_id, id)
}

fn query_paper_by_pdf(
    connection: &Connection,
    account_id: i64,
    sha256: &str,
) -> Result<Value, String> {
    let paper_id: String = connection
        .query_row(
            "SELECT paper_editions.paper_id FROM paper_editions JOIN copies \
         ON copies.edition_id=paper_editions.id WHERE copies.user_id=?1 \
         AND copies.deleted_at IS NULL AND paper_editions.sha256=?2 LIMIT 1",
            params![account_id, sha256],
            |row| row.get(0),
        )
        .map_err(|_| "Paper PDF not found".to_string())?;
    paper_view(connection, account_id, &paper_id)
}

fn query_sync_status(connection: &Connection, account_id: i64) -> Result<Value, String> {
    let pending: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM _local_outbox WHERE account_id=?1",
            [account_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let cursor: i64 = connection
        .query_row(
            "SELECT pull_cursor FROM _local_sync_state WHERE account_id=?1",
            [account_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(0);
    let details: Option<(Option<String>, Option<String>)> = connection
        .query_row(
            "SELECT last_synced_at,last_error FROM _local_sync_state WHERE account_id=?1",
            [account_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let (last_synced_at, error) = details.unwrap_or((None, None));
    let blocked: Option<(i64, Option<String>)> = connection
        .query_row(
            "SELECT attempts,last_error FROM _local_outbox WHERE account_id=?1 \
             AND last_error IS NOT NULL ORDER BY local_sequence LIMIT 1",
            [account_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let conflicts: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM _local_conflicts WHERE account_id=?1 AND resolved_at IS NULL",
            [account_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "pending": pending,
        "cursor": cursor,
        "last_synced_at": last_synced_at,
        "error": error,
        "conflicts": conflicts,
        "attempts": blocked.as_ref().map_or(0, |value| value.0),
        "outbox_error": blocked.and_then(|value| value.1),
        "blocked": connection.query_row(
            "SELECT COUNT(*) FROM _local_outbox WHERE account_id=?1 AND state='blocked'",
            [account_id], |row| row.get::<_, i64>(0),
        ).map_err(|error| error.to_string())?,
    }))
}

fn query_storage_status(connection: &Connection) -> Result<Value, String> {
    let mut statement = connection
        .prepare(
            "SELECT durability,COALESCE(SUM(size),0),COUNT(*) FROM _local_blobs \
             GROUP BY durability",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut totals = Map::new();
    for durability in ["pending", "pinned", "cache"] {
        let (bytes, files) = rows
            .iter()
            .find(|(name, _, _)| name == durability)
            .map(|(_, bytes, files)| (*bytes, *files))
            .unwrap_or((0, 0));
        totals.insert(durability.into(), json!({"bytes": bytes, "files": files}));
    }
    Ok(json!({
        "classes": totals,
        "cache_limit_bytes": DEFAULT_CACHE_LIMIT_BYTES,
    }))
}

fn query_local_account(connection: &Connection, account_id: i64) -> Result<Value, String> {
    let encoded: String = connection
        .query_row(
            "SELECT profile_json FROM _local_accounts WHERE account_id=?1",
            [account_id],
            |row| row.get(0),
        )
        .map_err(|_| "Local account profile is not available".to_string())?;
    serde_json::from_str(&encoded).map_err(|_| "Local account profile is invalid".into())
}

fn stage_blob_removal(directory: &Path, sha256: &str) -> Result<Option<PathBuf>, String> {
    let source = directory.join(sha256);
    let staged = directory.join(format!(".{sha256}.{}.delete", Uuid::new_v4()));
    match std::fs::rename(source, &staged) {
        Ok(()) => Ok(Some(staged)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn restore_staged_blobs(directory: &Path, staged: &[(String, PathBuf)]) {
    for (sha256, path) in staged {
        let _ = std::fs::rename(path, directory.join(sha256));
    }
}

fn recover_staged_blob_removals(connection: &Connection, directory: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(body) = name
            .strip_prefix('.')
            .and_then(|name| name.strip_suffix(".delete"))
        else {
            continue;
        };
        let Some((sha256, _nonce)) = body.split_once('.') else {
            continue;
        };
        if sha256.len() != 64
            || !sha256
                .chars()
                .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
        {
            continue;
        }
        let recorded = connection
            .query_row(
                "SELECT 1 FROM _local_blobs WHERE sha256=?1",
                [sha256],
                |_| Ok(true),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or(false);
        let destination = directory.join(sha256);
        if recorded && !destination.exists() {
            std::fs::rename(path, destination).map_err(|error| error.to_string())?;
        } else {
            std::fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn chrono_text() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board_change(id: &str, name: &str) -> DataChange {
        DataChange {
            table: "boards".into(),
            id: id.into(),
            operation: "upsert".into(),
            values: Map::from_iter([("name".into(), Value::String(name.into()))]),
        }
    }

    fn remote_board(id: &str, revision: i64, name: &str) -> Map<String, Value> {
        Map::from_iter([
            ("id".into(), json!(id)),
            ("user_id".into(), json!(7)),
            ("shelf_id".into(), Value::Null),
            ("name".into(), json!(name)),
            ("description".into(), Value::Null),
            ("created_at".into(), json!("2026-09-12T00:00:00Z")),
            ("updated_at".into(), json!("2026-09-12T00:00:00Z")),
            ("revision".into(), json!(revision)),
            ("deleted_at".into(), Value::Null),
        ])
    }

    #[test]
    fn local_mutation_commits_domain_row_and_outbox_together() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let id = Uuid::new_v4().to_string();
        let store = LocalStore::open(&path).unwrap();
        let receipt = store.mutate(7, vec![board_change(&id, "Offline")]).unwrap();
        assert_eq!(receipt.local_sequence, 1);
        assert_eq!(store.outbox_count(), 1);
        assert_eq!(store.query(7, "boards", json!({})).unwrap()[0]["id"], id);

        drop(store);
        let reopened = LocalStore::open(&path).unwrap();
        assert_eq!(reopened.outbox_count(), 1);
        assert_eq!(
            reopened.query(7, "board", json!({"id": id})).unwrap()["name"],
            "Offline"
        );
    }

    #[test]
    fn whole_row_conflicts_enqueue_the_complete_writable_row() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let paper_id = Uuid::new_v4().to_string();
        let edition_id = Uuid::new_v4().to_string();
        let stroke_id = Uuid::new_v4().to_string();
        let now = chrono_text();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO papers(id,title,created_at,updated_at,revision) VALUES (?1,'Paper',?2,?2,1)",
                    params![paper_id, now],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO paper_editions(id,paper_id,file_path,created_at,updated_at,revision) VALUES (?1,?2,'paper.pdf',?3,?3,1)",
                    params![edition_id, paper_id, now],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO ink_strokes(id,edition_id,user_id,page,points,color,width,opacity,shape,created_at,updated_at,revision) VALUES (?1,?2,7,2,'[{\"x\":0.1,\"y\":0.2}]','#111111',0.01,0.8,'flat',?3,?3,1)",
                    params![stroke_id, edition_id, now],
                )
                .unwrap();
        }

        store
            .mutate(
                7,
                vec![DataChange {
                    table: "ink_strokes".into(),
                    id: stroke_id,
                    operation: "patch".into(),
                    values: Map::from_iter([("color".into(), json!("#222222"))]),
                }],
            )
            .unwrap();
        let queued = store.next_outbox(7).unwrap().unwrap();
        let values = &queued.changes[0].values;
        for field in [
            "edition_id",
            "group_id",
            "page",
            "points",
            "color",
            "width",
            "opacity",
            "shape",
            "deleted_at",
        ] {
            assert!(values.contains_key(field), "missing {field}");
        }
        assert_eq!(values["color"], "#222222");
    }

    #[test]
    fn rejected_mutation_rolls_back_every_row_and_the_outbox() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let first = board_change(&Uuid::new_v4().to_string(), "Would roll back");
        let mut invalid = board_change(&Uuid::new_v4().to_string(), "Invalid");
        invalid
            .values
            .insert("server_secret".into(), Value::String("no".into()));
        assert!(store.mutate(7, vec![first, invalid]).is_err());
        assert_eq!(store.outbox_count(), 0);
        assert_eq!(store.query(7, "boards", json!({})).unwrap(), json!([]));
    }

    #[test]
    fn account_ownership_is_enforced_locally() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let id = Uuid::new_v4().to_string();
        store.mutate(7, vec![board_change(&id, "Mine")]).unwrap();
        let update = DataChange {
            table: "boards".into(),
            id,
            operation: "patch".into(),
            values: Map::from_iter([("name".into(), Value::String("Not mine".into()))]),
        };
        assert!(store.mutate(8, vec![update]).is_err());
    }

    #[test]
    fn blocked_mutation_does_not_freeze_later_unrelated_work() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let first = store
            .mutate(7, vec![board_change(&Uuid::new_v4().to_string(), "Bad")])
            .unwrap();
        let second = store
            .mutate(7, vec![board_change(&Uuid::new_v4().to_string(), "Good")])
            .unwrap();
        store
            .record_outbox_error(7, first.local_sequence, "422 Unprocessable Entity", true)
            .unwrap();
        let next = store.next_outbox(7).unwrap().unwrap();
        assert_eq!(next.local_sequence, second.local_sequence);
        let status = store.query(7, "sync_status", json!({})).unwrap();
        assert_eq!(status["pending"], 2);
        assert_eq!(status["blocked"], 1);
        assert_eq!(status["attempts"], 1);
    }

    #[test]
    fn unsafe_board_links_are_rejected_before_entering_the_outbox() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_id = Uuid::new_v4().to_string();
        store
            .mutate(7, vec![board_change(&board_id, "Links")])
            .unwrap();
        let change = DataChange {
            table: "board_items".into(),
            id: Uuid::new_v4().to_string(),
            operation: "upsert".into(),
            values: Map::from_iter([
                ("board_id".into(), json!(board_id)),
                ("kind".into(), json!("webpage")),
                ("source_url".into(), json!("javascript:alert(1)")),
            ]),
        };
        assert!(store.mutate(7, vec![change]).is_err());
        assert_eq!(store.outbox_count(), 1);
    }

    #[test]
    fn accepted_push_replaces_row_and_removes_outbox_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let id = Uuid::new_v4().to_string();
        let receipt = store.mutate(7, vec![board_change(&id, "Local")]).unwrap();
        let mut row = remote_board(&id, 1, "Canonical");
        row.insert("table".into(), json!("boards"));
        store
            .accept_push(
                7,
                receipt.local_sequence,
                vec![row],
                vec![json!({
                    "table": "boards", "id": id,
                    "strategy": "field_patch", "resolution": "client_won",
                    "server_revision": 1, "previous": {"name": "Remote"},
                })],
                Map::new(),
            )
            .unwrap();
        assert_eq!(store.outbox_count(), 0);
        assert_eq!(
            store.query(7, "board", json!({"id": id})).unwrap()["name"],
            "Canonical"
        );
        assert_eq!(
            store.query(7, "sync_status", json!({})).unwrap()["conflicts"],
            0
        );
        let connection = store.connection.lock().unwrap();
        let recorded: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM _local_conflicts WHERE resolved_at IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(recorded, 1);
    }

    #[test]
    fn pull_page_and_cursor_commit_together() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let id = Uuid::new_v4().to_string();
        store
            .apply_pull(
                7,
                vec![RemoteChange {
                    table: "boards".into(),
                    id: id.clone(),
                    revision: 1,
                    operation: "upsert".into(),
                    row: remote_board(&id, 1, "Remote"),
                }],
                19,
            )
            .unwrap();
        assert_eq!(store.pull_cursor(7).unwrap(), 19);
        assert_eq!(
            store.query(7, "board", json!({"id": id})).unwrap()["name"],
            "Remote"
        );

        let bad_id = Uuid::new_v4().to_string();
        let mut invalid = remote_board(&bad_id, 1, "Invalid");
        invalid.insert("unknown_server_field".into(), json!(true));
        assert!(store
            .apply_pull(
                7,
                vec![RemoteChange {
                    table: "boards".into(),
                    id: bad_id.clone(),
                    revision: 1,
                    operation: "upsert".into(),
                    row: invalid,
                }],
                20
            )
            .is_err());
        assert_eq!(store.pull_cursor(7).unwrap(), 19);
        assert!(store.query(7, "board", json!({"id": bad_id})).is_err());

        let foreign_id = Uuid::new_v4().to_string();
        let mut foreign = remote_board(&foreign_id, 1, "Foreign");
        foreign.insert("user_id".into(), json!(8));
        assert!(store
            .apply_pull(
                7,
                vec![RemoteChange {
                    table: "boards".into(),
                    id: foreign_id,
                    revision: 1,
                    operation: "upsert".into(),
                    row: foreign,
                }],
                20,
            )
            .is_err());
        assert_eq!(store.pull_cursor(7).unwrap(), 19);
    }

    #[test]
    fn blobs_are_content_addressed_and_survive_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let bytes = b"offline image";
        let store = LocalStore::open(&path).unwrap();
        let record = store.import_blob(bytes, Some("image/png".into())).unwrap();
        assert_eq!(record.sha256.len(), 64);
        assert_eq!(store.read_blob(&record.sha256).unwrap(), bytes);
        let board_id = Uuid::new_v4().to_string();
        store
            .mutate(7, vec![board_change(&board_id, "Files")])
            .unwrap();
        let item_id = Uuid::new_v4().to_string();
        let receipt = store
            .mutate(
                7,
                vec![DataChange {
                    table: "board_items".into(),
                    id: item_id.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("board_id".into(), json!(board_id)),
                        ("kind".into(), json!("image")),
                        ("blob_sha256".into(), json!(record.sha256.clone())),
                    ]),
                }],
            )
            .unwrap();
        let mut canonical = receipt.rows[0].as_object().unwrap().clone();
        canonical.insert("table".into(), json!("board_items"));
        store
            .accept_push(
                7,
                receipt.local_sequence,
                vec![canonical],
                vec![],
                Map::new(),
            )
            .unwrap();
        let connection = store.connection.lock().unwrap();
        let durability: String = connection
            .query_row(
                "SELECT durability FROM _local_blobs WHERE sha256=?1",
                [&record.sha256],
                |row| row.get(0),
            )
            .unwrap();
        let references: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM _local_blob_refs WHERE row_id=?1 AND sha256=?2",
                params![item_id, record.sha256],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(durability, "pinned");
        assert_eq!(references, 1);
        drop(connection);
        drop(store);
        let reopened = LocalStore::open(&path).unwrap();
        assert_eq!(reopened.read_blob(&record.sha256).unwrap(), bytes);
        assert!(reopened.read_blob(&record.sha256.to_uppercase()).is_err());
        assert!(reopened.read_blob("../../not-a-blob").is_err());
    }

    #[test]
    fn rejected_remote_blob_leaves_no_file_or_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let expected = "a".repeat(64);
        assert!(store
            .import_remote_blob(
                &expected,
                b"different bytes",
                Some("application/pdf".into())
            )
            .is_err());
        assert!(!store.has_blob(&expected));
        let connection = store.connection.lock().unwrap();
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM _local_blobs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn cache_eviction_never_removes_pending_or_pinned_files() {
        use sha2::Digest;

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let cached_bytes = b"replaceable remote file";
        let cached_sha = format!("{:x}", sha2::Sha256::digest(cached_bytes));
        store
            .import_remote_blob(&cached_sha, cached_bytes, Some("application/pdf".into()))
            .unwrap();
        let pending = store
            .import_blob(b"unsynchronized user file", Some("application/pdf".into()))
            .unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE _local_blobs SET durability='pinned' WHERE sha256=?1",
                    [&pending.sha256],
                )
                .unwrap();
        }

        assert_eq!(store.prune_cache(0).unwrap(), 1);
        assert!(!store.has_blob(&cached_sha));
        assert!(store.has_blob(&pending.sha256));
        let status = store.query(7, "storage_status", json!({})).unwrap();
        assert_eq!(status["classes"]["cache"]["bytes"], 0);
        assert_eq!(status["classes"]["pinned"]["files"], 1);
        assert_eq!(status["cache_limit_bytes"], DEFAULT_CACHE_LIMIT_BYTES);
    }

    #[test]
    fn cache_eviction_keeps_metadata_when_file_staging_fails() {
        use sha2::Digest;

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let bytes = b"cached file";
        let sha256 = format!("{:x}", sha2::Sha256::digest(bytes));
        store
            .import_remote_blob(&sha256, bytes, Some("application/pdf".into()))
            .unwrap();

        let backup = directory.path().join("blobs-backup");
        std::fs::rename(&store.blob_directory, &backup).unwrap();
        std::fs::write(&store.blob_directory, b"not a directory").unwrap();
        assert!(store.prune_cache(0).is_err());
        std::fs::remove_file(&store.blob_directory).unwrap();
        std::fs::rename(backup, &store.blob_directory).unwrap();

        assert!(store.has_blob(&sha256));
        let connection = store.connection.lock().unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM _local_blobs WHERE sha256=?1",
                [&sha256],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn startup_restores_a_blob_staged_before_an_interrupted_eviction() {
        use sha2::Digest;

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let bytes = b"interrupted cache eviction";
        let sha256 = format!("{:x}", sha2::Sha256::digest(bytes));
        let store = LocalStore::open(&path).unwrap();
        store
            .import_remote_blob(&sha256, bytes, Some("application/pdf".into()))
            .unwrap();
        let staged = store.blob_directory.join(format!(".{sha256}.crash.delete"));
        std::fs::rename(store.blob_directory.join(&sha256), &staged).unwrap();
        drop(store);

        let reopened = LocalStore::open(&path).unwrap();
        assert_eq!(reopened.read_blob(&sha256).unwrap(), bytes);
        assert!(!staged.exists());
    }

    #[test]
    fn failed_blob_storage_never_creates_metadata_or_an_outbox_reference() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        std::fs::remove_dir(&store.blob_directory).unwrap();
        std::fs::write(&store.blob_directory, b"not a directory").unwrap();
        assert!(store
            .import_blob(b"cannot be written", Some("application/pdf".into()))
            .is_err());
        let digest = "a".repeat(64);
        let board_id = Uuid::new_v4().to_string();
        store
            .mutate(7, vec![board_change(&board_id, "Files")])
            .unwrap();
        assert!(store
            .mutate(
                7,
                vec![DataChange {
                    table: "board_items".into(),
                    id: Uuid::new_v4().to_string(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("board_id".into(), json!(board_id)),
                        ("kind".into(), json!("file")),
                        ("blob_sha256".into(), json!(digest)),
                    ]),
                }],
            )
            .is_err());
        let connection = store.connection.lock().unwrap();
        let blobs: i64 = connection
            .query_row("SELECT COUNT(*) FROM _local_blobs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(blobs, 0);
        drop(connection);
        assert_eq!(store.outbox_count(), 1);
    }

    #[test]
    fn abandoned_file_selection_is_discarded_but_queued_data_is_not() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let abandoned = store.import_blob(b"cancelled", None).unwrap();
        assert!(store.discard_unreferenced_blob(&abandoned.sha256).unwrap());
        assert!(!store.has_blob(&abandoned.sha256));

        let retained = store.import_blob(b"queued", None).unwrap();
        let board_id = Uuid::new_v4().to_string();
        store
            .mutate(7, vec![board_change(&board_id, "Files")])
            .unwrap();
        store
            .mutate(
                7,
                vec![DataChange {
                    table: "board_items".into(),
                    id: Uuid::new_v4().to_string(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("board_id".into(), json!(board_id)),
                        ("kind".into(), json!("file")),
                        ("blob_sha256".into(), json!(retained.sha256)),
                    ]),
                }],
            )
            .unwrap();
        assert!(!store.discard_unreferenced_blob(&retained.sha256).unwrap());
        assert!(store.has_blob(&retained.sha256));
    }

    #[test]
    fn account_profiles_are_local_read_dependencies_and_account_scoped() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        store
            .set_local_account(
                7,
                json!({"id": 7, "email": "reader@example.test", "display_name": "Reader"}),
            )
            .unwrap();
        assert_eq!(
            store.query(7, "account", json!({})).unwrap()["display_name"],
            "Reader"
        );
        assert!(store.query(8, "account", json!({})).is_err());
        assert!(store
            .set_local_account(8, json!({"id": 7, "display_name": "Wrong"}))
            .is_err());
    }

    #[test]
    fn recovery_export_contains_pending_mutations_in_a_portable_manifest() {
        use std::io::Read;

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_id = Uuid::new_v4().to_string();
        store
            .mutate(7, vec![board_change(&board_id, "Recover me")])
            .unwrap();
        let destination = directory.path().join("recovery.zip");
        let exported = store.export_recovery(7, &destination).unwrap();
        assert_eq!(exported.mutations, 1);
        assert_eq!(exported.files, 0);
        assert!(exported.size > 0);

        let mut archive = zip::ZipArchive::new(std::fs::File::open(destination).unwrap()).unwrap();
        let mut manifest = String::new();
        archive
            .by_name("manifest.json")
            .unwrap()
            .read_to_string(&mut manifest)
            .unwrap();
        let manifest: Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(manifest["format"], "papol-offline-recovery-v1");
        assert_eq!(manifest["account_id"], 7);
        assert_eq!(manifest["mutations"][0]["changes"][0]["id"], board_id);
        assert_eq!(manifest["rows"][0]["id"], board_id);
        assert_eq!(manifest["rows"][0]["name"], "Recover me");
    }

    #[test]
    fn recovery_export_rejects_a_missing_pending_file_without_leaving_an_archive() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_id = Uuid::new_v4().to_string();
        let item_id = Uuid::new_v4().to_string();
        let blob = store
            .import_blob(b"queued user file", Some("application/pdf".into()))
            .unwrap();
        store
            .mutate(
                7,
                vec![
                    board_change(&board_id, "Missing file recovery"),
                    DataChange {
                        table: "board_items".into(),
                        id: item_id,
                        operation: "upsert".into(),
                        values: Map::from_iter([
                            ("board_id".into(), json!(board_id)),
                            ("kind".into(), json!("file")),
                            ("blob_sha256".into(), json!(blob.sha256)),
                        ]),
                    },
                ],
            )
            .unwrap();
        std::fs::remove_file(store.blob_directory.join(&blob.sha256)).unwrap();

        let destination = directory.path().join("recovery.zip");
        let error = store.export_recovery(7, &destination).unwrap_err();
        assert!(error.contains("Recovery file"), "{error}");
        assert!(!destination.exists());
        assert!(!destination.with_extension("zip.partial").exists());
    }

    #[test]
    fn startup_migrates_an_existing_database_forward_once() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE boards (
                  id TEXT PRIMARY KEY NOT NULL, user_id INTEGER NOT NULL,
                  shelf_id INTEGER, name TEXT NOT NULL, description TEXT,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
                );
                CREATE TABLE board_groups (
                  id TEXT PRIMARY KEY NOT NULL, board_id TEXT NOT NULL REFERENCES boards(id),
                  kind TEXT NOT NULL DEFAULT 'booklet', title TEXT NOT NULL, header TEXT,
                  auto_arrange INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
                  deleted_at TEXT
                );
                CREATE TABLE board_items (
                  id TEXT PRIMARY KEY NOT NULL, board_id TEXT NOT NULL REFERENCES boards(id),
                  group_id TEXT REFERENCES board_groups(id), kind TEXT NOT NULL, content TEXT,
                  excerpt_text TEXT, file_path TEXT, original_filename TEXT, mime_type TEXT,
                  source_url TEXT, source_label TEXT, staged INTEGER NOT NULL DEFAULT 0,
                  text_align TEXT NOT NULL DEFAULT 'left', position INTEGER NOT NULL DEFAULT 0,
                  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
                  width REAL NOT NULL DEFAULT 300, deleted_at TEXT, created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
                );
                "#,
            )
            .unwrap();
        drop(connection);

        let store = LocalStore::open(&path).unwrap();
        let connection = store.connection.lock().unwrap();
        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM _local_schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        let has_blob_column = connection
            .prepare("PRAGMA table_info(board_items)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .iter()
            .any(|column| column == "blob_sha256");
        assert_eq!(migration_count, 11);
        assert!(has_blob_column);
        drop(connection);
        drop(store);

        let reopened = LocalStore::open(&path).unwrap();
        let connection = reopened.connection.lock().unwrap();
        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM _local_schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(migration_count, 11);
    }

    #[test]
    fn annotation_snapshot_enables_offline_editing_across_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let paper_id = Uuid::new_v4().to_string();
        let edition_id = Uuid::new_v4().to_string();
        let duplicate_edition_id = Uuid::new_v4().to_string();
        let note_id = Uuid::new_v4().to_string();
        let store = LocalStore::open(&path).unwrap();
        store
            .apply_snapshot(
                7,
                vec![
                    Map::from_iter([
                        ("table".into(), json!("papers")),
                        ("id".into(), json!(paper_id.clone())),
                        ("doi".into(), Value::Null),
                        ("title".into(), json!("Paper")),
                        ("authors".into(), Value::Null),
                        ("journal".into(), Value::Null),
                        ("year".into(), Value::Null),
                        ("created_at".into(), json!("2026-09-12T00:00:00Z")),
                        ("updated_at".into(), json!("2026-09-12T00:00:00Z")),
                        ("revision".into(), json!(1)),
                        ("deleted_at".into(), Value::Null),
                    ]),
                    Map::from_iter([
                        ("table".into(), json!("paper_editions")),
                        ("id".into(), json!(edition_id.clone())),
                        ("paper_id".into(), json!(paper_id.clone())),
                        ("file_path".into(), json!("paper.pdf")),
                        ("sha256".into(), json!("1".repeat(64))),
                        ("created_at".into(), json!("2026-09-12T00:00:00Z")),
                        ("updated_at".into(), json!("2026-09-12T00:00:00Z")),
                        ("revision".into(), json!(1)),
                        ("deleted_at".into(), Value::Null),
                    ]),
                    Map::from_iter([
                        ("table".into(), json!("paper_editions")),
                        ("id".into(), json!(duplicate_edition_id)),
                        ("paper_id".into(), json!(paper_id.clone())),
                        ("file_path".into(), json!("duplicate.pdf")),
                        ("sha256".into(), json!("1".repeat(64))),
                        ("created_at".into(), json!("2026-09-12T00:00:00Z")),
                        ("updated_at".into(), json!("2026-09-12T00:00:00Z")),
                        ("revision".into(), json!(1)),
                        ("deleted_at".into(), Value::Null),
                    ]),
                ],
            )
            .unwrap();
        store
            .mutate(
                7,
                vec![DataChange {
                    table: "comments".into(),
                    id: note_id.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("paper_id".into(), json!(paper_id.clone())),
                        ("edition_id".into(), json!(edition_id.clone())),
                        ("content".into(), json!("Written offline")),
                        ("page".into(), json!(2)),
                        ("anchor_type".into(), json!("point")),
                        ("anchor".into(), json!(r#"{"x":0.2,"y":0.3}"#)),
                    ]),
                }],
            )
            .unwrap();
        drop(store);

        let reopened = LocalStore::open(&path).unwrap();
        let notes = reopened
            .query(7, "comments", json!({"parent_id": paper_id}))
            .unwrap();
        assert_eq!(notes[0]["id"], note_id);
        assert_eq!(notes[0]["content"], "Written offline");
        assert_eq!(notes[0]["anchor"]["type"], "point");
        assert_eq!(reopened.outbox_count(), 1);
    }

    #[test]
    fn snapshot_replaces_the_account_mirror_without_erasing_pending_work() {
        fn shelf(id: &str, name: &str) -> Map<String, Value> {
            Map::from_iter([
                ("table".into(), json!("shelves")),
                ("id".into(), json!(id)),
                ("user_id".into(), json!(7)),
                ("name".into(), json!(name)),
                ("color".into(), json!("#123456")),
                ("is_public".into(), json!(0)),
                ("is_default".into(), json!(0)),
                ("position".into(), json!(0)),
                ("created_at".into(), json!("2026-09-12T00:00:00Z")),
                ("updated_at".into(), json!("2026-09-12T00:00:00Z")),
                ("revision".into(), json!(1)),
                ("deleted_at".into(), Value::Null),
            ])
        }

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let stale_id = Uuid::new_v4().to_string();
        let current_id = Uuid::new_v4().to_string();
        store
            .apply_snapshot(
                7,
                vec![shelf(&stale_id, "Old"), shelf(&current_id, "Current")],
            )
            .unwrap();
        store
            .apply_snapshot(7, vec![shelf(&current_id, "Current")])
            .unwrap();
        let nook = store.query(7, "nook", json!({})).unwrap();
        assert_eq!(nook["shelves"].as_array().unwrap().len(), 1);
        assert_eq!(nook["shelves"][0]["id"], current_id);

        let pending_id = Uuid::new_v4().to_string();
        store
            .mutate(
                7,
                vec![DataChange {
                    table: "shelves".into(),
                    id: pending_id.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("name".into(), json!("Offline")),
                        ("color".into(), json!("#654321")),
                        ("position".into(), json!(1)),
                    ]),
                }],
            )
            .unwrap();
        store.apply_snapshot(7, vec![]).unwrap();
        let nook = store.query(7, "nook", json!({})).unwrap();
        assert!(nook["shelves"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == pending_id));
    }

    #[test]
    fn nook_snapshot_supports_offline_organization_across_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let paper_id = Uuid::new_v4().to_string();
        let shelf_id = Uuid::new_v4().to_string();
        let copy_id = Uuid::new_v4().to_string();
        let tag_id = Uuid::new_v4().to_string();
        let link_id = Uuid::new_v4().to_string();
        let timestamp = "2026-09-12T00:00:00Z";
        {
            let store = LocalStore::open(&path).unwrap();
            store
                .apply_snapshot(
                    7,
                    vec![
                        Map::from_iter([
                            ("table".into(), json!("papers")),
                            ("id".into(), json!(paper_id)),
                            ("doi".into(), Value::Null),
                            ("title".into(), json!("Offline systems")),
                            ("authors".into(), Value::Null),
                            ("journal".into(), Value::Null),
                            ("year".into(), Value::Null),
                            ("created_at".into(), json!(timestamp)),
                            ("updated_at".into(), json!(timestamp)),
                            ("revision".into(), json!(1)),
                            ("deleted_at".into(), Value::Null),
                        ]),
                        Map::from_iter([
                            ("table".into(), json!("shelves")),
                            ("id".into(), json!(shelf_id)),
                            ("user_id".into(), json!(7)),
                            ("name".into(), json!("Reading")),
                            ("color".into(), json!("#123456")),
                            ("is_public".into(), json!(0)),
                            ("is_default".into(), json!(1)),
                            ("position".into(), json!(0)),
                            ("created_at".into(), json!(timestamp)),
                            ("updated_at".into(), json!(timestamp)),
                            ("revision".into(), json!(1)),
                            ("deleted_at".into(), Value::Null),
                        ]),
                        Map::from_iter([
                            ("table".into(), json!("copies")),
                            ("id".into(), json!(copy_id)),
                            ("paper_id".into(), json!(paper_id)),
                            ("user_id".into(), json!(7)),
                            ("shelf_id".into(), json!(shelf_id)),
                            ("edition_id".into(), Value::Null),
                            ("edition_sha256".into(), Value::Null),
                            ("ignored_edition_id".into(), Value::Null),
                            ("summary".into(), Value::Null),
                            ("thought".into(), Value::Null),
                            ("marketed".into(), json!(0)),
                            ("is_author".into(), json!(0)),
                            ("rating_expertise".into(), Value::Null),
                            ("rating_reading".into(), Value::Null),
                            ("rating_liking".into(), Value::Null),
                            ("created_at".into(), json!(timestamp)),
                            ("updated_at".into(), json!(timestamp)),
                            ("revision".into(), json!(1)),
                            ("deleted_at".into(), Value::Null),
                        ]),
                    ],
                )
                .unwrap();
            store
                .mutate(
                    7,
                    vec![
                        DataChange {
                            table: "copies".into(),
                            id: copy_id.clone(),
                            operation: "patch".into(),
                            values: Map::from_iter([("summary".into(), json!("Read locally"))]),
                        },
                        DataChange {
                            table: "tags".into(),
                            id: tag_id.clone(),
                            operation: "upsert".into(),
                            values: Map::from_iter([("name".into(), json!("methods"))]),
                        },
                    ],
                )
                .unwrap();
            store
                .mutate(
                    7,
                    vec![DataChange {
                        table: "copy_tags".into(),
                        id: link_id,
                        operation: "upsert".into(),
                        values: Map::from_iter([
                            ("copy_id".into(), json!(copy_id)),
                            ("tag_id".into(), json!(tag_id)),
                        ]),
                    }],
                )
                .unwrap();
        }
        let reopened = LocalStore::open(&path).unwrap();
        let nook = reopened.query(7, "nook", json!({})).unwrap();
        assert_eq!(nook["copies"][0]["summary"], "Read locally");
        assert_eq!(nook["tags"][0]["name"], "methods");
        assert_eq!(nook["copy_tags"][0]["copy_id"], copy_id);
        assert_eq!(reopened.outbox_count(), 2);
    }

    #[test]
    fn pdf_import_commits_file_domain_rows_and_outbox_before_network() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let paper_id = Uuid::new_v4().to_string();
        let edition_id = Uuid::new_v4().to_string();
        let copy_id = Uuid::new_v4().to_string();
        let canonical_paper_id = Uuid::new_v4().to_string();
        let canonical_edition_id = Uuid::new_v4().to_string();
        {
            let store = LocalStore::open(&path).unwrap();
            let blob = store
                .import_blob(b"%PDF-1.4\noffline", Some("application/pdf".into()))
                .unwrap();
            let receipt = store
                .mutate(
                    7,
                    vec![
                        DataChange {
                            table: "papers".into(),
                            id: paper_id.clone(),
                            operation: "upsert".into(),
                            values: Map::from_iter([
                                ("title".into(), json!("Imported offline")),
                                ("doi".into(), Value::Null),
                            ]),
                        },
                        DataChange {
                            table: "paper_editions".into(),
                            id: edition_id.clone(),
                            operation: "upsert".into(),
                            values: Map::from_iter([
                                ("paper_id".into(), json!(paper_id)),
                                ("file_path".into(), json!(format!("{}.pdf", blob.sha256))),
                                ("sha256".into(), json!(blob.sha256)),
                            ]),
                        },
                        DataChange {
                            table: "copies".into(),
                            id: copy_id.clone(),
                            operation: "upsert".into(),
                            values: Map::from_iter([
                                ("paper_id".into(), json!(paper_id)),
                                ("edition_id".into(), json!(edition_id)),
                                ("edition_sha256".into(), json!(blob.sha256)),
                            ]),
                        },
                    ],
                )
                .unwrap();
            let mut rows = receipt.rows;
            for (index, table) in ["papers", "paper_editions", "copies"]
                .into_iter()
                .enumerate()
            {
                let row = rows[index].as_object_mut().unwrap();
                row.insert("table".into(), json!(table));
                row.insert("revision".into(), json!(2));
            }
            rows[0]
                .as_object_mut()
                .unwrap()
                .insert("id".into(), json!(canonical_paper_id));
            let edition = rows[1].as_object_mut().unwrap();
            edition.insert("id".into(), json!(canonical_edition_id));
            edition.insert("paper_id".into(), json!(canonical_paper_id));
            let copy = rows[2].as_object_mut().unwrap();
            copy.insert("paper_id".into(), json!(canonical_paper_id));
            copy.insert("edition_id".into(), json!(canonical_edition_id));
            store
                .accept_push(
                    7,
                    receipt.local_sequence,
                    rows.into_iter()
                        .map(|row| row.as_object().unwrap().clone())
                        .collect(),
                    vec![],
                    Map::from_iter([
                        (paper_id.clone(), json!(canonical_paper_id)),
                        (edition_id.clone(), json!(canonical_edition_id)),
                    ]),
                )
                .unwrap();
        }
        let reopened = LocalStore::open(&path).unwrap();
        let paper = reopened
            .query(7, "paper", json!({"id": canonical_paper_id}))
            .unwrap();
        assert_eq!(paper["title"], "Imported offline");
        assert_eq!(paper["edition_id"], canonical_edition_id);
        assert!(reopened.has_blob(paper["edition_sha256"].as_str().unwrap()));
        assert_eq!(reopened.outbox_count(), 0);
    }
}
