# Demo architecture

The demo uses the ordinary UI, API handlers, validation, authorization and SQLAlchemy
schema. Its only alternate behavior is storage lifetime and an explicit set of
supported operations. There is no reset control; parity with the ordinary app is
the goal, and the gaps are the operations that cannot be made disposable.

`backend/demo.py` mounts a separate application at `/api/demo`. Each visitor receives
an opaque session key and an isolated, in-memory SQLite database. The database is
seeded from `shared/demoSeed.json`; seed timestamps express days ago. The seed also
supplies the desktop's immutable PDF media identities directly.

Sessions last one hour from creation. An event-loop timer disposes of expired
databases, allowing an in-flight request to finish first. Server restart also discards
them. At most 64 sessions are retained per process; a full server reports that the
demo is busy. This matches the current single-worker deployment. Multiple workers
would require session affinity or a different temporary-store owner.

`shared/connectivity.js` redirects demo API traffic at the network boundary,
including multipart requests that bypass the JSON client. `shared/demo.js` obtains
or resumes the session, strips real credentials and sync identifiers, and uses the
demo endpoint. Web visits carry the key in session storage; desktop windows share
it through local storage. Only the key is stored there, never demo content. Expired
operations return an error without being replayed; reloading starts a fresh visit.

The demo application installs its own database dependency, substitutes the fictional
reader's credentials, and invokes the normal route handlers. It does not inherit
production startup jobs, idempotency bookkeeping or database error logging. Requests
within one workspace are serialized so its SQLite connection is never used by two
requests simultaneously.

`SUPPORTED_HANDLERS` is the capability policy. It includes reviewed handlers whose
effects are either read-only or confined to the disposable workspace. Notes, ratings,
shelves, tags, profile fields, seminars, board operations and sharing use their real
implementations. So do the operations that make files for the visitor: capturing
a webpage or a YouTube frame onto a board, reading a board's file, the data
export. Bibliographic lookup and bundled-PDF reference inspection are also
available; an unavailable external service may still produce its ordinary
degraded result. Account management runs the real handlers with the real checks,
and the demo reader's password is `papol-demo`, so changing it and closing the
account both work; closing the account ends the visit, and the next reload starts
a fresh one. Uploads are refused, deliberately and all of them: no paper, board
file, clip or avatar is accepted from a visitor. What else remains unsupported is
what leaves the boundary: feedback (it mails the admins), desktop synchronization,
admin, and the sign-in the demo replaces with its own session. An omitted
operation returns HTTP 501 with “Not supported in the demo.” There are no
fake-success implementations or separate demo domain rules.

Files follow the same rule as rows. Each workspace owns a temporary directory,
presented to the handlers through `backend/storage.py` as a layered store: the
directory in front, the real store behind it for reading. Captured images land
in the directory; the bundled PDFs are read through from the real store; nothing
a demo request does can write to, or delete from, the store everyone shares. The pair is installed for the duration of each request
through a context variable, so `storage.uploads` and `storage.board_files` name
the workspace's areas inside the handler and the configured ones everywhere
else. A workspace holds at most `files.demo_workspace_mb` across both areas, and
the directory is removed with the workspace. Reference analysis is the one job
that runs after the response, on the permanent database; a demo request never
queues it. The seeded papers get theirs through the bundled-PDF engine instead.
A board's captured image is read through the ordinary board-file route, which
carries the session header like any other demo request; PDFs and portraits are
bundled media on the ordinary static paths.

When adding a feature, reuse its normal handler when every write is disposable and
every external effect is acceptable. Check its callees too. An independent
production database session, mail, synchronization and durable background work
cross the boundary and stay unsupported. Read-only external enrichment is allowed
to fail in the same way it does in the ordinary app.

Demo share links deliberately name `/demo/viewer` and only resolve inside the session
that created them. They are useful for exercising the complete sharing interaction,
but are neither durable nor public links.

The viewer uses the same API source for ordinary and demo annotations, so edits made
on a paper's jacket and in its viewer belong to the same workspace. Character portraits are bundled with the frontend; bundled PDFs are read from the
real store through the workspace's layered view.

`backend/test_demo.py` checks real handler behavior, cross-surface annotation reads,
session isolation, expiration, rejection of unsupported operations, and that a
visitor's files stay in their workspace and die with it. The frontend
transport tests cover credential stripping, multipart routing, session reuse and
the absence of automatic mutation replay.
