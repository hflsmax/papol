# Papol offline-first implementation plan

Date: 2026-09-12

Companion decision record: [offline-first architecture](./offline-first-architecture.md)

## Goal

Build an offline desktop data layer that remains easy to extend. Papol will have one shared relational domain schema, one local SQLite replica, one server database, and generic synchronization infrastructure around the shared tables.

The plan intentionally avoids four parallel representations of a feature:

```text
REST response cache ≠ optimistic object ≠ local row ≠ server row
```

Instead:

```text
                 same domain table and UUID
local SQLite  ←──────────────────────────────→  server database
     │                                                   │
_local_* infrastructure                       _server_* infrastructure
```

## Decisions to hold constant

1. Synchronized domain tables have the same names, columns, meanings, UUID keys, revisions, and tombstones locally and remotely.
2. The desktop stores only the rows needed by the signed-in account, not a copy of the entire service.
3. The local SQLite database is the desktop UI's source of truth.
4. User-owned mutations commit locally before any network request.
5. The remote server remains authoritative for authorization and shared/public effects.
6. Sync preference is `_local_settings.sync_mode`; it never enters server account settings.
7. A single Rust coordinator owns network synchronization for all Tauri windows.
8. Ordinary tables use generic row synchronization. Only genuinely exceptional workflows get custom sync commands.
9. No CRDT is introduced until Papol supports simultaneous editing of the same shared document.
10. HTTP is network-only; the retired IndexedDB response cache and mutation queue are not part of the application data model.

## Schema ownership

### Repository layout

Introduce these areas when implementation begins:

```text
schema/
  domain/
    202609120001_sync_identity.sql
    202609120002_board_sync.sql
    ...
  sync_registry.json

backend/
  sync/
    api.py
    apply.py
    changes.py
    registry.py

desktop/src-tauri/src/
  data/
    database.rs
    migrations.rs
    mutations.rs
    queries.rs
    blobs.rs
  sync/
    coordinator.rs
    push.rs
    pull.rs
    status.rs
```

The exact filenames may change, but the boundaries should not.

### Canonical domain migrations

`schema/domain` is the canonical physical definition of synchronized tables. Migrations are append-only, ordered, SQLite-compatible SQL. Both the Python backend migration runner and the Rust desktop migration runner execute the same files.

The backend's SQLAlchemy models remain runtime mappings, not an independent migration authority. CI creates a clean database from the shared migrations and compares each synchronized table against SQLAlchemy metadata:

- column names and types;
- nullability and defaults;
- primary and foreign keys;
- unique constraints;
- indexes.

This gives one actual schema source without first creating a bespoke code generator.

### Sync registry

`sync_registry.json` contains only semantics that SQL cannot infer safely:

```json
{
  "board_items": {
    "owner": "board.user_id",
    "client_writable": [
      "group_id", "content", "staged", "text_align",
      "position", "x", "y", "width", "deleted_at"
    ],
    "conflict": "field_patch",
    "blob_columns": ["sha256"]
  }
}
```

The registry does not restate all columns or types. Full rows are serialized from database metadata. The registry controls authorization, which fields an offline client may change, the conflict handler, and file dependencies.

Python validates the registry against SQLAlchemy metadata. Rust embeds the same file at build time and validates incoming/outgoing table and column names. A CI test fails if the registry names a missing table or column.

## Shared domain model

### Tables synchronized read/write

These are private and user-owned:

- `copies`
- `copy_tags`
- `comments` (private notes)
- `ink_strokes`
- `paper_clips`
- `shelves`, excluding delayed publication changes
- `tags`
- `boards`
- `board_items`
- `board_groups`

### Tables synchronized primarily read-only

The desktop needs these as dependencies of the user's records:

- `papers`
- `paper_editions`
- the bounded reference-analysis rows needed for downloaded editions

Adding a PDF is an exceptional workflow because the server currently canonicalizes papers across users. The local app can create the edition by content hash and a local paper UUID, but the server may discover an existing canonical work. Handle this through one explicit `paper.import` mutation and a generic `_server_id_aliases` result, rather than recursively rewriting arbitrary JSON fields.

The longer-term simplification is to use content hash as edition identity and UUIDs as paper identity, with server deduplication represented as an explicit alias/merge event.

### Server-only tables

These do not appear in the local replica:

- authentication tokens and password material;
- operational analytics;
- admin data and feedback management;
- full public directory and seminar state;
- `_server_applied_mutations`;
- `_server_change_log`;
- `_server_clients` and cursor acknowledgements;
- `_server_id_aliases`, if paper canonicalization needs it.

