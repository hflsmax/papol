use crate::limits::{decimal as app_decimal_limit, mebibytes, value as app_limit};
use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

use super::REGISTRY;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DataChange {
    pub table: String,
    pub uuid: String,
    pub operation: String,
    #[serde(default)]
    pub values: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QueuedChange {
    pub table: String,
    pub uuid: String,
    pub base_revision: i64,
    pub operation: String,
    pub values: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MutationReceipt {
    pub client_uuid: String,
    pub mutation_uuid: String,
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
    pub client_uuid: String,
    pub mutation_uuid: String,
    pub local_sequence: i64,
    pub changes: Vec<QueuedChange>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoteChange {
    pub table: String,
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
        let mut connection = open_connection(path)?;
        // A replica this build does not recognize is one an older Papol
        // wrote. It is not carried forward: every row in it belongs to the
        // service, which still has them, so the file is discarded and the
        // next synchronization brings the whole account back at today's
        // shape. Nothing here reads it first — the point of not recognizing
        // a schema is having no idea what its rows mean. A first launch
        // takes the same path with nothing to remove: the schema is written
        // into the empty file that follows, and never again into that file.
        //
        // The user was told this was coming. A build below the service's
        // floor refuses to be used and says so, offering to save whatever it
        // had not managed to send; by the time this build is the one
        // running, that offer has been made and answered.
        if !super::schema::recognizes(&connection) {
            drop(connection);
            discard_replica(path, &blob_directory)?;
            connection = open_connection(path)?;
            super::schema::apply(&mut connection)?;
        }
        Ok(Self {
            connection: Mutex::new(connection),
            blob_directory,
        })
    }

    pub fn mutate(
        &self,
        account_uuid: &str,
        changes: Vec<DataChange>,
    ) -> Result<MutationReceipt, String> {
        if changes.is_empty() {
            return Err("A mutation needs at least one row change".into());
        }
        validate_import_batch(&changes)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        reject_duplicate_pdf_import(&transaction, account_uuid, &changes)?;
        let client_uuid = local_client_uuid(&transaction)?;
        let mutation_uuid = Uuid::new_v4().to_string();
        let mut queued = Vec::new();
        let mut rows = Vec::new();

        for change in changes {
            if !valid_row_id(&change.table, &change.uuid) {
                return Err(format!("A {} row is not named that way", change.table,));
            }
            let rule = REGISTRY["tables"]
                .get(&change.table)
                .ok_or_else(|| format!("{} is not synchronized", change.table))?;
            // What a replica may write is `client_writable` and nothing else.
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
            let blob_digest = change.values.get("sha256").and_then(Value::as_str);
            if blob_digest.is_some_and(|digest| !self.has_blob(digest)) {
                return Err("A local file mutation must reference an imported blob".into());
            }
            validate_ownership(&transaction, account_uuid, &change)?;
            let old_revision: Option<i64> = transaction
                .query_row(
                    &format!(
                        "SELECT revision FROM {} WHERE {}=?1",
                        change.table,
                        row_key(&change.table)
                    ),
                    [&change.uuid],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            let base_revision = old_revision.unwrap_or(0);
            // A paper is named by its file, so importing one Papol already
            // holds names the row that is already there. That is not a
            // second creation and not an error — the change still travels,
            // because it is what tells the service this user has the file.
            // Whether they may have a second *copy* of it is a different
            // question, and `reject_duplicate_pdf_import` has answered it.
            let already_held = change.table == "papers" && old_revision.is_some();
            if rule["create_only"].as_bool() == Some(true)
                && !already_held
                && (old_revision.is_some() || change.operation != "upsert")
            {
                return Err(format!("{} rows can only be created locally", change.table));
            }
            let revision = if already_held {
                base_revision
            } else {
                base_revision + 1
            };
            if !already_held {
                apply_local_change(
                    &transaction,
                    account_uuid,
                    &change,
                    revision,
                    old_revision.is_none(),
                )?;
            }
            validate_local_row(&transaction, &change.table, &change.uuid)?;
            refresh_blob_reference(&transaction, &change.table, &change.uuid)?;
            let row = read_row(&transaction, &change.table, &change.uuid)?;
            // Every table merges the same way: the writer restates the whole
            // row, and the last write wins. A delete says only that the row
            // is gone, so it still travels as itself.
            let values = if change.operation != "delete" {
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
                uuid: change.uuid.clone(),
                base_revision,
                operation: change.operation.clone(),
                values,
            });
            rows.push(row);
        }

        let changes_json = serde_json::to_string(&queued).map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO _local_outbox(account_uuid,client_uuid,mutation_uuid,changes_json) VALUES (?1,?2,?3,?4)",
                params![account_uuid, client_uuid, mutation_uuid, changes_json],
            )
            .map_err(|error| error.to_string())?;
        let local_sequence = transaction.last_insert_rowid();
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(MutationReceipt {
            client_uuid,
            mutation_uuid,
            local_sequence,
            rows,
        })
    }

    pub fn query(
        &self,
        account_uuid: &str,
        name: &str,
        parameters: Value,
    ) -> Result<Value, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        match name {
            "boards" => query_boards(&connection, account_uuid),
            "board" => {
                let uuid = parameters["uuid"]
                    .as_str()
                    .ok_or("board query requires a uuid")?;
                query_board(&connection, account_uuid, uuid)
            }
            "board_group" => {
                let uuid = parameters["uuid"]
                    .as_str()
                    .ok_or("board_group query requires a uuid")?;
                query_board_group(&connection, account_uuid, uuid)
            }
            // Asked for by paper, because a note written about the paper and
            // never placed on a page has no PDF to be found by. Narrowing to
            // one PDF, or to one kind, is the caller's business.
            "annotations" => query_annotations(&connection, account_uuid, parameters),
            "shelves" => {
                query_owned_rows(&connection, account_uuid, "shelves", "position,name,uuid")
            }
            "tags" => query_owned_rows(&connection, account_uuid, "tags", "name,uuid"),
            "nook" => query_nook(&connection, account_uuid),
            "papers" => query_papers(&connection, account_uuid),
            "paper" => {
                let uuid = parameters["uuid"]
                    .as_str()
                    .ok_or("paper query requires a uuid")?;
                query_paper(&connection, account_uuid, uuid)
            }
            "paper_by_pdf" => {
                let sha256 = parameters["sha256"]
                    .as_str()
                    .ok_or("paper query requires sha256")?;
                paper_view(&connection, account_uuid, sha256)
            }
            "sync_status" => query_sync_status(&connection, account_uuid),
            "storage_status" => query_storage_status(&connection),
            "account" => query_local_account(&connection, account_uuid),
            _ => Err(format!("Unknown local query: {name}")),
        }
    }

    /// Cache the paper a shared link or a Library listing described, so a
    /// copy of it can be made here before the service has been asked. Not a
    /// revision claim: the next push or pull replaces it with the service's
    /// own row.
    pub fn import_shared_paper(
        &self,
        account_uuid: &str,
        mut row: Map<String, Value>,
    ) -> Result<(), String> {
        let sha256 = row
            .get("sha256")
            .and_then(Value::as_str)
            .ok_or("Cached paper row is missing its digest")?
            .to_owned();
        if !valid_sha256(&sha256) {
            return Err("Cached paper row has an invalid digest".into());
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let account_exists: Option<i64> = transaction
            .query_row(
                "SELECT 1 FROM _local_accounts WHERE account_uuid=?1",
                [account_uuid],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if account_exists.is_none() {
            return Err("Local data requires a signed-in account".into());
        }
        row.insert("revision".into(), json!(0));
        apply_remote_row(&transaction, "papers", row, false)?;
        refresh_blob_reference(&transaction, "papers", &sha256)?;
        transaction.commit().map_err(|error| error.to_string())
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

    /// The two settings a window may set: how it wants to sync, and what the
    /// server last said about this build. Everything else in
    /// `_local_settings` is the store's own.
    pub fn set_local_setting(&self, key: &str, value: &str) -> Result<(), String> {
        match (key, value) {
            ("sync_mode", "automatic" | "manual") => {}
            ("sync_mode", _) => return Err("Sync mode must be automatic or manual".into()),
            ("client_compatibility", "incompatible" | "supported") => {}
            ("client_compatibility", _) => {
                return Err("A compatibility verdict is incompatible or supported".into())
            }
            _ => return Err("Unknown local setting".into()),
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

    pub fn set_local_account(&self, account_uuid: &str, profile: Value) -> Result<(), String> {
        if account_uuid.is_empty() || profile["uuid"].as_str() != Some(account_uuid) {
            return Err("Local account profile identity does not match".into());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection.execute(
            "INSERT INTO _local_accounts(account_uuid,profile_json,updated_at) VALUES (?1,?2,?3) \
             ON CONFLICT(account_uuid) DO UPDATE SET profile_json=excluded.profile_json,updated_at=excluded.updated_at",
            params![account_uuid, profile.to_string(), chrono_text()],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn next_outbox(&self, account_uuid: &str) -> Result<Option<OutboxMutation>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection
            .query_row(
                "SELECT local_sequence,client_uuid,mutation_uuid,changes_json FROM _local_outbox \
                 WHERE account_uuid=?1 AND state='pending' ORDER BY local_sequence LIMIT 1",
                [account_uuid],
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
                        local_sequence: row.get(0)?,
                        client_uuid: row.get(1)?,
                        mutation_uuid: row.get(2)?,
                        changes,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    /// How many mutations this account still has to send, blocked ones
    /// included.
    pub fn pending_count(&self, account_uuid: &str) -> Result<usize, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection
            .query_row(
                "SELECT COUNT(*) FROM _local_outbox WHERE account_uuid=?1",
                [account_uuid],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count as usize)
            .map_err(|error| error.to_string())
    }

    pub fn retry_blocked_outbox(&self, account_uuid: &str) -> Result<usize, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection
            .execute(
                "UPDATE _local_outbox SET state='pending',last_error=NULL \
                 WHERE account_uuid=?1 AND state='blocked'",
                [account_uuid],
            )
            .map_err(|error| error.to_string())
    }

    pub fn record_outbox_error(
        &self,
        account_uuid: &str,
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
             WHERE account_uuid=?1 AND local_sequence=?2",
                params![
                    account_uuid,
                    local_sequence,
                    message,
                    if blocked { "blocked" } else { "pending" }
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn client_uuid(&self) -> Result<String, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        local_client_uuid(&connection)
    }

    pub fn accept_push(
        &self,
        account_uuid: &str,
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
        apply_identity_aliases(&transaction, account_uuid, &aliases)?;
        for mut row in rows {
            let table = row
                .remove("table")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or("Push result row is missing its table")?;
            let row_uuid = row
                .get(row_key(&table))
                .and_then(Value::as_str)
                .ok_or("Push result row is missing its name")?
                .to_owned();
            let sha256 = row.get("sha256").and_then(Value::as_str).map(str::to_owned);
            validate_remote_ownership(&transaction, account_uuid, &table, &row)?;
            apply_remote_row(&transaction, &table, row, false)?;
            refresh_blob_reference(&transaction, &table, &row_uuid)?;
            if let Some(sha256) = sha256 {
                transaction
                    .execute(
                        "UPDATE _local_blobs SET durability='cache' WHERE sha256=?1",
                        [sha256],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        for conflict in conflicts {
            let table = conflict["table"].as_str().unwrap_or("unknown");
            let row_uuid = conflict["uuid"].as_str().unwrap_or("unknown");
            let resolved_at = matches!(
                conflict["resolution"].as_str(),
                Some("client_won" | "server_won")
            )
            .then(chrono_text);
            transaction.execute(
                "INSERT INTO _local_conflicts(uuid,account_uuid,table_name,row_uuid,details_json,resolved_at) VALUES (?1,?2,?3,?4,?5,?6)",
                params![Uuid::new_v4().to_string(), account_uuid, table, row_uuid, conflict.to_string(), resolved_at],
            ).map_err(|error| error.to_string())?;
        }
        transaction
            .execute(
                "DELETE FROM _local_outbox WHERE account_uuid=?1 AND local_sequence=?2",
                params![account_uuid, local_sequence],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn apply_pull(
        &self,
        account_uuid: &str,
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
            let uuid = change
                .row
                .get(row_key(&change.table))
                .and_then(Value::as_str)
                .ok_or("Pulled row is missing its name")?
                .to_owned();
            validate_remote_ownership(&transaction, account_uuid, &change.table, &change.row)?;
            apply_remote_row(&transaction, &change.table, change.row, false)?;
            refresh_blob_reference(&transaction, &change.table, &uuid)?;
        }
        transaction.execute(
            "INSERT INTO _local_sync_state(account_uuid,pull_cursor,last_synced_at,last_error) VALUES (?1,?2,?3,NULL) ON CONFLICT(account_uuid) DO UPDATE SET pull_cursor=excluded.pull_cursor,last_synced_at=excluded.last_synced_at,last_error=NULL",
            params![account_uuid, cursor, chrono_text()],
        ).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn apply_snapshot(
        &self,
        account_uuid: &str,
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
                "SELECT COUNT(*) FROM _local_outbox WHERE account_uuid=?1",
                [account_uuid],
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
            // Board children carry ownership through their parent, so stale
            // them before the boards themselves. Rows present in the incoming
            // snapshot are restored by the authoritative upserts below.
            for table in ["board_items", "board_groups"] {
                transaction
                    .execute(
                        &format!(
                            "UPDATE {table} SET deleted_at=?1 WHERE deleted_at IS NULL AND board_uuid IN (SELECT uuid FROM boards WHERE user_uuid=?2)"
                        ),
                        params![stale_at, account_uuid],
                    )
                    .map_err(|error| error.to_string())?;
            }
            for table in [
                "boards",
                "annotations",
                "copy_tags",
                "copies",
                "shelves",
                "tags",
            ] {
                transaction
                    .execute(
                        &format!(
                            "UPDATE {table} SET deleted_at=?1 WHERE user_uuid=?2 AND deleted_at IS NULL"
                        ),
                        params![stale_at, account_uuid],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        for mut row in rows {
            let table = row
                .remove("table")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or("Snapshot row is missing its table")?;
            let uuid = row
                .get(row_key(&table))
                .and_then(Value::as_str)
                .ok_or("Snapshot row is missing its name")?
                .to_owned();
            validate_remote_ownership(&transaction, account_uuid, &table, &row)?;
            apply_remote_row(&transaction, &table, row, pending == 0)?;
            refresh_blob_reference(&transaction, &table, &uuid)?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(count)
    }

    pub fn pull_cursor(&self, account_uuid: &str) -> Result<i64, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection
            .query_row(
                "SELECT pull_cursor FROM _local_sync_state WHERE account_uuid=?1",
                [account_uuid],
                |row| row.get(0),
            )
            .optional()
            .map(|value| value.unwrap_or(0))
            .map_err(|error| error.to_string())
    }

    pub fn record_sync_error(&self, account_uuid: &str, message: &str) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        connection.execute(
            "INSERT INTO _local_sync_state(account_uuid,last_error) VALUES (?1,?2) ON CONFLICT(account_uuid) DO UPDATE SET last_error=excluded.last_error",
            params![account_uuid, message],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn import_blob(
        &self,
        bytes: &[u8],
        mime_type: Option<String>,
    ) -> Result<BlobRecord, String> {
        if bytes.len() > mebibytes("files", "offline_blob_mb") {
            return Err(format!(
                "Offline files may be at most {} MB",
                app_limit("files", "offline_blob_mb")
            ));
        }
        self.store_blob(bytes, mime_type, "unsynced")
    }

    pub fn import_remote_blob(
        &self,
        expected_sha256: &str,
        bytes: &[u8],
        mime_type: Option<String>,
    ) -> Result<(), String> {
        use sha2::{Digest, Sha256};

        let actual_sha256 = hex::encode(Sha256::digest(bytes));
        if actual_sha256 != expected_sha256 {
            return Err("Downloaded blob failed SHA-256 verification".into());
        }
        self.store_blob(bytes, mime_type, "cache")?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        refresh_blob_references_for_digest(&connection, expected_sha256)?;
        Ok(())
    }

    fn store_blob(
        &self,
        bytes: &[u8],
        mime_type: Option<String>,
        durability: &str,
    ) -> Result<BlobRecord, String> {
        use sha2::{Digest, Sha256};

        let sha256 = hex::encode(Sha256::digest(bytes));
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
            "INSERT INTO _local_blobs(sha256,relative_path,size,mime_type,durability,last_accessed_at) VALUES (?1,?1,?2,?3,?4,?5) ON CONFLICT(sha256) DO UPDATE SET size=excluded.size,mime_type=COALESCE(excluded.mime_type,_local_blobs.mime_type),last_accessed_at=excluded.last_accessed_at,durability=CASE WHEN _local_blobs.durability='unsynced' THEN _local_blobs.durability ELSE excluded.durability END",
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
        if !valid_sha256(sha256) {
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

    /// Every active file this account refers to that is not held here — not
    /// in the index, or not on disk. PDFs are owned indirectly through the
    /// account's copies; board files are owned by their board. A file on
    /// disk that the index does not know is fetched again, which indexes it.
    pub fn missing_blob_digests(&self, account_uuid: &str) -> Result<Vec<String>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let mut statement = connection
            .prepare(
                r#"SELECT DISTINCT referenced.digest, _local_blobs.sha256 IS NOT NULL
                 FROM (
                   SELECT p.sha256 AS digest
                   FROM papers p
                   JOIN copies c ON c.paper_sha256=p.sha256
                   WHERE c.user_uuid=?1 AND c.deleted_at IS NULL AND p.deleted_at IS NULL
                   UNION ALL
                   SELECT bi.sha256 AS digest
                   FROM board_items bi
                   JOIN boards b ON b.uuid=bi.board_uuid
                   WHERE b.user_uuid=?1 AND b.deleted_at IS NULL
                     AND bi.deleted_at IS NULL AND bi.sha256 IS NOT NULL
                 ) referenced
                 LEFT JOIN _local_blobs ON _local_blobs.sha256=referenced.digest
                 ORDER BY referenced.digest"#,
            )
            .map_err(|error| error.to_string())?;
        let referenced = statement
            .query_map([account_uuid], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(referenced
            .into_iter()
            .filter(|(digest, indexed)| !indexed || !self.has_blob(digest))
            .map(|(digest, _)| digest)
            .collect())
    }

    /// Unlink a cached file whose index row is already gone. One that will
    /// not go is a harmless orphan: nothing names it, and a digest asked
    /// for again is fetched again.
    fn remove_blob_file(&self, sha256: &str) {
        let _ = std::fs::remove_file(self.blob_directory.join(sha256));
    }

    pub fn clear_data(&self) -> Result<usize, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let blobs = {
            let mut statement = transaction
                .prepare("SELECT sha256 FROM _local_blobs ORDER BY sha256")
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows
        };
        transaction
            .execute_batch(
                "DELETE FROM copy_tags;
                 DELETE FROM board_items;
                 DELETE FROM board_groups;
                 DELETE FROM annotations;
                 DELETE FROM copies;
                 DELETE FROM boards;
                 DELETE FROM tags;
                 DELETE FROM shelves;
                 DELETE FROM papers;
                 DELETE FROM _local_blob_refs;
                 DELETE FROM _local_blobs;
                 DELETE FROM _local_outbox;
                 DELETE FROM _local_conflicts;
                 DELETE FROM _local_sync_state;",
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        drop(connection);
        for sha256 in &blobs {
            self.remove_blob_file(sha256);
        }
        Ok(blobs.len())
    }

    pub fn remove_account(&self, account_uuid: &str) -> Result<usize, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        // Account-owned rows are hard-deleted on sign-out, children first:
        // the schema has no cascading deletes.
        transaction
            .execute(
                "DELETE FROM _local_blob_refs WHERE table_name='board_items' AND row_uuid IN (\
                   SELECT board_items.uuid FROM board_items JOIN boards ON boards.uuid=board_items.board_uuid \
                   WHERE boards.user_uuid=?1\
                 )",
                [account_uuid],
            )
            .map_err(|error| error.to_string())?;
        for statement in [
                "DELETE FROM copy_tags WHERE user_uuid=?1",
                "DELETE FROM board_items WHERE board_uuid IN (SELECT uuid FROM boards WHERE user_uuid=?1)",
                "DELETE FROM board_groups WHERE board_uuid IN (SELECT uuid FROM boards WHERE user_uuid=?1)",
                "DELETE FROM annotations WHERE user_uuid=?1",
                "DELETE FROM copies WHERE user_uuid=?1",
                "DELETE FROM boards WHERE user_uuid=?1",
                "DELETE FROM tags WHERE user_uuid=?1",
                "DELETE FROM shelves WHERE user_uuid=?1",
                "DELETE FROM _local_outbox WHERE account_uuid=?1",
                "DELETE FROM _local_conflicts WHERE account_uuid=?1",
                "DELETE FROM _local_sync_state WHERE account_uuid=?1",
            "DELETE FROM _local_accounts WHERE account_uuid=?1",
        ] {
            transaction
                .execute(statement, [account_uuid])
                .map_err(|error| error.to_string())?;
        }

        // Papers are shared cache rows. Remove them only when no other
        // local account still owns a copy or annotation.
        transaction
            .execute_batch(
                "DELETE FROM _local_blob_refs
                   WHERE table_name='papers' AND row_uuid IN (
                     SELECT papers.sha256 FROM papers
                     WHERE NOT EXISTS (SELECT 1 FROM copies WHERE copies.paper_sha256=papers.sha256)
                       AND NOT EXISTS (SELECT 1 FROM annotations WHERE annotations.paper_sha256=papers.sha256)
                   );
                 DELETE FROM papers
                   WHERE NOT EXISTS (SELECT 1 FROM copies WHERE copies.paper_sha256=papers.sha256)
                     AND NOT EXISTS (SELECT 1 FROM annotations WHERE annotations.paper_sha256=papers.sha256);",
            )
            .map_err(|error| error.to_string())?;

        let queued_digests = queued_blob_digests(&transaction)?;
        let blobs = {
            let mut statement = transaction
                .prepare(
                    "SELECT sha256 FROM _local_blobs WHERE NOT EXISTS (\
                       SELECT 1 FROM _local_blob_refs WHERE _local_blob_refs.sha256=_local_blobs.sha256\
                     ) ORDER BY sha256",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            rows.into_iter()
                .filter(|sha256| !queued_digests.contains(sha256))
                .collect::<Vec<_>>()
        };
        for sha256 in &blobs {
            transaction
                .execute("DELETE FROM _local_blobs WHERE sha256=?1", [sha256])
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        drop(connection);
        for sha256 in &blobs {
            self.remove_blob_file(sha256);
        }
        Ok(blobs.len())
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
        if durability.as_deref() != Some("unsynced") {
            return Ok(false);
        }
        let referenced: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM _local_blob_refs WHERE sha256=?1",
                [sha256],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if referenced > 0 || queued_blob_digests(&connection)?.contains(sha256) {
            return Ok(false);
        }
        connection
            .execute("DELETE FROM _local_blobs WHERE sha256=?1", [sha256])
            .map_err(|error| error.to_string())?;
        drop(connection);
        self.remove_blob_file(sha256);
        Ok(true)
    }

    pub fn export_recovery(
        &self,
        account_uuid: &str,
        destination: &Path,
    ) -> Result<RecoveryExport, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Local database lock failed")?;
        let mutations = {
            let mut statement = connection.prepare(
                "SELECT local_sequence,client_uuid,mutation_uuid,changes_json,created_at,attempts,last_error,state \
                 FROM _local_outbox WHERE account_uuid=?1 ORDER BY local_sequence",
            ).map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([account_uuid], |row| {
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
                        "client_uuid": row.get::<_, String>(1)?,
                        "mutation_uuid": row.get::<_, String>(2)?,
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
                    "SELECT table_name,row_uuid,details_json,created_at,resolved_at \
                 FROM _local_conflicts WHERE account_uuid=?1 ORDER BY created_at",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement.query_map([account_uuid], |row| {
                let details: String = row.get(2)?;
                Ok(json!({
                    "table": row.get::<_, String>(0)?,
                    "uuid": row.get::<_, String>(1)?,
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
                if let (Some(table), Some(uuid)) =
                    (change["table"].as_str(), change["uuid"].as_str())
                {
                    if let Ok(row) = read_row(&connection, table, uuid) {
                        recovery_rows.insert(format!("{table}:{uuid}"), row);
                    }
                }
                if let Some(digest) = change["values"]["sha256"].as_str() {
                    digests.insert(digest.to_owned());
                }
            }
        }
        let account = connection
            .query_row(
                "SELECT profile_json FROM _local_accounts WHERE account_uuid=?1",
                [account_uuid],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .and_then(|encoded| serde_json::from_str::<Value>(&encoded).ok());
        let manifest = json!({
            "format": "papol-offline-recovery-v1",
            "exported_at": chrono_text(),
            "account_uuid": account_uuid,
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
        .map(|change| change.uuid.as_str())
        .collect();
    if new_papers.is_empty() {
        return Ok(());
    }
    for paper_sha256 in new_papers {
        let owned_copy = changes.iter().any(|change| {
            change.table == "copies"
                && change.values.get("paper_sha256").and_then(Value::as_str) == Some(paper_sha256)
        });
        if !owned_copy {
            return Err("A local paper import needs an owned copy".into());
        }
    }
    Ok(())
}

fn reject_duplicate_pdf_import(
    connection: &Connection,
    account_uuid: &str,
    changes: &[DataChange],
) -> Result<(), String> {
    // A paper's name is its digest, so the import says which file it is by
    // saying which paper it is.
    for digest in changes
        .iter()
        .filter(|change| change.table == "papers")
        .map(|change| change.uuid.as_str())
    {
        let existing: Option<i64> = connection
            .query_row(
                "SELECT 1 FROM copies JOIN papers ON papers.sha256=copies.paper_sha256 \
                 WHERE copies.user_uuid=?1 AND copies.deleted_at IS NULL \
                 AND papers.sha256=?2 LIMIT 1",
                params![account_uuid, digest],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if existing.is_some() {
            return Err("This PDF is already in your nook".into());
        }
    }
    Ok(())
}

fn local_client_uuid(connection: &Connection) -> Result<String, String> {
    let existing: Option<String> = connection
        .query_row(
            "SELECT value FROM _local_settings WHERE key='sync_client_uuid'",
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
            "INSERT INTO _local_settings(key,value) VALUES ('sync_client_uuid',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [&value],
        )
        .map_err(|error| error.to_string())?;
    Ok(value)
}

fn validate_ownership(
    connection: &Connection,
    account_uuid: &str,
    change: &DataChange,
) -> Result<(), String> {
    if change.table == "copy_tags" {
        for (field, table) in [("copy_uuid", "copies"), ("tag_uuid", "tags")] {
            let parent_uuid = change
                .values
                .get(field)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    connection
                        .query_row(
                            &format!("SELECT {field} FROM copy_tags WHERE uuid=?1"),
                            [&change.uuid],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()
                        .ok()
                        .flatten()
                })
                .ok_or_else(|| format!("copy_tags.{field} is required"))?;
            let owner: Option<String> = connection
                .query_row(
                    &format!("SELECT user_uuid FROM {table} WHERE uuid=?1 AND deleted_at IS NULL"),
                    [parent_uuid],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if owner.as_deref() != Some(account_uuid) {
                return Err("A copy tag can only join rows owned by this account".into());
            }
        }
    }
    if matches!(change.table.as_str(), "boards" | "copies") {
        if let Some(shelf_uuid) = change.values.get("shelf_uuid").and_then(Value::as_str) {
            let owner: Option<String> = connection
                .query_row(
                    "SELECT user_uuid FROM shelves WHERE uuid=?1 AND deleted_at IS NULL",
                    [shelf_uuid],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if owner.as_deref() != Some(account_uuid) {
                return Err("A row can only use a shelf owned by this account".into());
            }
        }
    }
    if matches!(
        change.table.as_str(),
        "annotations" | "copies" | "copy_tags" | "shelves" | "tags"
    ) {
        let owner: Option<String> = connection
            .query_row(
                &format!("SELECT user_uuid FROM {} WHERE uuid=?1", change.table),
                [&change.uuid],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if owner.is_some_and(|owner| owner != account_uuid) {
            return Err("A local mutation cannot modify another account's row".into());
        }
        return Ok(());
    }
    let board_uuid: Option<String> = if change.table == "boards" {
        Some(change.uuid.clone())
    } else {
        change
            .values
            .get("board_uuid")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| {
                connection
                    .query_row(
                        &format!("SELECT board_uuid FROM {} WHERE uuid=?1", change.table),
                        [&change.uuid],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .ok()
                    .flatten()
            })
    };
    if let Some(board_uuid) = board_uuid.as_deref() {
        let owner: Option<String> = connection
            .query_row(
                "SELECT user_uuid FROM boards WHERE uuid=?1",
                [board_uuid],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if owner.is_some_and(|owner| owner != account_uuid) {
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
        let longest = app_limit("text", "paper_title") as usize;
        if title.is_empty() || title.chars().count() > longest {
            return Err(format!("Paper title must be 1–{longest} characters"));
        }
        // A paper is its PDF, so a new one names the file it is.
        if let Some(digest) = change.values.get("sha256").and_then(Value::as_str) {
            if digest.len() != 64 || !digest.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err("A local paper needs a valid SHA-256".into());
            }
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
            let longest = app_limit("text", "shelf_name") as usize;
            if name.trim().is_empty() || name.chars().count() > longest {
                return Err(format!("Shelf name must be 1–{longest} characters"));
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
            let longest = app_limit("text", "tag_name") as usize;
            if name.trim().is_empty() || name.chars().count() > longest {
                return Err(format!("Tag name must be 1–{longest} characters"));
            }
        }
    } else if change.table == "copies" {
        for field in ["rating_expertise", "rating_reading", "rating_liking"] {
            match change.values.get(field) {
                None | Some(Value::Null) => {}
                Some(value)
                    if value.as_i64().is_some_and(|rating| {
                        (app_limit("ratings", "min") as i64..=app_limit("ratings", "max") as i64)
                            .contains(&rating)
                    }) => {}
                Some(_) => {
                    return Err(format!(
                        "Ratings must be whole numbers from {} to {}",
                        app_limit("ratings", "min"),
                        app_limit("ratings", "max")
                    ))
                }
            }
        }
    }
    Ok(())
}

/// The column a table names its rows by.
///
/// A paper is named by the digest of its file — the one name everyone
/// holding those bytes arrives at. Everything else is named by a UUID its
/// writer made up.
fn row_key(table: &str) -> &'static str {
    if table == "papers" {
        "sha256"
    } else {
        "uuid"
    }
}

/// Whether a row id suits the table it names, which is the same question
/// the service asks of a push.
fn valid_row_id(table: &str, id: &str) -> bool {
    if table == "papers" {
        valid_sha256(id)
    } else {
        Uuid::parse_str(id).is_ok()
    }
}

fn validate_local_row(connection: &Connection, table: &str, uuid: &str) -> Result<(), String> {
    if table != "annotations" {
        return Ok(());
    }
    let value = read_row(connection, table, uuid)?;
    let row = value.as_object().ok_or("Invalid annotation row")?;
    let kind = row
        .get("kind")
        .and_then(Value::as_str)
        .ok_or("An annotation needs a kind")?;
    let body: Value = serde_json::from_str(
        row.get("body")
            .and_then(Value::as_str)
            .ok_or("An annotation needs a body")?,
    )
    .map_err(|_| "Invalid annotation body")?;
    let normalized_min = app_decimal_limit("annotations", "normalized_coordinate_min");
    let normalized_max = app_decimal_limit("annotations", "normalized_coordinate_max");
    let on_page = |point: &Value| {
        ["x", "y"].iter().all(|axis| {
            point[*axis]
                .as_f64()
                .is_some_and(|coordinate| (normalized_min..=normalized_max).contains(&coordinate))
        })
    };
    let page = row.get("page").and_then(Value::as_i64);

    if kind == "note" {
        if row
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .count()
            > app_limit("text", "comment") as usize
            || row
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .count()
                > app_limit("text", "annotation_name") as usize
        {
            return Err("Note text is too long".into());
        }
        let anchor = body.get("anchor").filter(|anchor| !anchor.is_null());
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
        if let Some(anchor) = anchor {
            if anchor.get("type").and_then(Value::as_str) != Some("point") {
                return Err("Unknown note anchor type".into());
            }
            if !on_page(anchor) {
                return Err("Note coordinates must be within the page".into());
            }
        }
        return Ok(());
    }

    if page.is_none_or(|page| page < 1) {
        return Err("Annotation page must be positive".into());
    }

    if kind == "ink" {
        let points = body["points"]
            .as_array()
            .ok_or("Ink points must be an array")?;
        if points.is_empty() || points.len() > app_limit("counts", "ink_points") as usize {
            return Err(format!(
                "Ink needs between 1 and {} points",
                app_limit("counts", "ink_points")
            ));
        }
        if !points.iter().all(on_page) {
            return Err("Ink coordinates must be within the page".into());
        }
        let width = body["width"].as_f64().unwrap_or(0.0);
        let opacity = body["opacity"].as_f64().unwrap_or(0.0);
        let color = body["color"].as_str().unwrap_or("");
        if !(0.0 < width
            && width <= app_decimal_limit("annotations", "ink_width_max")
            && 0.0 < opacity
            && opacity <= 1.0
            && color.len() == 7
            && color.starts_with('#')
            && color[1..]
                .chars()
                .all(|character| character.is_ascii_hexdigit())
            && matches!(body["shape"].as_str(), Some("flat" | "round")))
        {
            return Err("Invalid ink style".into());
        }
        return Ok(());
    }

    if kind != "clip" {
        return Err("Unknown annotation kind".into());
    }
    let number = |value: &Value, key: &str| value[key].as_f64();
    let (source, frame) = (&body["source"], &body["frame"]);
    let (sx, sy, sw, sh) = (
        number(source, "x"),
        number(source, "y"),
        number(source, "w"),
        number(source, "h"),
    );
    if !matches!((sx, sy, sw, sh), (Some(x), Some(y), Some(w), Some(h))
        if (normalized_min..=normalized_max).contains(&x)
        && (normalized_min..=normalized_max).contains(&y)
        && w > 0.0 && h > 0.0 && x + w <= 1.000001 && y + h <= 1.000001)
    {
        return Err("Clip source must stay within its page".into());
    }
    let (fx, fy, fw, fh) = (
        number(frame, "x"),
        number(frame, "y"),
        number(frame, "w"),
        number(frame, "h"),
    );
    let coordinate_max = app_decimal_limit("annotations", "clip_frame_coordinate_abs_max");
    if !matches!((fx, fy, fw, fh), (Some(x), Some(y), Some(w), Some(h))
        if (-coordinate_max..=coordinate_max).contains(&x)
        && (-coordinate_max..=coordinate_max).contains(&y)
        && w > 0.0
        && w <= app_decimal_limit("annotations", "clip_frame_size_max")
        && h > 0.0
        && h <= app_decimal_limit("annotations", "clip_frame_size_max"))
    {
        return Err("Invalid clip frame".into());
    }
    Ok(())
}

fn validate_remote_ownership(
    connection: &Connection,
    account_uuid: &str,
    table: &str,
    row: &Map<String, Value>,
) -> Result<(), String> {
    if table == "boards" {
        if row.get("user_uuid").and_then(Value::as_str) != Some(account_uuid) {
            return Err("Server returned a board for a different account".into());
        }
        return Ok(());
    }
    if table == "papers" {
        return Ok(());
    }
    if matches!(
        table,
        "annotations" | "copies" | "copy_tags" | "shelves" | "tags"
    ) {
        if row.get("user_uuid").and_then(Value::as_str) != Some(account_uuid) {
            return Err("Server returned an annotation for a different account".into());
        }
        return Ok(());
    }
    if !matches!(table, "board_groups" | "board_items") {
        return Err(format!("Server sent an unregistered table: {table}"));
    }
    let board_uuid = row
        .get("board_uuid")
        .and_then(Value::as_str)
        .ok_or("Server child row is missing its board")?;
    let owner: Option<String> = connection
        .query_row(
            "SELECT user_uuid FROM boards WHERE uuid=?1",
            [board_uuid],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if owner.as_deref() != Some(account_uuid) {
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
    account_uuid: &str,
    aliases: &Map<String, Value>,
) -> Result<(), String> {
    // Collapse the most dependent identities first. A duplicate imported
    // copy may still point at the temporary paper ID; removing/merging it
    // before the paper alias avoids violating UNIQUE(paper_sha256,user_uuid).
    for (old_uuid, new_value) in aliases {
        let new_uuid = new_value
            .as_str()
            .ok_or("Server alias target must be a UUID")?;
        let old_exists: Option<i64> = transaction
            .query_row("SELECT 1 FROM copy_tags WHERE uuid=?1", [old_uuid], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if old_exists.is_none() {
            continue;
        }
        let canonical_exists: Option<i64> = transaction
            .query_row("SELECT 1 FROM copy_tags WHERE uuid=?1", [new_uuid], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if canonical_exists.is_some() {
            transaction
                .execute("DELETE FROM copy_tags WHERE uuid=?1", [old_uuid])
                .map_err(|error| error.to_string())?;
        } else {
            transaction
                .execute(
                    "UPDATE copy_tags SET uuid=?1 WHERE uuid=?2",
                    params![new_uuid, old_uuid],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    for (old_uuid, new_value) in aliases {
        let new_uuid = new_value
            .as_str()
            .ok_or("Server alias target must be a UUID")?;
        let old_exists: Option<i64> = transaction
            .query_row("SELECT 1 FROM copies WHERE uuid=?1", [old_uuid], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if old_exists.is_none() {
            continue;
        }
        let canonical_exists: Option<i64> = transaction
            .query_row("SELECT 1 FROM copies WHERE uuid=?1", [new_uuid], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if canonical_exists.is_some() {
            transaction
                .execute(
                    "DELETE FROM copy_tags WHERE copy_uuid=?1 AND tag_uuid IN \
                 (SELECT tag_uuid FROM copy_tags WHERE copy_uuid=?2)",
                    params![old_uuid, new_uuid],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction
            .execute(
                "UPDATE copy_tags SET copy_uuid=?1 WHERE copy_uuid=?2",
                params![new_uuid, old_uuid],
            )
            .map_err(|error| error.to_string())?;
        if canonical_exists.is_some() {
            transaction
                .execute("DELETE FROM copies WHERE uuid=?1", [old_uuid])
                .map_err(|error| error.to_string())?;
        } else {
            transaction
                .execute(
                    "UPDATE copies SET uuid=?1 WHERE uuid=?2",
                    params![new_uuid, old_uuid],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    for (old_uuid, new_value) in aliases {
        let new_uuid = new_value
            .as_str()
            .ok_or("Server alias target must be a UUID")?;
        Uuid::parse_str(new_uuid).map_err(|_| "Server alias target must be a UUID")?;
        let old_paper: Option<i64> = transaction
            .query_row("SELECT 1 FROM papers WHERE sha256=?1", [old_uuid], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if old_paper.is_none() {
            continue;
        }
        let canonical_exists: Option<i64> = transaction
            .query_row("SELECT 1 FROM papers WHERE sha256=?1", [new_uuid], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if canonical_exists.is_none() {
            transaction
                .execute(
                    "UPDATE papers SET sha256=?1 WHERE sha256=?2",
                    params![new_uuid, old_uuid],
                )
                .map_err(|error| error.to_string())?;
        }
        for (table, column) in [("copies", "paper_sha256"), ("annotations", "paper_sha256")] {
            transaction
                .execute(
                    &format!("UPDATE {table} SET {column}=?1 WHERE {column}=?2"),
                    params![new_uuid, old_uuid],
                )
                .map_err(|error| error.to_string())?;
        }
        // The canonical paper can already have a blob reference when a
        // snapshot introduced it before this offline import was pushed.
        // Rebuild the reference under the canonical identity instead of
        // renaming the temporary row into the same primary key.
        transaction
            .execute(
                "DELETE FROM _local_blob_refs WHERE table_name='papers' AND row_uuid=?1",
                [old_uuid],
            )
            .map_err(|error| error.to_string())?;
        refresh_blob_reference(transaction, "papers", new_uuid)?;
        if canonical_exists.is_some() {
            transaction
                .execute("DELETE FROM papers WHERE sha256=?1", [old_uuid])
                .map_err(|error| error.to_string())?;
        }
    }
    let mut statement = transaction
        .prepare("SELECT local_sequence,changes_json FROM _local_outbox WHERE account_uuid=?1")
        .map_err(|error| error.to_string())?;
    let queued = statement
        .query_map([account_uuid], |row| {
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
            if let Some(target) = aliases.get(&change.uuid).and_then(Value::as_str) {
                change.uuid = target.to_owned();
                changed = true;
            }
            for value in change.values.values_mut() {
                if let Some(target) = value.as_str().and_then(|uuid| aliases.get(uuid)) {
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
    row_uuid: &str,
) -> Result<(), String> {
    match table {
        "board_items" | "papers" => {}
        _ => return Ok(()),
    }
    connection
        .execute(
            "DELETE FROM _local_blob_refs WHERE table_name=?1 AND row_uuid=?2",
            params![table, row_uuid],
        )
        .map_err(|error| error.to_string())?;
    let reference: Option<(Option<String>, Option<String>)> = connection
        .query_row(
            &format!(
                "SELECT sha256,deleted_at FROM {table} WHERE {}=?1",
                row_key(table)
            ),
            [row_uuid],
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
                    "INSERT INTO _local_blob_refs(table_name,row_uuid,sha256) VALUES (?1,?2,?3)",
                    params![table, row_uuid, sha256],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn queued_blob_digests(connection: &Connection) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare("SELECT changes_json FROM _local_outbox")
        .map_err(|error| error.to_string())?;
    let encoded = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut digests = HashSet::new();
    for value in encoded {
        let changes: Vec<QueuedChange> =
            serde_json::from_str(&value).map_err(|error| error.to_string())?;
        for change in changes {
            for value in change.values.values() {
                if let Some(digest) = value.as_str().filter(|value| value.len() == 64) {
                    digests.insert(digest.to_owned());
                }
            }
        }
    }
    Ok(digests)
}

fn refresh_blob_references_for_digest(connection: &Connection, sha256: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR REPLACE INTO _local_blob_refs(table_name,row_uuid,sha256) \
             SELECT 'board_items',uuid,sha256 FROM board_items \
             WHERE sha256=?1 AND deleted_at IS NULL",
            [sha256],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR REPLACE INTO _local_blob_refs(table_name,row_uuid,sha256) \
             SELECT 'papers',sha256,sha256 FROM papers \
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
    authoritative: bool,
) -> Result<(), String> {
    // A column the table does not have, or a row without its name or
    // revision, is refused by the INSERT itself.
    let mut fields: BTreeMap<String, SqlValue> = row
        .iter()
        .map(|(key, value)| Ok((key.clone(), json_to_sql(value)?)))
        .collect::<Result<_, String>>()?;
    let names: Vec<_> = fields.keys().cloned().collect();
    let placeholders: Vec<_> = (1..=names.len()).map(|index| format!("?{index}")).collect();
    let updates: Vec<_> = names
        .iter()
        .filter(|name| name.as_str() != "uuid")
        .map(|name| format!("{name}=excluded.{name}"))
        .collect();
    let values: Vec<_> = names
        .iter()
        .map(|name| fields.remove(name).unwrap())
        .collect();
    let revision_guard = if authoritative {
        String::new()
    } else {
        format!(" WHERE excluded.revision >= {table}.revision")
    };
    transaction
        .execute(
            &format!(
                "INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT({}) DO UPDATE SET {}{}",
                names.join(","),
                placeholders.join(","),
                row_key(table),
                updates.join(","),
                revision_guard,
            ),
            params_from_iter(values),
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_local_change(
    transaction: &rusqlite::Transaction<'_>,
    account_uuid: &str,
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
                    "UPDATE {} SET deleted_at=?1,updated_at=?1,revision=?2 WHERE uuid=?3",
                    change.table
                ),
                params![now, revision, change.uuid],
            )
            .map_err(|error| error.to_string())?;
        touch_parent_board(transaction, change, &now)?;
        return Ok(());
    }
    if change.operation != "upsert" {
        return Err("Operation must be upsert or delete".into());
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
        fields.insert(
            row_key(&change.table).into(),
            SqlValue::Text(change.uuid.clone()),
        );
        fields.insert("created_at".into(), SqlValue::Text(now));
        if matches!(
            change.table.as_str(),
            "boards" | "annotations" | "copies" | "copy_tags" | "shelves" | "tags"
        ) {
            fields.insert("user_uuid".into(), SqlValue::Text(account_uuid.to_owned()));
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
        values.push(SqlValue::Text(change.uuid.clone()));
        transaction
            .execute(
                &format!(
                    "UPDATE {} SET {} WHERE uuid=?{}",
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
                "UPDATE boards SET updated_at=?1 WHERE uuid=(SELECT board_uuid FROM {} WHERE uuid=?2)",
                change.table
            ),
            params![now, change.uuid],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn read_row(connection: &Connection, table: &str, uuid: &str) -> Result<Value, String> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT * FROM {table} WHERE {}=?1",
            row_key(table)
        ))
        .map_err(|error| error.to_string())?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| (*name).into())
        .collect();
    statement
        .query_row([uuid], |row| {
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

fn query_boards(connection: &Connection, account_uuid: &str) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT uuid FROM boards WHERE user_uuid=?1 AND deleted_at IS NULL ORDER BY updated_at DESC,uuid")
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([account_uuid], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|uuid| {
            let mut board = read_row(connection, "boards", &uuid)?;
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM board_items WHERE board_uuid=?1 AND deleted_at IS NULL AND staged=0",
                    [&uuid],
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

fn query_board(connection: &Connection, account_uuid: &str, uuid: &str) -> Result<Value, String> {
    let owner: Option<String> = connection
        .query_row(
            "SELECT user_uuid FROM boards WHERE uuid=?1 AND deleted_at IS NULL",
            [uuid],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if owner.as_deref() != Some(account_uuid) {
        return Err("Board not found".into());
    }
    let mut board = read_row(connection, "boards", uuid)?;
    let object = board.as_object_mut().ok_or("Invalid local board")?;
    object.insert("items".into(), query_items(connection, uuid, false)?);
    object.insert("staged_items".into(), query_items(connection, uuid, true)?);
    object.insert("groups".into(), query_groups(connection, uuid)?);
    Ok(board)
}

fn query_items(connection: &Connection, board_uuid: &str, staged: bool) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT uuid FROM board_items WHERE board_uuid=?1 AND deleted_at IS NULL AND staged=?2 ORDER BY created_at,uuid")
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map(params![board_uuid, staged], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|uuid| read_row(connection, "board_items", &uuid))
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn query_groups(connection: &Connection, board_uuid: &str) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT uuid FROM board_groups WHERE board_uuid=?1 AND deleted_at IS NULL ORDER BY created_at,uuid")
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([board_uuid], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|uuid| {
            let mut group = read_row(connection, "board_groups", &uuid)?;
            let mut members = connection
                .prepare("SELECT uuid FROM board_items WHERE group_uuid=?1 AND deleted_at IS NULL ORDER BY position,created_at,uuid")
                .map_err(|error| error.to_string())?;
            let item_uuids = members
                .query_map([&uuid], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            group.as_object_mut().ok_or("Invalid local group")?.insert(
                "item_uuids".into(),
                Value::Array(item_uuids.into_iter().map(Value::String).collect()),
            );
            Ok(group)
        })
        .collect::<Result<Vec<_>, String>>()
        .map(Value::Array)
}

fn query_board_group(
    connection: &Connection,
    account_uuid: &str,
    uuid: &str,
) -> Result<Value, String> {
    let board_uuid: Option<String> = connection
        .query_row(
            "SELECT board_uuid FROM board_groups WHERE uuid=?1 AND deleted_at IS NULL",
            [uuid],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let board_uuid = board_uuid.ok_or("Board group not found")?;
    let owner: String = connection
        .query_row(
            "SELECT user_uuid FROM boards WHERE uuid=?1",
            [&board_uuid],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if owner != account_uuid {
        return Err("Board group not found".into());
    }
    Ok(json!({
        "group": read_row(connection, "board_groups", uuid)?,
        "items": query_group_items(connection, uuid)?,
    }))
}

fn query_group_items(connection: &Connection, group_uuid: &str) -> Result<Value, String> {
    let mut statement = connection
        .prepare("SELECT uuid FROM board_items WHERE group_uuid=?1 AND deleted_at IS NULL ORDER BY position,created_at,uuid")
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([group_uuid], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|uuid| read_row(connection, "board_items", &uuid))
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn query_annotations(
    connection: &Connection,
    account_uuid: &str,
    parameters: Value,
) -> Result<Value, String> {
    let asked = parameters["paper_sha256"]
        .as_str()
        .ok_or("Annotation query requires paper_sha256")?;
    // A paper opened from a link is asked for by the name the link carried,
    // which may be the short one. Resolve it, and where it resolves to nothing
    // ask as given: a name no paper here answers to has no annotations here
    // either, and an empty list says that better than an error does.
    let paper_sha256 = resolve_paper_name(connection, asked).unwrap_or_else(|_| asked.to_string());
    let paper_sha256 = paper_sha256.as_str();
    let kind = parameters["kind"].as_str();
    let mut sql = String::from(
        "SELECT uuid FROM annotations WHERE user_uuid=?1 AND paper_sha256=?2 AND deleted_at IS NULL",
    );
    let mut bound: Vec<&str> = vec![account_uuid, paper_sha256];
    if let Some(kind) = kind {
        bound.push(kind);
        sql.push_str(&format!(" AND kind=?{}", bound.len()));
    }
    sql.push_str(" ORDER BY created_at,uuid");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map(rusqlite::params_from_iter(bound), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let rows = ids
        .into_iter()
        .map(|uuid| {
            let mut value = read_row(connection, "annotations", &uuid)?;
            let row = value.as_object_mut().ok_or("Invalid annotation row")?;
            // One column of geometry now, whatever the kind. An anchor
            // carries its own `type`, so nothing has to be reassembled from
            // a second column on the way out.
            if let Some(encoded) = row.get("body").and_then(Value::as_str).map(str::to_owned) {
                row.insert(
                    "body".into(),
                    serde_json::from_str(&encoded).map_err(|_| "Invalid local annotation JSON")?,
                );
            }
            Ok(value)
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Value::Array(rows))
}

fn query_owned_rows(
    connection: &Connection,
    account_uuid: &str,
    table: &str,
    order: &str,
) -> Result<Value, String> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT uuid FROM {table} WHERE user_uuid=?1 AND deleted_at IS NULL ORDER BY {order}"
        ))
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([account_uuid], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    ids.into_iter()
        .map(|uuid| read_row(connection, table, &uuid))
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn query_nook(connection: &Connection, account_uuid: &str) -> Result<Value, String> {
    Ok(json!({
        "shelves": query_owned_rows(connection, account_uuid, "shelves", "position,name,uuid")?,
        "tags": query_owned_rows(connection, account_uuid, "tags", "name,uuid")?,
        "copies": query_owned_rows(connection, account_uuid, "copies", "updated_at DESC,uuid")?,
        "copy_tags": query_owned_rows(connection, account_uuid, "copy_tags", "created_at,uuid")?,
    }))
}

fn paper_view(
    connection: &Connection,
    account_uuid: &str,
    paper_sha256: &str,
) -> Result<Value, String> {
    let copy_uuid: String = connection
        .query_row(
            "SELECT uuid FROM copies WHERE user_uuid=?1 AND paper_sha256=?2 AND deleted_at IS NULL",
            params![account_uuid, paper_sha256],
            |row| row.get(0),
        )
        .map_err(|_| "Paper not found".to_string())?;
    let mut paper = read_row(connection, "papers", paper_sha256)?;
    let copy = read_row(connection, "copies", &copy_uuid)?;
    let object = paper.as_object_mut().ok_or("Invalid local paper")?;
    let copy = copy.as_object().ok_or("Invalid local copy")?;
    object.insert("copy_uuid".into(), json!(copy_uuid));
    for field in [
        "shelf_uuid",
        "summary",
        "thought",
        "is_author",
        "rating_expertise",
        "rating_reading",
        "rating_liking",
    ] {
        object.insert(
            field.into(),
            copy.get(field).cloned().unwrap_or(Value::Null),
        );
    }
    let mut statement = connection
        .prepare(
            "SELECT tags.uuid FROM copy_tags JOIN tags ON tags.uuid=copy_tags.tag_uuid \
         WHERE copy_tags.copy_uuid=?1 AND copy_tags.deleted_at IS NULL AND tags.deleted_at IS NULL \
         ORDER BY tags.name,tags.uuid",
        )
        .map_err(|error| error.to_string())?;
    let tag_uuids = statement
        .query_map([&copy_uuid], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    object.insert(
        "tags".into(),
        Value::Array(
            tag_uuids
                .into_iter()
                .map(|uuid| read_row(connection, "tags", &uuid))
                .collect::<Result<Vec<_>, _>>()?,
        ),
    );
    object.insert(
        "is_public".into(),
        Value::Bool(copy_is_public(connection, copy)?),
    );
    Ok(paper)
}

/// Whether a copy is on display, which is its shelf's answer and only ever
/// the shelf's. A copy on no shelf — or on one already gone — is on no
/// display: there is nothing standing behind it.
fn copy_is_public(connection: &Connection, copy: &Map<String, Value>) -> Result<bool, String> {
    let Some(shelf_uuid) = copy.get("shelf_uuid").and_then(Value::as_str) else {
        return Ok(false);
    };
    connection
        .query_row(
            "SELECT is_public FROM shelves WHERE uuid=?1 AND deleted_at IS NULL",
            params![shelf_uuid],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())
        .map(|value| value == Some(1))
}

fn query_papers(connection: &Connection, account_uuid: &str) -> Result<Value, String> {
    let mut statement = connection.prepare(
        "SELECT paper_sha256,created_at FROM copies WHERE user_uuid=?1 AND deleted_at IS NULL ORDER BY created_at DESC,uuid"
    ).map_err(|error| error.to_string())?;
    let copies = statement
        .query_map([account_uuid], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    copies
        .into_iter()
        .map(|(uuid, added_at)| {
            let mut paper = paper_view(connection, account_uuid, &uuid)?;
            let object = paper.as_object_mut().ok_or("Invalid local paper")?;
            // Paper lists use the copy's creation time: that is when this
            // user added the paper to their nook. The canonical paper's
            // creation time can be much older (or newer after a merge).
            object.insert("created_at".into(), json!(added_at));
            Ok(paper)
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

// The name a paper goes by outside the database: the first half of its digest.
// One shape and no other, so there is nothing here to decide. What this hands
// back is the stored name — nothing past here holds half of one.
//
// Two papers sharing one name would be a bug rather than a coincidence at 128
// bits, so an ambiguous name is refused rather than settled by picking one.
fn resolve_paper_name(connection: &Connection, name: &str) -> Result<String, String> {
    let name = name.trim().to_ascii_lowercase();
    if name.len() != 32 || !name.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("Paper not found".to_string());
    }
    // A prefix range rather than LIKE: it reads straight off the primary key,
    // and no character of a digest can be a wildcard.
    let mut statement = connection
        .prepare("SELECT sha256 FROM papers WHERE sha256>=?1 AND sha256<?2 LIMIT 2")
        .map_err(|error| error.to_string())?;
    let mut found: Vec<String> = Vec::new();
    let rows = statement
        .query_map(params![name, format!("{name}g")], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    for row in rows {
        found.push(row.map_err(|error| error.to_string())?);
    }
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err("Paper not found".to_string()),
        _ => Err("That name means more than one paper".to_string()),
    }
}

fn query_paper(connection: &Connection, account_uuid: &str, uuid: &str) -> Result<Value, String> {
    let paper_sha256 = resolve_paper_name(connection, uuid)?;
    paper_view(connection, account_uuid, &paper_sha256)
}

fn query_sync_status(connection: &Connection, account_uuid: &str) -> Result<Value, String> {
    let (cursor, last_synced_at, error): (i64, Option<String>, Option<String>) = connection
        .query_row(
            "SELECT pull_cursor,last_synced_at,last_error FROM _local_sync_state \
             WHERE account_uuid=?1",
            [account_uuid],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or((0, None, None));
    // The outbox in one pass: how much is waiting, how much of that is
    // blocked, and what the first mutation that failed had to say.
    let (pending, blocked, attempts, outbox_error): (i64, i64, i64, Option<String>) = connection
        .query_row(
            "SELECT COUNT(*),COALESCE(SUM(state='blocked'),0),\
             COALESCE((SELECT attempts FROM _local_outbox WHERE account_uuid=?1 \
               AND last_error IS NOT NULL ORDER BY local_sequence LIMIT 1),0),\
             (SELECT last_error FROM _local_outbox WHERE account_uuid=?1 \
               AND last_error IS NOT NULL ORDER BY local_sequence LIMIT 1) \
             FROM _local_outbox WHERE account_uuid=?1",
            [account_uuid],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|error| error.to_string())?;
    let conflicts: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM _local_conflicts WHERE account_uuid=?1 AND resolved_at IS NULL",
            [account_uuid],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "pending": pending,
        "cursor": cursor,
        "last_synced_at": last_synced_at,
        "error": error,
        "conflicts": conflicts,
        "attempts": attempts,
        "outbox_error": outbox_error,
        "blocked": blocked,
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
    for durability in ["unsynced", "cache"] {
        let (bytes, files) = rows
            .iter()
            .find(|(name, _, _)| name == durability)
            .map(|(_, bytes, files)| (*bytes, *files))
            .unwrap_or((0, 0));
        totals.insert(durability.into(), json!({"bytes": bytes, "files": files}));
    }
    Ok(json!({"classes": totals}))
}

/// The profile of the account signed in on this computer, or null when
/// the replica holds none.
///
/// It holds none when nobody has signed in here, and when a newer build has
/// discarded a replica an older one wrote — the profile is written at
/// sign-in and goes with the rest. Either way that is an answer, not a
/// failure: the caller decides what a computer with no signed-in account
/// does next.
fn query_local_account(connection: &Connection, account_uuid: &str) -> Result<Value, String> {
    let encoded: Option<String> = connection
        .query_row(
            "SELECT profile_json FROM _local_accounts WHERE account_uuid=?1",
            [account_uuid],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match encoded {
        None => Ok(Value::Null),
        Some(encoded) => {
            serde_json::from_str(&encoded).map_err(|_| "Local account profile is invalid".into())
        }
    }
}

/// A replica opened the way Papol reads one.
fn open_connection(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

/// Throw away a replica written under a schema this build has never had.
///
/// The write-ahead log and its shared-memory file go with it. Left behind,
/// SQLite would replay them into the empty file that follows and put back
/// part of the shape just discarded — a replica half of one schema and half
/// of another, which is worse than either.
///
/// The cached files go too. What named them was the table that has just
/// gone, so keeping them would leave bytes on this computer that nothing
/// can account for. Every one of them is named by its own digest and can be
/// fetched again.
fn discard_replica(path: &Path, blob_directory: &Path) -> Result<(), String> {
    let cannot = |error: std::io::Error| {
        format!("A replica from an older Papol could not be discarded: {error}")
    };
    for suffix in ["", "-wal", "-shm"] {
        let mut name = path.as_os_str().to_owned();
        name.push(suffix);
        let file = PathBuf::from(name);
        match std::fs::remove_file(&file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(cannot(error)),
        }
    }
    match std::fs::remove_dir_all(blob_directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(cannot(error)),
    }
    std::fs::create_dir_all(blob_directory).map_err(cannot)
}

pub(crate) fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
}

fn chrono_text() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A library from before anybody was counting schema versions — which
    /// is to say at version 1 — as an older Papol left it: a paper named by
    /// a UUID, notes and ink in tables of their own, and the migration ids
    /// that carried it recorded as applied.
    fn replica_from_an_older_papol(path: &Path) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE _local_schema_migrations (\
                   migration_id TEXT PRIMARY KEY NOT NULL,\
                   applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);\
                 INSERT INTO _local_schema_migrations (migration_id) \
                   VALUES ('202609120001_domain');\
                 CREATE TABLE papers (uuid TEXT PRIMARY KEY NOT NULL, title TEXT);\
                 CREATE TABLE paper_editions (uuid TEXT PRIMARY KEY NOT NULL);\
                 CREATE TABLE comments (uuid TEXT PRIMARY KEY NOT NULL);\
                 INSERT INTO papers VALUES ('an-old-name', 'Named by a UUID');\
                 CREATE TABLE _local_accounts (\
                   account_uuid TEXT PRIMARY KEY NOT NULL,\
                   profile_json TEXT NOT NULL,\
                   updated_at TEXT NOT NULL);\
                 INSERT INTO _local_accounts VALUES \
                   ('7', '{\"uuid\":\"7\",\"display_name\":\"Signed in\"}', '');",
            )
            .unwrap();
    }

    #[test]
    fn a_replica_from_an_older_papol_is_discarded_rather_than_read() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        replica_from_an_older_papol(&path);
        let stale_blob = directory.path().join("blobs");
        std::fs::create_dir_all(&stale_blob).unwrap();
        std::fs::write(stale_blob.join("deadbeef"), b"cached under the old schema").unwrap();

        let store = LocalStore::open(&path).unwrap();

        let connection = store.connection.lock().unwrap();
        // The shape is today's: a paper is named by the digest of its PDF.
        let keys: Vec<String> = connection
            .prepare("SELECT name FROM pragma_table_info('papers') WHERE pk=1")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(keys, vec!["sha256".to_string()]);
        // Nothing of the old replica is carried across — not its rows, not
        // the tables it had that Papol no longer has, not its cached files.
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM papers", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0,
        );
        for gone in ["paper_editions", "comments", "_local_schema_migrations"] {
            assert!(
                connection
                    .query_row(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                        [gone],
                        |_| Ok(true),
                    )
                    .optional()
                    .unwrap()
                    .is_none(),
                "{gone} should have gone with the library that had it",
            );
        }
        assert!(!stale_blob.join("deadbeef").exists());
    }

    /// The profile was written at sign-in, so it went with the replica.
    /// What is left is a computer nobody has signed in on, which is an
    /// answer the shell acts on — not a failure to report.
    #[test]
    fn a_discarded_replica_no_longer_says_who_was_signed_in() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        replica_from_an_older_papol(&path);

        let store = LocalStore::open(&path).unwrap();

        assert_eq!(store.query("7", "account", json!({})).unwrap(), Value::Null);
        store
            .set_local_account("7", json!({"uuid": "7", "display_name": "Back"}))
            .unwrap();
        assert_eq!(
            store.query("7", "account", json!({})).unwrap()["display_name"],
            json!("Back"),
        );
    }

    #[test]
    fn a_replica_this_build_wrote_is_opened_rather_than_discarded() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let uuid = Uuid::new_v4().to_string();
        let store = LocalStore::open(&path).unwrap();
        store
            .mutate("7", vec![board_change(&uuid, "Kept")])
            .unwrap();
        drop(store);

        let store = LocalStore::open(&path).unwrap();

        assert_eq!(
            store.query("7", "board", json!({"uuid": uuid})).unwrap()["name"],
            json!("Kept"),
        );
    }

    fn board_change(uuid: &str, name: &str) -> DataChange {
        DataChange {
            table: "boards".into(),
            uuid: uuid.into(),
            operation: "upsert".into(),
            values: Map::from_iter([("name".into(), Value::String(name.into()))]),
        }
    }

    fn pdf_import_changes(sha256: &str, title: &str) -> Vec<DataChange> {
        // The paper is named by the file, so the import does not invent a
        // name for it — it reads one off the bytes it just stored.
        vec![
            DataChange {
                table: "papers".into(),
                uuid: sha256.to_owned(),
                operation: "upsert".into(),
                values: Map::from_iter([
                    ("title".into(), json!(title)),
                    ("file_path".into(), json!(format!("{sha256}.pdf"))),
                ]),
            },
            DataChange {
                table: "copies".into(),
                uuid: Uuid::new_v4().to_string(),
                operation: "upsert".into(),
                values: Map::from_iter([("paper_sha256".into(), json!(sha256))]),
            },
        ]
    }

    fn remote_board(uuid: &str, revision: i64, name: &str) -> Map<String, Value> {
        Map::from_iter([
            ("uuid".into(), json!(uuid)),
            ("user_uuid".into(), json!("7")),
            ("shelf_uuid".into(), Value::Null),
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
        let uuid = Uuid::new_v4().to_string();
        let store = LocalStore::open(&path).unwrap();
        let receipt = store
            .mutate("7", vec![board_change(&uuid, "Offline")])
            .unwrap();
        assert_eq!(receipt.local_sequence, 1);
        assert_eq!(store.outbox_count(), 1);
        assert_eq!(
            store.query("7", "boards", json!({})).unwrap()[0]["uuid"],
            uuid
        );

        drop(store);
        let reopened = LocalStore::open(&path).unwrap();
        assert_eq!(reopened.outbox_count(), 1);
        assert_eq!(
            reopened.query("7", "board", json!({"uuid": uuid})).unwrap()["name"],
            "Offline"
        );
    }

    #[test]
    fn paper_list_is_ordered_by_when_each_copy_was_added_to_the_nook() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let older_paper_sha256 = "a".repeat(64);
        let newer_paper_sha256 = "b".repeat(64);
        let first_copy_uuid = Uuid::new_v4().to_string();
        let second_copy_uuid = Uuid::new_v4().to_string();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO papers(sha256,title,file_path,created_at,updated_at) \
                     VALUES (?1,'Canonical old','old.pdf',?2,?2)",
                    params![older_paper_sha256, "2025-01-01T00:00:00Z"],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO papers(sha256,title,file_path,created_at,updated_at) \
                     VALUES (?1,'Canonical new','new.pdf',?2,?2)",
                    params![newer_paper_sha256, "2026-08-01T00:00:00Z"],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO copies(uuid,paper_sha256,user_uuid,created_at,updated_at) VALUES (?1,?2,'7',?3,?3)",
                    params![first_copy_uuid, newer_paper_sha256, "2026-08-02T00:00:00Z"],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO copies(uuid,paper_sha256,user_uuid,created_at,updated_at) VALUES (?1,?2,'7',?3,?3)",
                    params![second_copy_uuid, older_paper_sha256, "2026-09-01T00:00:00Z"],
                )
                .unwrap();
        }

        let papers = store.query("7", "papers", json!({})).unwrap();
        assert_eq!(papers[0]["sha256"], older_paper_sha256);
        assert_eq!(papers[0]["created_at"], "2026-09-01T00:00:00Z");
        assert_eq!(papers[1]["sha256"], newer_paper_sha256);
        assert_eq!(papers[1]["created_at"], "2026-08-02T00:00:00Z");
    }

    #[test]
    fn a_patch_enqueues_the_complete_writable_row() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let paper_sha256 = "e".repeat(64);
        let stroke_uuid = Uuid::new_v4().to_string();
        let now = chrono_text();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO papers(sha256,title,file_path,created_at,updated_at,revision) \
                     VALUES (?1,'Paper','paper.pdf',?2,?2,1)",
                    params![paper_sha256, now],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO annotations(uuid,kind,user_uuid,paper_sha256,page,body,created_at,updated_at,revision) \
                     VALUES (?1,'ink','7',?2,2,\
                     '{\"points\":[{\"x\":0.1,\"y\":0.2}],\"color\":\"#111111\",\"width\":0.01,\"opacity\":0.8,\"shape\":\"flat\"}',\
                     ?3,?3,1)",
                    params![stroke_uuid, paper_sha256, now],
                )
                .unwrap();
        }

        store
            .mutate(
                "7",
                vec![DataChange {
                    table: "annotations".into(),
                    uuid: stroke_uuid,
                    operation: "upsert".into(),
                    values: Map::from_iter([(
                        "body".into(),
                        json!(json!({
                            "points": [{"x": 0.1, "y": 0.2}],
                            "color": "#222222",
                            "width": 0.01,
                            "opacity": 0.8,
                            "shape": "flat",
                        })
                        .to_string()),
                    )]),
                }],
            )
            .unwrap();
        let queued = store.next_outbox("7").unwrap().unwrap();
        let values = &queued.changes[0].values;
        for field in [
            "kind",
            "paper_sha256",
            "group_uuid",
            "page",
            "content",
            "name",
            "body",
            "deleted_at",
        ] {
            assert!(values.contains_key(field), "missing {field}");
        }
        assert_eq!(values["kind"], "ink");
        assert!(values["body"].as_str().unwrap().contains("#222222"));
    }

    #[test]
    fn every_table_restates_its_whole_row_including_untouched_fields() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_uuid = Uuid::new_v4().to_string();
        let now = chrono_text();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO boards(uuid,user_uuid,name,description,created_at,updated_at,revision) \
                     VALUES (?1,'7','Named','Described',?2,?2,1)",
                    params![board_uuid, now],
                )
                .unwrap();
        }

        store
            .mutate(
                "7",
                vec![DataChange {
                    table: "boards".into(),
                    uuid: board_uuid,
                    operation: "upsert".into(),
                    values: Map::from_iter([("name".into(), json!("Renamed"))]),
                }],
            )
            .unwrap();

        // `boards` chose field-level merging before the registry stopped
        // offering the choice. One rule now: the writer restates the row,
        // so the untouched description travels with the new name.
        let queued = store.next_outbox("7").unwrap().unwrap();
        let values = &queued.changes[0].values;
        for field in ["name", "description", "shelf_uuid", "deleted_at"] {
            assert!(values.contains_key(field), "missing {field}");
        }
        assert_eq!(values["name"], "Renamed");
        assert_eq!(values["description"], "Described");
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
        assert!(store.mutate("7", vec![first, invalid]).is_err());
        assert_eq!(store.outbox_count(), 0);
        assert_eq!(store.query("7", "boards", json!({})).unwrap(), json!([]));
    }

    #[test]
    fn account_ownership_is_enforced_locally() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let uuid = Uuid::new_v4().to_string();
        store
            .mutate("7", vec![board_change(&uuid, "Mine")])
            .unwrap();
        let update = DataChange {
            table: "boards".into(),
            uuid,
            operation: "upsert".into(),
            values: Map::from_iter([("name".into(), Value::String("Not mine".into()))]),
        };
        assert!(store.mutate("8", vec![update]).is_err());
    }

    #[test]
    fn blocked_mutation_does_not_freeze_later_unrelated_work() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let first = store
            .mutate("7", vec![board_change(&Uuid::new_v4().to_string(), "Bad")])
            .unwrap();
        let second = store
            .mutate("7", vec![board_change(&Uuid::new_v4().to_string(), "Good")])
            .unwrap();
        store
            .record_outbox_error("7", first.local_sequence, "422 Unprocessable Entity", true)
            .unwrap();
        let next = store.next_outbox("7").unwrap().unwrap();
        assert_eq!(next.local_sequence, second.local_sequence);
        let status = store.query("7", "sync_status", json!({})).unwrap();
        assert_eq!(status["pending"], 2);
        assert_eq!(status["blocked"], 1);
        assert_eq!(status["attempts"], 1);
    }

    #[test]
    fn explicit_retry_returns_blocked_mutations_to_the_outbox() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let first = store
            .mutate(
                "7",
                vec![board_change(&Uuid::new_v4().to_string(), "Retry me")],
            )
            .unwrap();
        store
            .record_outbox_error("7", first.local_sequence, "413 Payload Too Large", true)
            .unwrap();

        assert!(store.next_outbox("7").unwrap().is_none());
        assert_eq!(store.retry_blocked_outbox("7").unwrap(), 1);
        assert_eq!(
            store.next_outbox("7").unwrap().unwrap().local_sequence,
            first.local_sequence
        );
        let status = store.query("7", "sync_status", json!({})).unwrap();
        assert_eq!(status["blocked"], 0);
        assert_eq!(status["attempts"], 0);
        assert_eq!(status["outbox_error"], Value::Null);
    }

    #[test]
    fn copy_ratings_are_validated_locally() {
        let change = |values: Value| DataChange {
            table: "copies".into(),
            uuid: Uuid::new_v4().to_string(),
            operation: "upsert".into(),
            values: values.as_object().unwrap().clone(),
        };
        assert!(validate_domain_values(&change(json!({"rating_reading": 5}))).is_ok());
        assert!(validate_domain_values(&change(json!({"rating_liking": null}))).is_ok());
        assert!(validate_domain_values(&change(json!({"rating_liking": 6}))).is_err());
        assert!(validate_domain_values(&change(json!({"rating_expertise": 2.5}))).is_err());
        assert!(validate_domain_values(&change(json!({"rating_reading": true}))).is_err());
    }

    #[test]
    fn unsafe_board_links_are_rejected_before_entering_the_outbox() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_uuid = Uuid::new_v4().to_string();
        store
            .mutate("7", vec![board_change(&board_uuid, "Links")])
            .unwrap();
        let change = DataChange {
            table: "board_items".into(),
            uuid: Uuid::new_v4().to_string(),
            operation: "upsert".into(),
            values: Map::from_iter([
                ("board_uuid".into(), json!(board_uuid)),
                ("kind".into(), json!("webpage")),
                ("source_url".into(), json!("javascript:alert(1)")),
            ]),
        };
        assert!(store.mutate("7", vec![change]).is_err());
        assert_eq!(store.outbox_count(), 1);
    }

    #[test]
    fn accepted_push_replaces_row_and_removes_outbox_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let uuid = Uuid::new_v4().to_string();
        let receipt = store
            .mutate("7", vec![board_change(&uuid, "Local")])
            .unwrap();
        let mut row = remote_board(&uuid, 1, "Canonical");
        row.insert("table".into(), json!("boards"));
        store
            .accept_push(
                "7",
                receipt.local_sequence,
                vec![row],
                vec![json!({
                    "table": "boards", "uuid": uuid,
                    "resolution": "client_won",
                    "server_revision": 1, "previous": {"name": "Remote"},
                })],
                Map::new(),
            )
            .unwrap();
        assert_eq!(store.outbox_count(), 0);
        assert_eq!(
            store.query("7", "board", json!({"uuid": uuid})).unwrap()["name"],
            "Canonical"
        );
        assert_eq!(
            store.query("7", "sync_status", json!({})).unwrap()["conflicts"],
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
        let uuid = Uuid::new_v4().to_string();
        store
            .apply_pull(
                "7",
                vec![RemoteChange {
                    table: "boards".into(),
                    row: remote_board(&uuid, 1, "Remote"),
                }],
                19,
            )
            .unwrap();
        assert_eq!(store.pull_cursor("7").unwrap(), 19);
        assert_eq!(
            store.query("7", "board", json!({"uuid": uuid})).unwrap()["name"],
            "Remote"
        );

        let bad_uuid = Uuid::new_v4().to_string();
        let mut invalid = remote_board(&bad_uuid, 1, "Invalid");
        invalid.insert("unknown_server_field".into(), json!(true));
        assert!(store
            .apply_pull(
                "7",
                vec![RemoteChange {
                    table: "boards".into(),
                    row: invalid,
                }],
                20
            )
            .is_err());
        assert_eq!(store.pull_cursor("7").unwrap(), 19);
        assert!(store
            .query("7", "board", json!({"uuid": bad_uuid}))
            .is_err());

        let foreign_uuid = Uuid::new_v4().to_string();
        let mut foreign = remote_board(&foreign_uuid, 1, "Foreign");
        foreign.insert("user_uuid".into(), json!("8"));
        assert!(store
            .apply_pull(
                "7",
                vec![RemoteChange {
                    table: "boards".into(),
                    row: foreign,
                }],
                20,
            )
            .is_err());
        assert_eq!(store.pull_cursor("7").unwrap(), 19);
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
        let board_uuid = Uuid::new_v4().to_string();
        store
            .mutate("7", vec![board_change(&board_uuid, "Files")])
            .unwrap();
        let item_uuid = Uuid::new_v4().to_string();
        let receipt = store
            .mutate(
                "7",
                vec![DataChange {
                    table: "board_items".into(),
                    uuid: item_uuid.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("board_uuid".into(), json!(board_uuid)),
                        ("kind".into(), json!("image")),
                        ("sha256".into(), json!(record.sha256.clone())),
                    ]),
                }],
            )
            .unwrap();
        let mut canonical = receipt.rows[0].as_object().unwrap().clone();
        canonical.insert("table".into(), json!("board_items"));
        store
            .accept_push(
                "7",
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
                "SELECT COUNT(*) FROM _local_blob_refs WHERE row_uuid=?1 AND sha256=?2",
                params![item_uuid, record.sha256],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(durability, "cache");
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
    fn missing_blobs_include_every_account_pdf_and_board_file() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let copy_uuid = Uuid::new_v4().to_string();
        let board_uuid = Uuid::new_v4().to_string();
        let board_item_uuid = Uuid::new_v4().to_string();
        let foreign_board_uuid = Uuid::new_v4().to_string();
        let foreign_item_uuid = Uuid::new_v4().to_string();
        let pdf = "a".repeat(64);
        let paper_sha256 = pdf.clone();
        let board_file = "b".repeat(64);
        let foreign_file = "c".repeat(64);
        let now = "2026-09-12T00:00:00Z";
        {
            let connection = store.connection.lock().unwrap();
            connection.execute(
                "INSERT INTO papers(sha256,title,file_path,created_at,updated_at) VALUES (?1,'Paper',?1 || '.pdf',?2,?2)",
                params![paper_sha256, now],
            ).unwrap();
            connection.execute(
                "INSERT INTO copies(uuid,paper_sha256,user_uuid,created_at,updated_at) VALUES (?1,?2,'7',?3,?3)",
                params![copy_uuid, paper_sha256, now],
            ).unwrap();
            for (board, item, digest, account) in [
                (&board_uuid, &board_item_uuid, &board_file, "7"),
                (&foreign_board_uuid, &foreign_item_uuid, &foreign_file, "8"),
            ] {
                connection.execute(
                    "INSERT INTO boards(uuid,user_uuid,name,created_at,updated_at) VALUES (?1,?2,'Board',?3,?3)",
                    params![board, account, now],
                ).unwrap();
                connection.execute(
                    "INSERT INTO board_items(uuid,board_uuid,kind,sha256,created_at,updated_at) VALUES (?1,?2,'file',?3,?4,?4)",
                    params![item, board, digest, now],
                ).unwrap();
            }
            // A metadata row without its bytes is still missing and must be
            // repaired by the next complete synchronization.
            connection.execute(
                "INSERT INTO _local_blobs(sha256,relative_path,size,mime_type,durability) VALUES (?1,?1,1,'application/pdf','cache')",
                [&pdf],
            ).unwrap();
        }

        assert_eq!(
            store.missing_blob_digests("7").unwrap(),
            vec![pdf, board_file]
        );
    }

    #[test]
    fn a_file_the_index_does_not_know_is_fetched_again() {
        use sha2::Digest;

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let bytes = b"on disk, in no index";
        let orphan = hex::encode(sha2::Sha256::digest(bytes));
        std::fs::write(store.blob_directory.join(&orphan), bytes).unwrap();
        let now = "2026-09-12T00:00:00Z";
        {
            let connection = store.connection.lock().unwrap();
            connection.execute(
                "INSERT INTO papers(sha256,title,file_path,created_at,updated_at) VALUES (?1,'Paper',?1 || '.pdf',?2,?2)",
                params![orphan, now],
            ).unwrap();
            connection.execute(
                "INSERT INTO copies(uuid,paper_sha256,user_uuid,created_at,updated_at) VALUES (?1,?2,'7',?3,?3)",
                params![Uuid::new_v4().to_string(), orphan, now],
            ).unwrap();
        }

        assert_eq!(
            store.missing_blob_digests("7").unwrap(),
            vec![orphan.clone()]
        );
        // Fetching it again is what indexes it.
        store
            .import_remote_blob(&orphan, bytes, Some("application/pdf".into()))
            .unwrap();
        assert!(store.missing_blob_digests("7").unwrap().is_empty());
        let status = store.query("7", "storage_status", json!({})).unwrap();
        assert_eq!(status["classes"]["cache"]["bytes"], bytes.len());
    }

    #[test]
    fn clear_data_removes_replica_pending_work_and_files_but_keeps_the_account() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_uuid = Uuid::new_v4().to_string();
        let blob = store
            .import_blob(b"unsynchronized file", Some("application/pdf".into()))
            .unwrap();
        store
            .set_local_account("7", json!({"uuid": "7", "display_name": "User"}))
            .unwrap();
        store
            .mutate("7", vec![board_change(&board_uuid, "Unsynced board")])
            .unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO _local_sync_state(account_uuid,pull_cursor) VALUES ('7',42)",
                    [],
                )
                .unwrap();
        }

        assert_eq!(store.clear_data().unwrap(), 1);
        assert_eq!(store.query("7", "boards", json!({})).unwrap(), json!([]));
        assert_eq!(store.outbox_count(), 0);
        assert_eq!(store.pull_cursor("7").unwrap(), 0);
        assert!(!store.has_blob(&blob.sha256));
        assert_eq!(
            store.query("7", "account", json!({})).unwrap()["display_name"],
            "User"
        );
    }

    #[test]
    fn remove_account_deletes_only_that_accounts_replica_and_orphaned_files() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let unique_paper = Uuid::new_v4().to_string();

        let unique_copy = Uuid::new_v4().to_string();
        let shared_paper = Uuid::new_v4().to_string();

        let first_copy = Uuid::new_v4().to_string();
        let second_copy = Uuid::new_v4().to_string();
        let first_board = Uuid::new_v4().to_string();
        let second_board = Uuid::new_v4().to_string();
        let first_item = Uuid::new_v4().to_string();
        let second_item = Uuid::new_v4().to_string();
        let unique_blob = store
            .import_blob(b"first account PDF", Some("application/pdf".into()))
            .unwrap();
        let shared_blob = store
            .import_blob(b"shared PDF", Some("application/pdf".into()))
            .unwrap();
        let first_board_blob = store
            .import_blob(b"first board file", Some("application/pdf".into()))
            .unwrap();
        let second_board_blob = store
            .import_blob(b"second board file", Some("application/pdf".into()))
            .unwrap();
        store
            .set_local_account("7", json!({"uuid": "7", "display_name": "First"}))
            .unwrap();
        store
            .set_local_account("8", json!({"uuid": "8", "display_name": "Second"}))
            .unwrap();
        {
            let connection = store.connection.lock().unwrap();
            let now = "2026-09-12T00:00:00Z";
            for (paper, title, blob) in [
                (&unique_paper, "Unique", &unique_blob.sha256),
                (&shared_paper, "Shared", &shared_blob.sha256),
            ] {
                connection.execute(
                    "INSERT INTO papers(sha256,title,file_path,created_at,updated_at) VALUES (?1,?2,?1 || '.pdf',?3,?3)",
                    params![paper, title, now],
                ).unwrap();
                connection.execute(
                    "INSERT INTO _local_blob_refs(table_name,row_uuid,sha256) VALUES ('papers',?1,?2)",
                    params![paper, blob],
                ).unwrap();
            }
            for (copy, paper, account) in [
                (&unique_copy, &unique_paper, "7"),
                (&first_copy, &shared_paper, "7"),
                (&second_copy, &shared_paper, "8"),
            ] {
                connection.execute(
                    "INSERT INTO copies(uuid,paper_sha256,user_uuid,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)",
                    params![copy, paper, account, now],
                ).unwrap();
            }
            for (board, item, blob, account) in [
                (&first_board, &first_item, &first_board_blob.sha256, "7"),
                (&second_board, &second_item, &second_board_blob.sha256, "8"),
            ] {
                connection.execute(
                    "INSERT INTO boards(uuid,user_uuid,name,created_at,updated_at) VALUES (?1,?2,'Board',?3,?3)",
                    params![board, account, now],
                ).unwrap();
                connection.execute(
                    "INSERT INTO board_items(uuid,board_uuid,kind,sha256,created_at,updated_at) VALUES (?1,?2,'file',?3,?4,?4)",
                    params![item, board, blob, now],
                ).unwrap();
                connection.execute(
                    "INSERT INTO _local_blob_refs(table_name,row_uuid,sha256) VALUES ('board_items',?1,?2)",
                    params![item, blob],
                ).unwrap();
            }
            connection.execute(
                "INSERT INTO _local_outbox(account_uuid,client_uuid,mutation_uuid,changes_json) VALUES ('7','client-7','mutation-7','[]')",
                [],
            ).unwrap();
            connection.execute(
                "INSERT INTO _local_outbox(account_uuid,client_uuid,mutation_uuid,changes_json) VALUES ('8','client-8','mutation-8','[]')",
                [],
            ).unwrap();
        }

        assert_eq!(store.remove_account("7").unwrap(), 2);
        let connection = store.connection.lock().unwrap();
        for (query, expected) in [
            (
                "SELECT COUNT(*) FROM _local_accounts WHERE account_uuid='7'",
                0,
            ),
            (
                "SELECT COUNT(*) FROM _local_accounts WHERE account_uuid='8'",
                1,
            ),
            ("SELECT COUNT(*) FROM copies WHERE user_uuid='7'", 0),
            ("SELECT COUNT(*) FROM copies WHERE user_uuid='8'", 1),
            ("SELECT COUNT(*) FROM boards WHERE user_uuid='7'", 0),
            ("SELECT COUNT(*) FROM boards WHERE user_uuid='8'", 1),
            (
                "SELECT COUNT(*) FROM _local_outbox WHERE account_uuid='7'",
                0,
            ),
            (
                "SELECT COUNT(*) FROM _local_outbox WHERE account_uuid='8'",
                1,
            ),
        ] {
            assert_eq!(
                connection
                    .query_row(query, [], |row| row.get::<_, i64>(0))
                    .unwrap(),
                expected,
                "{query}"
            );
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM papers WHERE sha256=?1",
                    [&unique_paper],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM papers WHERE sha256=?1",
                    [&shared_paper],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        drop(connection);
        assert!(!store.has_blob(&unique_blob.sha256));
        assert!(!store.has_blob(&first_board_blob.sha256));
        assert!(store.has_blob(&shared_blob.sha256));
        assert!(store.has_blob(&second_board_blob.sha256));
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
        let board_uuid = Uuid::new_v4().to_string();
        store
            .mutate("7", vec![board_change(&board_uuid, "Files")])
            .unwrap();
        assert!(store
            .mutate(
                "7",
                vec![DataChange {
                    table: "board_items".into(),
                    uuid: Uuid::new_v4().to_string(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("board_uuid".into(), json!(board_uuid)),
                        ("kind".into(), json!("file")),
                        ("sha256".into(), json!(digest)),
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
        let board_uuid = Uuid::new_v4().to_string();
        store
            .mutate("7", vec![board_change(&board_uuid, "Files")])
            .unwrap();
        store
            .mutate(
                "7",
                vec![DataChange {
                    table: "board_items".into(),
                    uuid: Uuid::new_v4().to_string(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("board_uuid".into(), json!(board_uuid)),
                        ("kind".into(), json!("file")),
                        ("sha256".into(), json!(retained.sha256)),
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
                "7",
                json!({"uuid": "7", "email": "user@example.test", "display_name": "User"}),
            )
            .unwrap();
        assert_eq!(
            store.query("7", "account", json!({})).unwrap()["display_name"],
            "User"
        );
        // Another account has no profile here, and that is an answer: null.
        assert_eq!(store.query("8", "account", json!({})).unwrap(), Value::Null);
        assert!(store
            .set_local_account("8", json!({"uuid": "7", "display_name": "Wrong"}))
            .is_err());
    }

    #[test]
    fn recovery_export_contains_pending_mutations_in_a_portable_manifest() {
        use std::io::Read;

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_uuid = Uuid::new_v4().to_string();
        store
            .mutate("7", vec![board_change(&board_uuid, "Recover me")])
            .unwrap();
        let destination = directory.path().join("recovery.zip");
        let exported = store.export_recovery("7", &destination).unwrap();
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
        assert_eq!(manifest["account_uuid"], "7");
        assert_eq!(manifest["mutations"][0]["changes"][0]["uuid"], board_uuid);
        assert_eq!(manifest["rows"][0]["uuid"], board_uuid);
        assert_eq!(manifest["rows"][0]["name"], "Recover me");
    }

    #[test]
    fn recovery_export_rejects_a_missing_pending_file_without_leaving_an_archive() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_uuid = Uuid::new_v4().to_string();
        let item_uuid = Uuid::new_v4().to_string();
        let blob = store
            .import_blob(b"queued user file", Some("application/pdf".into()))
            .unwrap();
        store
            .mutate(
                "7",
                vec![
                    board_change(&board_uuid, "Missing file recovery"),
                    DataChange {
                        table: "board_items".into(),
                        uuid: item_uuid,
                        operation: "upsert".into(),
                        values: Map::from_iter([
                            ("board_uuid".into(), json!(board_uuid)),
                            ("kind".into(), json!("file")),
                            ("sha256".into(), json!(blob.sha256)),
                        ]),
                    },
                ],
            )
            .unwrap();
        std::fs::remove_file(store.blob_directory.join(&blob.sha256)).unwrap();

        let destination = directory.path().join("recovery.zip");
        let error = store.export_recovery("7", &destination).unwrap_err();
        assert!(error.contains("Recovery file"), "{error}");
        assert!(!destination.exists());
        assert!(!destination.with_extension("zip.partial").exists());
    }

    #[test]
    fn opening_a_replica_again_leaves_the_schema_where_it_is() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        for _ in 0..2 {
            let store = LocalStore::open(&path).unwrap();
            let connection = store.connection.lock().unwrap();
            let recorded: String = connection
                .query_row(
                    "SELECT value FROM _local_settings WHERE key='schema_version'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                recorded,
                super::super::schema::declared_schema_version().to_string()
            );
        }
    }

    #[test]
    fn a_compatibility_verdict_written_is_read_back_after_reopening() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let store = LocalStore::open(&path).unwrap();
        assert_eq!(store.local_setting("client_compatibility").unwrap(), None);
        store
            .set_local_setting("client_compatibility", "incompatible")
            .unwrap();
        drop(store);

        let reopened = LocalStore::open(&path).unwrap();
        assert_eq!(
            reopened
                .local_setting("client_compatibility")
                .unwrap()
                .as_deref(),
            Some("incompatible"),
        );
        reopened
            .set_local_setting("client_compatibility", "supported")
            .unwrap();
        assert_eq!(
            reopened
                .local_setting("client_compatibility")
                .unwrap()
                .as_deref(),
            Some("supported"),
        );
        assert!(reopened
            .set_local_setting("client_compatibility", "maybe")
            .is_err());
        assert!(reopened.set_local_setting("schema_version", "1").is_err());
    }

    #[test]
    fn shared_paper_import_supports_an_offline_owned_copy_without_queueing_shared_rows() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let account_uuid = Uuid::new_v4().to_string();
        let shelf_uuid = Uuid::new_v4().to_string();
        let paper_sha256 = "e".repeat(64);
        let copy_uuid = Uuid::new_v4().to_string();
        let now = "2026-09-14T00:00:00Z";
        store
            .set_local_account(&account_uuid, json!({"uuid": account_uuid}))
            .unwrap();
        store
            .apply_snapshot(
                &account_uuid,
                vec![Map::from_iter([
                    ("table".into(), json!("shelves")),
                    ("uuid".into(), json!(shelf_uuid.clone())),
                    ("user_uuid".into(), json!(account_uuid.clone())),
                    ("name".into(), json!("Nook")),
                    ("color".into(), json!("#123456")),
                    ("is_public".into(), json!(0)),
                    ("is_default".into(), json!(1)),
                    ("position".into(), json!(0)),
                    ("created_at".into(), json!(now)),
                    ("updated_at".into(), json!(now)),
                    ("revision".into(), json!(1)),
                    ("deleted_at".into(), Value::Null),
                ])],
            )
            .unwrap();
        store
            .import_shared_paper(
                &account_uuid,
                Map::from_iter([
                    ("doi".into(), Value::Null),
                    ("title".into(), json!("Shared paper")),
                    ("authors".into(), Value::Null),
                    ("journal".into(), Value::Null),
                    ("year".into(), Value::Null),
                    ("file_path".into(), json!("shared.pdf")),
                    ("sha256".into(), json!(paper_sha256.clone())),
                    ("created_at".into(), json!(now)),
                    ("updated_at".into(), json!(now)),
                    ("revision".into(), json!(1)),
                    ("deleted_at".into(), Value::Null),
                ]),
            )
            .unwrap();
        assert_eq!(store.outbox_count(), 0);

        store
            .mutate(
                &account_uuid,
                vec![DataChange {
                    table: "copies".into(),
                    uuid: copy_uuid.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("paper_sha256".into(), json!(paper_sha256.clone())),
                        ("shelf_uuid".into(), json!(shelf_uuid)),
                    ]),
                }],
            )
            .unwrap();
        assert_eq!(store.outbox_count(), 1);
        let paper = store
            .query(&account_uuid, "paper", json!({"uuid": &paper_sha256[..32]}))
            .unwrap();
        assert_eq!(paper["title"], "Shared paper");
        assert_eq!(paper["copy_uuid"], copy_uuid);
    }

    #[test]
    fn annotation_snapshot_enables_offline_editing_across_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let paper_sha256 = "e".repeat(64);
        let note_uuid = Uuid::new_v4().to_string();
        let store = LocalStore::open(&path).unwrap();
        store
            .apply_snapshot(
                "7",
                vec![Map::from_iter([
                    ("table".into(), json!("papers")),
                    ("doi".into(), Value::Null),
                    ("title".into(), json!("Paper")),
                    ("authors".into(), Value::Null),
                    ("journal".into(), Value::Null),
                    ("year".into(), Value::Null),
                    ("file_path".into(), json!("paper.pdf")),
                    ("sha256".into(), json!(paper_sha256.clone())),
                    ("created_at".into(), json!("2026-09-12T00:00:00Z")),
                    ("updated_at".into(), json!("2026-09-12T00:00:00Z")),
                    ("revision".into(), json!(1)),
                    ("deleted_at".into(), Value::Null),
                ])],
            )
            .unwrap();
        store
            .mutate(
                "7",
                vec![DataChange {
                    table: "annotations".into(),
                    uuid: note_uuid.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("kind".into(), json!("note")),
                        ("paper_sha256".into(), json!(paper_sha256.clone())),
                        ("content".into(), json!("Written offline")),
                        ("page".into(), json!(2)),
                        (
                            "body".into(),
                            json!(r#"{"anchor":{"type":"point","x":0.2,"y":0.3}}"#),
                        ),
                    ]),
                }],
            )
            .unwrap();
        drop(store);

        let reopened = LocalStore::open(&path).unwrap();
        let notes = reopened
            .query(
                "7",
                "annotations",
                json!({"paper_sha256": paper_sha256, "kind": "note"}),
            )
            .unwrap();
        assert_eq!(notes[0]["uuid"], note_uuid);
        assert_eq!(notes[0]["content"], "Written offline");
        assert_eq!(notes[0]["body"]["anchor"]["type"], "point");
        assert_eq!(reopened.outbox_count(), 1);
    }

    #[test]
    fn snapshot_replaces_the_account_mirror_without_erasing_pending_work() {
        fn shelf(uuid: &str, name: &str) -> Map<String, Value> {
            Map::from_iter([
                ("table".into(), json!("shelves")),
                ("uuid".into(), json!(uuid)),
                ("user_uuid".into(), json!("7")),
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
        let stale_uuid = Uuid::new_v4().to_string();
        let current_uuid = Uuid::new_v4().to_string();
        store
            .apply_snapshot(
                "7",
                vec![shelf(&stale_uuid, "Old"), shelf(&current_uuid, "Current")],
            )
            .unwrap();
        store
            .apply_snapshot("7", vec![shelf(&current_uuid, "Current")])
            .unwrap();
        let nook = store.query("7", "nook", json!({})).unwrap();
        assert_eq!(nook["shelves"].as_array().unwrap().len(), 1);
        assert_eq!(nook["shelves"][0]["uuid"], current_uuid);

        let pending_uuid = Uuid::new_v4().to_string();
        store
            .mutate(
                "7",
                vec![DataChange {
                    table: "shelves".into(),
                    uuid: pending_uuid.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("name".into(), json!("Offline")),
                        ("color".into(), json!("#654321")),
                        ("position".into(), json!(1)),
                    ]),
                }],
            )
            .unwrap();
        store.apply_snapshot("7", vec![]).unwrap();
        let nook = store.query("7", "nook", json!({})).unwrap();
        assert!(nook["shelves"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["uuid"] == pending_uuid));
    }

    #[test]
    fn authoritative_snapshot_restores_a_present_board_despite_a_higher_local_revision() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_uuid = Uuid::new_v4().to_string();
        let now = chrono_text();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO boards(uuid,user_uuid,name,created_at,updated_at,revision) VALUES (?1,'7','Stale local board',?2,?2,8)",
                    params![board_uuid, now],
                )
                .unwrap();
        }

        let mut snapshot_board = remote_board(&board_uuid, 2, "Server board");
        snapshot_board.insert("table".into(), json!("boards"));
        store.apply_snapshot("7", vec![snapshot_board]).unwrap();

        let boards = store.query("7", "boards", json!({})).unwrap();
        assert_eq!(boards.as_array().unwrap().len(), 1);
        assert_eq!(boards[0]["uuid"], board_uuid);
        assert_eq!(boards[0]["name"], "Server board");
        assert_eq!(boards[0]["revision"], 2);
        assert!(boards[0]["deleted_at"].is_null());
    }

    #[test]
    fn snapshot_does_not_overwrite_a_higher_revision_with_pending_local_work() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_uuid = Uuid::new_v4().to_string();
        let mut original = remote_board(&board_uuid, 1, "Server board");
        original.insert("table".into(), json!("boards"));
        store.apply_snapshot("7", vec![original]).unwrap();
        store
            .mutate(
                "7",
                vec![DataChange {
                    table: "boards".into(),
                    uuid: board_uuid.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([("name".into(), json!("Offline edit"))]),
                }],
            )
            .unwrap();

        let mut stale_snapshot = remote_board(&board_uuid, 1, "Stale server board");
        stale_snapshot.insert("table".into(), json!("boards"));
        store.apply_snapshot("7", vec![stale_snapshot]).unwrap();

        let boards = store.query("7", "boards", json!({})).unwrap();
        assert_eq!(boards[0]["name"], "Offline edit");
        assert_eq!(store.outbox_count(), 1);
    }

    #[test]
    fn snapshot_removes_a_board_hierarchy_missing_from_the_server() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let board_uuid = Uuid::new_v4().to_string();
        let group_uuid = Uuid::new_v4().to_string();
        let item_uuid = Uuid::new_v4().to_string();
        let now = chrono_text();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO boards(uuid,user_uuid,name,created_at,updated_at,revision) VALUES (?1,'7','Old board',?2,?2,1)",
                    params![board_uuid, now],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO board_groups(uuid,board_uuid,kind,title,created_at,updated_at,revision) VALUES (?1,?2,'collection','Old group',?3,?3,1)",
                    params![group_uuid, board_uuid, now],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO board_items(uuid,board_uuid,group_uuid,kind,content,created_at,updated_at,revision) VALUES (?1,?2,?3,'comment','Old item',?4,?4,1)",
                    params![item_uuid, board_uuid, group_uuid, now],
                )
                .unwrap();
        }

        store.apply_snapshot("7", vec![]).unwrap();

        assert!(store
            .query("7", "boards", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
        let connection = store.connection.lock().unwrap();
        for (table, uuid) in [
            ("boards", board_uuid),
            ("board_groups", group_uuid),
            ("board_items", item_uuid),
        ] {
            let deleted: bool = connection
                .query_row(
                    &format!("SELECT deleted_at IS NOT NULL FROM {table} WHERE uuid=?1"),
                    [uuid],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(deleted, "{table} should be stale after an empty snapshot");
        }
    }

    #[test]
    fn nook_snapshot_supports_offline_organization_across_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let paper_sha256 = "e".repeat(64);
        let shelf_uuid = Uuid::new_v4().to_string();
        let copy_uuid = Uuid::new_v4().to_string();
        let tag_uuid = Uuid::new_v4().to_string();
        let link_uuid = Uuid::new_v4().to_string();
        let timestamp = "2026-09-12T00:00:00Z";
        {
            let store = LocalStore::open(&path).unwrap();
            store
                .apply_snapshot(
                    "7",
                    vec![
                        Map::from_iter([
                            ("table".into(), json!("papers")),
                            ("doi".into(), Value::Null),
                            ("title".into(), json!("Offline systems")),
                            ("authors".into(), Value::Null),
                            ("journal".into(), Value::Null),
                            ("year".into(), Value::Null),
                            ("file_path".into(), json!("offline-systems.pdf")),
                            ("sha256".into(), json!(paper_sha256.clone())),
                            ("created_at".into(), json!(timestamp)),
                            ("updated_at".into(), json!(timestamp)),
                            ("revision".into(), json!(1)),
                            ("deleted_at".into(), Value::Null),
                        ]),
                        Map::from_iter([
                            ("table".into(), json!("shelves")),
                            ("uuid".into(), json!(shelf_uuid)),
                            ("user_uuid".into(), json!("7")),
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
                            ("uuid".into(), json!(copy_uuid)),
                            ("paper_sha256".into(), json!(paper_sha256)),
                            ("user_uuid".into(), json!("7")),
                            ("shelf_uuid".into(), json!(shelf_uuid)),
                            ("summary".into(), Value::Null),
                            ("thought".into(), Value::Null),
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
                    "7",
                    vec![
                        DataChange {
                            table: "copies".into(),
                            uuid: copy_uuid.clone(),
                            operation: "upsert".into(),
                            values: Map::from_iter([("summary".into(), json!("Read locally"))]),
                        },
                        DataChange {
                            table: "tags".into(),
                            uuid: tag_uuid.clone(),
                            operation: "upsert".into(),
                            values: Map::from_iter([("name".into(), json!("methods"))]),
                        },
                    ],
                )
                .unwrap();
            store
                .mutate(
                    "7",
                    vec![DataChange {
                        table: "copy_tags".into(),
                        uuid: link_uuid,
                        operation: "upsert".into(),
                        values: Map::from_iter([
                            ("copy_uuid".into(), json!(copy_uuid)),
                            ("tag_uuid".into(), json!(tag_uuid)),
                        ]),
                    }],
                )
                .unwrap();
        }
        let reopened = LocalStore::open(&path).unwrap();
        let nook = reopened.query("7", "nook", json!({})).unwrap();
        assert_eq!(nook["copies"][0]["summary"], "Read locally");
        assert_eq!(nook["tags"][0]["name"], "methods");
        assert_eq!(nook["copy_tags"][0]["copy_uuid"], copy_uuid);
        assert_eq!(reopened.outbox_count(), 2);
    }

    #[test]
    fn pdf_import_commits_file_domain_rows_and_outbox_before_network() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let copy_uuid = Uuid::new_v4().to_string();
        let digest;
        {
            let store = LocalStore::open(&path).unwrap();
            let blob = store
                .import_blob(b"%PDF-1.4\noffline", Some("application/pdf".into()))
                .unwrap();
            digest = blob.sha256.clone();
            let receipt = store
                .mutate(
                    "7",
                    vec![
                        DataChange {
                            table: "papers".into(),
                            // Named by the file it is, which is a name the
                            // service will arrive at too.
                            uuid: digest.clone(),
                            operation: "upsert".into(),
                            values: Map::from_iter([
                                ("title".into(), json!("Imported offline")),
                                ("doi".into(), Value::Null),
                                ("file_path".into(), json!(format!("{digest}.pdf"))),
                            ]),
                        },
                        DataChange {
                            table: "copies".into(),
                            uuid: copy_uuid.clone(),
                            operation: "upsert".into(),
                            values: Map::from_iter([("paper_sha256".into(), json!(digest))]),
                        },
                    ],
                )
                .unwrap();
            let mut rows = receipt.rows;
            for (index, table) in ["papers", "copies"].into_iter().enumerate() {
                let row = rows[index].as_object_mut().unwrap();
                row.insert("table".into(), json!(table));
                row.insert("revision".into(), json!(2));
            }
            store
                .accept_push(
                    "7",
                    receipt.local_sequence,
                    rows.into_iter()
                        .map(|row| row.as_object().unwrap().clone())
                        .collect(),
                    vec![],
                    // Nothing to alias. The replica named the paper and the
                    // service agreed, because neither of them chose it.
                    Map::new(),
                )
                .unwrap();
        }
        let reopened = LocalStore::open(&path).unwrap();
        let paper = reopened
            .query("7", "paper", json!({"uuid": &digest[..32]}))
            .unwrap();
        assert_eq!(paper["title"], "Imported offline");
        assert!(reopened.has_blob(paper["sha256"].as_str().unwrap()));
        assert_eq!(reopened.outbox_count(), 0);
    }

    // A paper is asked for by its name — the first half of its digest — and
    // what the replica hands back is named the way it is stored.
    #[test]
    fn a_paper_is_found_by_the_name_a_link_carries() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let blob = store
            .import_blob(
                b"%PDF-1.4\nnamed by its file",
                Some("application/pdf".into()),
            )
            .unwrap();
        store
            .mutate("7", pdf_import_changes(&blob.sha256, "A paper with a name"))
            .unwrap();

        let name = blob.sha256[..32].to_string();
        let paper = store.query("7", "paper", json!({"uuid": name})).unwrap();
        assert_eq!(paper["title"], "A paper with a name");
        assert_eq!(paper["sha256"], json!(blob.sha256));

        // The name is read as written, without regard to case.
        let shouted = blob.sha256[..32].to_uppercase();
        let paper = store.query("7", "paper", json!({"uuid": shouted})).unwrap();
        assert_eq!(paper["sha256"], json!(blob.sha256));
    }

    // Only the two lengths Papol writes. Anything between them is refused
    // rather than resolved to whichever paper happens to start that way.
    #[test]
    fn a_name_of_the_wrong_shape_is_not_a_paper() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let blob = store
            .import_blob(
                b"%PDF-1.4\nnamed by its file",
                Some("application/pdf".into()),
            )
            .unwrap();
        store
            .mutate("7", pdf_import_changes(&blob.sha256, "A paper with a name"))
            .unwrap();

        for wrong in [
            blob.sha256[..31].to_string(),
            blob.sha256[..33].to_string(),
            blob.sha256[..48].to_string(),
            // The whole digest is the identity, not a name.
            blob.sha256.clone(),
            "z".repeat(32),
            "_".repeat(32),
            String::new(),
        ] {
            let answer = store.query("7", "paper", json!({"uuid": wrong}));
            assert!(answer.is_err(), "{wrong} should name no paper");
        }
    }

    #[test]
    fn repeated_pdf_import_is_rejected_inside_the_database_transaction() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let blob = store
            .import_blob(b"%PDF-1.4\nsame bytes", Some("application/pdf".into()))
            .unwrap();

        store
            .mutate("7", pdf_import_changes(&blob.sha256, "First name"))
            .unwrap();
        let error = store
            .mutate("7", pdf_import_changes(&blob.sha256, "Second name"))
            .unwrap_err();

        assert_eq!(error, "This PDF is already in your nook");
        assert_eq!(
            store
                .query("7", "papers", json!({}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(store.outbox_count(), 1);
    }

    /// Importing a file the replica already holds. There is no alias to
    /// apply and no second row to merge: the import names the paper that is
    /// already there, because the file is the name. What has to be true is
    /// that the blob stays spoken for exactly once.
    #[test]
    fn importing_a_file_already_held_finds_the_paper_that_is_there() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let blob = store
            .import_blob(b"%PDF-1.4\ncanonical bytes", Some("application/pdf".into()))
            .unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO papers(sha256,title,file_path,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)",
                    params![
                        blob.sha256,
                        "Canonical",
                        format!("{}.pdf", blob.sha256),
                        chrono_text(),
                    ],
                )
                .unwrap();
            refresh_blob_reference(&connection, "papers", &blob.sha256).unwrap();
        }

        let receipt = store
            .mutate(
                "7",
                pdf_import_changes(&blob.sha256, "Imported again, same bytes"),
            )
            .unwrap();
        assert_eq!(receipt.rows[0]["sha256"], blob.sha256);
        // The change still travels: it is how the service is told this user
        // has the file, even though the row was already here.
        assert_eq!(store.outbox_count(), 1);
        store
            .accept_push("7", receipt.local_sequence, vec![], vec![], Map::new())
            .unwrap();

        let connection = store.connection.lock().unwrap();
        let on_that_file: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM papers WHERE sha256=?1",
                [&blob.sha256],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(on_that_file, 1, "one file is one paper");
        let references: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM _local_blob_refs WHERE table_name='papers' AND sha256=?1",
                [&blob.sha256],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(references, 1, "the blob is spoken for once, not twice");
        let orphans: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM copies WHERE paper_sha256 NOT IN (SELECT sha256 FROM papers)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(orphans, 0);
        drop(connection);
        assert_eq!(store.outbox_count(), 0);
    }

    /// There used to be a window here: an import minted a paper of its own,
    /// a pull could land the service's row for the same file, and the two
    /// were reconciled afterwards by an alias. Naming a paper by its file
    /// closes it. The replica and the service choose the same name because
    /// neither of them chooses — so the pull meets the row the import made,
    /// rather than a second one to be merged later.
    #[test]
    fn a_pull_meets_the_row_an_import_already_made_for_that_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("papol.sqlite3");
        let store = LocalStore::open(&path).unwrap();
        let blob = store
            .import_blob(b"%PDF-1.4\nin flight", Some("application/pdf".into()))
            .unwrap();

        // Imported offline, not yet pushed.
        let receipt = store
            .mutate("7", pdf_import_changes(&blob.sha256, "Imported offline"))
            .unwrap();
        assert_eq!(receipt.rows[0]["sha256"], blob.sha256);
        assert_eq!(store.outbox_count(), 1);

        // The service's own row for the very same bytes arrives meanwhile.
        let now = chrono_text();
        store
            .apply_snapshot(
                "7",
                vec![Map::from_iter([
                    ("table".into(), json!("papers")),
                    ("doi".into(), Value::Null),
                    ("title".into(), json!("The same file, from the service")),
                    ("authors".into(), Value::Null),
                    ("journal".into(), Value::Null),
                    ("year".into(), Value::Null),
                    ("file_path".into(), json!(format!("{}.pdf", blob.sha256))),
                    ("sha256".into(), json!(blob.sha256)),
                    ("created_at".into(), json!(now)),
                    ("updated_at".into(), json!(now)),
                    ("revision".into(), json!(1)),
                    ("deleted_at".into(), Value::Null),
                ])],
            )
            .expect("a pull must not be refused by work the replica has in flight");

        let connection = store.connection.lock().unwrap();
        let on_that_file: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM papers WHERE sha256=?1",
                [&blob.sha256],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(on_that_file, 1, "one file is one paper, at every moment");
        // And the copy the import made is still on it: the pull met the row
        // rather than replacing it with one of its own.
        let held: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM copies WHERE paper_sha256=?1 AND deleted_at IS NULL",
                [&blob.sha256],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(held, 1);
    }
}
