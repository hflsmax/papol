# Handoff: group C, missed rules (from nixos, 2026-09-30 19:20Z)

Task (coordinator brief, Cong's ask 18:35): fix group C of the 214-paper box review, "missed rules"
(137 lines): printed named rules that got no box. Fix principled, by category, in analyzer/src/rules/
(inference.ts, registry.ts). Boxes must never overlap. Score with rule-truth (test/rule-truth keys) and
rule-sweep (corpus29, test/rule-sweep.json) before/after, plus a before/after count on the top10 corpus;
lose no keyed rule, add no false find. Add keys for papers fixed. PR with before/after crops (PNGs committed on
the PR branch, linked by SHA) and a "Still tricky" section; squash-merge when CI is green, deploy with
worker.yml environment=production. Threads A (geometry), B (extra boxes), D (names/mentions) edit the same files.

## State: little done
Work stopped about ten minutes after the workers started, to move to plg2. Nothing is fixed or scored.
- Baseline: not computed here (runs were killed in the 19:09 OOM). Thread A was scoring main 428aa934 into
  ~/papol-corpora/groupA/base.truth, base.sweep, base-top10/ on nixos.
- Review source: branch showcase-pages-2026-09-30, review/gathered.md section "By cause" C, gathered.json group "C";
  rendered pages <author>/<paper>/pNN.jpg on the same branch.
- handoff-groupC/cases-C1..C4.md: the 137 lines split into four families (my split, by paper):
  - C1 name shapes (45): glyph-led names (□-MONO, ⊡-INTRO, ⟨affine⟩-INTRO, ▷-, ⇛-, ≼-BASE, <:-⊤, ∧1-<:), ★ endings,
    " [S]", #, +, ′, colon/spaced names ((MEMORY: NEW), (MACHINE STEP), ANGELIC RECURSION, (♭-intro 1)).
    Relevant code: TOKEN regex / tokenOf (inference.ts ~99-239), RULE_SHAPE_* patterns in registry.ts, shapeOf/allowed.
  - C2 bar-less axioms and specs (47): named axioms without a bar, -SPEC triples, GPS/mosel RA-* axioms,
    rustbelt LftL-*, ghostcell, affect ModeSub. Relevant: overRow()/related() in settingOf, barless() convention.
  - C3 wide rules and rules beside boxed siblings (27): REL-COUPLE-TAPE-L, Aiken 2013-OOPSLA hierarchical p08/p09,
    visualization synthesis figs, SV-CS. Relevant: BAR_SHARE/dividing()/near filter, twoColumn(), sameColumn().
  - C4 label placement (18): left-margin labels (consolidation of queries Skip 1), labels left of rules (RACE-1),
    name over bar (HOARE-BIND, wp-couple-*), names beside/under (TyVar, terra SBAS), "BRANCHEXT.".
- handoff-groupC/BRIEF.md: the brief each worker got (worktree paths are nixos scratch paths; adapt).
- Worker progress when stopped: C1 and C2 had only read code (no edits).
  - C3 had a WIP (handoff-groupC/wip-C3-wide-siblings.patch, untested, contains DEBUG lines to strip):
    (1) twoColumn() ignores caption lines when deciding a line spans the middle; (2) new "propped" setting:
    a label level with a premise, flush right in a column of rules, ends a stack of premises running unbroken down
    to a bar left of it (Aiken hierarchical Fig. 4 T-Read, E-Read).
  - C4 had a one-line WIP (wip-C4-label-placement.patch, untested): blankTo() also accepts a bar to the label's
    right, and a margined label further than FAR from it.
- Untried: everything else; no keys added, no scoring, no PR.

## Tools (on nixos; copy if needed)
- ~/papol-corpora/top10/tools/score.sh <analyzer> <out prefix>: rule-truth + rule-sweep split across jobs.
- ~/papol-corpora/top10/tools/sweep.sh <analyzer> <out dir>: rule stage over the whole top10 corpus to JSON;
  tools/diff.py <before> <after>: per-paper lost/gained/moved/overlaps.
- ~/papol-corpora/groupA/tools/show.sh <analyzer> <paper id> <page> <out.jpg>: one page rendered with boxes.
- On nixos, heavy runs must be wrapped in `flock ~/papol-corpora/heavy.lock` with --jobs=8 at most.
