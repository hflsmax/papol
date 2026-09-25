# Newsletters

Letters from the admin to Papol's users about what shipped, one directory
each, named by the day it covers up to: `YYYY-MM-DD-<topic>/`. Each is
drafted in a pull request and reviewed there; merging it means the text is
approved, not that it was sent.

Each directory holds:

- `letter.md`: the letter as it reads, in Markdown. GitHub renders it in the
  pull request, and the admin page's Email users form offers it as a Draft:
  choosing it fills the subject (the `# ` title) and the body, which is sent
  as a formatted email with a plain-text copy.

Its pictures are GIFs of each feature in use (`scripts/feature-letter/record.mjs`),
kept in the public bucket under `admin/`, apart from what users upload, and
named by their content hash (`scripts/feature-letter/publish.sh`). The letter
links them by their `https://files.papol.io/admin/<sha256>.gif` address, so
the same Markdown shows them on GitHub and in the email.

Sending is the owner's. How a letter is drafted is in
`.claude/skills/feature-letter/SKILL.md`.

| Letter | Covers |
|---|---|
| [2026-09-25-whats-new](2026-09-25-whats-new/letter.md) | 2026-09-21 to 2026-09-25: Intelligent link navigation, Reverse citation, Folder Drop, Tiny links, Papol on your Mac, Reading log |
