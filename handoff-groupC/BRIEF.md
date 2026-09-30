# Group C (missed rules): worker brief

You fix one family of "missed rule" cases in Papol's analyzer rule stage
(analyzer/src/rules/inference.ts, rule ids rule.* in analyzer/src/rules/registry.ts).
A missed rule is a named inference rule printed in a paper that got no box.
Your family's cases: ~/papol-corpora/groupC/cases-<FAMILY>.md (one line per page).

## Where things are
- Your git worktree (your branch groupC-<family>, based on origin/main 428aa934) is given in your prompt.
  Work only there. Never touch ~/src/papol. Never push. Commit on your branch when done.
- Rendered review pages with current boxes drawn:
  /tmp/claude-1000/-home-congm-src-papol-work--claude-worktrees-bridge-cse-01EbKwEcn9i6RFF8CZvS6EXz/d33c0126-4f0f-5332-9aa1-cd8df2a2a143/scratchpad/review/<author>/<paper>/pNN.jpg (read them as images to see the problem).
- PDFs: ~/papol-corpora/top10/<author>/<paper>.pdf
- See one page with your analyzer's boxes: `bash ~/papol-corpora/groupA/tools/show.sh <your worktree>/analyzer <paper id> <page> /some/out.jpg`
  (paper id = the pdf basename; prints the rules on that page with boxes; then Read the jpg).
- Trace of one paper: `cd <worktree>/analyzer && ALL=1 node scripts/run-script.mjs rules <pdf>` prints rules plus
  headings/cells/"alone" drops and "none"/"unnamed" candidates. You may add temporary debug output, remove it before commit.
- Read analyzer/src/rules/inference.ts first (2100 lines; passes: tokenOf/shortOf candidates, settingOf,
  shapeOf/allowed names, conventions in findRules, boxOf, separate) and the RULE_* entries in registry.ts.

## Rules of the project (hard)
- Principled fixes by category, the way the stage is organised (candidate / setting / shape / convention / box), not
  symptom patches for one paper. Comment style: match the file (prose comments that cite the example papers/rules).
  If you widen a registered rule's behaviour, update its summary/why and matches/rejects in registry.ts
  (test/rules.test.mjs checks the examples).
- Rule boxes must never overlap; never trade an overlap for a found rule.
- Stay in your family. Three other workers edit inference.ts at the same time for other families
  (C1 name shapes: glyph-led names, ★ / [S] / # / + / colon or spaced names; C2 bar-less axioms and specs;
  C3 wide rules and rules beside boxed siblings / two-column lists; C4 label placement: margin, left/right of bar,
  name above). Keep diffs small and local to minimise merge conflicts; don't reformat code.
- Another group (A box geometry, B extra boxes, D names/mention links) also edits this file on other branches: don't
  fix their issues.

## Machine limits (hard)
The machine is shared by many sessions (31 GB RAM). Every heavy run (rule-truth with more than a handful of papers,
rule-sweep over a directory, any top10 sweep) must be wrapped:
`flock ~/papol-corpora/heavy.lock <command>` and use at most `--jobs=8`. Single-paper runs (show.sh, rules script,
rule-truth --only=<one or two papers> --jobs=1) need no lock.

## Scoring (before you commit)
From <worktree>/analyzer:
- `flock ~/papol-corpora/heavy.lock node scripts/run-script.mjs rule-truth ~/papol-corpora/corpus29 ~/papol-corpora/pacmpl-sweep/papers --jobs=8 > /tmp/claude-1000/-home-congm-src-papol-work--claude-worktrees-bridge-cse-01EbKwEcn9i6RFF8CZvS6EXz/d33c0126-4f0f-5332-9aa1-cd8df2a2a143/scratchpad/out/<family>.truth`
  Baseline for main: ~/papol-corpora/groupA/base.truth (if not there yet, run the same on /tmp/claude-1000/-home-congm-src-papol-work--claude-worktrees-bridge-cse-01EbKwEcn9i6RFF8CZvS6EXz/d33c0126-4f0f-5332-9aa1-cd8df2a2a143/scratchpad/base/analyzer once).
  No keyed rule may be lost, no new false find, no new overlap.
- rule-sweep on corpus29 (`flock ... node scripts/run-script.mjs rule-sweep ~/papol-corpora/corpus29`) must stay "same" on
  every paper, or each difference must be a real rule gained (check it on the page) and then you update
  test/rule-sweep.json for those papers only (not --write blindly over other changes).
- top10 before/after on your family's papers: run tools/rules-json via show.sh or a small script for each case paper
  on main (/tmp/claude-1000/-home-congm-src-papol-work--claude-worktrees-bridge-cse-01EbKwEcn9i6RFF8CZvS6EXz/d33c0126-4f0f-5332-9aa1-cd8df2a2a143/scratchpad/base/analyzer) and on yours; report found rules per page. Also check you did not add false boxes
  or overlaps on those papers' other pages.
- `npm test` and `npx tsc --noEmit` in analyzer.
- Add a rule-truth key (analyzer/test/rule-truth/<pdf basename>.json, format as the others: page, name, box in PDF points
  [x0,y0,x1,y1] top-left origin, every named rule of the paper) for one or two papers you fixed, where you can inventory the
  whole paper reliably (check every page with rules visually). Tell me which dir holds its PDF.

## Report back (your final message)
- What causes you found, what you changed (by category), commit SHA on your branch.
- Per case line: fixed / not fixed (and why, with the concrete reason).
- Scores: truth totals before/after, sweep differences, top10 case-paper counts before/after.
- A list of (paper id, page) crops that best show before/after for the PR screenshots, and for "still tricky" cases.
Do not call any mcp__hearthbot__ tools; only the lead posts to the user.
