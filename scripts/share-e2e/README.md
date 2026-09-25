# The real pages, end to end

Three suites drive Chrome through the pages the Cloudflare Worker serves: sharing
(`run.mjs`, below), uploading a paper (`upload.mjs`) and pasting links onto
a board (`board.mjs`). They share a DevTools driver (`cdp.mjs`) and the
Worker's API as a script calls it (`papol.mjs`).

## Sharing

The Cloudflare Worker suite states what a link means; the viewer's own tests state what
its source layer answers. Neither watches a user follow one. This does: it
drives Chrome through the real pages and asserts on what rendered.

```sh
./deploy.sh dev                              # in one terminal
node scripts/share-e2e/seed.mjs              # in another
node scripts/share-e2e/run.mjs
```

Seeding makes a new paper and a new recipient each run, so the suite can
assert the recipient has not got the paper yet — which it could not do twice
against the same one. The fixture is written to the temp directory; nothing
runtime-generated lands in the repository.

What it covers:

- a **rich** link opens for a visitor with no account, names the user whose
  reading it is, carries their annotations, keeps the whole tool bar, offers the
  paper, and invites them to sign in in a card that "Not now" puts away;
- a **lean** link opens the same way, names nobody, and carries none of the
  marks;
- a signed-in user presses **Add to nook**, the copy lands on the shared
  paper, it carries none of the sharer's marks, and the link stops offering
  what they now have;
- the sharer's own **Share menu** opens and shows the live link with a way to
  copy it;
- the sharer opens **their own paper** in the viewer: no error bar, and the
  clip on it is drawn;
- **the wire**: no request under `/api/` was ever answered with HTML. The SPA
  answers a path it does not know with the page itself, status 200, so a badly
  built request dies later in a JSON parser with the URL nowhere in the
  message; this names it.

## Two things to know before changing it

**Readiness is the whole difficulty.** `.viewer-bar` is chrome and renders
before the shared reading has been fetched. Waiting on it snapshots a
half-built page, and the negative assertions — names nobody, carries no marks
— then pass for the wrong reason, which is worse than failing. The check waits
for the paper's name to reach `document.title`.

**No password is typed.** The token comes from the Cloudflare Worker's own
API and is stored the way the application stores it. Chrome runs headless unless
`PAPOL_E2E_HEADED=1`, and `CHROME` names the binary if it is not in the usual
place.

`PAPOL_BASE` is where the pages are. Against `./deploy.sh dev` that is the
frontend's Vite server, `http://127.0.0.1:5173`, the default, which proxies
the viewer and the API behind it. CI (`.github/workflows/pr.yml`) assembles
the site and points it at the Cloudflare Worker itself.

Seed and run from the same shell, or name the fixture explicitly with
`PAPOL_E2E_FIXTURE`: the default path lives in `TMPDIR`, and a shell that sets
a `TMPDIR` of its own makes seeding in one shell and running in another look
exactly like a fixture that was never written.

## Uploading, and the queue behind it

`upload.mjs` chooses PDFs on the library's form and follows each reading to
its end: the bytes stored, the `extract_metadata` job woken through the
queue, the PDF sent to the helper beside GROBID with its credential, what it
read in the form, the saved paper in the library and in the API. Then a job
whose wake-up was lost — a row written straight into the local D1, no
message sent — is left queued until the suite fires the cron sweep, and must
come back done by `cron:sweep`.

The helper is `fake-helper.mjs`, a stand-in answering in the real one's
shapes (host/helper/src/server.ts). The suite tells it per PDF digest what to
say: nothing read, so the filename's title stands; a title block, whose title,
authors, journal and year must reach the form; or a 500, which the Cloudflare Worker
treats as nothing read (extract.ts) — the form keeps the filename's title and
says nothing, which the suite holds it to. It needs the Cloudflare Worker started with:

```sh
node scripts/share-e2e/fake-helper.mjs &
cd cloudflare && npx wrangler dev --test-scheduled \
  --var GROBID_URL:http://127.0.0.1:8072 --var GROBID_AUTH:papol:e2e
PAPOL_BASE=http://127.0.0.1:8787 node scripts/share-e2e/upload.mjs
```

No PDF here carries a DOI or an arXiv id, so nothing is asked of CrossRef.

## Pasting links onto a board

`board.mjs` pastes four links onto a fresh board, as a paste event carrying
the link as clipboard text, and follows each card to where it ends:

- a **YouTube** link, whose page the Cloudflare Worker reads with
  linkpeek: the card carries the real title, the canvas draws the picture,
  and the page itself asks YouTube nothing (so this needs the network, as
  example.com does);
- a page under **`.invalid`**, which never resolves: "Capturing webpage…" at
  once, the card on the board with the request, then the capture failing and
  the board saying why, the card left as the link;
- **example.com**: `wrangler dev` runs Browser Rendering on a Chrome of its
  own, downloaded on first use, so the picture is taken — with the YouTube
  link, the checks in these suites that need the network;
- a **Bilibili** link: the card is the link, drawn as a Bilibili video
  with no picture, and nothing asks Bilibili.

## When a check fails

Each suite keeps the page as the failing check left it — the document and a
screenshot — under `PAPOL_E2E_ARTIFACTS` (the temp dir by default). CI keeps
them as the `e2e-pages` artifact of a red run, beside the Cloudflare Worker's log.
