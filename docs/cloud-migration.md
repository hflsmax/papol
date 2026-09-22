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

### Step 4, references — landed 2026-09-21

`cloudflare/src/papers/tei.ts` (GROBID's TEI read into references,
markers and figure links), `grobid.ts` (the service behind the tunnel,
with an Access service token), `resolve.ts` (the CrossRef/OpenAlex
judgment, `biblio.py` as was), `references.ts` (the `analyze_paper`
job, the stored bibliography, lazy lookup, the preview) and
`routes/references.ts` (`/api/viewer-references/…`, `/api/viewer/{digest}/info`).
The TEI cases of `test_metadata_extraction.py`, `test_biblio.py`,
`test_reference_preview.py` and the viewer case of `test_sharables.py`
translate (`cloudflare/test/references.test.ts`); the GROBID header
fallback for an upload that prints no identifier is in `extract.ts`.

- XML is parsed with `@rgrove/parse-xml`, a small conformant parser
  with a document-order tree, since a Worker has no `DOMParser`. The
  TEI reading is the Python one line for line, including the equation-
  number and Box-versus-Figure heuristics.
- **Dropped**: the layout pass that read numbered "Figure N", "Box N"
  and "Table N" headings out of the PDF's own text with PyMuPDF and
  drew links for the phrases citing them. A Worker has no PyMuPDF, and
  GROBID's own figure references cover the common case. The link
  layer is poorer by the boxes GROBID misses.
- **Dropped with the demo**: the ephemeral reference engine for the
  bundled demo PDFs. Whether the demo returns is decided in its own
  step; nothing here assumes it.
- Secrets: `GROBID_URL`, `GROBID_ACCESS_CLIENT_ID`,
  `GROBID_ACCESS_CLIENT_SECRET`. Unset, the viewer is told references
  are unavailable and uploads get no title-block reading, as before.
- The arXiv special cases are carried over unchanged and questioned in
  issue #98: whether the identifier path resolves what the searches
  would not is unmeasured.

### Step 4, the website — landed 2026-09-21

The three Vite builds are served as Workers Static Assets from
`cloudflare/site/`, laid out by `cloudflare/scripts/assemble.sh`: the
frontend at the root, the viewer under `/viewer/`, the board under
`/boards/`. Every request passes through the Worker (`run_worker_first`),
and the router's fallback is the assets store: an unknown `/api/` or
`/uploads/` path is a JSON 404, `/boards/<uuid>` is the board's
document, and any other clean path is the frontend's document for
History API routing (`not_found_handling = "single-page-application"`).
`cloudflare/test/site.test.ts` covers the routing against three
one-line documents the suite stands in when no site is assembled.

- The frontend is built at base `/`. The `/papol/` base the production
  build carried was the NixOS host's nginx arrangement; the Worker is
  its own origin.
- **Dropped: the demo.** `backend/demo.py` ran the whole API against a
  per-session in-memory database; on Cloudflare that is a Durable
  Object with its own SQLite re-implementing the D1 layer, which is
  not worth it for a sales demo with no users. `/api/demo/*`,
  `/demo/viewer` and `/demo/boards/*` do not exist on the Worker. The
  front ends still link to them; removing that is issue #100.

Phase 4 is complete with this step: every route the frontends call is
answered by the Worker except the demo's.

## Phase 5 — Cutover

### Step 1 — landed 2026-09-21: the Worker is live on workers.dev

- D1 `papol` (id `4a3f822d-…`) created and migrated; queue `papol-jobs`
  created; the R2 bucket is `papol-files`, the one the Python backend
  already used (`wrangler.toml` corrected from `papol`).
- `wrangler deploy` succeeded: https://papol.hflsmax.workers.dev serves
  the site and the API against the empty production database, with both
  cron triggers and the queue consumer attached.
- Secrets set: `PAPOL_CONTACT_EMAIL`, `PAPOL_OPENALEX_KEY`. Not set, and
  waiting on decisions: mail (the Python backend sent SMTP from the
  settings table; the Worker wants an HTTP mail API, `EMAIL_API_URL`,
  `EMAIL_API_KEY`, `EMAIL_FROM`), GROBID (the tunnel and Access service
  token do not exist yet), `PAPOL_URL` (the final hostname).
- `scripts/migrate-postgres-to-d1.py` turns a `pg_dump --data-only
  --column-inserts` file into D1 statements; tried against a synthetic
  dump into the local D1. The production dump needs `sudo` on the host.

### Step 2 — landed 2026-09-21: the data is across

`sudo -u postgres pg_dump -d papol --data-only --column-inserts` on the
host, converted with `scripts/migrate-postgres-to-d1.py`, rehearsed
into the local D1, then loaded into production with `wrangler d1
execute --remote --file`: 8,369 statements, every table's count equal
to the dump's (12 users, 44 papers, 88 annotations, 2,540 references,
3,921 citation markers, 1,405 links, 102 change-log rows). The service
on the host was not stopped: there are no users to write meanwhile,
and the Python backend keeps running on Postgres until the hostname
moves. `applied_mutations` was left behind, as the script says.

### Step 3 — landed 2026-09-21: papol.io

