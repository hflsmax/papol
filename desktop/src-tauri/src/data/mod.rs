mod database;
mod schema;

use serde_json::Value;
use std::sync::LazyLock;

pub use database::{
    BlobRecord, DataChange, LocalStore, MutationReceipt, RecoveryExport, RemoteChange,
};
pub use schema::declared_schema_version;

/// `schema/sync_registry.json`, compiled in and parsed once: which tables
/// travel, which of their columns a replica may write, and the schema
/// version this build is written for.
static REGISTRY: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../../schema/sync_registry.json"))
        .expect("schema/sync_registry.json must be valid JSON")
});
