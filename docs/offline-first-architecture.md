# Papol offline-first data and sync architecture

Research date: 2026-09-12

Status: the decisions behind the shipped desktop data layer

## Executive decision

Papol should use a **practical local-first architecture** for the desktop app:

- the bundled UI reads and writes a durable local database;
- synchronized domain tables use the same names, columns, types, and UUID identities locally and on the server;
- every user-owned edit commits locally first, in the same transaction as a durable outbox record;
- one Tauri/Rust sync coordinator pushes the outbox and pulls server changes;
- the existing FastAPI service remains authoritative for accounts, authorization, shared/public state, and cross-device reconciliation;
- PDFs and board attachments live as content-addressed files beside the database, not as duplicate blobs inside queued HTTP requests;
- the UI never treats the network response cache as its data model.

The recommended desktop store is **SQLite owned by the Tauri/Rust layer**, with narrow domain commands exposed to the bundled UI. SQLite gives Papol an explicit, inspectable storage location, migrations, atomic crash recovery, and one process-wide coordinator shared by the library, viewer, and board windows. SQLite documents its atomic-commit guarantees even across application or power failure, which is exactly the property required when a local edit and its pending-sync record must never separate.[^sqlite-atomic]

Papol should **not adopt a general-purpose CRDT system now**. Its required offline edits are private, user-owned records and boards, not concurrent collaborative documents. Stable client-generated IDs, idempotent server mutations, server revisions, tombstones, and a few entity-specific conflict rules provide a much smaller system. The domain schema should be shared by default; local/server differences belong in separate infrastructure tables rather than alternate representations of the same entity.

There are off-the-shelf products, but none is a drop-in match for the present stack. PowerSync is the closest and deserves a future spike if Papol moves its backend database to PostgreSQL. Today, that route combines a backend database migration with an explicitly alpha Tauri SDK. A focused Papol sync protocol is therefore the simplest production path—not because synchronization is easy, but because Papol's required domain is narrower than the migrations and runtime dependencies imposed by the available products.

## What “offline-first” means for Papol

The important distinction is between an offline cache and an offline data system.

An offline cache says, “show an old server response if the request fails.” A local-first data system says, “the local database is what the UI reads and writes; the network reconciles it with other devices when available.” The Android architecture guidance describes the same invariant: higher layers read exclusively from the local source of truth, network results update that local source, and critical user writes use a local-first or “lazy write” strategy.[^android-offline]

For Papol, the desired contract is:

1. Opening the app without a network shows all locally retained papers, notes, ink, clips, shelves, tags, boards, and board items immediately.
2. Every permitted edit succeeds locally without waiting for the backend.
3. Quitting or crashing immediately after an edit does not lose it.
4. Retrying after an ambiguous network failure cannot create duplicate papers, notes, cards, or files.
5. Another device's changes arrive incrementally on the next synchronization.
6. A local failure never silently discards the user's work. A permanently rejected edit remains visible as requiring attention.
7. “Automatic” and “Manual” change network scheduling only. They do not change local save behavior.

This is a practical form of the local-first ideals described by Kleppmann and colleagues: the local copy remains usable and responsive without a server, while servers still provide synchronization and multi-device access.[^local-first]

## Scope and ownership policy

The safest architecture begins by classifying operations by ownership, not by HTTP method.

| Class | Examples | Offline behavior |
| --- | --- | --- |
| Local device settings | sync mode and window state | Save locally; never upload |
| Private user-owned records | summary, private note, ink, clip, private tags, private shelf organization | Save locally and queue for sync |
| Private board state | board creation/deletion, cards, files, excerpts sent from the viewer, layout, groups, staging | Save locally and queue for sync |
| Visibility-changing state | publishing a shelf, exposing or unexposing content | Require online confirmation unless a later product decision defines delayed publication semantics |
| Shared/social state | rooms, joining/leaving, messages, availability, notifications, public comments | Online-only |
| Account/security state | login, password, profile identity, account deletion, sessions | Online-only; credentials stored securely on device |
| Derived or replaceable data | web captures, YouTube thumbnails, reference analysis, remote public library results | Cache when useful; regenerate or refetch |

