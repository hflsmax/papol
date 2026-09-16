# Sharing, end to end

The backend suite states what a link means; the viewer's own tests state what
its source layer answers. Neither watches a reader follow one. This does: it
drives Chrome through the real pages and asserts on what rendered.

```sh
PAPOL_DEV_PORT=8010 ./deploy.sh dev          # in one terminal
python3 scripts/share-e2e/seed.py            # in another
node scripts/share-e2e/run.mjs
```

Seeding makes a new paper and a new recipient each run, so the suite can
assert the recipient has not got the paper yet — which it could not do twice
against the same one. The fixture is written to the temp directory; nothing
runtime-generated lands in the repository.

What it covers:

- a **rich** link opens for a visitor with no account, names the reader whose
  reading it is, carries their marks, keeps the whole tool bar, and offers the
  paper;
- a **lean** link opens the same way, names nobody, and carries none of the
  marks;
- a signed-in reader presses **Add to nook**, the copy lands on the shared
  edition, it carries none of the sharer's marks, and the link stops offering
  what they now have;
- the sharer's own **Share menu** opens and shows the live link with a way to
  copy it.

## Two things to know before changing it

**Readiness is the whole difficulty.** `.viewer-bar` is chrome and renders
before the shared reading has been fetched. Waiting on it snapshots a
half-built page, and the negative assertions — names nobody, carries no marks
— then pass for the wrong reason, which is worse than failing. The check waits
for the paper's name to reach `document.title`.

**No password is typed.** The token comes from the backend's own API and is
stored the way the application stores it. Chrome runs headless unless
`PAPOL_E2E_HEADED=1`, and `CHROME` names the binary if it is not in the usual
place.

Seed and run from the same shell, or name the fixture explicitly. The default
path lives in `TMPDIR`, and `nix develop` — which `./deploy.sh dev` runs under
— sets a `TMPDIR` of its own, so seeding inside that shell and running outside
it looks exactly like a fixture that was never written. `PAPOL_E2E_FIXTURE`
settles it in both places.
