# The cloud migration

Written 2026-09-20; destination revised 2026-09-21. Papol began as a single
NixOS host: one uvicorn process, SQLite, files on local disk, a GROBID
container on the side. The plan is to move it to the cloud and expect real
load. This document records the decisions and the order of work, so each
phase can land on its own without re-litigating the destination.

The guiding rule: **change the database where the tests are, change the
language after the data model has stopped moving.** Postgres migrated
first, in Python, covered by the existing suite; then files, then jobs.
The port comes last and ports a stabilized backend, not a moving target.
We have no users yet, so every phase is free to break compatibility (see
"break it rather than carry it") — but not to break the API contract that
the three SPAs and the macOS app speak, which stays fixed throughout.

The destination, decided after phase 3: **Cloudflare**. The API and the
jobs run as Workers in TypeScript, the database is D1, the files are
already in R2, and the one thing that cannot run there — GROBID, a JVM —
stays on the NixOS host, which becomes the GROBID host and nothing else.
The Go rewrite this document first planned is withdrawn: Go does not run
on Workers, and once the jobs are Workers too there is no resident
process left for Go to be.

D1 is SQLite, which phase 1 left. That is not a reversal of phase 1's
reason. The problem was a write lock held in application code by one
process that had to be the only one; D1 serializes writes inside the
service, so no process of ours holds a lock and any number of Workers
write. What phase 1 also bought — the suite running on the engine
production runs, `SKIP LOCKED`, interactive transactions — is
re-examined in phase 4, and the one that does not carry over
(interactive transactions) is the first thing that phase proves out.

## What stays

- The HTTP API contract. frontend/, viewer/, board/, and the Tauri desktop
  app talk to the backend over HTTP and do not care what serves it. The
  desktop sync contract in particular is pinned by
  `backend/test_desktop_sync.py`; that test is the acceptance gate for every
  phase, including the port.
- GROBID as an external service. It is already out-of-process; it stays on
  the NixOS host, reached over the tunnel that host already has.
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

Three things stayed in the request on purpose. The edit form's "re-read
the PDF" button (`/api/papers/{sha}/extract-metadata`) still answers
synchronously: it is a button, not an upload, and the demo — which has no
jobs, by design — answers it too. The demo's bundled PDFs are still
analyzed in the web process through the ephemeral reference engine,
because that state is process-local by design and a worker could not
fill it. And a demo board's captures are made in the request, into the
workspace's own files, and answer with `job: null`: a worker would run
on the permanent database, which is the one thing the demo must never
touch, and the client treats a missing job as a picture already there.

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

## Phase 4 — The Workers port

The backend, API and jobs alike, rewritten in TypeScript as one Worker
project, against the existing suite. About 10,500 lines of application
Python and 5,600 lines of tests; the tests are the asset and the cost, and
are translated, not skipped. `test_desktop_sync.py` passes against the
Worker before anything switches.

What each piece becomes:

- **The database**: D1, bound to the Worker; no connection string, no
  pooler, no provider. The schema is the one `models.py` declares — it was
  SQLite before phase 1 and round-trips, as `migrate-sqlite-to-postgres.py`
  showed. Backups are D1's own point-in-time restore. The one gap is that
  D1 has no interactive transactions: a request cannot read, decide in
  code, and write inside one transaction; it gets `batch()`, which runs a
  list of statements atomically. Two places read-then-write today — the
  sync push (`backend/sync/`) and the idempotency middleware, which holds
  a transaction open around the handler — and both become read, decide,
  then one `batch` of writes guarded by the revisions they read. This is
  the port's one real risk, so it is proved first (step 2 below) against
  `test_desktop_sync.py`. Managed Postgres through Hyperdrive is the
  fallback if the push resists `batch`; nothing else in the plan moves.
- **The API**: a Worker. It is already stateless, holds nothing in memory
  across requests, and hands files out by presigned R2 URL, so the routes
  port as they are.
