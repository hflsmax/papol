# The cloud migration

Written 2026-09-20. Papol today is a single NixOS host: one uvicorn process,
SQLite, files on local disk, a GROBID container on the side. The plan is to
move it to the cloud, expect real load, and rewrite the backend in Go. This
document records the decisions and the order of work, so each phase can land
on its own without re-litigating the destination.

The guiding rule: **change the database where the tests are, change the
language after the data model has stopped moving.** Postgres migrates first,
in Python, covered by the existing suite. The Go port comes later and ports a
stabilized backend, not a moving target. We have no users yet, so every phase
is free to break compatibility (see "break it rather than carry it") — but
not to break the API contract that the three SPAs and the macOS app speak,
which stays fixed throughout.

## What stays

- The HTTP API contract. frontend/, viewer/, board/, and the Tauri desktop
  app talk to the backend over HTTP and do not care what serves it. The
  desktop sync contract in particular is pinned by
  `backend/test_desktop_sync.py`; that test is the acceptance gate for every
  phase, including the Go port.
- GROBID as an external service. It is already out-of-process; in the cloud
  it becomes its own scalable deployment.
- Nix for development environments, for as long as it earns its keep.

## Phase 1 — Postgres (in Python) — DONE 2026-09-20

Landed: the server runs on PostgreSQL everywhere. Development owns a
cluster in the checkout (`.postgres/`, made and started by `./deploy.sh db`
and by `dev`); production gets the system cluster from module.nix, with the
`papol` role reachable over peer authentication by the service and the
deploy user alike. The suite (250 tests) runs against a `papol_test`
database it levels per test class — `testdb.py` refuses any database not
named `*_test`. `serialize_sqlite_writes` is gone, `deploy.sh pull` moves a
`pg_dump` instead of a file, backups are dumps under `backend/backups/`
(and inside the R2 archive), and `scripts/migrate-sqlite-to-postgres.py`
brings a papol.db across once — run for development already; production
runs it at the next deploy. `./deploy.sh prod` activates the system that
carries PostgreSQL and starts the service on an empty database; then, once:

    sudo systemctl stop papol
    python scripts/migrate-sqlite-to-postgres.py \
        /srv/papol/prod/backend/papol.db \
        'postgresql+psycopg://papol@/papol?host=/run/postgresql'
    sudo systemctl start papol

(The script treats a database the service merely started on — a schema
stamp, maybe an error log — as empty; anything more is refused.)

SQLite remains in exactly two places, on purpose: the demo's throwaway
in-memory worlds, and the desktop's local replica (a different database,
owned by the Rust layer, untouched by this phase).

What the phase was planned around, kept for the record:

SQLite's single writer is baked in deeper than the file format:

- `backend/main.py:326` (`serialize_sqlite_writes`) funnels every mutating
  request through one `asyncio.Lock`. It assumes exactly one process, which
  `module.nix` indeed runs. This middleware is deleted at the end of this
  phase — Postgres handles concurrent writers.
- The idempotency middleware holds a transaction open until the response is
  stored. Revisit that pattern under concurrent writers; it must not hold
  locks that other requests need.
- `backend/database.py` introspects `sqlite_master`. Replace with
  SQLAlchemy's inspector or `information_schema`.

Order of work:

1. Make the test suite runnable against Postgres (`DATABASE_URL` already
   exists), in addition to SQLite for now. Fix what falls out.
2. Rework `deploy.sh pull` and the backup story: file copies and the
   `papol.db.bak-*` habit become `pg_dump`/restore. Hand edits to the
   database become `psql`.
3. Cut production over to Postgres. Delete the write-lock middleware and the
   SQLite test leg.
4. While in here: throttle the last-used stamp in `backend/auth.py`
   (`_live_session`) so authenticated reads stop writing on every request.

## Phase 2 — Object storage for files

`uploads/` and `board_uploads/` are local paths served by the Python process
(`StaticFiles` mounts and `FileResponse` in `backend/main.py`). Two instances
cannot share them.

1. Introduce a storage interface (put / get / delete / public URL) and move
   the current filesystem code behind it.
2. Move the bytes to S3-compatible object storage. PDFs and board files are
   served by presigned URL or CDN, not through the app.
3. `deploy.sh pull` learns to sync the bucket alongside the dump.

## Phase 3 — Background jobs

Heavy work runs inside the web process today: GROBID calls with a 300-second
timeout, PDF text extraction, webpage capture, SMTP sends
(`services/feedback.py`, `services/notifications.py`).

1. Paper analysis becomes an explicit job: upload enqueues and returns; the
   client polls (or is pushed) the result. This is an API contract change —
   do it once, before the Go port, so Go ports the final shape.
2. Email and capture move to the same queue.
3. Workers are a separate process from the web tier, even while both still
   run on one host.

## Phase 4 — The Go rewrite

Ported after phases 1–3, when the data model and API shape have settled.
About 10,500 lines of application Python and 5,200 lines of tests.

- The tests are the real asset and the real cost: the sync protocol
  (`backend/sync/`, ~1,200 lines), idempotency, sharables, and the upgrade
  path are all specified by tests that must be translated, not skipped.
  `test_desktop_sync.py` runs against the Go server before anything switches.
- PyMuPDF is used in `pdf_parser.py` (text from the first pages) and
  `grobid.py`. Plain text extraction has Go libraries; whatever `grobid.py`
  needs beyond that gets checked when we get there, with "shell out to a
  small tool" as the acceptable fallback.
- The port is wholesale, not strangler-fig: no users, one developer, and a
  proxy split would cost more than it protects.
- The prize on the other side: one static binary (simpler `module.nix`, or
  its container successor), lower memory per instance, and no GIL between us
  and CPU-bound handlers.

## Phase 5 — Cloud deployment

Mostly configuration once 1–4 are done:

- Managed Postgres with its backup/PITR story replacing the `.bak` files.
- Web tier scaled horizontally (auth tokens already live in the database, so
  instances are stateless); workers and GROBID scaled independently.
- Static assets (frontend/viewer/board dists) behind a CDN instead of
  uvicorn-behind-nginx.
- Structured logs shipped off-host; the `ErrorLog` table remains the
  admin-facing view, not the system of record.
- `deploy.sh` keeps its verbs (`dev`, `prod`, `pull`, `status`) but their
  implementations move from "ssh to the box" to the cloud provider's terms.