`papol.io` and `www.papol.io` are custom domains of the Worker
(`routes` in `wrangler.toml`); Cloudflare wrote the DNS records on
deploy. `PAPOL_URL` is `https://papol.io`. The workers.dev address
stays as a second door for now. Mail was off by decision at first;
it comes back through Resend (`EMAIL_API_URL` is
`https://api.resend.com/emails`), which refuses a request without a
User-Agent, so the sender names itself. The previous
production hostname was on the LAN only, so nothing public moves.

### Step 4 — landed 2026-09-21: GROBID behind a tunnel of Papol's own

A tunnel `papol` (`wrangler tunnel create papol`, id `feda19ad-…`),
separate from the host's other tunnel, carries `grobid.papol.io` to
the NixOS host. There, `module.nix`'s new `grobid.expose` options run
cloudflared for that tunnel and an nginx vhost on localhost in front
of GROBID, asking for one basic-auth credential from an htpasswd file
outside the store. The Worker holds the same credential as
`GROBID_AUTH` and `https://grobid.papol.io` as `GROBID_URL`.

- Not Cloudflare Access, as first planned: the wrangler login has no
  Zero Trust scope, and a single-tenant service needs no more than one
  shared credential over TLS. The Access design is gone from
  `grobid.ts` (`GROBID_ACCESS_CLIENT_ID/SECRET` are not secrets any
  more).
- The tunnel's credentials JSON was derived from its token through the
  API and placed at `~/.cloudflared/<id>.json` on the host, where the
  NixOS cloudflared service expects it; a remotely-created tunnel
  otherwise has no local file.
- The host's cloudflared login is scoped to another zone, so
  `cloudflared tunnel route dns` wrote a stray record
  `grobid.papol.io.mc-pony.com` there; the real CNAME in papol.io is
  added in the dashboard.

Verified 2026-09-21, after the host's rebuild started the tunnel and the
front door: `grobid.papol.io/api/isalive` answers 401 without the
credential and `true` with it; resetting one paper's analysis and
asking for its references through papol.io queued the pass, and
twenty seconds later the paper was `ready` with the same 47 references
and 73 markers the Python backend had read. `grobid.expose` defaults
on with this host's tunnel id, so configuration.nix needed no change.

### Step 5 — landed 2026-09-21: passwords at the platform's cost

The first sign-in on papol.io failed: production WebCrypto refuses
PBKDF2 above 100,000 iterations, and every hash made before the move
used 200,000 (the local runtime the suite ran on did not object). Now
`auth.ts` verifies the older form (`salt$hex`) in plain JavaScript
(`@noble/hashes`, about a second of CPU, once per account) and writes
the Worker's own form `pbkdf2$100000$salt$hex` for new passwords and
for an older one the moment it verifies at sign-in. A closed account's
unusable hash still matches nothing. With this the Worker's code,
tests and configuration stop describing themselves against the backend
they replaced: what they say is what they do.

### Step 6 — landed 2026-09-21: dev.papol.io, and CI that uses it

Two failures on the first day (the PBKDF2 ceiling, the plain-HTTP tab)
were of one kind: the local runtime is permissive where Cloudflare is
strict, and nobody exercised the real thing before a person did. So:

- `[env.dev]` in `wrangler.toml`: a second Papol at https://dev.papol.io
  with its own D1 (`papol-dev`), bucket (`papol-files-dev`) and queue
  (`papol-jobs-dev`), the same code and site, its own secrets, GROBID
  shared. `wrangler deploy --env dev`. Its data is disposable.
- `cloudflare/scripts/smoke.sh <url>`: what a person does, against a
  deployed Papol — the redirect, the documents, a sign-up and sign-in, an
  upload, a save, a stroke, the PDF, the refusals — failing on the first
  wrong answer. It passes against dev.papol.io.
- `.github/workflows/worker.yml`: the Worker's suite on every pull
  request that touches it; on `main`, a deploy to dev followed by the
  smoke test; production only from the Actions tab, by choice, after
  dev is green. Needs the `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- Plain HTTP is redirected to HTTPS at the edge, by the zone's "Always
  Use HTTPS" setting, not by the Worker: a redirect in the Worker fired
  under `wrangler dev` too, which serves plain HTTP on the loopback, and
  broke every local check. `newUuid` no longer depends on a browser API
  withheld outside secure contexts.

### Step 7 — landed 2026-09-21: the retired backend is deleted

`backend/` is gone, with its Python closure, the PostgreSQL, and every
script and unit that existed only to run it: `scripts/pull-files.py`,
`scripts/migrate-sqlite-to-postgres.py`, the R2 backup, the health probe,
the LAN names. `flake.nix` is Node, the browser and the Rust; `module.nix`
is GROBID, its tunnel and the rebuild rule, still accepting the host's
retired keys with a warning until its configuration is trimmed;
`deploy.sh prod` is the site assembled and `wrangler deploy`, `host` the
NixOS rebuild over ssh, `dev` wrangler beside the Vite servers, `pull` a
D1 export into the local one. The desktop app's default backend is
`https://papol.io`. The two desktop end-to-end checks and the share
end-to-end start the Worker (`wrangler dev`) where they started uvicorn.
`scripts/migrate-postgres-to-d1.py` stays as the record of the one move.

