# Papol macOS

Papol macOS is a standalone Tauri application. Its three web surfaces and
their runtime dependencies (the Desk, PDF viewer, boards, PDF.js fonts and
WASM, tutorials, and demo assets) are compiled into the application and DMG.
Only data and uploaded files come from the hosted backend, the Worker at
`https://papol.io`, so the macOS app and browser clients share accounts
and data without loading the hosted frontend.

## Offline use

### Startup identity

Papol macOS treats the local account on this computer as the user's
identity. It loads that profile from SQLite before mounting the application and
renders the local nook without waiting for the backend. Server authentication
and synchronization happen afterward in the background. An expired credential
removes network access but does not remove the local identity or its data;
explicit sign-out or account switching is the identity boundary.

The user's boards, nook, papers, notes, ink, clips, tags, and shelves are stored
in a Rust-owned SQLite database under Tauri's application data directory.
Files use content-addressed SHA-256 names in a `blobs` directory beside that
database. A local row change and its outbox entry commit in one SQLite
transaction; one process-wide coordinator uploads blobs, pushes mutations,
refreshes bounded paper dependencies, then pulls the server cursor. Remote PDFs
download lazily when opened. A browser handoff whose PDF is not present uses a
direct one-file download, reports byte progress in the viewer, and opens as
soon as that verified blob is stored. Unsynchronized files are durable; only the
replaceable cache has no automatic size limit and can be removed with Clear cache.

Offline writes are deliberately limited to data owned by that user: adding
or removing a personal PDF, private paper fields, notes, ink, clips, tags, and
private shelves. All operations on the user's own boards are supported too,
including board creation, cards, files, notes, groups, layout, staging, and
sending excerpts or clips from the viewer. These rows use permanent UUIDs and
the same synchronized schema locally and remotely.
Shared actions—seminars, public shelf/profile changes, feedback, and administration—show an
online-required message instead of being queued.

Synchronization is a permanent control at the bottom of the desktop sidebar.
Its explicit action is simply **Sync**; detailed state remains available to
assistive text and the control's tooltip. The **Automatic** or **Manual** preference lives in
the **Settings** panel. It applies only to this installation and is not stored
with the user's account. Manual mode keeps
all owned edits local until Sync is chosen. Automatic mode synchronizes after
an edit, at sign-in/startup, when connectivity returns, and when the app comes
back to the foreground. A first sign-in and data not previously opened still
require a connection. Permanent validation failures remain visible as blocked
recovery records without freezing unrelated later work. Papol offers to send
the developer a user-reviewed diagnostic report for these failures, local
database/IPC failures, and unexpected runtime errors. Reports contain bounded,
redacted operational details rather than credentials or document content.
Settings can save a portable recovery ZIP with queued mutations, current
affected rows, conflict details, and unsynchronized files.

Desktop diagnostic events are JSON Lines records in the application data
directory. The native logger keeps four files of at most 1 MiB each and accepts
only bounded identifiers, messages, and an allowlist of scalar metadata. It
redacts macOS user-directory paths and bearer credentials before writing. The
feedback dialog previews a bounded recent excerpt and lets the user exclude
it before sending; **Open logs** in Settings reveals the local files in Finder.

## Opening PDFs from the system

Papol registers as a PDF viewer (`bundle.fileAssociations`). A PDF opened with
Open With, by double-click once Papol is the default, by a drop on the Dock
icon, or as a command-line path opens in its own viewer window, named by the
file's SHA-256. A viewer may read only files the system handed to this process.

Opening a file needs no account and makes no network request. If the user's
nook already holds those exact bytes, the window works on that paper. Otherwise
the file is read only — a note, a stroke or a clip needs a nook to go into —
and **Add to nook** copies the file into the replica; without an account it
first asks the Desk window to sign in. The Desk banner and
Settings can make Papol the default PDF viewer (macOS only).

## Opening a reading handed over from a browser