- **The queue**: the `jobs` table, unchanged, is still the truth. What
  changes is the wake-up and the claim. A route writes the row in its
  `batch` as now and, after it, sends the row's uuid to a Cloudflare
  Queue. A consumer in the same Worker claims the row with one conditional
  `UPDATE ... WHERE status = 'queued' RETURNING`, atomic on D1's single
  writer, which is what `FOR UPDATE SKIP LOCKED` did on Postgres; runs it;
  and records the outcome on it. The message is acked either way, since
  the row carries the result. A Cron Trigger every two minutes claims
  anything due that nobody was woken for — a lost message, a consumer that
  died past its lease — so the queue is a hint and the sweep is what makes
  it correct. Transactional enqueue, the key that holds one live job, the
  lease and retry-once all survive; `test_jobs.py` translates as it is.
- **The jobs**: `send_email` calls an email API instead of SMTP.
  `daily_digest` is a Cron Trigger at the digest hour rather than a
  self-rescheduling row. `extract_metadata` reads the first pages through a
  PDF library compiled to Wasm in place of PyMuPDF, and asks CrossRef,
  OpenAlex and GROBID over HTTP as now. `analyze_paper` fetches the PDF
  from R2, posts it to GROBID across the tunnel, parses the TEI and writes
  the rows. `capture_webpage` uses Browser Rendering in place of a
  Chromium subprocess. `capture_youtube` keeps only the oEmbed thumbnail:
  **the timestamped frame is dropped**, with `yt-dlp` and `ffmpeg` and
  their environment variables, since native binaries have no place in a
  Worker and the frame was the only reason for them.
- **The demo**: its in-memory SQLite world has no equivalent in a Worker.
  It moves to a Durable Object per demo session, which gives the same
  disposable, single-visitor state with its own storage.
- **The static apps**: served as Worker assets from the same deploy.

Order of work, each step a PR that leaves everything green:

1. Remove the timestamped frame from the Python worker now, so the port
   does not carry it.
2. Stand up the Worker project with a local D1, the Vitest workers pool
   for the suite, the schema from `models.py`, and the sync push on
   `batch` with `test_desktop_sync.py` passing against it. This is the
   step that decides D1; it comes before anything easier.
3. Port the queue and the job kinds, with `test_jobs.py`.
4. Port the remaining routes; the idempotency middleware moves onto
   `batch` here.
5. Port the demo onto a Durable Object.

The Python backend keeps running on the NixOS host throughout, on its
Postgres; the two do not share a database, so there is no overlap period
— production moves once, at cutover.

### Step 2 — landed 2026-09-21: the sync protocol on D1

The push runs on `batch()`: every change is worked on in memory against
rows read first, and the rows, the change log and the stored reply are
written as one atomic batch. `test_desktop_sync.py`'s protocol cases pass
against the Worker (`cloudflare/test/sync.test.ts`), so D1 is decided.
The desktop's push loop, its snapshot and its pull deserialize what they
did before.

The port is the moment to question what it carries, and these are the
decisions taken so far, each with its reason:

- **The idempotency middleware is gone.** The Python wrapped every
  mutating route in a replay cache keyed by two headers. No shipped client
  — not the desktop, not the three apps — ever sent them; only the demo
  stripped them. The push has its own replay by mutation UUID, which the
  desktop does rely on, and that stays. `applied_mutations` shrinks to
  what the push needs (`migrations/0002_sync_simplified.sql`).
- **A pull change is `{table, row}`.** The Python also sent `sequence`,
  `uuid`, `revision` and `operation` beside each row; the desktop's
  `RemoteChange` reads `table` and `row` and nothing else, and the row
  carries its own name, revision and tombstone. The page's `cursor` is the
  sequence.
- **A card's edit does not version its board.** Through the ORM, bumping
  `boards.updated_at` for a moved card also bumped the board's revision
  and logged the board as changed, so a replica with a pending rename
  reported a conflict it never had. The clock moves; the revision is for
  what a replica may write on the board.
- **Timestamps are ISO-8601 text everywhere.** SQLite stores text, the
  wire carried text, the desktop writes RFC 3339 and never parses ours.
  One format, no conversion.