### Step 8 — landed 2026-09-21: the host helps

The Worker runs on Cloudflare's Free plan, which gives an invocation
about ten milliseconds of CPU. Reading a paper is not ten milliseconds
of work: laying out the first pages with pdf.js to find an identifier,
and walking a long paper's TEI into references, markers and links, are
each more than that, and the two jobs that did them were the ones that
could be cut off mid-way. So the CPU-heavy work moves to the NixOS host,
which has plenty, as a small Node service beside GROBID (`host/helper/`,
the `papol-helper` unit), and the Worker only forwards bytes and stores
rows.

- Two endpoints, each taking a PDF's bytes and answering JSON: `POST
  /analyze` runs GROBID's full-text pass and answers `{ references,
  citations, links }`; `POST /header` runs the header pass, consolidated
  (GROBID asks CrossRef itself, from the host) and answers the title
  block with its DOI and arXiv id. They sit behind the same nginx vhost
  and credential as GROBID, under `/helper/`, so the Worker's secrets
  are unchanged: `${GROBID_URL}/helper/analyze` with `GROBID_AUTH`.
- One implementation of the TEI reading, run where the CPU is: the
  helper imports `cloudflare/src/papers/tei.ts` and esbuild bundles it,
  so the Worker's parser is the one that runs on the host and the
  Worker's tests are what test it. `parseHeader` now reads the header's
  `<idno>` elements too. The Worker itself no longer parses TEI or reads
  a PDF: `unpdf` is gone, `grobid.ts` is `helper.ts`, a client.
- The upload's identifier comes from the consolidated header rather than
  the first pages' text, which is a change in what is found: CrossRef's
  match on the title block where a paper prints no DOI, and nothing where
  GROBID misreads the block. The CrossRef/OpenAlex enrichment by DOI
  stays in the Worker; that is network, not CPU.
- The bundle `host/helper/dist/helper.js` is checked in and the unit runs
  `node` on it: the host rebuilds with a fast-forward and `nixos-rebuild
  switch`, with no npm on the way and no network inside a Nix build.
  `npm run check` in `host/helper` rebuilds and fails on a stale bundle,
  and CI runs it.
- With no helper configured, or one that is down, nothing changes from
  before: references are "unavailable", uploads get the filename title.

### Step 9 — landed 2026-09-21: the export is a tar

Measured on dev with a mirror of production and the owner's 29 papers
(113 MB): the zip export was cut off at 80–95 MB, unreadable, both
times. A zip carries a CRC-32 of every entry, which the Worker had to
compute over every byte of every PDF, and the Free plan's CPU budget
killed the invocation mid-stream. The export is now a tar: each entry
states its size and carries its bytes, so every PDF is piped from R2
into the response without passing through JavaScript, and the Worker
spends nothing on arithmetic. That bought back the checksums and not
the bytes: see step 10.

### Step 10 — landed 2026-09-21: the browser assembles the export

Measured on dev with the same nook (29 papers, 113 MB): the tar export
ended with `outcome: exceededCpu` after 2,010 ms of CPU, and the client
got a truncated 200. Pushing bytes through the Worker's own stream costs
it about 18 ms of CPU per megabyte even when they only pass from R2 to
the response, and an invocation on the Free plan gets about two seconds
in practice, so anything past roughly a hundred megabytes is cut off
whatever the archive format. The Worker must not carry the PDFs.

It no longer carries any file. The tar holds the data and one more
entry, `files.json`: for each PDF in the nook, each board file and the
picture, the path it takes in the export, the URL it is fetched from
(`/uploads/<file>` for a PDF or the picture, `/api/board-items/<uuid>/
file` for a board file) and its size. The website's "My data" button
reads the tar in the browser (`shared/exportArchive.js`), fetches every
file — each its own invocation, with the whole budget to itself — builds
one zip with `fflate` (PDFs stored, text deflated) and saves it as
`papol-export-<date>.zip`, with progress in the panel and a quiet line
naming any file that could not be fetched. The README in the tar says as
much for anyone taking the export with curl. The cost is memory: the
browser holds the files and the zip at once, a few hundred megabytes for
a large nook, which a desktop has.

Measured after the change, same nook, from headless Chrome against dev:
the export invocation 43 ms of CPU and 3.5 s of wall time (the D1 reads
and one `head` per file), each of the 26 PDF fetches 0–3 ms of CPU —
a response whose body is the bucket's object itself never passes
through JavaScript, which is what makes `/uploads/` cheap where the
export's stream was not — and the browser had the 129.5 MB zip in
6.6 s, `zipfile.testzip()` clean.

### Step 11 — landed 2026-09-21: the files come from the bucket

Every PDF and every picture was a Worker invocation whose body was the
R2 object. Cheap, but an invocation each, and nothing cached at the
edge. An R2 bucket can carry a custom domain in the zone, on which
Cloudflare serves the objects itself — cached at the edge, range
requests answered, no Worker in the path. `FILES_URL` in `wrangler.toml`
names that address; with it set, `GET /uploads/<key>` and
`/uploads/avatars/<key>` answer a 301 to it (the key's shape still
checked; a day's `cache-control`, since the bytes are permanent and the
host need not be), the paper answers (`/api/papers/:name`,
`/api/viewer/:digest`, a shared reading's `paper`) carry `file_url`
beside `file_path`, and the export's `files.json` names the bucket
address for a PDF or the picture. The viewer hands pdf.js `file_url`
when it is there, so the PDF's stream never touches the Worker, not
even for the redirect; the `<img>` for a picture follows the 301.
Without `FILES_URL` — local development — the Worker serves the file as
before. `cloudflare/r2-cors-public.json` is the bucket's CORS rule: GET
and HEAD from any origin (the files are public and content-addressed;
an origin list would protect nothing and would have to name every local
port and the desktop's `tauri://` origin), the `Range` header allowed,
`Content-Length`, `Content-Range`, `Accept-Ranges` and `ETag` exposed,
which is what pdf.js needs to read by range across origins.