A user looking at a paper or a board in a browser on a Mac is offered the
application for that document (USER_STORIES.md §7d). The bar is
`shared/ui/MacHandoffBar.jsx`, mounted by the viewer and board applications;
every decision it makes — whether to offer at all, what the address is, what
the user has already answered — is in `shared/macHandoff.js`, so the policy
is testable without a browser (`frontend/src/macHandoff.test.js`).

Papol registers its scheme through `src-tauri/Info.plist`, which tauri-bundler
merges into the generated one. That file is written by
`scripts/write-info-plist.mjs` before each build, because the scheme belongs
to the build and not to the repository: Launch Services hands a scheme to one
application system-wide, so a development build claiming `papol` would be the
one a user's browser reaches. The release answers `papol`, a development
build answers `papol-dev`, and `handoff_scheme` in `lib.rs` derives the same
name from the bundle identifier at runtime. The address mirrors the web
address the user was at, so `https://papol.io/viewer/?pdf=…`
arrives as `papol://papol.io/viewer/?pdf=…`. `handle_run_event`
answers it: `deep_link_url` moves the path onto the bundled origin — a window
built on the browser's origin would fetch the hosted site over the network —
and `show_document_window` then opens or retargets the one window that
document has. Only the query keys naming a document and a place in it cross
over, because anyone at all can send the application one of these.

Two things make this untestable in `tauri dev`. macOS resolves a scheme
through Launch Services, which knows only about bundled applications in
`/Applications`, and it cannot be registered at runtime. Build and install
first, then hand a reading over from a browser or with
`open 'papol://papol.io/viewer/?pdf=<sha>'`.

No browser will say whether an application is installed. The bar assigns the
address to `location.href` and watches for this tab losing the user within
`DETECTION_MS`. The three signals are not equally good: going hidden or being
unloaded means the page is in front of nobody, but losing focus does not —
a browser that cannot open the address may say so in a panel attached to this
window, which blurs the page while leaving it visible. So a blur only extends
the wait to `BLUR_GRACE_MS`, and focus returning inside that settles the
question the other way. All of it is still a guess, so silence is reported as
"unknown" and shown as an offer to download, never as a verdict about the
user's computer.

A handoff is usually a cold launch — the address is what starts Papol — so
`RunEvent::Opened` arrives before `setup` has built anything to show it in.
`open_handed_over_links` queues those addresses in `OpenedFiles::waiting_links`
and `setup` drains them, exactly as it does for files opened at launch.

Checking it on a Mac takes a build, because Launch Services knows only about
bundled applications and cannot be told about a scheme at runtime:

    npm run build:dev                     # a bundle that answers papol-dev://
    cp -R src-tauri/target/release/bundle/macos/"Papol Dev.app" /Applications/
    open 'papol-dev://papol.io/viewer/?pdf=<sha>&page=14'

A cold launch should open the reading rather than the Desk, a second
address for the same document should move that window rather than add one,
and `papol://` should still belong to the installed release. The browser half
needs a real browser and is not scriptable from a shell, so it has its own
instrument:

    desktop/scripts/handoff-browser-check.sh papol-dev

It drives a Chrome of its own and reports what the page saw. The page must be
on the space you are looking at: a window elsewhere is `hidden`, and no
browser opens an application from a hidden page.

Claiming Papol's own web addresses through universal links is not built. It
needs an Apple-issued associated-domains entitlement and an
`apple-app-site-association` file served from the domain, and it would not
help here anyway: a user already standing on an address cannot follow a link
to where they already are.

## Development

### Run the native app on macOS

From the repository root, start the developer app against the local backend:

```sh
./deploy.sh macos dev
```

This checks the local Node, Rust, and Xcode toolchains, installs changed npm
dependencies, and starts the frontend, viewer, and board Vite servers before
Tauri. UI edits live-reload and Rust edits rebuild and relaunch the app. The
default backend is `http://127.0.0.1:8787` (`wrangler dev`) on macOS; choose another explicitly with
`--backend URL`. If it is unavailable, the app still opens for cached/offline
work.

Build the production-backed application bundle and DMG with:

```sh
./deploy.sh macos prod
```

