# Application boundaries

Papol's browser entry points are separate applications: `frontend`, `viewer`,
and `board`. They may depend on modules in `shared`, but never on one another.
The dependency-boundary test enforces that rule.

The shared client layers have distinct responsibilities:

- `appUrls.js` owns deployment paths and backend URL derivation.
- `httpClient.js` owns authenticated HTTP requests and response normalization.
- `api/` contains cohesive product clients for accounts, people, boards,
  papers, rooms, notifications, feedback, and administration. Applications
  import the domain they use; `api.js` is only a compatibility barrel.
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
