# Demo architecture

The demo uses the ordinary UI, API handlers, validation, authorization and SQLAlchemy
schema. Its only alternate behavior is storage lifetime and an explicit set of
supported operations. There is no reset control and no requirement for feature parity.

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
shelves, tags, profile fields, seminars, database-backed board operations and sharing
use their real implementations. Bibliographic lookup and bundled-PDF reference
inspection are also available; an unavailable external service may still produce its
ordinary degraded result. Uploads and board attachments that target durable file
storage, account management, feedback submission and sync remain unsupported. An
omitted operation returns HTTP 501 with “Not supported in the demo.” There are no
fake-success implementations or separate demo domain rules.

When adding a feature, reuse its normal handler when every write is disposable and
every external effect is acceptable. Check its callees too. Permanent files, an
independent production database session, mail, synchronization and durable background
work cross the boundary and stay unsupported. Read-only external enrichment is
allowed to fail in the same way it does in the ordinary app.

Demo share links deliberately name `/demo/viewer` and only resolve inside the session
that created them. They are useful for exercising the complete sharing interaction,
but are neither durable nor public links.

The viewer uses the same API source for ordinary and demo annotations, so edits made
on a paper's jacket and in its viewer belong to the same workspace. PDFs and character
portraits are immutable bundled media and can use the existing static read paths.

`backend/test_demo.py` checks real handler behavior, cross-surface annotation reads,
session isolation, expiration and rejection of unsupported operations. The frontend
transport tests cover credential stripping, multipart routing, session reuse and
the absence of automatic mutation replay.