“All board operations work offline” is compatible with this policy because a board is private and owned. Some cards rely on external processing. For example, an uncached YouTube frame or web-page capture cannot be generated while physically offline. Papol should still create the board card locally, show a clear pending preview, and complete the capture during sync. The user's board mutation is durable even though its derived preview is not yet available.

The sync preference is explicitly a **local device setting**. If a user selects Manual on one Mac, that choice must not change another Mac. Account-wide settings, by contrast, belong in replicated server-owned settings. Code and schema names should preserve this distinction (`device_settings.sync_mode`, not a generic `settings.sync`).

## Recommended target architecture

```text
Bundled React UI: library / viewer / board windows
              │ Tauri commands + status channel
              ▼
      Papol macOS data service (Rust, one per process)
        ├─ repository/domain operations
        ├─ SQLite local replica + durable outbox
        ├─ content-addressed file store
        ├─ one synchronization coordinator
        └─ account-partitioned repository
              │ native HTTPS
              ▼
           FastAPI synchronization API
        ├─ authentication + authorization
        ├─ idempotent mutation application
        ├─ monotonic per-user change feed
        └─ existing domain services and database
```

The frontend should invoke domain operations such as `create_note`, `move_board_item`, `list_board`, and `sync_now`. It should not receive unrestricted SQL execution. Tauri's security model treats Rust and WebView code as separate trust groups and recommends a well-defined IPC boundary with narrowly granted capabilities.[^tauri-security] The official SQL plugin is viable and includes migrations and permissions, but enabling generic `sql:allow-execute` exposes a wider primitive to the WebView than Papol needs.[^tauri-sql]

### Filesystem layout on macOS

Use Tauri's app data and app cache directories derived from the configured bundle identifier `com.mc-pony.papol`; Tauri documents that these paths are resolved as the OS data/cache directory plus that identifier.[^tauri-path]

The current implementation keeps all content-addressed bytes in one managed
application-data `blobs/` directory and records their lifecycle class in
SQLite. Files are removed only by explicit data clearing, account removal, or deletion of their referencing content. Conceptually:

```text
Application Support/com.mc-pony.papol/
  papol.sqlite3                 durable replica, outbox, settings, sync state
  blobs/<sha256>                unsynced or cache per SQLite metadata
```

The exact paths should be resolved through Tauri at runtime rather than constructed as string literals. WAL mode is appropriate for responsive reads while the sync actor writes, but backup/export code must treat the database, WAL, and shared-memory state correctly. SQLite notes that a WAL file is part of persistent state while active and must not be separated carelessly from the database.[^sqlite-wal]

## Shared domain schema and auxiliary tables

Papol should not maintain a second interpretation of a board, note, or paper on the desktop. Every synchronized domain table uses the same table name, column name, meaning, SQLite-compatible type, UUID identity, revision, and tombstone columns on both sides. The local database contains an authorized subset of rows, not a different shape of row.

For example, both databases should use the same definition:

```sql
board_items (
  id TEXT PRIMARY KEY,             -- client-generated UUID
  board_id TEXT NOT NULL,
  group_id TEXT,
  kind TEXT NOT NULL,
  content TEXT,
  excerpt_text TEXT,
  sha256 TEXT,
  original_filename TEXT,
  mime_type TEXT,
  source_url TEXT,
  source_label TEXT,
  staged INTEGER NOT NULL,
  text_align TEXT NOT NULL,
  position INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
```

The server may join that row to account and authorization tables, while the local database may hold only the signed-in user's rows. Neither side renames `content`, converts the card into a response-cache object, or assigns a second local identifier.

One file, `schema/domain/domain.sql`, is the canonical physical schema; the desktop writes it verbatim into a new replica. SQLAlchemy models remain the server's runtime mappings, and a test creates a fresh database from the shared file and compares its columns with the metadata, so the two cannot drift. There is no second file describing a shape the schema used to have: a change an existing database cannot be read under is a new `schema_version` in `schema/sync_registry.json`, the server refuses a database at any other version, and the desktop discards a replica at any other version and pulls the account again.

Keep differences explicit in prefixed auxiliary tables. A minimum local-only shape is:

```sql
_local_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

_local_accounts (
  account_id TEXT PRIMARY KEY,
  server_url TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT,
  last_opened_at TEXT NOT NULL
);

_local_sync_state (
  account_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  pull_cursor INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_error TEXT,
  FOREIGN KEY (account_id) REFERENCES _local_accounts(account_id)
);

_local_outbox (
  mutation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  local_sequence INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  patch_json TEXT NOT NULL,
  base_revision INTEGER,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

_local_blobs (
  sha256 TEXT PRIMARY KEY,
  byte_size INTEGER NOT NULL,
  mime_type TEXT,
  durability TEXT NOT NULL,       -- unsynced | cache
  upload_state TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL
);

_local_blob_refs (
  account_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (account_id, table_name, row_id, sha256)
);
```

Server-only infrastructure follows the same convention, for example `_server_applied_mutations`, `_server_change_log`, and `_server_client_cursors`. Authentication, administration, and other non-replicated server domains remain ordinary server-only tables.

Synchronized domain tables should include at least a stable UUID `id`, `revision`, `updated_at`, `deleted_at` or an equivalent tombstone flag, and normal query indexes. Papol will share papers as read-only dependencies and synchronize user-owned copies, private notes, ink, clips, shelves, tags, boards, board items, and board groups. Public library and seminar data can remain a bounded cache or online-only view.

This deliberately avoids separate “sync DTO” types for ordinary rows. Push and pull carry a generic row envelope plus the row's shared columns. A small registry allowlists synchronized tables, writable columns, and ownership rules; conflict behavior is one rule for every table, so the registry does not choose one. Adding a normal nullable field requires one shared migration and corresponding application usage—not a new cache overlay, optimistic response shape, ID mapper, and endpoint translator.

The local sequence is generated by SQLite, not by wall clock. It gives one deterministic order for dependent local operations. Wall time is useful for display and diagnostics, but clocks from two laptops are not a safe global ordering authority.

## Mutation lifecycle

### 1. Local commit

When the user edits a note, the Rust repository starts one SQLite transaction:

1. validate that the action is permitted offline;
2. update the note row immediately;
3. insert a unique outbox mutation containing the note UUID and its base server revision;
4. update any file references;
5. commit;
6. notify every open window that affected queries and sync status changed.

The UI reports success only after this local transaction commits. Network activity is never on the critical path.

Repeated high-frequency operations should be coalesced when safe. Ten board drag updates for the same unsynced card can become one final position mutation. Creates and deletes, file references, group membership, and operations with dependencies must retain causal order.

### 2. Blob preparation

Files are named by SHA-256. The outbox contains the hash and metadata, not a second copy of the bytes. Before applying a mutation that references a blob, sync asks whether the backend already has that hash, uploads it if necessary using an idempotent content-addressed endpoint, and then sends the record mutation.

An unsynced blob is user data that has not yet been confirmed by the server. Synced and downloaded blobs are retained locally without an automatic size limit; they are removed only through explicit local-data clearing, account removal, or deletion of the content that references them.

### 3. Idempotent push

Add a batch endpoint such as:

```http
POST /api/sync/push
Authorization: Bearer …

{
  "client_id": "installation UUID",
  "mutations": [
    {
      "mutation_id": "UUID",
      "sequence": 42,
      "table": "board_items",
      "row_id": "UUID",
      "operation": "upsert",
      "base_revision": 8,
      "values": {"x": 120.5, "y": 440.0}
    }
  ]
}
```

For each mutation, the server performs one database transaction:

1. authenticate and authorize against the current user;
2. look up `(user_id, client_id, mutation_id)` in `applied_mutations`;
3. if present, return the original stored result without applying again;
4. validate dependencies and the base revision;
5. apply or reconcile the domain change;
6. increment the entity revision;
7. append a user-visible change to `sync_changes`;
8. store the mutation result in `applied_mutations`;
9. commit.

Only after receiving an acknowledgement does the desktop delete or mark the outbox row complete in a local transaction. A crash before or after any network boundary is therefore recoverable by retrying the same mutation ID.

One invalid mutation must not freeze unrelated future work forever. Preserve ordering within a dependency chain, but classify failures:

- transient network/5xx: retain for retry (scheduled backoff is a future
  operational optimization; automatic sync is event-driven, not a tight loop);
