# Papol offline-first data and sync architecture

Research date: 2026-09-12

Status: implemented architecture and continuing operational reference

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

## Current implementation: what it gets right

The present implementation in `shared/offlineStore.js` is a useful prototype. It already establishes several correct product boundaries:

- it permits only an explicit list of private operations offline;
- it distinguishes automatic and manual synchronization locally;
- it stores successful JSON responses, queued operations, blobs, and temporary ID mappings in IndexedDB;
- it uses content hashes for offline PDFs and board files;
- it replays operations in order and stops when a request fails;
- it routes remote HTTP through Tauri's native HTTP plugin while bundled resources remain in the WebView;
- it lets the viewer send excerpts and clips into boards through the same offline layer.

This work is valuable because it proves the UI flows and identifies the domain operations that need offline support. It should be treated as a compatibility bridge and test oracle during migration, not discarded as a failed approach.

## Current implementation: risks that prevent it being the final design

### Cached HTTP responses are the data model

The `responses` store is keyed by bearer authorization header plus API path. Queued mutations are then interpreted again and overlaid on arbitrary nested response JSON using route-specific JavaScript. This creates multiple representations of the same paper, note, shelf, or board. Every new endpoint or response shape can make the overlays disagree.

A normalized local replica eliminates this class of bug. A note exists once in a `notes` table; the library, paper detail, and viewer query that same row.

### A local edit and its visible state are not one atomic transaction

The current queue record, optimistic response entries, blob entry, and ID mapping are written in separate IndexedDB transactions. A crash between them can leave a queued operation without its file, or visible optimistic data without a queued mutation. The target invariant is one database transaction for the entity change, its outbox row, and any blob reference.

### Replay is not idempotent

The code correctly recognizes the “server committed but response was lost” problem and currently refuses to queue some ambiguous failures. That prevents duplication at the cost of making a valid user edit fail offline. The canonical answer is a stable client request ID and server-side deduplication. AWS's guidance for safe retries describes the same failure: a request may complete server-side while the client times out, so a caller-provided idempotency token lets the retry recover the original result rather than repeat the action.[^aws-idempotency]

### Temporary integer IDs require heuristic rewriting

Negative temporary IDs are replaced recursively in fields whose names look like IDs and in URL path segments. That is brittle and makes dependencies implicit. New offline-created entities should receive permanent UUIDs on the client. Server integer IDs may remain internal during migration, but references and sync identity should use stable UUIDs.

### There is no real pull protocol

“Sync” currently drains mutations and asks mounted screens to refetch. There is no per-account cursor, server change feed, or tombstone stream. Consequently, another device's deletion can be missed, the app cannot prove that it is caught up, and synchronization cost grows with whole-resource refetches.

### Multi-window coordination is only per WebView

The module-level `syncing` promise prevents duplicate work inside one JavaScript realm. Papol has separate library, viewer, and board WebViews, so each window can own a different singleton and replay concurrently. The coordinator must be process-wide. Tauri supports Rust commands, managed state, and channels for communicating from the frontend; this is the natural boundary for a single desktop sync actor.[^tauri-rust]

### IndexedDB is managed as browser-origin storage

IndexedDB is capable of offline applications and transactional records, but its quota and persistence are controlled by the browser storage manager. MDN notes that browser storage is best-effort by default, can be evicted, and fails with `QuotaExceededError` at quota; persistent storage can be requested where supported.[^mdn-quota] That model is acceptable for a hosted web fallback, but it is a poor semantic fit for the only copy of a user's unsynchronized desktop work.

### Secrets and accounts are not cleanly partitioned

The bearer token appears in response keys and queued request headers, while files and ID mappings are not intrinsically account-scoped. Tokens persist in the webview's local storage and every local row must carry an account partition. This storage is convenient and shared across Papol windows, but it does not provide OS-backed secret protection.

### Storage has no lifecycle

There is no reference counting, download management, or distinction between irreplaceable unsynced files and server-backed cached files. Those categories must not share one deletion policy.

## Recommended target architecture