What a bucket domain exposes is the whole bucket: every key answers on
it, and nothing scopes it to a prefix (the domain does not list keys —
`/` and `/uploads/` are 404 — but any key one knows is public). The
production bucket `papol-files` holds, beside 54 PDFs and one picture
under `uploads/`, some seventy private board files and desktop blobs
under `board_uploads/`, and a stale `dev/uploads/` tree from the Python
era. So production has no domain yet and its `FILES_URL` is empty; the
Worker serves its files as before. `papol-files-dev` holds only
`uploads/` and got `files-dev.papol.io`, which is where all of this was
proved. The follow-up that lets production have `files.papol.io`: a
second bucket, `papol-board-files`, for `board_uploads/` — a second
binding, `BOARD_FILES`, that `src/sync/blobs.ts`, `routes/boards.ts`,
`jobs/capture.ts` and `account/export.ts` read and write instead of
`FILES` for that prefix; the seventy objects copied across
(`wrangler r2 object get`/`put`, or `rclone` with an S3 token); the
`dev/` keys deleted from `papol-files`; then
`wrangler r2 bucket domain add papol-files --domain files.papol.io
--zone-id 27efd91b…` and `FILES_URL = "https://files.papol.io"` in
`[vars]`. Board files stay behind `/api/board-items/:uuid/file` and
`/api/sync/blobs/:sha256` throughout, where the route asks who is
asking. The desktop's content policy and capabilities already admit
`https://files.papol.io`, so no app release is needed for that day.

Measured on dev: the Worker's `/uploads/<digest>.pdf` answers 301 in
0 ms of CPU; the bucket domain answers the 1.4 MB PDF with
`content-type: application/pdf`, `accept-ranges: bytes`,
`access-control-allow-origin: *`, `cf-cache-status: MISS` then `HIT`
(`cache-control: max-age=14400`, Cloudflare's default for the type;
the objects carry no cache-control of their own); the viewer in headless
Chrome rendered the paper from `files-dev.papol.io` — one 200, then
206s by range — with no `/uploads/` event in the Worker's tail at all.
One thing to know: the edge caches a 404 for a key for a few minutes,
so a URL asked for before its object exists stays a 404 that long. Papol
never hands out an address before the upload has landed, and keys are
never reused, so this is a probe's problem rather than a user's.

### Step 12 — landed 2026-09-22: uploads go straight to the bucket

The same arithmetic as step 10, on the way in: a PDF that went browser →
Worker → R2 cost the Worker ~18 ms of CPU a megabyte just to pass it on,
and a request body is capped at 100 MB besides. Now the Worker never sees
the file.

