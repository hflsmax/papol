# Release checks

What has to be true before a revision goes to production, and what has to be
seen after it lands.

The suites answer "does the code do what it says." This document exists for
the question they do not answer: **does the thing a person clicks still work.**

## The lesson this is written from

On 2026-09-17 a release keyed papers by the digest of their PDF instead of by
a UUID. Backend, replica, viewer, board and the demo were all re-keyed. The
browser's router was not: `parseRoute` still matched `/paper/` against a UUID,
so `/paper/<digest>` matched nothing and fell through to the home page.

Everything passed. 125 frontend unit tests, 210 backend tests, the browser
smoke test, the health probe, and a thorough review of the pull request. Every
paper link anyone had ever been handed was dead, and nothing said so, because:

- **No test opened a URL.** `parseRoute` was a private function inside
  `App.jsx`, unexported and unreachable from a test. The one thing that
  turned a link into a page was the one thing nothing exercised.
- **The smoke test only opened `/`.** It proved the bundle boots. The home
  page is exactly the page a broken route falls through to, so it was the one
  URL in the application that could not have failed.
- **The health probe only checks the status code.** A single-page app serves
  its shell — HTTP 200 — for every path it has never heard of. A 200 from a
  dead link and a 200 from a live one are the same 200.

The shape of the failure is general, so the checks below are general: a rename
that misses one caller, in a layer nothing drives through a URL, looks
identical to perfect health from outside.

## Before a release

Run the suites. `./deploy.sh macos prod` runs the four UI and native lanes;
otherwise, per surface:

    (cd frontend && npm run test)    # units, production build, browser smoke
    (cd viewer   && npm test)
    (cd board    && npm test)
    (cd cloudflare && npm run typecheck && npm test)   # the Worker, on a local D1
    (cd desktop  && cargo test --manifest-path src-tauri/Cargo.toml)

`npm run test` in `frontend` includes the browser smoke test, which now opens
every link shape the application answers — a paper, a user, a room, the
library, and the standing pages — and fails unless each renders the page it
names. That list lives in `frontend/scripts/browser-smoke.mjs`; a new URL shape
belongs in it, and in `frontend/src/routes.test.js`.

## The desktop renders the same pages from different rows

On 2026-09-20 the macOS app blanked on every paper jacket. The web API always
sends `also_read_by`, so a cleanup removed the guard around it; the desktop
replica never stores it, so the jacket dereferenced a field that was not
there, and one throw unmounted the whole window. Every suite passed, because
nothing rendered a desktop surface against a replica-served row.

Three things now stand where that gap was:

- **`schema/api_shapes.json`** declares the list fields each API view always
  carries, and `shared/nativeData.js` completes replica-served rows against
  it — a list the replica cannot know starts empty instead of missing. The
  test that pinned it to the server's response models went with the Python
  backend; a Worker response gaining or losing a list moves the declaration
  by hand, and `frontend/src/nativeData.test.js` reads it.
- **The browser smoke's desktop pass** opens the built bundle as Papol macOS
  runs it — a mocked Tauri bridge answering with replica-shaped rows — and
  fails if a surface crashes or renders the wrong thing.
- **Error boundaries** (`shared/ui/ErrorBoundary.jsx`) keep a render crash to
  the surface that raised it. The panel that stands in offers to report the
  error; the rest of the window keeps working. A blank window means the
  boundary itself is missing from that surface.

## Before a macOS tag

The click-through is automated and lives in CI. Each surface's `npm test`
now ends in a browser smoke that does what the checklist used to ask of a
human: the frontend's opens every link shape and the desk against
replica-shaped rows; the viewer's opens a shared reading of a generated PDF,
clicks a citation marker, and requires the reference card to fill; the
board's opens a canvas and requires its cards drawn. They run hermetically —
each smoke serves its own API from the declared shapes — so they pass or
fail the same on a laptop and on a runner.

The gate is CI's, and only CI's. `./deploy.sh macos release` bumps the
version and pushes the tag; it checks nothing, because a gate a script can
skip on the machine that wants to ship is not a gate. What stands behind it:

- **every pull request and every push to main** runs all of it twice: on
  ubuntu (`pr.yml`, which also carries the backend suite and the share
  end-to-end drive) and on the macOS runner (`desktop-macos.yml`'s test
  job), so a commit that would fail the release gate is known the moment
  it exists, on the machine family the app ships to;
- **the tag** runs the macOS gate once more, and the DMG is built,
  notarized and published only if it passes. A failed gate leaves a tag
  and no release — nothing shipped; fix main and cut the next version.

`./deploy.sh macos prod` additionally smoke-tests the web payload Tauri
actually bundled (`PAPOL_SMOKE_DIST=desktop/dist`), which is the closest a
check gets to the shipped bytes. The native shell itself — a window that
opens, a real replica underneath, a real service behind it — is the
end-to-end job's, in the same workflow: it starts the backend, compiles the
app against it, signs in through the window, and requires the seeded paper
to be listed there and held in the replica. It asks the window for those
three things by name and nothing more; a suite that drives a whole feature
through the accessibility API spends its failures on itself, which is why
the sharing suite that once did was removed (`desktop/scripts/papol-ui.swift`
says so at its head).

