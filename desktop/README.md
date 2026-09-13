# Papol Desktop

Papol Desktop is a standalone Tauri application. Its three web surfaces and
their runtime dependencies (the library, PDF viewer, boards, PDF.js fonts and
WASM, tutorials, and demo assets) are compiled into the application and DMG.
Only data and uploaded files come from the hosted FastAPI backend at
`https://mc-pony.com/papol`, so the desktop and browser clients share accounts
and data without loading the hosted frontend.

## Offline use

The user's boards, nook, papers, notes, ink, clips, tags, and shelves are stored
in a Rust-owned SQLite database under Tauri's application data directory.
Files use content-addressed SHA-256 names in a `blobs` directory beside that
database. A local row change and its outbox entry commit in one SQLite
transaction; one process-wide coordinator uploads blobs, pushes mutations,
refreshes bounded paper dependencies, then pulls the server cursor. Remote PDFs
download lazily when opened. Unsynchronized files are durable; only the
replaceable cache is subject to the 2 GiB LRU limit and Clear cache.

Offline writes are deliberately limited to data owned by that reader: adding
or removing a personal PDF, private paper fields, notes, ink, clips, tags, and
private shelves. All operations on the reader's own boards are supported too,
including board creation, cards, files, notes, groups, layout, staging, and
sending excerpts or clips from the viewer. These rows use permanent UUIDs and
the same synchronized schema locally and remotely.
Shared actions—seminars, public shelf/profile changes, feedback, and administration—show an
online-required message instead of being queued.

Synchronization is a permanent control at the bottom of the desktop sidebar.
Its explicit action is simply **Sync**; detailed state remains available to
assistive text and the control's tooltip. The **Automatic** or **Manual** preference lives in
the **Settings** panel. It applies only to this installation and is not stored
with the reader's account. Manual mode keeps
all owned edits local until Sync is chosen. Automatic mode synchronizes after
an edit, at sign-in/startup, when connectivity returns, and when the app comes
back to the foreground. A first sign-in and data not previously opened still
require a connection. Permanent validation failures remain visible as blocked
recovery records without freezing unrelated later work. Settings can save a
portable recovery ZIP with queued mutations, current affected rows, conflict
details, and unsynchronized files.

## Development

### Run the native app on macOS

From the repository root, start the developer app against the local backend:

```sh
./deploy.sh macos dev
```

This checks the local Node, Rust, and Xcode toolchains, installs changed npm
dependencies, and starts the frontend, viewer, and board Vite servers before
Tauri. UI edits live-reload and Rust edits rebuild and relaunch the app. The
default backend is `http://127.0.0.1:8000`; choose another explicitly with
`--backend URL`. If it is unavailable, the app still opens for cached/offline
work.

Build the production-backed application bundle and DMG with:

```sh
./deploy.sh macos prod
```

`macos build` is an alias. Production builds run all tests and native lints by
default; use `--no-check` only when iterating locally. `--universal` installs
both Rust macOS targets and produces one Apple Silicon/Intel application.
Local builds are ad-hoc signed, while tagged CI builds use the configured
Developer ID identity and notarization credentials.

The lower-level commands remain available from `desktop/` as `npm run dev`,
`npm run build:web`, and `npm run build`.
Run `npm test` for all UI and Rust tests, and `npm run check:native` for Rust
formatting and Clippy's warning-denying lint pass. The release workflow runs
both before signing and publishing.

The synchronization boundary has two focused suites. From `desktop/`, run
`npm run test:sync` for the IndexedDB request queue. Run
`npm run test:backend-contract` inside the repository's Python development
environment to exercise the same dependent board operations against FastAPI
and an isolated in-memory SQLite database. `npm run test:e2e:native-sync`
starts a disposable real backend and drives a Rust harness through offline
creation, process restart, blob transfer, push, and pull; set
`PAPOL_TEST_PYTHON` to the backend virtual environment's Python executable.
Dependabot checks the four npm lockfiles, the Rust lockfile, and GitHub Actions
weekly so Tauri and its surrounding supply chain do not silently age in place.
To use another backend in that bundle:

```sh
PAPOL_BACKEND_URL=http://localhost:8000 npm run build:web
```

### Extending offline data

