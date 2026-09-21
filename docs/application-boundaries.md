# Application boundaries

Papol's browser entry points are separate applications: `frontend`, `viewer`,
and `board`. They may depend on modules in `shared`, but never on one another.
The dependency-boundary test enforces that rule.

The shared client layers have distinct responsibilities:

- `appUrls.js` owns deployment paths and backend URL derivation.
- `httpClient.js` owns authenticated HTTP requests and response normalization.
- `api/` contains cohesive product clients for accounts, people, boards,
  papers, rooms, sharables, notifications, feedback, and administration.
  Applications import the domain they use.
- `nativeData.js` exposes a finite `nativeRepository` for desktop queries and
  atomic transactions without importing Tauri. Raw IPC query names are private
  to that module and are also represented by a closed enum in Rust.
- `ui/` contains UI used by more than one application.

Each application configures its platform adapters in `configurePlatform.js`.
This is the only layer that imports Tauri packages. Hosted builds therefore use
the same product APIs without making the shared data layer platform-aware.

Code belongs in an application until a second application needs it. At that
point it should move behind a deliberate shared interface rather than being
imported from the first application's source tree.

## Backend assembly

The backend is one Cloudflare Worker, `cloudflare/src`. `index.ts` owns
application construction: the router, the cross-cutting concerns
(authentication, idempotency, the error shape), the static assets, and the
queue and cron entry points. HTTP handlers live in `src/routes`, one file
per resource; reusable domain policy lives beside the routes in modules of
its own (`src/papers`, `src/sync`, `src/account`), and the jobs in
`src/jobs`.

Dependencies point inward: `index` assembles routes, routes use the domain
modules, and those never import the routes or the entry point.

The jobs are the same Worker's other face, and the reason the domain
modules never import a route: `src/jobs/queue.ts` is the queue (a table,
with a Cloudflare Queue as its wake-up and a cron sweep as its guarantee),
and the consumer runs what the routes queued with nothing of the HTTP
application involved. A job's handler is a domain function; the runner
names every kind it knows in one table, and a route queues by kind. Work
that takes longer than a request should — the reference analyzer, a
browser, the mail API — is a job, and a route that needs it writes the job
in the same batch as its own rows and answers with the job's uuid for
`GET /api/jobs/{uuid}`.