- **Validation is one module** (`cloudflare/src/validate.ts`), asked by
  the push now and by the routes as they arrive, so a title the browser
  accepts is one the Mac can push back — the property the Python kept by
  running its pydantic models from both places.
- **Password hashes are unchanged**: PBKDF2-SHA256 at 200,000 rounds in
  the `salt$hex` form, through WebCrypto, so every account crosses as it
  is.
- **What the Python checked at every start, a test checks once**: that
  the registry places every column of every synchronized table
  (`cloudflare/test/registry.test.ts`, against the migrated schema).

Not carried, and listed at the end of `sync.test.ts`: the cases about
routes not yet ported, which come with those routes.

### Step 3 — landed 2026-09-21: the queue, the mail, the digest

`cloudflare/src/jobs`. The `jobs` table is still the truth; a Cloudflare
Queue message carrying the row's uuid is the wake-up, sent after the
batch that wrote the row; the consumer claims by uuid with one
conditional `UPDATE ... RETURNING`; a cron every two minutes claims what
is due and was not woken — a lost message, a consumer dead past its
lease — and runs it there and then. The key, the lease and retry-once
are as they were, and `test_jobs.py`'s cases translate
(`cloudflare/test/jobs.test.ts`). `GET /api/jobs/{uuid}` is ported.
The kinds that need the routes that queue them — the reading of an
upload, the reference pass, the captures — come with those routes.

Decisions taken:

- **Mail goes through an HTTP email API, not SMTP.** A Worker has no
  place for an SMTP conversation, and every transactional provider
  speaks the same one call: from, to, subject, text, a bearer key.
  `EMAIL_API_URL`, `EMAIL_API_KEY` and `EMAIL_FROM` name the provider at
  cutover; unset, mail is skipped and the job says so, as an unconfigured
  SMTP host meant before. The settings-table fallback for SMTP
  credentials is not carried: a secret belongs in a secret, not in a
  table the admin page edits.
- **The digest is the hourly cron's, not a self-rescheduling row.** At
  the digest hour it queues the day's emails and writes one `daily_digest`
  row keyed by the day, which is the record that the day is done with
  whatever hour asks again. `digest_hour` is read as UTC: a Worker has no
  host clock to be local to.
- **The sweep runs what it claims.** It is a Worker invocation like any
  other, so a job it finds needs no second wake-up.

### Step 4, boards — landed 2026-09-21

`cloudflare/src/routes/boards.ts`, with the two capture kinds in
`src/jobs/capture.ts`: every board route, the cards, the groups, the
files, and the link cards whose pictures are jobs. The board-route cases
of `test_desktop_sync.py` and `test_board_group_booklets.py` and the
capture cases of `test_jobs.py` translate (`cloudflare/test/boards.test.ts`).

Decisions taken:

- **One way to write a synchronized row.** `src/sync/write.ts` versions
  a row, writes it and logs it, and both the push and every route go
  through it — what `commit_sync` did by watching the ORM's dirty set,
  done by saying so.
- **A board file is served by the Worker, not by a presigned redirect.**
  The Python presigned a bucket URL so the web tier never carried bytes.
  A Worker streaming from R2 costs nothing it was protecting against,
  and gives the browser and the desktop one origin with no presign key
  to keep. `/uploads/{key}` will follow the same rule when it arrives.
- **A webpage's address is checked on its face.** The Python resolved
  the hostname to refuse private addresses, because its Chromium sat on
  the LAN. Browser Rendering is Cloudflare's browser on Cloudflare's
  network, so what remains is the URL: a browser scheme, no credentials,
  no loopback or private literal.
- **A card's edit moves the board's clock, not its revision**, as the
  push already had it.

### Step 4, the nook — landed 2026-09-21

`cloudflare/src/routes/nook.ts` and `src/papers/list.ts`: the Library's
users, a user's nook, shelves, tags, and the Library's list of papers.
The library cases of `test_paper_is_not_owned.py` translate
(`cloudflare/test/nook.test.ts`); the paper page itself, with its
routes, comes next. One decision: a list of papers is built in a handful
of queries for the whole list — the displayed copies, the seminar
statuses, the nook's own tags — rather than the ORM's query per row.