- authentication: pause until credentials refresh;
- dependency: wait for the prerequisite mutation;
- validation/conflict requiring a choice: mark `blocked`, preserve the local
  value and recovery snapshot, expose it in sync status, and continue with
  later independent mutations;
- permanent forbidden operation: mark rejected, retain enough information to undo or export it.

### 4. Incremental pull

Add a cursor endpoint:

```http
GET /api/sync/pull?cursor=1842&limit=500

{
  "changes": [
    {"sequence": 1843, "table": "comments", "id": "UUID", "revision": 7,
     "operation": "upsert", "row": {…}},
    {"sequence": 1844, "table": "board_items", "id": "UUID", "revision": 12,
     "operation": "delete"}
  ],
  "cursor": 1844,
  "has_more": false
}
```

The server cursor is opaque to the client even if implemented as a monotonic integer. Authorization filters every change; the client must never be trusted to request another user's private partition.

The client applies a page of changes and advances its cursor in the **same local transaction**. If the process crashes, it replays the page safely. Deletions travel as tombstones rather than disappearing from server queries before every client can observe them. CouchDB's mature replication protocol uses the same broad ideas—sequence-based incremental changes, checkpoints, and tombstones—although Papol does not need to implement CouchDB's document protocol.[^couch-replication]

An initial sync is a snapshot with a starting cursor. The snapshot must have a consistent boundary so changes occurring during download are not missed. For Papol's present backend SQLite database, this can be produced inside a read transaction together with the maximum visible change sequence.

## Conflict policy

No library can infer product meaning for conflicts. Keep the rules explicit and small.

| Entity/change | Recommended rule |
| --- | --- |
| New records | Client UUID makes concurrent creation distinct; idempotency prevents duplicates |
| Independent scalar fields | Merge if server changes and local mutation touched disjoint fields |
| Same private scalar field | Later server-applied mutation wins, but retain the replaced value in short conflict history |
| Note text edited on two devices | Preserve the rejected/local version as a conflict copy; never silently lose prose |
| Board item position/size | Last server-applied mutation wins; movement mutations may be coalesced |
| Group layout/membership | Require matching base revision; if stale, rebase when membership is unchanged, otherwise show blocked conflict |
| Delete versus update | Delete wins, with a recoverable tombstone/trash window |
| Attachments | Identity is content hash; different bytes are distinct versions, never an in-place overwrite |

“Later server-applied” is intentionally not “largest client timestamp.” Server order is deterministic and cannot be manipulated by clock skew. The mutation includes its base revision, so Papol can tell a clean update from a concurrent one.

CRDTs become justified only if Papol introduces simultaneous collaborative editing of the same text or canvas and wants automatic convergence without central serialization. Even then, a CRDT would apply to those specific document fields, not automatically replace the entire relational sync architecture.

## Exact synchronization semantics

### Automatic

Local saving is always immediate. While the app is running, the coordinator attempts sync:

- after startup and authentication;
- shortly after a local mutation, with debounce/coalescing;
- when network reachability returns;
- when the app regains focus;
- periodically while active, using a modest interval as a fallback;
- after an explicit Sync click.

One cycle uploads required blobs, pushes ready mutations, then pulls changes until the cursor is current. Failures use backoff. A WebSocket “changes available” hint can be added later, but the cursor pull remains the correctness mechanism.

### Manual

All permitted edits still save locally and accumulate in the outbox. No automatic push or pull occurs. Pressing **Sync** runs the same complete cycle: upload, push, then pull. The UI remains mounted; reactive local queries update in place. Manual mode is local to that device.

The status model should be small and truthful: `Saved on this Mac`, `N changes to sync`, `Syncing`, `Synced`, `Needs attention`, or `Offline`. Network reachability alone is not “synced”; only an empty ready outbox plus a completed pull is.

## Storage and cache policy

Call things by their durability:

- **Replica data** is durable application data. Keep it until the user removes the account from the device.
- **Unsynced files** are user data the server has not confirmed yet.
- **Cache files** are server-backed local PDFs, attachments, thumbnails, and previews.
- **Bundled UI** is part of the signed app bundle and is neither replica nor cache.