### Local-only tables

These never synchronize:

- `_local_settings`;
- `_local_accounts`;
- `_local_sync_state`;
- `_local_outbox`;
- `_local_blobs` and `_local_blob_refs`;
- `_local_conflicts`;
- optional local search indexes and UI state.

## Identity migration

The existing server uses integer primary keys for most records and a GUID alongside the integer for boards. Converting everything at once would be risky. Migrate by connected groups.

### Transition rule

Add a non-null unique UUID `sync_id` to existing synchronized tables first. New APIs and relationships use `sync_id`; existing integer keys remain temporary server compatibility columns. Once every relationship and route in a group uses UUIDs, rename `sync_id` to `id` in a table rebuild and retire the integer key.

The local database is introduced only with the final UUID shape. It never persists the temporary integer identity as a relationship key.

### Migration groups

1. Boards: `boards`, `board_items`, `board_groups`.
2. Reader annotations: `comments`, `ink_strokes`, `paper_clips`.
3. Nook organization: `copies`, `shelves`, `tags`, `copy_tags`.
4. Paper dependencies: `papers`, `paper_editions`, reference rows.

Each group is independently deployable and keeps compatibility routes until its clients have migrated.

## Generic mutation model

An ordinary local mutation is a transaction containing one or more row patches:

```json
{
  "mutation_id": "69321eec-4fd9-46d0-9c19-a08df43443bf",
  "client_id": "desktop-installation-uuid",
  "local_sequence": 108,
  "changes": [
    {
      "table": "board_items",
      "id": "item-uuid",
      "base_revision": 12,
      "operation": "patch",
      "values": {"x": 420.0, "y": 260.0}
    }
  ]
}
```

Creating a group and assigning its cards is one mutation containing the group insert and several card patches. The server applies the entire mutation transactionally or rejects it as a unit.

### Local write transaction

The Tauri data service:

1. checks the table and fields against the embedded registry;
2. verifies that the current local account owns the row or its parent;
3. applies the row change;
4. inserts the exact mutation into `_local_outbox`;
5. updates blob references if necessary;
6. commits once;
7. emits invalidation and sync-status events to all windows.

### Server apply transaction

`POST /api/sync/push`:

1. authenticates the current user;
2. checks `(user_id, client_id, mutation_id)` for a previous result;
3. validates every table, field, ownership path, base revision, and domain invariant;
4. applies the row changes in dependency order;
5. increments affected row revisions;
6. writes full-row snapshots or delete tombstones to `_server_change_log`;
7. stores the result in `_server_applied_mutations`;
8. commits once.

The server returns canonical rows and revisions. A duplicated push returns the stored result without applying the mutation again.

### Existing REST writes

Browser and online-only routes must also enter the change log. Do not rely on developers remembering to append log rows in every endpoint.

Introduce one SQLAlchemy unit-of-work commit helper for synchronized models. It inspects the session's new, dirty, and deleted registered objects, increments revisions, and appends change snapshots in the same transaction. Existing endpoints gradually replace direct `db.commit()` for synchronized data with this helper. Tests assert that every registered model write produces the correct change entry.

The sync push path uses the same domain validators and unit of work as REST routes; it does not implement a second set of business rules.

## Generic pull model

`GET /api/sync/pull?cursor=...` returns authorized changes after an opaque cursor. A change contains:

```json
{
  "sequence": 8872,
  "table": "board_items",
  "id": "item-uuid",
  "revision": 13,
  "operation": "upsert",
  "row": {
    "id": "item-uuid",
    "board_id": "board-uuid",
    "x": 420.0,
    "y": 260.0,
    "revision": 13,
    "deleted_at": null
  }
}
```

The Rust client checks the table and columns against the embedded schema/registry, then applies the page and advances `_local_sync_state.pull_cursor` in one SQLite transaction.

Pull returns complete rows initially. Patches can reduce bandwidth later, but full rows are easier to evolve and recover. The protocol envelope has its own version. Additive nullable columns are backward compatible: old clients ignore unknown columns only after protocol validation explicitly allows that behavior; new clients use migration defaults when talking to an older server.

## Desktop IPC surface

Avoid implementing one Rust command per field while also avoiding unrestricted writes from the WebView. Start with a small stable API:

- `data_query(query_name, parameters)` — registered read queries;
- `data_mutate(mutation)` — registry-validated row transaction;
- `blob_import(path_or_bytes, metadata)`;
- `blob_url(sha256)` or a scoped Tauri asset URL;
- `sync_now()`;
- `sync_status()`;
- a channel carrying query invalidations and sync status.

Query names correspond to product views such as `library`, `paper`, `board`, and `viewer_annotations`. Adding a new screen naturally requires a query, but adding a field to an existing row usually changes only its query selection and UI.

Do not expose `sql:allow-execute` to every window. If the official Tauri SQL plugin is used, restrict it to read-only access and the specific database; all domain writes still pass through `data_mutate` so the local row and outbox record cannot separate.

## File protocol

Files are addressed by SHA-256 on both sides.

- `_local_blobs` stores metadata and durability; bytes live on disk.
- A mutation refers to `sha256`, never embeds duplicate bytes.
- Before pushing a dependent mutation, the coordinator checks `HEAD /api/sync/blobs/{sha256}`.
- Missing content uploads with an idempotent `PUT /api/sync/blobs/{sha256}`.
- The server verifies the digest before making it available.
- Pending content cannot be evicted.
- Pulling a row does not automatically download a large PDF. It records the hash; open/pin initiates download.

YouTube frames and web captures are jobs derived from a user-owned board card. The card can be created offline with `preview_state = 'pending'`; synchronization asks the server to derive the preview and later pulls the completed blob hash.

## Conflict behavior

The generic default is field-level optimistic concurrency:

- if `base_revision` matches, apply;
- if it is stale but changed fields do not overlap, merge;
- if the same scalar field changed, later server application wins and the old value enters `_local_conflicts` briefly;
- note-text overlap creates a recoverable conflict copy;
- delete beats update but remains recoverable during the tombstone window;
- compound board-group changes reject when membership changed and remain visible as needing attention.

Conflict handlers are named in the registry. Most new tables choose an existing handler; a developer writes new conflict code only when the product semantics are genuinely new.

## Extension workflow

This is the test of the architecture.

### Add a nullable field to an existing synchronized table

Example: `board_items.color`.

1. Add one shared domain migration.
2. Add the column to the SQLAlchemy model; CI verifies exact agreement.
3. If clients may edit it, add `color` to that table's registry allowlist.
4. Select/display/edit it in the relevant UI query.
5. Add a round-trip test.

No new sync endpoint, response cache, optimistic shape, ID mapping, or pull serializer is required.

### Add a normal user-owned table

Example: private board labels.

1. Add the shared table migration with UUID, revision, timestamps, tombstone, and ownership relationship.
2. Add its SQLAlchemy mapping.
3. Add one registry entry selecting ownership and an existing conflict policy.
4. Add local queries and UI mutations.
5. Add authorization, push/pull, deletion, and account-isolation tests.

### Add an online-only feature

Add only the server schema/API and UI. Do not put it in the sync registry or local database. The offline policy test ensures it cannot accidentally enter `_local_outbox`.

### Add an exceptional workflow

Only operations involving server-side derivation, canonical merging, or external irreversible effects get a named command mutation. The command still uses mutation UUID idempotency and records resulting ordinary rows in the same server change log.

## Delivery stages

### Stage A — contract and safety foundation

Implementation status (2026-09-12): complete. The compatibility queue has
persistent client/mutation UUIDs, stores account scope instead of bearer
credentials, retries ambiguous responses idempotently, and is restricted by an
explicit user-owned operation allowlist.

- write an ADR for the fixed decisions above;
- add client and mutation UUIDs to the current IndexedDB queue;
- implement server idempotency for queued mutations;
- remove bearer headers from persisted queue entries;
- classify every existing mutation as offline row, offline command, or online-only;
- add ambiguous-response retry tests.

Exit criterion: the current offline queue can retry after “server committed, response lost” without duplication.

### Stage B — shared board schema

Implementation status (2026-09-12): complete for the board domain. UUID push
and cursor pull, tombstones, revisions, ownership checks, persistent replay
results, content-addressed blobs, REST change logging, registry validation, and
schema column conformance are covered by the backend contract tests.

- introduce shared migrations and schema-conformance CI;
- migrate board tables to UUID relationships, revisions, and tombstones;
- add the board registry entries;
- route existing board REST writes through the synchronized unit of work;
- add server change-log and pull endpoints for boards.

Exit criterion: two API clients can push, pull, retry, and delete board rows using only UUIDs and cursors.

### Stage C — native board vertical slice