### Step 4, papers — landed 2026-09-21

`cloudflare/src/routes/papers.ts`, `src/papers/`: the upload and the
`extract_metadata` job that reads it, saving, the paper page, editing,
taking a copy and letting it go, the viewer's paper, and `/uploads/{key}`.
`test_paper_names.py`, the rest of `test_paper_is_not_owned.py`,
`test_paper_metadata_shape.py`'s rules and `test_metadata_lookup.py`
translate (`cloudflare/test/papers.test.ts`).

Decisions taken:

- **The PDF is read by `unpdf`**, pdf.js built for the edge, in place of
  PyMuPDF: the first three pages' text, for the identifier printed there.
- **GROBID's title-block fallback waits for the reference pass.** It
  needs the TEI parsing that pass brings; until then a paper that prints
  no identifier gets its filename for a title, which the form always let
  the user correct.
- **A title is trimmed in the one validator**, so an upload, an edit and
  a replica's push agree on what a title is. The Python trimmed on two of
  the three paths.
- **The reference pass is not queued on save yet**: its handler comes
  with the pass, and a job no handler knows is failed, not left. A saved
  paper's `references_status` is null — never asked — until then.
- **`/uploads/{key}` is streamed by the Worker from R2**, immutable and
  rangeable, as the board files are. The CDN option (`PAPOL_FILES_PUBLIC_URL`)
  is not carried: one origin, and Cloudflare's cache in front of the
  Worker is the CDN.
- **In the suite, wake-ups are handed to the consumer by the test.** The
  local runtime delivers queue messages on its own, which would run a job
  before a test had said what the outside world answers.

### Step 4, annotations — landed 2026-09-21

`cloudflare/src/routes/annotations.ts`: a note, a stroke, a clip; listed
oldest first, narrowed by kind, changed by merging into the stored
geometry, deleted by their author. The annotation cases of
`test_account_data.py` translate (`cloudflare/test/annotations.test.ts`).
A route stores a body with its kind's defaults filled in
(`validate.normalizedBody`), as the Python's `body_text` did; a push
stores what the replica sent, as the Python's did. A refusal is a
sentence, or a list of them — not pydantic's list of error records.

### Step 4, seminars — landed 2026-09-21

`cloudflare/src/routes/rooms.ts` and the cohort in `src/cohorts.ts`:
calling a seminar, the cohort joining and leaving, hosting and stepping
back, messages and availability, announcing and finishing, and
uncalling. `test_seminar_transitions.py` translates
(`cloudflare/test/rooms.test.ts`). Nothing here synchronizes — rooms are
the website's — so the rows are written plainly. The ORM's
delete-orphan cascade on uncalling is four `DELETE`s said in order.

### Step 4, the inbox — landed 2026-09-21

`cloudflare/src/routes/inbox.ts`: notifications, the messages an admin
broadcasts and their dismissal, feedback with the admins' inbox message
and mail queued beside it, and the two admin routes that send and list
recipients. `test_admin_messages.py` and the feedback cases of
`test_jobs.py` translate (`cloudflare/test/inbox.test.ts`).

### Step 4, links — landed 2026-09-21

`cloudflare/src/papers/sharables.ts` and `cloudflare/src/routes/sharables.ts`:
a paper's own link and a reading's link, asking for one's own, dropping
the annotations from a link or taking it back, the reading a link opens
for anyone, and what a holder may keep of it. `test_sharables.py`
translates (`cloudflare/test/sharables.test.ts`) except the
viewer-references case, which arrives with the references.

- One road into a nook. The Python add-to-nook and the shared
  add-to-nook each built a copy on their own, and the second never
  revived a removed copy, so a paper let go and then taken back by link
  left its dead copy beside the new one. `keepPaper` is the one path,
  and both routes call it.
- The viewer's authorization is one function, `viewerPaper`: a user who
  keeps the paper, or a link that names it. `/api/viewer/{digest}` calls
  it as the Python route did, without a link; the info and references
  routes, when they come, pass the `share` query through it.