Cache files have no automatic size limit and remain on the device until their referencing content is deleted, the account is removed, or local data is explicitly cleared. Show separate totals for unsynced and cached data. Removing an account should offer a clear choice if unsynced changes exist: sync first, export local work, or explicitly discard it.

The database should retain compact tombstones and mutation deduplication records long enough for every supported offline horizon. Do not prune solely by age without a per-device acknowledgement or a full-resync strategy.

## Credentials, encryption, and privacy

Store the backend refresh/access credential in the webview's local storage and load it into memory at startup. Do not use the bearer token as a cache namespace or persist it inside every outbox row. Outbox rows carry `account_id`; the coordinator receives the current credential at send time. Treat script execution in the app origin as credential-sensitive because local storage is not an OS-backed secret store.

SQLite and file permissions prevent casual cross-account exposure but are not application-level encryption. Decide explicitly whether the threat model requires protection from someone who can read the user's unlocked filesystem. If yes, use a well-supported encrypted SQLite build and encrypt blobs with a separately designed key-management mechanism. Do not invent field encryption ad hoc.

Each account must have a distinct logical partition. A stronger, simpler cleanup boundary is one database and blob namespace per account plus one device-settings database. On logout, close the account database; on removal, verify no pending work or obtain explicit discard/export intent.

Tauri capabilities should allow only bundled Papol windows to invoke the relevant domain commands. Viewer and board windows can receive narrower commands than the main library. Tauri warns that capabilities assigned to multiple windows merge, so capability files must be reviewed as security boundaries.[^tauri-capabilities]

## Verification plan

Offline synchronization is proven with failure testing, not only happy-path unit tests.

### Required invariants

- local entity update and outbox insertion are atomic;
- an acknowledged mutation is applied at most once server-side;
- replaying a pull page is harmless;
- advancing a cursor without applying all its changes is impossible;
- a blob cannot be evicted while referenced by pending work;
- one account can never read or push another account's partition;
- all windows observe the same sync state;
- Manual mode performs no network sync until Sync is clicked;
- Automatic mode and explicit Sync use the identical engine;
- the UI never reloads the whole page to display synchronized changes.

### Failure matrix

Automate crashes or process termination:

- before local transaction commit;
- after local commit, before network send;
- after the server commits, before the response arrives;
- after the acknowledgement arrives, before local outbox deletion;
- halfway through blob upload;
- halfway through a pull page;
- while two WebViews request sync;
- during schema migration;
- during account switch/logout.

Also test duplicated requests, reordered responses, connectivity flapping, expired credentials, disk full/quota exceeded, corrupt or missing blobs, a permanently invalid mutation at the queue head, two devices editing the same note, delete-versus-edit, and a stale board group layout.

### Observability

Log mutation IDs, client IDs, cursors, attempt counts, error classes, and durations without logging note contents, bearer tokens, or raw files. Provide a local diagnostics export with redacted sync metadata. Server metrics should track outbox latency, idempotency hits, conflict rate, rejected mutations, pull lag, blob failures, and full-resync frequency.

## Sources

[^local-first]: Martin Kleppmann et al., [Local-first software: You own your data, in spite of the cloud](https://www.inkandswitch.com/local-first/), Ink & Switch / Onward! 2019.
[^android-offline]: Android Developers, [Build an offline-first app](https://developer.android.com/topic/architecture/data-layer/offline-first).
[^sqlite-atomic]: SQLite, [Atomic Commit in SQLite](https://www.sqlite.org/atomiccommit.html).
[^sqlite-wal]: SQLite, [Write-Ahead Logging](https://www.sqlite.org/wal.html).
[^couch-replication]: Apache CouchDB, [Replication protocol](https://docs.couchdb.org/en/stable/replication/protocol.html).
[^tauri-security]: Tauri, [Security](https://v2.tauri.app/security/).
[^tauri-capabilities]: Tauri, [Capabilities](https://v2.tauri.app/security/capabilities/).
[^tauri-sql]: Tauri, [SQL plugin](https://v2.tauri.app/plugin/sql/).
[^tauri-path]: Tauri, [JavaScript path API](https://v2.tauri.app/reference/javascript/api/namespacepath/).