Implementation status (2026-09-12): implemented and enabled on desktop. The
Rust-owned SQLite store uses ordered atomic migrations, transactional outbox
writes, account validation, blob references/durability, a process-wide sync
gate, and Tauri events across windows. The real-process E2E harness proves an
offline board, comment, and viewer clip survive restart and synchronize once.

- add Rust SQLite, migrations, IPC, and coordinator;
- implement board queries and generic local mutations;
- implement board blobs and viewer-to-board staging;
- put the feature behind a local development flag;
- verify multiple Tauri windows share one coordinator and update without reload.

Exit criterion: create and fully edit a board offline, quit the app, reopen it offline, then synchronize it exactly once.

### Stage D — annotations and nook

Implementation status (2026-09-12): complete for approved private desktop
operations. Notes, ink, clips, copies, tags, shelves, paper/edition dependencies,
content-hash PDF import and canonical identity aliases use the native replica.
The bearer credential is loaded into JavaScript memory and persists in the
webview's local storage. Visibility changes, account/security, seminars, and social actions
remain deliberately online-only.

- migrate notes, ink, clips, copies, shelves, tags, and associations;
- add paper/edition read dependencies;
- implement the explicit PDF import/canonicalization workflow;
- add local search where needed;
- standardize credential persistence in webview local storage.

Exit criterion: every approved user-owned operation works across restart and sync; shared/security operations remain online-only.

### Stage E — storage lifecycle and migration

Implementation status (2026-09-12): complete for the native rollout baseline.
Blobs have unsynced/cache classes, verified downloads retained without an
automatic size limit, reference protection, storage diagnostics, sign-out
protection, and a portable recovery export. The legacy IndexedDB database is
left physically untouched for recovery, but no runtime code reads it or treats
it as application state.

- implement unsynced/cache file classes without automatic eviction;
- add diagnostics/export and unsynced-work logout protection;
- soak-test before enabling native storage by default;
- remove the old response cache and HTTP mutation queue explicitly.

Exit criterion: upgrade from the current desktop build without losing queued edits or files, including after simulated crashes.

### Stage F — remove compatibility machinery

Implementation status (2026-09-14): complete for desktop storage. Native
screens no longer use response overlays, negative IDs, or an HTTP mutation
queue. Server integer keys and legacy routes remain temporarily for
browser clients and the promised rollback release; their later deletion is a
compatibility retirement, not part of enabling offline desktop use.

- remove response-cache overlays and temporary negative-ID rewriting;
- retire integer compatibility keys and routes after supported clients migrate;
- keep only a bounded cache for replaceable public/derived data;
- document the new-feature workflow in the contributor guide.

Exit criterion: synchronized feature work follows the four- or five-step extension workflow above.

## Test gates before default rollout

- schema migration forward from every released desktop schema;
- SQLAlchemy/shared-DDL conformance;
- registry/schema conformance;
- account isolation for every registered table;
- duplicate push and ambiguous network response;
- cursor page replay and crash before cursor commit;
- two-window concurrent sync request;
- two-device conflict for every conflict handler;
- delete/update conflict and tombstone recovery;
- disk full during local edit and blob import;
- interrupted blob upload and digest mismatch;
- Manual mode produces no background network traffic;
- explicit Sync performs upload, push, and pull without navigation or reload;
- HTTP failures never return cached domain responses or enqueue REST mutations.

The automated suites cover these gates through backend contract/schema tests,
Rust database/coordinator tests, frontend/viewer/board tests, and the disposable
real-process native synchronization harness. Destructive disk-full behavior is
simulated by making the blob path unwritable; the harness covers process restart,
blob transfer, ordered push, snapshot, and cursor pull.

## First implementation slice

Start with board data, not with every table and not with a storage-engine-only replacement. Boards exercise almost every difficult property while remaining private:

```text
boards
  ├── board_groups
  └── board_items ── sha256
```

The first slice should include:

1. shared UUID/revision/tombstone schema for these three tables;
2. server idempotency and change log;
3. push and cursor pull;
4. native local tables and outbox;
5. create, rename, delete, move, resize, group, ungroup, stage, restore;
6. viewer-to-board excerpt and clipped-image transfer;
7. one automatic/manual coordinator shared by all windows;
8. crash and duplicate-delivery tests.

This slice will validate the architecture before Papol commits to migrating the paper and annotation model. If adding one extra board field still requires touching sync engine code after this slice, stop and simplify the abstraction before expanding it.