- A rich link is demoted where it is opened, not where the copy is
  deleted. The Python service did the same, for the same reason: the web
  route and a synchronized delete are two roads out of a nook, and the
  read is the one place both pass through. The cost is a write on a
  read, once per demotion.
- A closed account is `users.deleted_at`, not an `is_deleted` flag: the
  column the schema already has.

### Step 4, the account — landed 2026-09-21

`cloudflare/src/routes/account.ts` with `cloudflare/src/account/export.ts`
and `close.ts`: the profile, the picture, the password, the export, and
closing the account. `test_account_data.py` translates
(`cloudflare/test/account.test.ts`), joined by the route behaviour that
had no test before: the picture's storage and serving, the password's
checks, the confirmation and the last-admin refusal, the tombstone, and
the seminars handed on or reopened.

- The export is streamed, not built. Python wrote the zip to a scratch
  file and streamed that; a Worker has no disk and 128 MB of memory, so
  the archive is written through `fflate` as the client reads it, each
  PDF copied from R2 a chunk at a time with the response's own
  backpressure holding the reads. Nothing is held whole.
- The export carries what the user has, not what they have let go of.
  `gather` in Python selected copies, notes and ink with no
  `deleted_at` filter, so a removed paper and its deleted notes came out
  in the archive as if still kept. Live rows only, here.
- Closing the account is one D1 batch: the deletes, the seminars handed
  on, the sessions and sync bookkeeping, and the scrub of the row, all
  or nothing; the avatar and the boards' files are removed from R2 only
  after the batch has committed, as Python did.
- The login route's "this account has been closed" branch is gone. The
  tombstone's address is `deleted-<uuid>@papol.invalid` and its hash
  matches no password, so a closed account is never found by the address
  its owner had, and the branch could not fire. The address is free to
  register again, which Python allowed too.
- Avatars are served at `/uploads/avatars/<name>`: the one folder under
  the uploads prefix, named as a route rather than a general path
  wildcard.

### Step 4, the admin pages — landed 2026-09-21

`cloudflare/src/routes/admin.ts`: the reports and their resolution, the
tables, a row edited or deleted by its key, and one raw statement. No
Python test covered these; `cloudflare/test/admin.test.ts` does now.

- The tables are asked of the database. Python listed SQLAlchemy's
  metadata and coerced values through each column's Python type; the
  Worker reads `sqlite_master` and `PRAGMA table_info`, and coerces a
  typed value by the column's declared affinity. SQLite's own tables and
  D1's migration table are not Papol's and are not listed.
- The database timing metrics are dropped: `GET /api/admin/db-metrics`,
  its reset, the admin page's panel and the two client functions. They
  were counters in one Python process, collected through SQLAlchemy
  engine events; a Worker has no process to hold them and D1 reports
  its own timings in the dashboard. (The user's call, 2026-09-21: drop
  what does not fit rather than port it awkwardly.)

## Phase 5 — Cutover

Configuration and one move of the data, once phase 4 passes the suite:

- D1, with its point-in-time restore replacing the dumps in
  `backend/backups/` and the R2 archive. Production's data goes across
  once, with the service stopped: a `pg_dump` of the Postgres, rewritten
  to SQLite statements (the inverse of `migrate-sqlite-to-postgres.py`,
  over the same schema), and loaded with `wrangler d1 execute`. Files are
  already in R2 and do not move.
- GROBID stays where it is. The NixOS host keeps the container, the tunnel
  that exposes it to the Worker with Cloudflare Access in front, and
  nothing else: `papol.service`, `papol-worker.service`, nginx and the
  system Postgres are removed from `module.nix`.
- Structured logs and errors go to Workers' own observability; the
  `ErrorLog` table remains the admin-facing view, not the system of record.
- `deploy.sh` keeps its verbs (`dev`, `prod`, `pull`, `status`), with
  `prod` becoming a `wrangler deploy` plus the GROBID host's rebuild, and
  `pull` a copy from the managed database and R2 into the development
  cluster and directories.
- The Python backend, its `module.nix` units and its nix Python closure are
  deleted, not kept as a fallback: no users, and two backends is the
  combination that drifts.
