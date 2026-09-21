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

## Phase 2 — Object storage for files — DONE 2026-09-21

Landed: every file Papol stores goes through `backend/storage.py`, and the
bytes can live in a bucket. Two areas — `uploads` (a paper's PDF under its
digest, an avatar under a UUID) and `board_files` (a board's files under
its uuid, the desktop's blobs under `blobs/`) — each behind one interface:
put, get, exists, delete, list, copy, a local path for the readers that
need one (PyMuPDF, the GROBID upload), and a URL. The keys are the
`file_path` values the database already held, so no row changed.

Two backends. Unset, `PAPOL_FILES_URL` means the filesystem — the
`uploads/` and `board_uploads/` directories, as before — which is what
development, the suite and the e2e harnesses run on. `s3://bucket[/prefix]`
means S3-compatible object storage through boto3, with the endpoint and
credentials in boto3's own variables (`AWS_ENDPOINT_URL_S3`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` —
`auto` for Cloudflare R2). Both areas are prefixes in that one bucket.

Serving follows from the backend, and the API contract did not move: the
same URLs answer either way. With a bucket, `/uploads/{key}`,
`/api/board-items/{uuid}/file` and `/api/sync/blobs/{sha256}` answer a 307
to a URL the bucket serves itself — presigned for an hour, or the CDN when
`PAPOL_FILES_PUBLIC_URL` names a public face for the bucket (uploads only;
board files stay presigned, because the link is the credential). The web
tier never carries file bytes. With the filesystem, the process serves
the file as it always did. Browsers and the desktop's native client
both follow the redirect and drop the `Authorization` header when they
cross origins, which is what lets a presigned URL and a bearer token
coexist on the authenticated routes.

`deploy.sh pull` calls `scripts/pull-files.py`, which reads each
checkout's `.env`, builds the two stores it describes, and copies across
whatever development lacks — bucket to directories, directories to
directories, whichever pair it finds. `backend/test_storage.py` runs one
contract against both backends, the bucket being a small S3 server started
in-process that boto3 talks to over real HTTP, and follows each route's
redirect to it.

To move production onto a bucket: make the bucket, put the variables in
`/srv/papol/prod/.env`, load the directories into it, and deploy:

    sudo systemctl stop papol
    python scripts/pull-files.py --from-directories /srv/papol/prod /srv/papol/prod
    ./deploy.sh prod

(With the flag the source is the checkout's directories whatever its
`.env` says, and the destination is the store the `.env` names; the copy
is idempotent, so an interrupted one is rerun.) The bucket needs a CORS
rule allowing `GET` and `HEAD` from the site's origin, with
`Content-Length`, `Content-Range`, `Accept-Ranges` and `ETag` exposed:
pdf.js fetches the PDF across origins and reads by range. The daily R2
archive still zips the checkout and the dump; the bucket is its own
durable store and is not in the archive.

What the phase was planned around, kept for the record:

`uploads/` and `board_uploads/` were local paths served by the Python
process (`StaticFiles` mounts and `FileResponse` in `backend/main.py`).
Two instances could not share them.

1. Introduce a storage interface (put / get / delete / public URL) and move
   the current filesystem code behind it.
2. Move the bytes to S3-compatible object storage. PDFs and board files are
   served by presigned URL or CDN, not through the app.
3. `deploy.sh pull` learns to sync the bucket alongside the dump.

## Phase 3 — Background jobs — DONE 2026-09-21

Landed: the web tier does no heavy work. What a request cannot answer at
once it writes as a row in a `jobs` table — in the same transaction as
the paper, the card or the report the job is about — and
`backend/worker.py`, a second process on the same code and environment,
claims rows with `SELECT ... FOR UPDATE SKIP LOCKED` and runs them.
`backend/services/jobs.py` is the whole protocol: enqueue, claim, finish,
fail. There is no broker; the queue is PostgreSQL, which any number of
workers on any number of hosts already share, and the same shape ports
to Go as one table and one query. A job's `key` holds one live job at a
time (one analysis per paper, one daily digest); a worker that dies
mid-job leaves it `running`, and after a fifteen-minute lease the next
claim takes it up once more, then fails it.

The API contract changed in two places, and both are the final shape:

- `POST /api/papers/extract` stores the PDF and answers `202` with
  `{job, file_path, sha256}`. The reading of the file — the printed
  identifier, CrossRef and OpenAlex, GROBID's title block as a last
  resort — is the `extract_metadata` job, and its result is the
  `ExtractedMetadata` the form used to get in the response.
- `POST /api/boards/{uuid}/webpage` and `/youtube` check the link, write
  the card, and answer `202` with `{job, item}`. The card is on the board
  as a link at once; the `capture_webpage` / `capture_youtube` job puts
  the picture on it, and a capture that fails leaves the card as the link
  it was, with the job saying why.

Both are polled at `GET /api/jobs/{uuid}` (`JobOut`: `queued`, `running`,
`done` with `result`, `failed` with `detail`), which answers only the user
whose request queued the job. `shared/api/jobs.js` is the client's side
of it, and `shared/polling.js` is the one loop every wait in a client
goes through — a job ticket and the viewer's reference status alike:
ask, show each answer, stop when it has settled, back off in between. The paper's reference pass (`analyze_paper`) kept its contract —
`papers.references_status` and `/api/viewer-references` saying `pending`
— because that was already a poll; what changed is that the pass runs on
the worker, and its in-process bookkeeping (the `_analyzing` set) became
the job key. Mail is `send_email`, one job per recipient, queued by the
feedback route and by the daily digest; the digest is itself a job that
queues tomorrow's after finishing, so it runs once however many web
processes or workers there are, rather than once per uvicorn startup.
An old desktop build calling the upload route still works: it treats
the ticket as an answer with no title and falls back to the filename.

Production runs `papol-worker.service` beside `papol.service`, from the
same `module.nix` definition (`papolProcess`, `papolServiceConfig`); the
browser, ffmpeg and yt-dlp moved off the web unit's PATH onto the
worker's, and the worker's stop timeout covers a GROBID pass so a deploy
lets the job in hand finish. `./deploy.sh prod` stops and starts both and
checks both; `./deploy.sh dev` runs `python worker.py --reload` beside
uvicorn, and `python -m unittest` runs jobs in-process through
`worker.drain()`. `backend/test_jobs.py` is the queue's own suite: the
key, the lease, and each kind from the request that queues it to the row
the worker leaves.

Two things stayed in the request on purpose. The edit form's "re-read
the PDF" button (`/api/papers/{sha}/extract-metadata`) still answers
synchronously: it is a button, not an upload, and the demo — which has no
jobs, by design — answers it too. And the demo's bundled PDFs are still
analyzed in the web process through the ephemeral reference engine,
because that state is process-local by design and a worker could not
fill it.

What the phase was planned around, kept for the record:

Heavy work ran inside the web process: GROBID calls with a 300-second
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