For a nullable field on an existing synchronized row: add it to the ordered
shared migration in `schema/domain`, mirror it in the SQLAlchemy model, add it
to `schema/sync_registry.json` only if the desktop may write it, expose it from
the named local query, and add a round-trip test. A normal new private table
follows the same pattern plus its ownership rule. Shared, public, security, and
irreversible actions must stay outside the registry unless their delayed
offline semantics have been explicitly designed. Do not add a response-cache
overlay, a temporary ID mapper, or raw SQL IPC for a synchronized feature.

## Runtime and networking

Before any UI module executes, Tauri injects one immutable
`window.__PAPOL_ENV__` runtime object. It identifies the `desktop` runtime, the
`main`, `viewer`, or `board` surface, and whether the surface is a document
window. Hosted pages derive the corresponding `web` default in
`shared/appEnvironment.js`. Desktop chrome, document-window behavior, and
network selection all consume that contract rather than probing private Tauri
globals or the user agent.

HTTP(S) traffic uses Tauri's native HTTP client and is restricted by the
window-specific capabilities to the Papol production backend and local development
backends. It therefore does not require the API to grant CORS access to Tauri's
internal asset origin. Requests for bundled `tauri:` assets remain inside the
webview; hosted Papol builds continue using normal browser `fetch` and CORS.

The bundled application has an explicit Content Security Policy. Tauri adds
nonces and hashes for compiled assets; Papol additionally permits only its own
resources, IPC, local data/blob images, and uploaded avatars from its backend.
Object embedding and frames are disabled, and `Object.prototype` is frozen in
the custom-protocol webview.

The desktop pages swap the website masthead for a native reference-manager
layout: a source-list sidebar of shelves, tags, boards and the library, a list
of papers, and the selected paper beside it. See "Desktop shell" in
`frontend/DESIGN.md`. On macOS the window uses an overlay title bar, so those
toolbars sit where the title bar would be and the traffic lights float over
their left edge.

## Window chrome

A webview is not a browser, and three things a web page takes for granted need
the app's help. The window is declared in `tauri.conf.json` with `create: false`
and built in `src-tauri/src/lib.rs`, so handlers can be attached to it:

- Links that ask for a new tab or window (a DOI, a publisher's PDF) open in the
  default browser. Only `http`, `https` and `mailto` links are handed on.
- Downloads (a paper's PDF, an account export) are allowed, and saved to the
  Downloads folder without overwriting.
- The macOS webview shows no JavaScript dialogs, so `window.confirm` silently
  answers "no". Every confirmation goes through `shared/confirmAction.js`, which
  asks with an in-app sheet inside the app and with `confirm()` in a browser.

## macOS release

The final macOS build must run on macOS. The repository release workflow builds
a universal Apple Silicon/Intel binary, signs and notarizes it, and attaches its
DMG to a GitHub release when a tag matching `desktop-v*` is pushed.

Configure these GitHub Actions secrets first:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: password for that `.p12`
- `APPLE_SIGNING_IDENTITY`: certificate identity, such as `Developer ID Application: Name (TEAMID)`
- `APPLE_ID`: Apple Account used for notarization
- `APPLE_PASSWORD`: app-specific password for that Apple Account
- `APPLE_TEAM_ID`: Apple Developer team identifier

Then update the version in both `package.json` and `src-tauri/tauri.conf.json`,
commit it, and push a matching tag, for example `desktop-v0.1.0`.

A local `npm run build` uses an ad-hoc macOS signature so its DMG is internally
consistent. Tagged workflow builds replace that with the configured Developer
ID signature and notarization.

Capabilities live in `src-tauri/capabilities/`, rather than being embedded in
the main configuration. The permanent library window cannot invoke the close
command; viewer and board document windows can. Each receives only window
chrome, document navigation, and HTTP access to the Papol production or local
development backend. No window has native filesystem access, and hosted pages
are not granted native capabilities.

The Isolation pattern is intentionally not enabled yet. It is most valuable
with a small, separately reviewed hook that validates every IPC payload; adding
an empty pass-through isolation app would add complexity without another useful
policy boundary. The updater is also deferred until a public update endpoint
and updater signing key are chosen. These are separate from Apple's application
signature and notarization credentials.
