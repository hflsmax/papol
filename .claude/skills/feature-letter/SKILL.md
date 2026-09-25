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

Five to seven things a reader would notice, grouped by what they do
(reading a paper, citations, adding papers, boards, sharing, the Mac app).
Leave out infrastructure, tests, deploys, refactors, releases by number.
Say anything a user must act on: old links that stopped working, an app
that must be updated, a feature removed (the migration doc records
removals).

Open every picture before using it. Drop ones that show `127.0.0.1`,
test names like `A. Sharer` or `6c221b` suffixes in a prominent place,
"Before/After (this PR)" labels, or a half-drawn page; prefer a crop that
shows the one thing the paragraph is about.

## 4. Missing pictures

For a component the frontend smokes already render, photograph it with
the application's styles and a pretend server — no account needed:

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

Plain words from the reader's side: what they can do now, and how to try
it (where to click, which key). One short paragraph per feature, its
picture under it. Signed by the team, no marketing adjectives.

The letter is a directory in `newsletters/` (its README has the layout),
`YYYY-MM-DD-<topic>/` with:

- `letter.md`: the letter as it reads, every screenshot from `img/`
  beside the paragraph it shows.
- `announcement.txt`: the plain text for the admin page, with the subject
  on the first line. The announcement email is sent as `text` only
  (`outgoing()` in `mail.ts`), so it cannot carry pictures. It names each
  feature in a line or two and ends with a `{LINK TO THE PUBLISHED LETTER}`
  placeholder. Limits (`config/app_limits.json`): subject 200, body 20,000,
  and an in-app message 4,000.
- `img/`: the pictures, scaled to about 1,300–1,600 px wide.

Add a row to the README's table. Then open a pull request with the
directory: the owner reviews the letter there, where GitHub renders
`letter.md`. Whether and where the letter is published, and when it is
sent, is the owner's call.