`macos build` is an alias. Production builds run all tests and native lints by
default; use `--no-check` only when iterating locally.
Local builds are ad-hoc signed unless the repository root contains an ignored,
owner-only `.env.macos-notarization` file. With that file, `deploy.sh` signs,
notarizes, and validates the app in one build pass. Its contents are shell
assignments:

```sh
APPLE_SIGNING_IDENTITY='Developer ID Application: Name (TEAMID)'
APPLE_ID='developer@example.com'
APPLE_PASSWORD='app-specific-password'
APPLE_TEAM_ID='TEAMID'
```

Run `chmod 600 .env.macos-notarization` after creating it. App Store Connect
Team API credentials (`APPLE_API_ISSUER`, `APPLE_API_KEY`, and
`APPLE_API_KEY_PATH`) can replace the Apple ID authentication trio. Repeated
ad-hoc local builds reuse an unchanged web payload and its matching DMG;
notarized builds deliberately bypass that cache so an older ad-hoc artifact
cannot be reused.

The lower-level commands remain available from `desktop/` as `npm run dev`,
`npm run build:web`, and `npm run build`.
Run `npm test` for all UI and Rust tests, and `npm run check:native` for Rust
formatting and Clippy's warning-denying lint pass. The release workflow runs
both before signing and publishing.

The synchronization boundary has focused suites. From `desktop/`, run
`npm run test:sync` for the network-only connectivity boundary and native
SQLite synchronization lifecycle; the server's side of the same contract
is `cloudflare/test/sync.test.ts`. `npm run test:e2e:native-sync`
starts a disposable real backend — the Worker, as `wrangler dev` on a port
of its own with a database of its own — and drives a Rust harness through
offline creation, process restart, blob transfer, push, and pull. `npm run
test:e2e:native-ui` starts the same backend, compiles the real app against
it, opens it on a fresh replica under a throwaway `HOME`, and signs in
through its own window: the desk has to come up, take the account, and list
the paper the service holds, and the replica underneath has to hold it too.
It drives the window with `scripts/papol-ui.swift` (below) and needs
Accessibility permission for whatever runs it. Both take wrangler from
`cloudflare/node_modules` (`npm ci --legacy-peer-deps` there first) and
Node from mise (`mise.toml`); the scripts themselves want nothing of Python's
but the standard library, so the Mac's own `python3` runs them.
CI runs both on every pull request, in `desktop-macos.yml`'s two end-to-end jobs; the app's job grants the runner that permission itself.
Dependabot checks the four npm lockfiles, the Rust lockfile, and GitHub Actions
weekly so Tauri and its surrounding supply chain do not silently age in place.
To use another backend in that bundle:

```sh
PAPOL_BACKEND_URL=http://localhost:8787 npm run build:web
```

`PAPOL_BACKEND_URL` is the base directory that contains Papol's `api/`
route: use `https://papol.io` for the production app and
`http://localhost:8787` for `wrangler dev`. The build
normalizes either form to a trailing-slash directory URL, so browser requests
and native synchronization retain that path prefix.

### Driving the interface

Apple ships no WebDriver for WKWebView, so the usual desktop test drivers do
not work here. The accessibility API does, and `scripts/papol-ui.swift` is the
small amount of it Papol needs:

```sh
cd desktop/scripts
xcrun swift papol-ui.swift windows            # every running Papol, and its windows
xcrun swift papol-ui.swift dump 1234          # every named element in the first window
xcrun swift papol-ui.swift press 1234 "Not now"
xcrun swift papol-ui.swift shot 1234 /tmp/papol.png
```

WebKit publishes the page as real elements — `AXButton`, `AXTextField`,
`AXStaticText`, each carrying the name a user sees — and pressing one runs
the handler a click would run. That works against the application as shipped:
no plugin compiled in, no debug build, no development server. It needs
Accessibility permission for whatever runs it, in System Settings → Privacy &
Security → Accessibility.

Two things mislead anyone who tries this without the script. AppleScript's
System Events cannot see the page at all: its `entire contents` stops at the
web area and reports a few unnamed groups, which reads exactly like a webview
that publishes nothing. And `screencapture -R` captures a rectangle of the
screen rather than a window, so an occluded Papol yields a picture of whatever
is in front of it; `shot` raises the window first.

