---
name: feature-letter
description: Draft a letter from the admin to Papol's users introducing what shipped lately, with screenshots. Use when asked for release notes, a "what's new" letter, an announcement or newsletter to users. Drafts only — the owner sends it.
---

# A letter to users about new features

The letter is a draft for the owner. Never send it: the admin page's
**Announcement** (email, via Resend) and **Message** (the in-app "From
Papol" dialog) are the owner's to press.

## 1. The window

Start from the day of the last letter. The admin page's *Emails sent*
lists every announcement (Resend is the record, `cloudflare/src/jobs/mail.ts`);
the newest directory in `newsletters/` says what the last letter covered;
if neither settles it, ask the owner for the day. Papol moved to
Cloudflare on 2026-09-21 and the announcement box arrived with #137 on
2026-09-22 — before any letter, that is the start.

## 2. Gather

```sh
node scripts/feature-letter/gather.mjs --since YYYY-MM-DD --out "$CLAUDE_JOB_DIR/tmp/letter"
```

It writes `prs.md` — every PR merged to main in the window, newest first,
with its opening paragraph — and fetches each picture a PR description
links (`pr-<n>/*.png`). Some PRs link their pictures by branch instead;
also look at `git branch -r | grep -- -screenshots` and pull what you need
with `git archive origin/<topic>-screenshots | tar -x -C <dir>`.

## 3. Choose

About six features, each one a thing a reader would notice. Put the one
used most often in everyday reading first, and number them in that order:
the letter says "most useful first". Give each a short name worth
remembering, not a description (the first letter used Intelligent link
navigation, Reverse citation, Folder Drop, Tiny links, Papol on your Mac,
Reading log). Propose the list to the owner before writing, if they are
around.
Leave out infrastructure, tests, deploys, refactors, releases by number.
Say anything a user must act on: old links that stopped working, an app
that must be updated, a feature removed (the migration doc records
removals).

Open every picture before using it. Drop ones that show `127.0.0.1`,
test names like `A. Sharer` or `6c221b` suffixes in a prominent place,
"Before/After (this PR)" labels, or a half-drawn page; prefer a crop that
shows the one thing the paragraph is about.

## 4. GIFs

Each feature gets a short GIF of it in use, recorded with:

```sh
node scripts/feature-letter/record.mjs "$CLAUDE_JOB_DIR/tmp/letter/gifs" [scene ...]
```

A scene in `scripts/feature-letter/scenes.mjs` is a page, what to get
ready off camera, and what the reader does on camera, played with a drawn
pointer, real mouse and key events, and a folder the pointer can carry.
Reading scenes use a real paper on papol.io by its hash, a lean link that
needs no account. Pick one that shows the feature at its best (the
first letter used Kinergy, two columns), and check that each card it
opens resolved to the right work. Frontend scenes use a fixture page
with a pretend server from `frontend/scripts/fixtures/` (`folderPage.mjs`
with `?styled&flow&letter`, `activityPage.mjs`). The recorder presets
what a returning reader has dismissed (the first-link tip, the Mac
offers) and scenes close the sign-in offer. Sample each GIF into a
contact sheet (`ffmpeg -i x.gif -vf "fps=1/1.6,scale=480:-1,tile=4x3"
-frames:v 1 x.png`) and look at it before using it.

For a still, a component the frontend smokes already render can be
photographed with the application's styles and a pretend server:

```sh
cd frontend && npm run shots:letter -- "$CLAUDE_JOB_DIR/tmp/letter/new" [upload-box folder-review]
```

A new shot is an entry in `SHOTS` in `frontend/scripts/letter-shots.mjs`:
the fixture page it opens, what to wait for, the element to crop to. A
fixture page lives in `frontend/scripts/fixtures/` beside the smoke that
checks it (`folderPage.mjs` serves both `smoke:folder` and the shots).
For whole-app views (viewer, boards, activity) drive the app with the
share-e2e CDP driver, `scripts/share-e2e/cdp.mjs`, as the UI PRs do.

## 5. Write

Succinct, and about how the feature makes reading and research easier:
what the reader can do now and how to try it (where to click, which key).
Each feature gets one short paragraph (two to four sentences, no lists)
and at most one picture. Always say things forward: what Papol lets the
reader do, told from their side, so it feels intelligent, even magic.
Never backward, with no pain first ("you still upload… and lose…").
Never explain how it works: no analyzer, reading, parsing, indexes or
publishers. Say what the reader sees, not how Papol gets there. Leave out
the smaller fixes around each feature too. Sign it from the team,
with no marketing adjectives.

The letter is `newsletters/YYYY-MM-DD-<topic>/letter.md` (the README has
the layout), with the `# ` title as the email's subject. Its pictures
live in the public bucket, not the repository: publish each GIF with
`scripts/feature-letter/publish.sh <file.gif>`, which puts it at
`https://files.papol.io/admin/<sha256>.gif` (the admin-only prefix, apart
from what users upload), and link it by that address beside the paragraph
it shows. Publishing makes the picture public, so ask the owner first.

Before the pull request, have a subagent critique the draft as a
demanding copy editor. Give it these rules and the verified facts, and ask
it for each vague referent (an "elsewhere" that names nothing), abstract
verb, piece of filler or marketing, and benefit buried past the first
sentence. Give each revision the owner asks for to a writing subagent too,
with the rules, the verified facts and the phrasings already rejected.
Never apologise for how Papol used to be, and never compare with it. Check version numbers against `gh release list`, not
memory.

Add a row to the README's table. Then open a pull request with the
directory: the owner reviews the letter there, where GitHub renders
`letter.md`. Once merged and deployed, the admin page's Email users form
lists it under Draft: choosing it fills the subject and body, and it goes
out as a formatted email with a plain-text copy. The owner sends it,
first with Send a test to me, and decides when it goes to everyone.