## After a release

`./deploy.sh prod` waits for the page to answer and then runs the link check
itself; `check.sh` is the probe module.nix's timer runs every minute. Both
can be run by hand.

    health/check.sh https://mc-pony.com/papol    # the service is answering
    health/links.sh https://mc-pony.com/papol <digest-of-a-real-paper>

`links.sh` opens each link in a headless browser and reads `data-page` off the
application root, which says which page the router actually built. It is the
only check that can tell a live link from a dead one, and the only one worth
trusting after a change to how anything is named.

**The URL must be the public one**, not `http://127.0.0.1:<port>`. The built
application asks for its own scripts under `/papol`, a prefix the proxy in
front of the service strips: on the service's own port those requests miss the
assets, fall into the single-page catch-all, and come back as HTML. The module
never loads, nothing renders, and every link looks dead. Papol is only whole
where a reader meets it, which is the only place worth checking anyway.

`links.sh` renders the home page first and on its own, because every unknown
path renders the home page: if *that* does not come up, the check is standing
in the wrong place and has nothing to say about routing. It exits 2 for that,
and `deploy.sh` steps over a 2 rather than blaming the revision for it.

Then open one real paper link in a real browser and read it. Not the home page,
not a link the app just generated for you in the same session — a link from
before the release, the way a reader holds one.

## Papol is in development, and that is a licence

There are no readers but us. Nobody is holding a link written last month, no
client is pinned to a response shape, and no deployment has to survive the one
before it. So when a change could be made compatibly or cleanly, **make it
cleanly and break the old thing.** Compatibility costs a branch in the code, a
second shape in every test, and a second thing to hold in the head, and it is
being paid for nobody.

Concretely, prefer to: change a URL rather than answer both; rename a field
rather than accept either name; bump the schema version rather than read
around a column;
delete a route rather than deprecate it. The first version of the shortened
paper name answered both 32 and 64 characters so old links would survive. There
were no old links worth surviving — only two shapes in three resolvers, two in
every test, and a question at every boundary about which kind of name this was.
It went.

This is a licence to be succinct, not a licence to be careless: an incompatible
change still has to be complete. What it buys is the right to not carry the
past. Revisit it the day Papol has a reader who is not us.

## When a name changes shape

A UUID becoming a digest, a path gaining a segment, a route being retired. This
is the change class that produced the failure above, and it deserves its own
pass. Every one of these has to move together:

- `shared/paperName.js` — what a paper is called in a URL, and the only place
  that decides it
- `frontend/src/routes.js` — which page a path opens
- `frontend/src/routes.test.js` — the shapes that must keep working, and the
  shapes that must keep *not* working
- `cloudflare/src/papers/resolve.ts`, `desktop/src-tauri/src/data/database.rs` — the
  two resolvers that turn a name from a URL back into the stored identity
- `frontend/scripts/browser-smoke.mjs` — the links the smoke test opens
- `health/links.sh` — the links production is checked with after a deploy
- `shared/demo.js` — the demo answers the same paths without a service
- `viewer/src/source.js`, `shared/nativeData.js` — the other surfaces' names

Grep for the old shape before declaring it done: `grep -rn '{8}-\[0-9a-f\]'`
finds UUID patterns, `grep -rn '{64}'` finds digests. A pattern nobody changed
is not evidence that it did not need changing.

And keep the two apart. A **name** is what a URL and the wire carry and a
lookup resolves; an **identity** is what rows are keyed by, blobs are stored
under, and bytes are checked against. A paper's name is the first half of its
digest; its identity is all of it, and shortening the one must never shorten
the other. `cloudflare/test/papers.test.ts` holds that line, and the test that
matters most there is the one asserting the blob check still demands all 64
characters: a name half as long would be a check half as strong.

One shape each, per the section above. The service does not answer a paper's
full digest as though it were a name, and nothing sends one: `paperName()` and
`paper_name()` are applied at every boundary, so no code below them has to ask
which kind of name it is holding.

## Why a test is not enough

The three checks above are deliberately at three different altitudes, because
each can be fooled on its own:

| Check | Catches | Blind to |
| --- | --- | --- |
| `routes.test.js` | a path parsed wrongly | a route nobody wired to a page |
| browser smoke | a link that renders the wrong page | anything the deployment does differently |
| `links.sh` | a dead link in production | a page that renders but is useless |

None of them replaces opening the app. They replace *forgetting* to.

A check that reports everything as broken is reporting on itself. The first
run of `links.sh` against production called all seven links dead, including
`/` — which cannot be broken, because it is where broken links land. Read a
total failure as "the check lost its footing" before reading it as "the
release is bad."