A name alone will not find an element, and neither will the role you expect.
A button carrying `aria-haspopup="menu"` is published as `AXPopUpButton`, not
`AXButton`, and a search for a word like "share" is swamped by every user
named Sharer on the page. Both failures read exactly like a control that never
rendered. Ask a dump what roles it actually found before concluding anything is
missing:

```sh
xcrun swift papol-ui.swift roles 1234       # what the page actually published
```

When the question is what the page itself thinks — which props it rendered
from, which branch it took — the development build serves its UI from Vite, so
an edit to a component hot-reloads into the running application in seconds. A
temporary line written to the application's own diagnostic log answers that in
minutes, and more reliably than an inspector: Safari's Web Inspector has to be
attached by hand, and calling `open_devtools()` from `setup` does not work
(tauri#4170).

Typing is the one thing this cannot do. Setting a field's value through the
accessibility API reports success and leaves the field empty, because React
never sees the change — a test that must type should send keystrokes, or drive
the same screens in a browser against the development server instead.

### Extending offline data

For a nullable field on an existing synchronized row: add it to
`schema/domain/domain.sql`, mirror it in a D1 migration (`cloudflare/migrations`), add it to
`schema/sync_registry.json` only if the desktop may write it, expose it from
the named local query, and add a round-trip test.

`domain.sql` is edited in place; there is no second file recording the shape
it used to have. When the change is one an existing replica or database
cannot be read under, say so: bump `schema_version` in
`schema/sync_registry.json`. Nothing works that out for you — whether a
change is breaking is your judgement, and both ends act on having been told.
The desktop discards a replica at any other version and pulls the account
again; the service refuses to start on a database at any other version,
naming the statement that records the new one once you have brought it
there. The same number is what every request carries, so an older build is
refused with a 426 and stops being used, rather than making work into a
replica the next build will throw away. Every change to a table's shape is
such a change: the service does not alter a table it already has. A normal
new private table follows the same pattern plus its ownership rule. Shared, public, security, and
irreversible actions must stay outside the registry unless their delayed
offline semantics have been explicitly designed. Do not add a response-cache
overlay, a temporary ID mapper, or raw SQL IPC for a synchronized feature.

## Runtime and networking

Before any UI module executes, Tauri injects one immutable
`window.__PAPOL_ENV__` runtime object. It identifies the `desktop` runtime, the
`desk`, `viewer`, or `board` surface, and whether the surface is a document
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
layout: a source-list sidebar of shelves, tags, boards and the Library, a list
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

The final macOS build must run on macOS. A release is the Papol macOS workflow
(`.github/workflows/desktop-macos.yml`) run by hand with `release` set, which
`./deploy.sh macos release [patch|minor|major|X.Y.Z] [--dry-run]` asks for. It
runs the gate on main, stamps the version after the latest `macos-v*` tag into
its own checkout (`scripts/release-version.mjs`), builds an Apple Silicon
binary, signs and notarizes it, and only then tags the commit and attaches the
DMG to a GitHub release. No version is committed: the tags say which release
came last, and the versions in `package.json` and `src-tauri/tauri.conf.json`
only name what a local build calls itself.

The workflow needs these GitHub Actions secrets; `./deploy.sh macos
credentials` prints them from the local credential file and certificate, and
with `--set` also sets them on the repository:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: password for that `.p12`
- `APPLE_SIGNING_IDENTITY`: certificate identity, such as `Developer ID Application: Name (TEAMID)`
- `APPLE_ID`: Apple Account used for notarization
- `APPLE_PASSWORD`: app-specific password for that Apple Account
- `APPLE_TEAM_ID`: Apple Developer team identifier

A local `npm run build` uses an ad-hoc macOS signature so its DMG is internally
consistent. Release builds replace that with the configured Developer ID
signature and notarization.

Capabilities live in `src-tauri/capabilities/`, rather than being embedded in
the Desk configuration. The permanent Desk window cannot invoke the close
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
