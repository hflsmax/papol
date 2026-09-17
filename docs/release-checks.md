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
    pytest backend                   # the service
    (cd desktop  && cargo test --manifest-path src-tauri/Cargo.toml)

`npm run test` in `frontend` includes the browser smoke test, which now opens
every link shape the application answers — a paper, a user, a room, the
library, and the standing pages — and fails unless each renders the page it
names. That list lives in `frontend/scripts/browser-smoke.mjs`; a new URL shape
belongs in it, and in `frontend/src/routes.test.js`.

## After a release

`./deploy.sh prod` runs both of these itself; they are listed so they can be
run by hand.

    health/check.sh https://mc-pony.com/papol    # the service is answering
    health/links.sh https://mc-pony.com/papol <digest-of-a-real-paper>

`links.sh` opens each link in a headless browser and reads `data-page` off the
application root, which says which page the router actually built. It is the
only check that can tell a live link from a dead one, and the only one worth
trusting after a change to how anything is named.

Then open one real paper link in a real browser and read it. Not the home page,
not a link the app just generated for you in the same session — a link from
before the release, the way a reader holds one.

## When a name changes shape

A UUID becoming a digest, a path gaining a segment, a route being retired. This
is the change class that produced the failure above, and it deserves its own
pass. Every one of these has to move together:

- `frontend/src/routes.js` — which page a path opens
- `frontend/src/routes.test.js` — the shapes that must keep working, and the
  shapes that must keep *not* working
- `frontend/scripts/browser-smoke.mjs` — the links the smoke test opens
- `health/links.sh` — the links production is checked with after a deploy
- `shared/demo.js` — the demo answers the same paths without a service
- `viewer/src/source.js`, `shared/nativeData.js` — the other surfaces' names

Grep for the old shape before declaring it done: `grep -rn '{8}-\[0-9a-f\]'`
finds UUID patterns, `grep -rn '{64}'` finds digests. A pattern nobody changed
is not evidence that it did not need changing.

## Why a test is not enough

The three checks above are deliberately at three different altitudes, because
each can be fooled on its own:

| Check | Catches | Blind to |
| --- | --- | --- |
| `routes.test.js` | a path parsed wrongly | a route nobody wired to a page |
| browser smoke | a link that renders the wrong page | anything the deployment does differently |
| `links.sh` | a dead link in production | a page that renders but is useless |

None of them replaces opening the app. They replace *forgetting* to.