- The browser hashes the PDF (WebCrypto SHA-256) and asks `POST
  /api/papers/upload-address` with `{ sha256, size, name }`. The answer is
  `{ stored: true, file_path }` when the bucket already holds
  `uploads/<sha256>.pdf`, else `{ stored: false, file_path, url, headers }`:
  a presigned S3 PUT to R2 (`aws4fetch`, an R2 API token as the secrets
  `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, the bucket named by the
  new `FILES_BUCKET` var), valid fifteen minutes, whose signature covers
  `x-amz-checksum-sha256` (the digest, base64), `content-type` and
  `content-length`. R2 honours the checksum on a presigned PUT — verified
  on dev: same length, one byte different → `400 BadDigest`; a tampered
  checksum header, or one byte more than the size the address was asked
  for → `403 SignatureDoesNotMatch`; the right bytes → 200 — so the
  bucket itself refuses anything that does not hash to its name, and no
  MD5 fallback was needed. The browser PUTs with a plain `fetch` and the
  headers listed, no credential of Papol's, then tells `POST
  /api/papers/uploaded` `{ file_path, uploaded_name, identifier? }`, which
  checks the object exists and queues the reading as `extract` did.
  `POST /api/papers/extract` stays for older desktop builds, and the
  browser falls back to it when the address route answers 404 or 503 (an
  older Worker, or one without the secrets).
- The bucket needs a CORS rule for that PUT, applied by hand (it lives
  in `cloudflare/r2-cors-public.json` with the read rule since step 13:
  `npx wrangler r2 bucket cors set papol-files --file r2-cors-public.json`,
  and `papol-files-dev`). R2 refuses a port wildcard in an origin, so
  the development origins are listed by port (5173, 8787).
- The paper's identifier is read in the browser: `pdfjs-dist` (the
  viewer's version, its worker loaded the same way) lays out the first
  three pages while the bytes go up, and `shared/identifiers.js`, the
  port of the Worker's `identifiers.ts` with a unit test beside it, finds
  the arXiv id or the first complete-looking DOI. The job asks CrossRef
  and OpenAlex about a given identifier without fetching the PDF, and
  turns to the host helper's `/header` only when none was given or no
  index knew it. A paper limit `files.paper_mb` (200) is in
  `app_limits.json` now; the address is refused above it.

Measured on dev from headless Chrome, the real form: a 21 MB paper
(`47602f24…`, which prints a DOI on its first page) had its form open
2.8 s after the file was chosen — the PUT to `r2.cloudflarestorage.com`
took 2.1 s of that — and filled 4.9 s after, from CrossRef by the DOI the
browser read. The Worker saw a 110-byte body for the address (2 ms of
CPU), a 157-byte body for `uploaded` (3 ms), and the job took 4 ms of CPU
and 453 ms of wall time without touching the PDF. `attention.pdf`, already
in the bucket, opened its form in 0.8 s with no PUT at all; OpenAlex does
not index arXiv's DataCite DOIs, so that one still went to the helper
(15 ms of CPU, 3.8 s) and filled in 11 s.

### Step 13 — landed 2026-09-21: production files come from the bucket

Step 11 left production without a domain because `papol-files` also
holds board files and the desktop's blobs, and a bucket domain exposes
every key. The owner's decision: **one bucket, public by key, board
files included.** A key is a content digest (`uploads/<sha256>.pdf`,
`board_uploads/blobs/<sha256>`) or a uuid minted for one write
(`uploads/avatars/<user uuid>.<ext>`, `board_uploads/<board
uuid>/<uuid>.<ext>`); whoever has one has the file already, and hiding
it behind a session protects nothing. The domain lists nothing (`/`,
`/uploads/`, `/board_uploads/` are 404s). The second bucket that step
11 sketched was built as far as the copy — `papol-board-files` made,
the 70 `board_uploads/` objects copied across server-side and verified
by size — and then undone: the copies deleted, both buckets removed,
no code written for it.

What the buckets hold now, which is what to remember:

- `papol-files`, on **`files.papol.io`**, `FILES_URL` in `[vars]`:
  125 objects. `uploads/` — 54 PDFs and one picture, what `/uploads/`
  served to anyone already. `board_uploads/` — 49 web board files under
  `<board uuid>/<uuid>.<ext>` (47 under the one live board, 2 under a
  legacy `2/`) and 21 desktop blobs under `blobs/<sha256>`; nothing
  moved. The stale `dev/uploads/` tree from the Python era — 10 PDFs,
  15.2 MB, each a duplicate of an `uploads/` key with the same digest —
  is deleted. Board files are still handed out by
  `/api/board-items/:uuid/file` and `/api/sync/blobs/:sha256`, which
  ask who is asking; that they are also reachable by key on the domain
  is the decision above.
- `papol-files-dev`, on `files-dev.papol.io`: 31 objects, all
  `uploads/`.
- **CORS**: one file, `cloudflare/r2-cors-public.json`, applied by hand
  to both buckets (`npx wrangler r2 bucket cors set papol-files --file
  r2-cors-public.json`, and `papol-files-dev`; `cors set` replaces the
  whole set, so there is one file). Two rules: the read rule — GET and
  HEAD, `Range`/`If-None-Match`/`If-Modified-Since` allowed,
  `Content-Length`/`Content-Range`/`Accept-Ranges`/`ETag`/`Content-Type`
  exposed — and the direct-upload PUT rule from the upload PR
  (`content-type`, `x-amz-checksum-sha256`; `etag` exposed), each with
  the same five origins rather than `*`: `https://papol.io`,
  `https://www.papol.io`, `https://dev.papol.io`, `tauri://localhost`,
  `http://tauri.localhost` (the desktop fetches through Tauri's HTTP
  plugin, its webview origins are listed anyway). No localhost origin:
  a local `wrangler dev` reads and takes files itself (`.dev.vars`
  empties `FILES_URL` and `FILES_BUCKET`), so a page on localhost never
  talks to a bucket, and a local Worker cannot sign a PUT to one. The
  upload PR's `r2-cors.json` is superseded by this file.
- The suite pins `FILES_URL` empty in `vitest.config.ts`, whatever
  production's is, so it keeps testing the Worker serving a file itself
  and hands a bucket address in where a test is about that.

Measured on production after the deploy: `papol.io/uploads/<digest>.pdf`
answers 301 to `files.papol.io/uploads/<digest>.pdf` with a day's
`cache-control`, the avatar likewise, a malformed key still 404; the
bucket address answers 200, `content-type: application/pdf`,
`accept-ranges: bytes`, `access-control-allow-origin: https://papol.io`
for that origin and no allow-origin header at all for
`https://example.com`, 206 with `content-range` for a byte range; the
viewer in headless Chromium, signed in as a throwaway reader holding a
copy of the paper, rendered it with one 200 and then 206s from
`files.papol.io` (`cf-cache-status: HIT`) and not one request to the
Worker's `/uploads/`.

Next: key every board file by its hash and serve board files from the
domain too, as papers are — a `file_url` beside `file_path` on a board
item, and `/api/board-items/:uuid/file` reduced to a 301.

Still to do: the desktop app rebuilt and released against
`https://papol.io`; the stray `grobid.papol.io.mc-pony.com` record
deleted; the host's configuration.nix trimmed of the retired keys; one
R2 token per bucket (dev's unable to write production's).

### Step 14 — landed 2026-09-22: a known version at upload

The Library showed one paper five times: five PDFs of DOI 10.1145/3808345
uploaded over a month, each a `papers` row of its own — a paper is the
SHA-256 of its PDF — and each row left standing when its copy was let go,
since a paper is nobody's. The four orphans were deleted by hand. Two
rules follow, and neither changes what a paper is:

- **The PDF's hash is the identity; a DOI may have versions.** A preprint
  and the published article share a DOI and are two papers. No unique
  index on the DOI and no merging: what changes is that the form knows.
  The extract job (`papers/extract.ts`, `knownVersion`) looks the resolved
  DOI up — case-insensitive, trimmed — among the non-deleted rows under
  another hash, and when one is there its result carries
  `existing: { sha256, title, file_path }`. The upload form then shows one
  line, "Papol already has a version of this paper: <title>", with two
  choices. *Use that version* (the default) saves `POST /api/papers` for
  the known paper's file, as for any file Papol already holds — the user
  gets a copy of it, or "already in your nook" — and names the upload as
  `discard_file_path`; once the copy is saved the route lets that object
  go, if no `papers` row and no queued or running job names it, and only
  then. *Keep this version* is what always happened: a paper of its own
  under its own hash, DOI and all. The desktop viewer's Add to nook does
  not read the job result's paper and goes on making a paper under the
  opened file's hash; the nook's upload form on the desktop shows the same
  choice, and taking the known version saves through the server and lets
  the pending local blob go.
- **A paper nobody holds is not removed by itself.** Cleaning on every
  let-go was weighed and dropped as overhead; the decision is taken by
  hand, with `cloudflare/scripts/gc-papers.py`. `--list` prints every
  orphan — a non-deleted row with no live copy by anyone, no annotation by
  anyone (soft-deleted ones count: a replica may still hold them), no
  seminar, no link out and no board card carrying its file — with title,
  DOI, hash prefix, age and file size; `--delete` removes those rows, the
  tombstoned copies still pointing at them, their `paper_links`,
  `paper_references` and `paper_citations` rows and their bucket objects,
  and says what went; `--only 3b7eb8b7,…` limits either to named hashes;
  `--env dev` is dev.papol.io, production otherwise. Standard library,
  with `npx wrangler d1 execute` and `npx wrangler r2 object delete`
  underneath, so wrangler's login is all it needs. Never `--delete` on
  production without a `--list` first.

Verified on dev against the real Worker: a fresh PDF uploaded with the
identifier 10.1145/3526113.3545710, which dev holds as `47602f24…`, had
`existing` in its job result; taking that version gave the uploader a copy
of `47602f24…`, the Library one row for the DOI, and the upload's object a
404 at the bucket domain; keeping a second one made `782089f4…` beside it.
Cleaned with `gc-papers.py --delete --env dev --only …`: the dev mirror's
four orphan rows of 10.1145/3808345 (`3b7eb8b7…`, `4d48478d…`,
`a6fed677…`, `ef920e57…`, whose objects the dev bucket never had, with 40
links, 152 references and 184 citations between them) and the
verification's own orphan. Production's `--list` shows four orphans
(`40807dab…` The Byzantine Generals Problem, 32 days old and without a DOI,
and the recent `22bd33f7…`, `dbfb7aab…`, `24570d4a…`); nothing was deleted
there.

### Step 15 — landed 2026-09-22: one file model, board files keyed by their hash

The owner's instruction: make them all hash based, and let the browser
and the Mac fetch as much as they can without going through the Worker.
Step 12 had done it for a paper's PDF; a board file made on the website
was still stored under a name minted per write, still served by a
Worker route that asked who was asking, and the desktop still sent its
files through the Worker's `PUT /api/sync/blobs`. Now there is one
model, and every layer that existed for the Worker-carries-the-bytes era
is gone.

**The layout.** One bucket, `papol-files`, public by key on
`files.papol.io` (`papol-files-dev` on `files-dev.papol.io`), holding:
`uploads/<sha256>.pdf` for a paper's PDF; `uploads/avatars/<uuid>.<ext>`
for a picture; `board_uploads/blobs/<sha256>` for every board file — a
picture or a document put on a card in a browser or in the desktop app,
a clip from the viewer, a link card's capture. Every key is a content
digest or a uuid minted for one write, nothing in the bucket is listed,
and the Worker never carries a file's bytes in either direction.

**Writing** (`cloudflare/src/files.ts`, `routes/files.ts`,
`shared/api/files.js`): the client hashes the file and asks `POST
/api/files/upload-address` `{ kind, sha256, size, name, mime }` — `kind`
is `paper` or `board_file` — and is told `{ stored: true, file_path }`
when the bucket holds those bytes, else `{ stored: false, file_path,
url, headers }`, a presigned S3 PUT (fifteen minutes, signed over
`x-amz-checksum-sha256`, `content-type` and `content-length`, so the
bucket itself refuses bytes that do not hash to their name). The client
PUTs with the listed headers and no credential of Papol's, then tells
the route that records the row: `POST /api/papers/uploaded` for a
paper, `POST /api/boards/:uuid/files` `{ sha256, original_filename,
mime_type, caption, x, y }` for a card, `POST
/api/boards/:uuid/staging/clip` `{ sha256, caption, source_url,
source_label }` for a clip — each a JSON body naming a digest, each
refusing (409) bytes the bucket does not hold. The desktop's sync asks
the same route for each pushed row that carries a `sha256` (a paper's
row → `paper`, a card's → `board_file`) and PUTs by the same address.
A Worker without the R2 token — a local `wrangler dev`, whose R2 is a
simulation — answers with its own door as the address, `PUT
/api/files/:kind/:sha256`, with the caller's credential among the
listed headers, and holds the bytes to the same contract; the client
cannot tell the two apart, and a Worker that can sign for the bucket
keeps that door shut (404).

**Reading.** A card's answer carries `file_url` beside `file_path`, as
a paper's does: the bucket's address when `FILES_URL` is set, the
Worker's route otherwise. The board app and the desk fetch `file_url`
directly; the export's `files.json` names the bucket address for board
files as it does for PDFs. The desktop learns the address from
`files_url` in `GET /api/client-requirements` and builds
`${files_url}/uploads/<sha256>.pdf` or
`${files_url}/board_uploads/blobs/<sha256>` itself (the store now says
which kind each missing file is), with no credential; when `files_url`
is null it asks the Worker's `GET /api/sync/blobs/:sha256` with its
credential, as before. `GET /api/board-items/:uuid/file` and `GET
/api/sync/blobs/:sha256` answer a 301 to the bucket when `FILES_URL` is
set (a day's cache-control) and serve the object otherwise; the item
route no longer asks who is asking — a card's uuid and its file's digest
are both minted, and the bucket hands the file to whoever holds the key
anyway. On production, then, no read of a file's bytes passes through
the Worker except its own: the extract job and
`/api/papers/:name/extract-metadata` read a PDF from the bucket to hand
it to the host helper, and the reference pass to GROBID.

**Deletion.** A board file is named by its bytes, so two users' cards
— or a card of the leaver's that was let go and may be restored — can
name one object. Closing an account (`account/close.ts`) deletes a blob
only when no `board_items` row at all, soft-deleted rows included,
carries its sha256 once the leaver's rows are gone; `removed.board_files`
counts them. The suite holds it: a shared blob survives one owner's
closure and goes with the last.

**Removed**, with the tests, smoke tests and e2e seeds moved to the one
path: `POST /api/papers/extract` (multipart) and `storePdf`; `POST
/api/papers/upload-address` (folded into `/api/files/upload-address`);
`PUT` and `HEAD /api/sync/blobs/:sha256` and `receivePaperFile`'s copy
from the blobs area to `uploads/`; the multipart board-file and clip
handlers; `uploadThroughServer` and the `file_path.startsWith('http')`
branch of `pdfHref` in `shared/api/papers.js`; the desktop's HEAD-then-PUT
upload in `sync/coordinator.rs`; `cloudflare/src/papers/uploads.ts`
(absorbed into `files.ts`). A desktop build older than 0.5.0 would
still send its files through the removed routes, so
`MINIMUM_DESKTOP_VERSION` in `clientRequirements.ts` refuses it (426 on
the sync routes, `incompatible` in the requirements) whatever schema it
announces; the app is bumped to 0.5.0. Line counts before → after:
`shared/api/papers.js` 507 → 465 (plus `shared/api/files.js`, 40);
`cloudflare/src/routes/boards.ts` 568 → 555; `cloudflare/src/sync/blobs.ts`
116 → 42, with `papers/uploads.ts` (65) gone and `src/files.ts` (134)
and `routes/files.ts` (55) new; the desktop sync module
(`sync/coordinator.rs` + `mod.rs`) 1117 → 1239, the growth being the
address round trip and the bucket download that replaced two
Worker-shaped requests.

**The rekey**, `cloudflare/scripts/rekey-board-files.py [dev|prod]
[--dry-run]`: for every card whose `file_path` was not under `blobs/`,
a server-side `CopyObject` to `board_uploads/blobs/<sha256>` (the
digest computed from the bytes when a row lacked one — none did),
verified by size and ETag, the row pointed at the new key with its
`revision` and `updated_at` moved (file_path is server-owned and
travels to replicas), and only then the old key deleted; a final pass
gives every typeless board file — the Python era stored them with no
content type, which the bucket now serves — the type its card records,
by a copy onto itself. Standard library, the R2 token read from the
host at run time, wrangler for D1. Dev first, with the 33 production
objects the dev mirror's rows named copied across so the rehearsal was
real: 33 rows, 33 copied, 33 verified, 33 rekeyed, 33 old keys deleted.
Then production: 33 rows, 25 copied and 8 already present under their
digest (the same bytes as a desktop blob or an earlier card), 33
verified, 33 rekeyed, 33 deleted, 13 objects retyped. A second run of
each finds nothing. The two R2 secrets were set on both Workers, which
neither had (step 12's "still to do").

Verified on production with a throwaway account, every status as
designed: `client-requirements` says `files_url` and a 0.5.0 minimum
(a `Papol macOS/0.4.1` agent is `incompatible`); the address for a
board file is a signed PUT to `r2.cloudflarestorage.com` (200); the
card answers `file_path: blobs/<sha256>` and the bucket `file_url`;
`/api/board-items/:uuid/file` 301 with no credential; the bucket
answers 200, `content-type: image/png`,
`access-control-allow-origin: https://papol.io`, the bytes intact;
`/api/sync/blobs/:sha256` 301 with a credential and 401 without; the
Worker's door 404; a card rekeyed from the Python era 301 and, followed,
200 with a matching digest; the account closed with `board_files: 1`,
the card's route 404 and the object gone from the bucket.

What `papol-files` holds after: `uploads/` 50 PDFs and one picture,
`board_uploads/blobs/` 46 objects (85 MB), and 16 objects still under
`board_uploads/<board uuid>/` (14 under the one live board, 2 under the
legacy `2/`, 20 MB) that no card names — orphans of cards long gone,
left for the owner to delete by hand. A possible follow-up, not built:
`gc-papers.py`'s counterpart for those.

### Step 16 — landed 2026-09-22: each DOI asked of the registry that holds it

The upload's reading asked CrossRef about every DOI and OpenAlex behind
it, and an arXiv paper, whose DOI (`10.48550/arXiv.<id>`) is registered
with DataCite, fell through both to GROBID on the host: eleven seconds,
and the title block's reading of the authors (`Google Brain` among them).
Measured before changing anything: Papol's 30 DOIs from production and
ten well-known arXiv papers, each asked of the three sources three times,
the way the Worker asks (360 requests, no contact address or key),
scored against the titles people saved.

| | CrossRef | OpenAlex | DataCite |
|---|---|---|---|
| publisher DOIs found (27) | 27 | 27 | 0 |
| arXiv DOIs found (12) | 0 | 8 | 12 |
| … with the right title | – | 6 | 12 |
| LIPIcs (DataCite) found (1) | 0 | 0 | 1 |
| errors, timeouts, answers changing between rounds | 0 | 0 | 0 |
| median / p90 ms | 41 / 61 | 105 / 165 | 160 / 204 |

Each registry holds all of its own DOIs and none of the other's, and none
of the three failed once. OpenAlex added nothing CrossRef had not already
answered, missed 4 arXiv DOIs (Attention, BERT, GPT-4 among them) and gave
2 more the wrong title over the right authors — Chain-of-Thought came
back as "BNAI, NO-TOKEN, and MIND-UNITY: Pillars of a Systemic Revolution
in Artificial Intelligence". So `byDoi` (`bibliography.ts`) now asks:

- an arXiv DOI of DataCite alone; unknown there or DataCite down, the job
  reads the title block on the host, never OpenAlex;
- any other DOI of CrossRef; on its 404 (never heard of it), DataCite,
  which registers the rest (LIPIcs, Zenodo); OpenAlex only when CrossRef
  itself could not answer (network, timeout, 5xx, 429), and DataCite
  after it, since the DOI may be DataCite's. Unavailable, and the job's
  "Metadata lookup failed", only when all three could not answer.

The experiment's two scripts — one asking every DOI of every source, one
tabulating — stay out of the repository: the table above is what they
were for, and rerunning them means another read of production's papers.

With it, three smaller things from the upload's follow-ups:

- The bucket CORS rules (`r2-cors-public.json`) lose their localhost
  origins; see step 13's paragraph. `.dev.vars` empties `FILES_BUCKET`, so
  a local Worker gives its own door as the address even with R2 keys at
  hand, and can never sign a PUT to production's bucket; the suite names
  the bucket in `vitest.config.ts`.
- `scripts/smoke.sh` checks the one guarantee the direct upload rests on,
  which is R2's and not ours: with fresh bytes each run, so the address is
  a real signed PUT, the same length with one byte changed is refused
  (400 `BadDigest`; 422 from a local Worker's door) and the right bytes
  taken. Python's own user agent is refused at the edge (error 1010), so
  the check sends one of its own.

### Step 17 — landed 2026-09-22: the host fetches the paper itself

The last place a PDF passed through a Worker: the reference analysis and
the title-block reading downloaded the paper from R2 and posted its bytes
to the host's helper, although the bucket is public by key. Now the
Worker sends the helper `{ url }`, the paper's address on the bucket
domain (`FILES_URL`), and the helper fetches it itself
(`host/helper/src/files.ts`). The Worker only checks that the object is
there (`head`, no body). It still reads and sends the bytes where there
is no bucket domain, which is local development.

The helper fetches only `/uploads/<sha256>.pdf` on the origins
`services.papol.helper.fileOrigins` lists (default `files.papol.io` and
`files-dev.papol.io`), and only bytes that hash to that name: 400 for any
other address, 422 for bytes that do not match, 404 for a file the bucket
does not have. It sends its own user agent, since the edge refuses some
default ones. Order of the change: the helper learned addresses first and
was deployed to the host (`./deploy.sh host`), then the Worker switched.

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
