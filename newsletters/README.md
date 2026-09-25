# Newsletters

Letters from the admin to Papol's users about what shipped, one directory
each, named by the day it covers up to: `YYYY-MM-DD-<topic>/`. Each is
drafted in a pull request and reviewed there; merging it means the text is
approved, not that it was sent.

Each directory holds:

- `letter.md`: the letter as it reads, with its screenshots from `img/`.
  GitHub renders it in the pull request.
- `announcement.txt`: the plain text for the admin page. The first line is
  the subject, and the rest is the body. The announcement email is sent as
  text only (`cloudflare/src/jobs/mail.ts`), so it cannot carry pictures.
  It names each feature briefly and links to the full letter. The limits in
  `config/app_limits.json` are a 200-character subject and a 20,000-character
  body. An in-app message is limited to 4,000 characters.
- `img/`: the screenshots, cropped to what each paragraph is about.

Sending is the owner's: paste the announcement into the admin page's
Announcement box once the letter is published somewhere the link can point
to. How a letter is drafted is in `.claude/skills/feature-letter/SKILL.md`.

| Letter | Covers |
|---|---|
| [2026-09-25-whats-new](2026-09-25-whats-new/letter.md) | 2026-09-21 to 2026-09-25: the first letter after the move to papol.io |