```text
Bundled React UI: library / viewer / board windows
              │ Tauri commands + status channel
              ▼
      Papol desktop data service (Rust, one per process)
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

Use one ordered directory of **shared domain migrations** as the canonical physical schema. Both the backend migration runner and Rust `sqlx` migration runner execute those files. SQLAlchemy models remain useful runtime mappings, but CI creates a fresh database from the shared migrations and compares its columns, constraints, and indexes with SQLAlchemy metadata. This prevents drift without first building a custom schema generator.

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

Synchronized domain tables should include at least a stable UUID `id`, `revision`, `updated_at`, `deleted_at` or an equivalent tombstone flag, and normal query indexes. Papol will share papers and editions as read-only dependencies and synchronize user-owned copies, private notes, ink, clips, shelves, tags, boards, board items, and board groups. Public library and seminar data can remain a bounded cache or online-only view.

This deliberately avoids separate “sync DTO” types for ordinary rows. Push and pull carry a generic row envelope plus the row's shared columns. A small registry allowlists synchronized tables, writable columns, ownership rules, and exceptional conflict handlers. Adding a normal nullable field requires one shared migration and corresponding application usage—not a new cache overlay, optimistic response shape, ID mapper, and endpoint translator.

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
      "operation": "patch",
      "base_revision": 8,
      "patch": {"x": 120.5, "y": 440.0}
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

## Off-the-shelf options

### Decision matrix

| Product | What it supplies | Fit for current Papol | Decision |
| --- | --- | --- | --- |
| PowerSync | Client SQLite, local writes/upload queue, partial replication service, Tauri/Rust connector | Closest design, but current server SQLite is unsupported as a replication source; Tauri SDK is alpha; upload application logic is still Papol's responsibility | Re-evaluate after PostgreSQL migration or Tauri SDK stabilization; optional spike now |
| RxDB | Reactive local document DB, schemas/migrations, custom HTTP replication, many storage adapters | Can retain a custom backend protocol, but production Tauri SQLite storage is a paid plugin and Papol still builds authorization/write endpoints | Useful library, not enough simplification to justify migration now |
| Ditto | Local database, CRDT-based cloud and peer-to-peer synchronization, Rust/macOS support | Technically capable but far broader than Papol needs; introduces a new data platform and commercial dependency | Consider only if serverless/peer-to-peer operation becomes a core requirement |
| Couchbase Lite + Sync Gateway | Mature embedded document database, bidirectional sync, conflict handling, attachments | Requires Couchbase Server/Capella and Sync Gateway plus a native integration; replaces much of the backend data stack | Too large a migration |
| ElectricSQL/PGlite | PostgreSQL change streaming into local stores | Current PGlite sync documentation says outgoing local writes and conflict resolution are not yet supported | Not sufficient for offline editing today |
| Zero | Query-driven web sync and fast local reads | Official docs explicitly say no offline writes or long offline operation | Does not meet the requirement |
| Replicache | Optimistic/offline client mutations with custom push/pull | Its public repository was archived in June 2026 | Do not start a new dependency |
| MongoDB Atlas Device Sync/Realm Sync | Former managed device synchronization | MongoDB discontinued the relevant Device Sync offering | Do not use |

### PowerSync

PowerSync most closely resembles the target: it keeps a managed SQLite database on the client, queues local writes for upload, and streams selected backend data down. It has a Tauri SDK whose Rust connector can run across multiple windows even when JavaScript is absent.[^powersync-tauri] That is strong validation for the architecture recommended here.

However, the same official page labels the Tauri SDK alpha and warns of breaking Rust/IPC changes. PowerSync's supported source databases are PostgreSQL, MongoDB, MySQL beta, and SQL Server alpha—not SQLite.[^powersync-overview] Papol would therefore need to migrate the server database and operate PowerSync Cloud or its service. Client SDKs are open source, while its server service uses the Functional Source License.[^powersync-open]

PowerSync also does not eliminate Papol's write-side domain logic: its connector delivers queued CRUD transactions to an application backend, which must authorize and apply them. It primarily saves the read replication/change-feed machinery and much of the client database machinery.

Recommendation: do a two-day proof of concept only if PostgreSQL is already on Papol's roadmap. Test the alpha Tauri SDK, multi-window behavior, attachments, FastAPI write connector, bundle size, migration path, hosting, and licensing before selecting it.

### RxDB

RxDB is a mature reactive local document database with replication primitives. Its free core includes replication, while the production SQLite adapter for Tauri is part of the premium offering; the free SQLite trial is explicitly limited and not for production.[^rxdb-sqlite][^rxdb-premium] RxDB can use a custom HTTP replication protocol, so it fits the current FastAPI backend better than products that require PostgreSQL.

The tradeoff is that Papol still has to implement checkpoints, authorization, conflict handling, file transfer, and server mutations. It also changes the data model to RxDB documents and keeps the sync coordinator close to JavaScript/WebViews unless additional native coordination is built. This is a credible web-first alternative, but not clearly simpler than a small native repository for a Tauri-first desktop app.

### Ditto and Couchbase Lite

Ditto supports persistent offline databases and Rust/macOS, then adds CRDT-based cloud and peer-to-peer synchronization.[^ditto-rust] It is compelling for aircraft, field operations, or local meshes that must synchronize with no central connectivity. Papol currently needs one person's devices to reconcile through an existing backend, so Ditto's peer mesh and platform migration are unnecessary complexity.

Couchbase Lite offers a mature embedded database and secure bidirectional replication through Sync Gateway.[^couchbase-sync] It is a complete answer if an organization already chooses Couchbase. Papol would need Couchbase Server/Capella, Sync Gateway, a document-model migration, and a C/Swift bridge into Tauri. That is a platform rewrite, not a dependency addition.

### Products that do not satisfy the requirement

Electric's PGlite sync extension currently synchronizes server shapes into local tables but explicitly does not yet sync local writes out or resolve conflicts.[^electric-pglite] Zero explicitly rejects writes after disconnection and says it is not for long offline periods.[^zero-offline] Replicache's repository is now archived.[^replicache-archive] MongoDB's own reporting states that it discontinued Atlas Device Sync and related Device SDK support.[^mongodb-discontinued]

## Build versus buy conclusion

Use a **small custom sync protocol over standard SQLite**, not a custom database engine.

Papol's custom portion should be deliberately bounded:

- two sync endpoints (push and pull);
- two or three server bookkeeping tables (applied mutations, change log, client acknowledgements);
- one shared set of domain migrations, with stable UUIDs and revisions on syncable entities;
- one Rust repository/sync actor;
- domain-specific conflict functions;
- content-addressed upload endpoints.

Everything underneath remains established technology: SQLite transactions, HTTPS, FastAPI, SQLAlchemy, Tauri commands/channels, and webview storage. This is less operational and migration risk than adding a replication service whose supported backend and Tauri maturity do not presently match Papol.

The decision should be revisited if any of these become true:

- Papol migrates the production backend to PostgreSQL;
- PowerSync's Tauri SDK becomes stable;
- real-time multi-user board collaboration becomes a near-term requirement;
- peer-to-peer synchronization without a server becomes a product requirement;
- the number of replicated tables, authorization rules, and clients grows enough that operating a sync service is cheaper than maintaining the focused protocol.

## Migration plan

### Phase 0: freeze behavior and terminology

- Keep the current offline route allowlist as the authoritative product policy while designing domain commands.
- Add an inventory test proving every permitted action has a local representation and every shared/security action is rejected offline.
- Define `LocalSyncMode = automatic | manual`; never store it in account settings.
- Specify sync status and error states before changing persistence.

### Phase 1: make the existing protocol retry-safe

This is the highest-value change even before native SQLite:

- generate a persistent `client_id` and a UUID `mutation_id` for every queued operation;
- add server-side idempotency storage and accept the mutation ID on existing mutation endpoints or a new push endpoint;
- stop persisting authorization headers inside queue records;
- give new boards and other offline-created records stable UUID identities;
- add retry classification and a blocked/dead-letter state;
- partition every IndexedDB key by account ID;
- request persistent browser storage and handle quota errors while IndexedDB remains in use.

After idempotency exists, Papol can safely retry an ambiguous failed request instead of refusing to preserve the edit.

### Phase 2: establish the shared domain schema

- create the canonical ordered shared-migration directory;
- classify current tables as shared domain, server-only, or local-only;
- add UUID, revision, updated-at, and tombstone columns to synchronized tables;
- migrate foreign-key relationships to UUIDs in bounded table groups;
- make the backend and future desktop database execute the same domain migrations;
- add a CI schema-conformance test against SQLAlchemy metadata;
- define the small synchronization registry for ownership, writable columns, and conflict exceptions.

During transition, existing integer IDs can remain as server-only compatibility columns. They must not appear in new sync relationships, and they can be removed after routes and data have migrated.

### Phase 3: add server revisions, changes, and tombstones

- add UUID and revision fields to syncable backend tables;
- append authorized changes transactionally with each server mutation;
- retain deletion tombstones;
- implement initial snapshot and cursor pull;
- add per-device acknowledgement and full-resync behavior;
- test account isolation exhaustively.

This phase turns the Sync button into a complete push-and-pull operation rather than a queue drain plus page refetch.

### Phase 4: introduce the native desktop repository

- create a Rust-managed SQLite connection and migrations under Tauri app data;
- expose narrow read/write/sync commands and a status/change channel;
- create normalized local tables and the transactional outbox;
- keep tokens in webview local storage and out of replica/outbox rows;
- move blobs to content-addressed app-data/cache directories;
- ensure one process-wide sync coordinator serves every window;
- update React data hooks to query/subscribe to the repository instead of calling REST directly.

Do one vertical slice first: board plus board items, including viewer-to-board staging and files. It exercises stable IDs, high-frequency layout coalescing, multi-window notifications, attachments, deletes, and conflict handling. Then migrate notes/ink/clips and finally nook organization.

### Phase 5: migrate existing desktop data

On first native-repository launch:

1. identify the signed-in account without copying the bearer token into the new database;
2. import cached normalized entities where their provenance is known;
3. import queued operations in original order and assign mutation UUIDs;
4. copy referenced blobs by hash and verify their digest;
5. run a sync and compare the local replica with a fresh server snapshot;
6. mark migration complete but retain old IndexedDB data for one release as rollback insurance;
7. remove it only after explicit successful migration telemetry or a user-visible cleanup step.

Do not silently import response-cache data for a different account. If identity is ambiguous, preserve the old store and require sign-in before migration.

### Phase 6: web fallback

If the hosted web UI must retain offline editing, implement the same repository interface with IndexedDB, including account partitioning, idempotency, cursor pull, and persistence requests. Desktop uses the native adapter; web uses the IndexedDB adapter. Domain behavior and sync protocol stay shared.

If offline editing is desktop-only, keep the hosted web app server-first and remove the complex queue overlay from it after desktop migration.

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

## Can Papol do this?

Yes. The present code already covers the product surface and optimistic behavior; the missing work is mostly correctness infrastructure. The architecture is compatible with the baked UI, native HTTP transport, existing FastAPI domain rules, and Tauri multi-window design.

The safest implementation order is:

1. server idempotency;
2. one shared domain schema with stable UUIDs and revisions;
3. cursor pull and tombstones;
4. native SQLite repository/outbox;
5. file lifecycle and migration;
6. conflict UX and hardening.

Do not begin by swapping IndexedDB for SQLite alone. A different storage engine does not fix duplicate network commits, missing pulls, temporary-ID rewriting, or conflict semantics. Establish the sync contract first, then move persistence behind it.

## Sources

[^local-first]: Martin Kleppmann et al., [Local-first software: You own your data, in spite of the cloud](https://www.inkandswitch.com/local-first/), Ink & Switch / Onward! 2019.
[^android-offline]: Android Developers, [Build an offline-first app](https://developer.android.com/topic/architecture/data-layer/offline-first).
[^sqlite-atomic]: SQLite, [Atomic Commit in SQLite](https://www.sqlite.org/atomiccommit.html).
[^sqlite-wal]: SQLite, [Write-Ahead Logging](https://www.sqlite.org/wal.html).
[^aws-idempotency]: Amazon Builders' Library, [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).
[^couch-replication]: Apache CouchDB, [Replication protocol](https://docs.couchdb.org/en/stable/replication/protocol.html).
[^mdn-quota]: MDN Web Docs, [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
[^tauri-rust]: Tauri, [Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/).
[^tauri-security]: Tauri, [Security](https://v2.tauri.app/security/).
[^tauri-capabilities]: Tauri, [Capabilities](https://v2.tauri.app/security/capabilities/).
[^tauri-sql]: Tauri, [SQL plugin](https://v2.tauri.app/plugin/sql/).
[^tauri-path]: Tauri, [JavaScript path API](https://v2.tauri.app/reference/javascript/api/namespacepath/).
[^powersync-tauri]: PowerSync, [Tauri SDK (alpha)](https://docs.powersync.com/client-sdks/reference/tauri).
[^powersync-overview]: PowerSync, [PowerSync overview](https://docs.powersync.com/intro/powersync-overview).
[^powersync-open]: PowerSync, [Open-source packages and licensing](https://powersync.com/open-source).
[^rxdb-sqlite]: RxDB, [SQLite RxStorage for hybrid apps](https://rxdb.info/rx-storage-sqlite.html).
[^rxdb-premium]: RxDB, [RxDB premium](https://rxdb.info/premium/).
[^ditto-rust]: Ditto, [Rust console app quickstart](https://docs.ditto.live/sdk/latest/quickstarts/rust-console).
[^couchbase-sync]: Couchbase, [Data Sync using Sync Gateway](https://docs.couchbase.com/couchbase-lite/current/swift/replication.html).
[^electric-pglite]: PGlite, [Sync using Electric](https://pglite.dev/docs/sync).
[^zero-offline]: Rocicorp, [Zero connection status and offline behavior](https://zero.rocicorp.dev/docs/connection).
[^replicache-archive]: Rocicorp, [Replicache repository](https://github.com/rocicorp/replicache).
[^mongodb-discontinued]: MongoDB, [2025 Form 10-K](https://investors.mongodb.com/static-files/2e35ada9-36d6-4ea2-a03a-bbba3b559770).
