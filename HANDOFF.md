# Handoff: fix group D (names, tabs and mention links)

Branch `claude/names-links-handoff`, based on main 428aa934. Delete this file before opening the PR.
The review list is group D in `review/gathered.md` / `gathered.json` on branch `showcase-pages-2026-09-30`.

## Done (committed here)

- **Small-caps "qu" read as "q"** (uniqe, conseqence, Eqiv, qeue, qo/). Cause: Libertine's small-capital
  "qu" is one glyph, `q.sc_u.sc` (code 27 in the encoding's Differences), whose ToUnicode entry is just
  "q". Fix in `analyzer/src/rules/page.ts`: glyphs carry the font's glyph name (from pdf.js's
  `differences` / `defaultEncoding`, exported only with `fontExtraProperties: true`, now set in
  `analyzer/src/rules/pdf.ts` and in the viewer's `getDocument` in `viewer/src/App.jsx`);
  `ligatureSpelling()` spells a `_`-joined name; `offsetsAlong` now returns `{ offsets, next, text }`
  with the missing letters put back, and `readPage` uses that text for the run. New registry rule
  `layout.ligature`. Unit test in `analyzer/test/layout.test.mjs`. `npm test` in analyzer: 125 pass.
- **rule-truth keys updated** for the same quirk (8 files: 2024-OOPSLA1-124, 2024-OOPSLA1-137,
  2024-POPL-050, 2025-OOPSLA2-386, 2026-OOPSLA2-402, 2026-PLDI-259, 2026-POPL-006, 2026-POPL-020).
  Before the key update, rule-truth on those 8 papers showed each qu name as missed + false with the
  corrected spelling, i.e. definitions and names match after the fix. Mentions still match their
  definitions (both go through the same run text).
- Checked on top10 papers (runner `~/papol-corpora/top10/tools/rules-json.ts` pointed at this analyzer):
  logical-essence (wbHoare-consequence, stack-*-unique), diaframe (locked-unique), future-is-ours
  (sequence-prophecy-*, mentions 27 -> 29), modal-dependent (quo/*), rustbelt (F-consequence),
  monadic-encapsulation (SavedPred-Equiv), knowing-when (Equivalent) all fixed, rule counts unchanged.

## Not yet working

- **Verified Lock-Free Session Channels** (robbert-krebbers/2024-OOPSLA, p04, p05, p23: link-qeue-*,
  uniqe) is NOT fixed: pdf.js puts "(uniqe)" in one text item whose fontName is the paren's font
  (g_d0_f2) while "uniqe" is drawn in the small-caps font (g_d0_f12), so `offsetsAlong` finds no match
  in the run's font and the run falls back to `offsetsOf` with the text unrepaired. Likely fix: match a
  run against the page's glyphs across fonts (a page-wide, draw-order glyph list with its own cursor)
  when its own font's glyphs do not spell it. This is very probably also the cause of the
  **mention links shifted / clipped by one character on small-caps names** (the run's offsets come from
  the wrong font's widths): Backwards-Compatible Row-Based Exceptions p08+, Iris-WasmFX p08+, Data
  Extraction via Semantic Regexes p07+, C/C++ inline assembly p14 (COHERENCE-III boxed as -II),
  Persistence semantics p16/p25, Concurrent Incorrectness SL p15/p20, Promising 2.0 p10. Untested.

## Subagents (both stopped, nothing useful committed)

- Shift subagent (small-caps mention offsets): was still reading pages; no code.
- Words subagent (mention links on prose words: dual, ite, while, fence/flush, return, update/write/
  promise, GetCell, "Par. 7", loop/let/goto, "If", "[REC]", phys_atomic premise; partial names
  UNEVAL PROD, SIM-VIS inside NO-SIM-VIS-EX-COMM, M-PropFL+FO+SF): had only added debug output.
  Start from `RULE_MENTION` in `analyzer/src/rules/registry.ts` and `mentionsIn` in `inference.ts`.

## Untried

- **Name tabs over the text above the box**: this is only the review renderer
  (`~/papol-corpora/top10/tools/pages.py` draws a 20px tab above each box's top-left). The viewer draws
  no tabs (its telescope shows a clip at the mention, `viewer/src/telescope.js`), so nothing to fix
  there. Fix in the renderer (place the tab where the page has no ink, or inside the box) and in the
  showcase artifact if it draws tabs the same way.
- **μ / κ missing in tabs**: labels hold math-italic letters (U+1D707 𝜇, U+1D705 𝜅, 𝑝𝑞 in
  Sngl𝑝𝑞-<:) which DejaVu Sans lacks; the renderer should draw NFKC(label) or use a font with math
  alphanumerics. Labels themselves are right.
- "⊲-intro" for ▷-INTRO (2023-OOPSLA proof automation p11): the text layer gives U+22B2; not looked at.
- "InvPreAlloc N" (later credits p26): premise superscript taken into the name; not looked at.
- Knock-on links from false rules (by, NaN, Section 6, IT, Divide-by-Zero, ...): skipped, thread B.
- **Higher-order ghost state wrong PDF**: NOT changed. `~/papol-corpora/top10/manifest.json` entry
  `2016-ICFP-higher-order-ghost-state` has source https://pure.au.dk/ws/files/417855185/3607856.pdf,
  which is "Dependent Session Protocols in Separation Logic from First Principles" (ICFP 2023); its
  three copies under derek-dreyer/, lars-birkedal/, robbert-krebbers/ need the real paper (e.g.
  https://iris-project.org/pdfs/2016-icfp-iris2-final.pdf) and SHA256SUMS updated.

## Scoring

No full rule-truth / rule-sweep run was made on this branch (the nixos machine was overloaded; the
coordinator asked to reuse thread A's main baseline in `~/papol-corpora/groupA/`). Only the 8 papers
above were scored. Wrap heavy runs in `flock ~/papol-corpora/heavy.lock` with `--jobs=8` on nixos.
