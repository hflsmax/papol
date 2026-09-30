# Rule box review, share 5 of 6

Showcase branch showcase-pages-2026-09-30 (rule stage of PR #399, c369d258). Share 5 = manifest papers with index mod 6 == 4: 35 papers, 247 pages, every page opened by one of eight reviewers; the lead re-checked five flagged pages by eye (CISL p14, Termination-insensitive p18, Incremental inference p16, Scala step-by-step p14, Persistence semantics p12) and all findings held.

Papers and pages checked:
- viktor-vafeiadis/2010-POPL-structuring-the-verification-of-heap-manipulating-programs: p04, p05, p11, p12
- sumit-gulwani/2011-POPL-automating-string-processing-in-spreadsheets-using-input-out: p03
- ranjit-jhala/2012-PLDI-deterministic-parallelism-via-liquid-effects: p07, p08
- isil-dillig/2013-OOPSLA-inductive-invariant-generation-via-abductive-inference: p03
- zhendong-su/2013-POPL-automatic-detection-of-floating-point-exceptions: p01, p02, p03, p04, p10
- alex-aiken/2014-PLDI-stochastic-optimization-of-floating-point-programs-with-tuna: p03, p04, p06, p08
- martin-t-vechev/2015-OOPSLA-scalable-race-detection-for-android-applications: p07, p08, p09, p10, p11, p12, p16
- viktor-vafeiadis/2015-POPL-common-compiler-optimisations-are-invalid-in-the-c11-memory: p07, p11, p14, p16
- alex-aiken/2016-PLDI-verifying-bit-manipulations-of-floating-point: p07, p08, p09, p11, p12, p15
- alex-aiken/2017-PLDI-synthesizing-program-input-grammars: p08, p10
- ranjit-jhala/2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati: p10, p11, p12, p13, p14, p15, p16, p17, p19, p20
- martin-t-vechev/2018-PLDI-incremental-inference-for-probabilistic-programs: p16
- martin-t-vechev/2018-OOPSLA-robust-relational-layout-synthesis-from-examples-for-android: p06, p07, p17
- viktor-vafeiadis/2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers: p11, p12, p13, p14, p15, p16, p22, p25
- martin-t-vechev/2019-PLDI-unsupervised-learning-of-api-aliasing-specifications: p09, p14
- sumit-gulwani/2019-OOPSLA-on-the-fly-synthesis-of-edit-suggestions: p20, p21, p23
- lars-birkedal/2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi: p01, p03, p04, p06, p08, p09, p10, p13, p14, p15, p16, p18, p20, p21, p23
- lars-birkedal/2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic: p06, p07, p08, p09, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p22, p23, p26
- viktor-vafeiadis/2020-POPL-persistency-semantics-of-the-intel-x86-architecture: p12, p13, p14, p15, p16, p17, p18, p20, p21, p26
- derek-dreyer/2021-PLDI-refinedc-automating-the-foundational-verification-of-c-code: p02, p03, p04, p05
- lars-birkedal/2021-POPL-mechanized-logical-relations-for-termination-insensitive-non: p06, p07, p08, p09, p13, p16, p17, p18, p21
- sumit-gulwani/2021-OOPSLA-semantic-programming-by-example-with-pre-trained-models: p20
- alex-aiken/2022-PLDI-distal-the-distributed-tensor-algebra-compiler: p03, p08
- derek-dreyer/2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr: p05, p07, p08, p09, p10, p11, p12, p13, p14, p15, p16, p18, p20, p21, p22, p23, p24, p25
- derek-dreyer/2022-POPL-concurrent-incorrectness-separation-logic: p03, p04, p05, p06, p08, p09, p10, p11, p12, p14, p15, p18, p19, p20, p22, p23, p24, p25, p26
- isil-dillig/2023-PLDI-imageeye-batch-image-processing-using-program-synthesis: p14, p15, p16
- ranjit-jhala/2023-PLDI-flux-liquid-types-for-rust: p10, p11, p12, p13, p15, p16
- derek-dreyer/2023-POPL-dimsum-a-decentralized-approach-to-multi-language-semantics: p11, p12, p14, p15, p16, p18, p19, p20, p21, p23, p24, p25, p26, p27, p28
- lars-birkedal/2024-POPL-modular-denotational-semantics-for-effects-with-guarded-inte: p05, p07, p08, p12, p13, p14, p15, p16, p19, p23, p24
- alex-aiken/2024-PLDI-recursive-program-synthesis-using-paramorphisms: p05, p07, p10, p12
- isil-dillig/2024-POPL-programming-by-demonstration-for-long-horizon-robot-tasks: p08, p09, p11, p14, p15, p16
- viktor-vafeiadis/2024-OOPSLA-extending-the-c-c-memory-model-with-inline-assembly: p10, p11, p13, p14, p16, p17, p18, p22, p24
- isil-dillig/2025-PLDI-graphiti-bridging-graph-and-relational-database-queries: p12, p13, p14, p15, p16, p28, p29, p39, p40, p41, p42
- derek-dreyer/2025-PLDI-destabilizing-iris: p04, p05, p06, p07, p08, p09, p10, p11, p12, p13, p15, p17, p18
- lars-birkedal/2026-PLDI-iris-wasmfx-modular-reasoning-for-wasm-stack-switching: p08, p09, p10, p11, p13, p14, p17, p18, p19, p20

## Counts

Box problems 80: extra 35, missed 18, partial 13, overlap 9, overrun 3, other 1, wrong-name 1. Mention-link problems 15. Cosmetic tab notes 6.

## Box problems

| author | paper | page | kind | what is wrong |
|---|---|---|---|---|
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p08 | missed | DC-Error axiom (top-left of Fig. 4, name "DC-Error" above "[emp] L:error [er(L): emp]") has no box; the other 9 DC-* axioms are boxed correctly |
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p14 | overrun | RD-Assign box spans the whole bottom row of axioms, taking in the RD-Lock and RD-Unlock axiom bodies ("[τ↦H] lock l [...]" and "[τ↦H] unlock l [...]"); it should cover only "RD-Assign / [emp] x:=e [ok: emp]" |
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p14 | partial | RD-Lock and RD-Unlock boxes cover only the name labels; their axiom lines (below the names) are outside their boxes (inside the RD-Assign box instead). The RD-Lock box also has the RD-Assign box's top edge running through its label |
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p14 | overlap | RD-Lock and RD-Unlock boxes overlap the RD-Assign box |
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p18 | extra | Box "Par" drawn around an example derivation (PAR then CONS steps, "(derived via Seq, Atom and CISL_RD axioms on p. 14)") that is not a rule definition; the box also starts partway through, leaving out the left "(derived" text |
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p24 | missed | SV-CS and SV-CS-G (named derived rules with premises, bar and conclusion in Fig. 13) have no boxes |
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p24 | extra | "Subv-Split" box is on an equivalence (res(k) ⇔ ∃k1…kn …, tagged (SUBV-SPLIT) at the right), not an inference rule; its tab also sits on the prose line above ("that a global view ... always be split") |
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p24 | partial | SV-Acq, SV-Rel, SV-Acq-G and SV-Rel-G boxes' right edges sit on or just inside the closing "]" of each postcondition, so the final bracket is clipped/hidden (minor) |
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p25 | extra | All four boxes (Par, SeqEr, ParEr, Cons) are on steps of the proof derivations in Fig. 14 (Examples 7.1/7.2), not on rule definitions |
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p25 | overlap | The same derivation boxes cut through the formulas and overlap each other: SeqEr/ParEr/Cons are stacked across the middle derivation, and the ParEr and Cons tabs cover formula text |
| viktor-vafeiadis | 2015-POPL-common-compiler-optimisations-are-invalid-in-the-c11-memory | p11 | extra | "OW-adj" box is on a transformation equation "W_X(l,v');W_X(l,v) ~> skip;W_X(l,v) (OW-adj)", not an inference rule (the matching RAR-adj/RAW-adj equations are not boxed) |
| viktor-vafeiadis | 2015-POPL-common-compiler-optimisations-are-invalid-in-the-c11-memory | p11 | overrun | The same OW-adj box spans both columns, taking in the left column's "Repeated Read. The first transformation we consider is eliminat-..." prose and the 5.1 section heading line |
| viktor-vafeiadis | 2015-POPL-common-compiler-optimisations-are-invalid-in-the-c11-memory | p14 | extra | "rf" box is on part of an execution graph (A.7, around the rf edge and the "(RACE)" label), not a rule |
| lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p06 | extra | "Domain-Bad" box sits on a displayed recursive domain equation (SemType/SemVal ≅ ...), not an inference rule; the matching (Domain) equation below has no box, so the two are handled inconsistently |
| lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p09 | missed | Fig. 4: T-{}-I, T-{}-E and T-∀-E_p (name tabs beside the bar) have no box |
| lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p09 | overrun | P-Var box takes in the "Path typing" section heading above the rule |
| lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p09 | other | P-μ-I and P-μ-E tabs draw as "P- -I" / "P- -E" because the μ glyph is missing from the tab font (same on p13; Sngl_pq-<: / Sngl_qp-<: tabs draw as "Sngl  -<:" on p10 and p14) |
| lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p10 | missed | Fig. 5: <:-⊤, ∧1-<:, ∧2-<:, ⊥-<:, <:-Refl (named axioms), <:-∧ and ∀-<:-∀ (rules with a bar) have no box |
| lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p13 | missed | Fig. 6: T-{}-I, T-∀-E_p and D-∀ have no box |
| lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p14 | missed | Fig. 7: <:-⊤, ∧1-<:, ∧2-<:, ⊥-<:, <:-Refl, <:-∨1, <:-∨2, Distr-∧-∨-<: (axioms; the axiom <:-Add-Later on the same page is boxed) plus <:-∧, ∨-<:, μ-<:-μ, μ-<:, <:-μ and ∀-<:-∀ have no box |
| lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p17 | missed | Fig. 8: Impl-▷, Löb, ⇛-Mono, ⇛-Intro, ⇛-Trans and ⇛-Frame have no box (only ▷-Intro/Mono/Impl and Saved-Pred-* are boxed) |
| viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p12 | extra | Two overlapping "TId:Lab" boxes cover the Fig. 4a header lines (thread and program transition signatures plus the Lab definition); these are not rules |
| viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p12 | missed | T-Seq1 has no box; T-While has no box of its own (see next line) |
| viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p12 | wrong-name | Box tabbed "T-Read" covers the T-While rule (while ... → if ...) plus T-Read's premise line; T-Read's bar, conclusion and name sit outside it |
| viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p12 | partial | T-ReadL box cuts off its premise (s'=s[a↦s(e)] is at the top edge, under the tab); T-Write box holds only the conclusion line, with its premise, bar and (T-Write) name above it |
| viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p12 | overlap | Boxes and tabs overlap in Fig. 4: T-ReadL/T-CAS0, T-CAS0/T-FAA (FAA tab over the CAS0 conclusion), T-CAS1 tab over the T-Read conclusion, T-Fence/P-Step (P-Step tab over the "fence" conclusion), M-Read*/M-RMW* (RMW tab over the Read* conclusion), M-RMW*/M-BProp* (BProp* tab over the RMW* conclusion) |
| viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p13 | partial | SilentP box's left edge is right of its conclusion's start, so "P, S" of the conclusion is outside the box |
| viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p13 | overlap | SilentM tab sits on SilentP's conclusion ("P, S ... M, PB, B ⇒") |
| viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p15 | extra | tso-total, tso-po, tso-rf1, tso-rf2, nvo-total, nvo-tso are bullet-list axioms of a definition (PTSO-validity), not inference rules; their tabs also hide the start of each line, and the tso-rf2 tab sits on the tso-rf1 line |
| viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p16 | extra | nvo-psf, nvo-pre, nvo-pers: bullet-list definition axioms boxed as rules; tabs hide the start of each line |
| alex-aiken | 2024-PLDI-recursive-program-synthesis-using-paramorphisms | p05 | missed | TVar (named axiom Γ,v:τ ⊢ v:τ) has no box, while Tabs, Tapp, Tctr and Tpara are boxed |
| sumit-gulwani | 2011-POPL-automating-string-processing-in-spreadsheets-using-input-out | p03 | extra | "Token T" box is on a grammar production (Token T := C+ \| [¬C]+) in Fig. 1, not a rule |
| derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p07 | missed | SIM-CALL (named axiom, centred between SIM-FRAME and SIM-BIND in Fig. 3) has no box |
| derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p09 | extra | Fig. 4 is value-relation definition clauses, not inference rules: VALUE-LOC, VALUE-FNPTR, VALUE-PAIR are boxed (VALUE-INT, VALUE-BOOL on the same figure are not, so it is inconsistent too); the value-fnptr tab sits on top of the value-loc box |
| derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p16 | extra | DATA-RACE-CTX is a labelled displayed equation (contextual refinement example), not an inference rule |
| derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p21 | extra | Fig. 13 proof-overview diagram rows boxed as rules "language-specific" and "language-independent" (the parenthesised labels are row annotations); these false names also produce spurious prose mention boxes on p21 (4x) and on p05/p18 ("language-independent", "(language-specific)") |
| derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p23 | extra | displayed definition of H_C(l_s,q_h) (with a case split) boxed as rule "exploit_frac( )"; it is not a rule |
| martin-t-vechev | 2015-OOPSLA-scalable-race-detection-for-android-applications | p08 | missed | Fig. 4: CALLBACKREG#1, CALLBACKREG#2, MSGBEGIN#1, MSGBEGIN#2 have no box; Fig. 5: IPCASYNC has no box (all the names with "#" or in the last Fig. 5 rule were skipped) |
| derek-dreyer | 2021-PLDI-refinedc-automating-the-foundational-verification-of-c-code | p03 | extra | Table 1 (judgment table) cells boxed as rules "r-expressions" and "l-expressions"; the l-expressions box also covers only the READ row, cutting through the table |
| derek-dreyer | 2021-PLDI-refinedc-automating-the-foundational-verification-of-c-code | p04 | partial | side conditions printed right of the rules are outside the boxes: T-goto ("Σ = (C, (ℓ,n), ∃x. τ(x);H(x))"), T-assign ("p1 = K[ℓ1]"), T-return ("Σ = ..."), T-annotS ("p = K[ℓ]") |
| derek-dreyer | 2021-PLDI-refinedc-automating-the-foundational-verification-of-c-code | p05 | partial | T-cas box stops at the bar and its conclusion "⊢EXPR CAS(e1,e2,e3) {v,τ. G(v,τ)}" is outside; side condition "p = K[ℓ]" is outside the boxes of T-use and T-addr-of |
| alex-aiken | 2022-PLDI-distal-the-distributed-tensor-algebra-compiler | p03 | extra | Fig. 4 grammar (syntax of tensor distribution notation) boxed as rule "Machines M" |
| alex-aiken | 2022-PLDI-distal-the-distributed-tensor-algebra-compiler | p08 | extra | Fig. 14 grammar (concrete index notation syntax) boxed as rule "Tensors T" |
| lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | p03 | missed | Named rule HOARE-BIND (inadmissible in presence of continuations), drawn with name over bar, has no box |
| lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | p08 | missed | Named rule INADMISSIBLE-BIND at page bottom (name over the bar) has no box |
| lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | p14 | missed | FST-CLWP (top-left of Fig. 5) has no box; the other Fig. 5 rules are boxed |
| lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | p14 | partial | INV-OPEN-CLWP box stops after the second premise; the third premise "e is atomic" and the right end of the bar are outside the box |
| lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | p23 | extra | Three unnamed spec-side rules (Cfork rule and the two yield rules) are boxed with the name "CurTh(j)", which is their first premise, not a rule name. None of the four rules on the page has a printed name, so no box is needed |
| lars-birkedal | 2021-POPL-mechanized-logical-relations-for-termination-insensitive-non | p18 | partial | MWP-bind-gen box covers only the name and the first premise BindCond(a,a',f,g); the second premise (mwp ... K[v] ...), the bar and the conclusion mwp K[e] {Φ} are outside |
| viktor-vafeiadis | 2024-OOPSLA-extending-the-c-c-memory-model-with-inline-assembly | p11 | extra | No-Thin-Air box sits on a bulleted consistency condition in Definition 3.1 ("acyclic(po ∪ rf) (NO-THIN-AIR)"). It is not an inference rule, and the sibling conditions Coherence/SC/Atomicity are rightly unboxed. |
| viktor-vafeiadis | 2024-OOPSLA-extending-the-c-c-memory-model-with-inline-assembly | p13 | extra | Coherence-II and Coherence-III boxes sit on bulleted consistency conditions in Definition 3.5, not rules. The two boxes also overlap/touch, and Coherence-III's tab covers the Coherence-II line. |
| alex-aiken | 2014-PLDI-stochastic-optimization-of-floating-point-programs-with-tuna | p03 | extra | "NaN" box on the NaN row of the IEEE-754 table in Figure 1. It is a table row, not a rule, and its tab also covers the "Infinity" row above. |
| alex-aiken | 2014-PLDI-stochastic-optimization-of-floating-point-programs-with-tuna | p04 | extra | "β−p" box on equation (8). It is not a rule, and the box spans both columns, taking in right-column prose and equation (13). |
| ranjit-jhala | 2012-PLDI-deterministic-parallelism-via-liquid-effects | p07 | partial | T-UNFOLD box starts at the third premise line. The first two premise lines ("Γ ⊢ v : {ν : ref(l̃, i_y) \| ν ≠ 0}" and "h = h0 ∗ l̃ ↦ n_k:τ_k, i⁺:τ⁺") are outside the box, and the tab sits on the second line. |
| isil-dillig | 2013-OOPSLA-inductive-invariant-generation-via-abductive-inference | p03 | extra | "Conditional C" box on the language grammar (Statement/Expression/Conditional productions). It is not a rule, and it starts mid-grammar. |
| derek-dreyer | 2025-PLDI-destabilizing-iris | p10 | extra | eval-def box covers the displayed definition "e ⇓ v ≜ ∃h. ..." (EVAL-DEF). It is a labelled definition (≜), not an inference rule (borderline, since prose later cites it like a rule) |
| lars-birkedal | 2026-PLDI-iris-wasmfx-modular-reasoning-for-wasm-stack-switching | p17 | partial | ewp-contnew box covers only the name and the premise "F.inst.types[i] = ft". The full-width bar and the 3-line conclusion "ewp [ref.func addr; cont.new i] ; F ⟨Ψ⟩ {w F', ∃kaddr ...}" are outside it |
| zhendong-su | 2013-POPL-automatic-detection-of-floating-point-exceptions | p04 | extra | "Divide-by-Zero" box covers the lower half of the rewriting-rule definition T(x / y) = {Invalid / Divide-by-Zero / Overflow / ...}, a case-split equation, not a named inference rule. The box also misses the "T(x / y) =" left side, and its tab sits on the "x ⊙ y otherwise" line of T(x ⊙ y). The name comes from a case label inside the equation |
| alex-aiken | 2017-PLDI-synthesizing-program-input-grammars | p10 | extra | Box named "by" drawn around the prose "Results. We estimate the precision of Ĉ by |E_prec∩L*|/|E_prec|, where E_prec consists of ...". This is text, not a rule |
| martin-t-vechev | 2018-PLDI-incremental-inference-for-probabilistic-programs | p16 | extra | All 5 boxes (ZQ, ZQ, ZQ, ZP left column; ZP right column) sit on equational derivation steps inside the proofs of Lemma 4 and Lemma 5, cutting through fractions Z_Q/Z_P. None is a rule. The left-column boxes also overlap each other and cut the lines they sit on (e.g. "Z_Q/Z_P Pr[u~Q]/Σ..." split) |
| lars-birkedal | 2024-POPL-modular-denotational-semantics-for-effects-with-guarded-inte | p07 | extra | Box "IT" drawn on the commutative diagram (the P <-h/k-> IT square, with f/g/fold/unfold arrows); this is a diagram, not an inference rule |
| ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | p12 | partial | R-Loop-Upd box covers only the name and premises and stops above the inference bar; the conclusion (Γ, Δ, [for q in Q do A end]_p ∥ ∏q:Q.[B;C]_q, Ψ ⇝ Γ, Δ', ∏q:Q.[C]_q, Ψ') is left outside |
| ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | p13 | partial | R-Recv-Unfold box's bottom edge runs through the middle of the last conclusion line (Γ,Δ,([x ← recv(q*,t)]_p ∥ ∏q:Q'\{q}.A ∥ [A]_q*),Ψ), so that line is cut in half |
| ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | p13 | overlap | R-Send-Unfold and R-Recv-Unfold boxes are stacked with no gap: the R-Recv-Unfold tab covers the start of R-Send-Unfold's second conclusion line. R-Recv-Unfold's right edge also touches R-Compose-Resid's left edge |
| ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | p14 | overlap | R-While-Repeat/R-if-then and R-While-Remove/R-if-else boxes touch with no gap: the R-if-then and R-if-else tabs sit on top of the last conclusion lines of R-While-Repeat (Γ',Δ',[while true do A end]_p ∥ [C]_q, Ψ') and R-While-Remove (Γ',Δ',[C]_q, Ψ'), hiding their start |
| ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | p15 | missed | R-Loop-Repeat (Fig. 4.8) has its name printed above the rule but has no box |
| martin-t-vechev | 2018-OOPSLA-robust-relational-layout-synthesis-from-examples-for-android | p06 | extra | Box "Section 6" drawn on part of the Fig. 4 overview diagram (Robustness Properties / User Feedback / <Button ...> XML); not a rule |
| martin-t-vechev | 2018-OOPSLA-robust-relational-layout-synthesis-from-examples-for-android | p17 | extra | Box "X YK" drawn on the display equation Z(ρ,v) = Σ ∏ P_fk(c ∣ f_k(c,v))^w_k; not a rule |
| sumit-gulwani | 2021-OOPSLA-semantic-programming-by-example-with-pre-trained-models | p20 | extra | Box "subject-verb" drawn on the body rows of Table 1 (GPT-3 names, taken from a table cell); not a rule |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p12 | missed | (T-FO), (T-FL) and (Prog) in the bottom row of Fig. 6 are named rules with no box. |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p12 | partial | The T-If2 box holds only the premise, bar and label. Its conclusion "if (v) then C1 else C2 → C" is below the box, partly under the T-Write tab. |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p12 | overlap | The T-CAS0 box's top-right corner touches or slightly overlaps the bottom-left of the T-FAA box. The rules are packed tight (T-Let1/T-If1 and T-Read/T-CAS0 edges nearly touch too). |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p15 | missed | (SilentS) and (Crash) in Fig. 8 are named rules with no box. Only SilentP and Step are boxed. |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p17 | missed | (M-PropP), the last rule of Fig. 9, has no box. Its label only has a cyan mention link on it. |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p21 | extra | Fig. 10 is a table of axioms, not inference rules, but it has 6 large purple boxes (tso-mo, tso-rf1, tso-rf2, nvo-loc, nvo-wu-fofl, nvo-fofl-d). Each spans several table rows, including the header and the "✓ in Fig. 3" column. |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p21 | overlap | The Fig. 10 table boxes overlap and nest: tso-rf2 overlaps tso-rf1 and nvo-loc, nvo-loc overlaps nvo-wu-fofl and nvo-fofl-d, and all sit inside tso-mo. |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p26 | extra | The nvo-fofl-d box covers a prose paragraph ("nvo has the added benefit … in Def. 2."). |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p26 | extra | The p-tso and p-tso-wu boxes cover bulleted axiom definitions (dom(...) ⊆ P) that have labels but are not inference rules. |
| sumit-gulwani | 2019-OOPSLA-on-the-fly-synthesis-of-edit-suggestions | p20 | extra | The BP-threshold and BP-transient boxes cover rows of Table 2, a configuration table. The paper has no inference rules there. |
| sumit-gulwani | 2019-OOPSLA-on-the-fly-synthesis-of-edit-suggestions | p20 | overlap | The BP-threshold box (table header and first row) overlaps the BP-transient box (next rows). |

## Mention-link problems (not boxes)

| author | paper | page | kind | what is wrong |
|---|---|---|---|---|
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p06 | other | Mention links: "Par" in "Par. 7" / "Par. 8" (short for Parameter) is linked as the PAR rule. The same happens on p08 ("Par 4") and p11 ("Par. 4") |
| derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p15 | other | Mention links in Fig. 8 and in the text are shifted by one character (e.g. "R[D-LOCK]", "R[D-WRITE]": the box starts after the first letter). The same happens on p20 ("D[D-LOCK]", etc.) |
| viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p16 | other | Mention links in prose are shifted left by a few characters (e.g. "(TSO-TOTA|L)", "(TSO-P|O)", "(TSO-R|F1)"); same on p25 ("(NVO-TSO)", "(NVO-PSF)", "(NVO-PRE)", "(NVO-PERS)") |
| derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p14 | other | cyan mention box on "exploit_frac(c)" inside the premise of RELEASE-EXPLOIT; it's a function name, not a rule (it comes from the bogus exploit_frac rule on p23) |
| derek-dreyer | 2023-POPL-dimsum-a-decentralized-approach-to-multi-language-semantics | p19 | other | Mention link "SIM-VIS" matches a substring of the longer names NO-SIM-VIS-EX-COMM and SIM-VIS-ALL-COMM, both in the Fig. 10 labels and in the prose, so it links to the wrong rule. (Fig. 10's named principles have no inference bar and no boxes, which is consistent with the rest.) |
| viktor-vafeiadis | 2024-OOPSLA-extending-the-c-c-memory-model-with-inline-assembly | p14 | other | Mention boxes are shifted about one character left of the text (also on p11, p16, p17, p18, p22, p24: TerminateStep, Coherence-II, No-Thin-Air). The "COHERENCE-III" mention on p14 (and on p16/p18) is boxed as "COHERENCE-II" with the last "I" left outside, so it probably resolves to the wrong condition. |
| alex-aiken | 2014-PLDI-stochastic-optimization-of-floating-point-programs-with-tuna | p04 | other | Spurious mention links on the ordinary word "NaN" (also on p06 twice and p08), caused by the bogus NaN rule. |
| lars-birkedal | 2026-PLDI-iris-wasmfx-modular-reasoning-for-wasm-stack-switching | p10 | other | Small-caps mention boxes sit about one character too far left on every page of this paper (p08, p10, p11, p13, p14, p18, p19, p20): they cut off the last letter (e.g. REDUCE-SUSPEND-TRANSLA|TE, REDUCE-LABE|L, EWP-RESUM|E) and take in the space before the name |
| zhendong-su | 2013-POPL-automatic-detection-of-floating-point-exceptions | p01 | other | Knock-on from the bogus rule above: every prose use of the exception name "Divide-by-Zero" is linked as a rule mention on p01, p02, p03 (including a Table 1 cell) and p10 (including the Table 3 caption) |
| alex-aiken | 2017-PLDI-synthesizing-program-input-grammars | p08 | other | Knock-on from the bogus "by" rule: the ordinary word "by" ("ruled out by the check") is linked as a rule mention |
| martin-t-vechev | 2018-PLDI-incremental-inference-for-probabilistic-programs | p16 | other | Knock-on: stray mention boxes on the Z_P and Z_Q symbols inside the Lemma 6 and Lemma 7 proofs |
| lars-birkedal | 2024-POPL-modular-denotational-semantics-for-effects-with-guarded-inte | p05 | other | Cyan mention link on the prose word "It" ("It satisfies the following rule"), which points at the fake rule "IT"; the same thing happens on p08 (the "IT" inside get_fun's type) and p14 ("It combines the computational rule...") |
| martin-t-vechev | 2018-OOPSLA-robust-relational-layout-synthesis-from-examples-for-android | p07 | other | Cyan mention link on "(Section 6)" in the prose, pointing at the fake rule "Section 6" |
| isil-dillig | 2024-POPL-programming-by-demonstration-for-long-horizon-robot-tasks | p15 | other | Mention links (not boxes) on ordinary words and code: "loop" in prose (p14, p15), code keyword `let` (p11), `goto` (p09), "disjunction" (p16). None of these refer to a rule. |
| sumit-gulwani | 2019-OOPSLA-on-the-fly-synthesis-of-edit-suggestions | p21 | other | Spurious mention links on BP-threshold / BP-transient table cells in Tables 3–5 (p20, p21), in prose (p21) and on a Fig. 8 axis label (p23). They come from the false rule boxes on p20. |

## Cosmetic: name tabs drawn over the text of the rule above (boxes themselves correct)

| author | paper | page | kind | what is wrong |
|---|---|---|---|---|
| alex-aiken | 2016-PLDI-verifying-bit-manipulations-of-floating-point | p09 | other | The RND box's tab sits on FLOP's conclusion line ("e1 ⊗f e2 ▷ ...") and hides part of it; the FLOP and RND boxes touch at that point (minor) |
| martin-t-vechev | 2019-PLDI-unsupervised-learning-of-api-aliasing-specifications | p09 | other | Table 2 boxes are packed so tightly that the Assign, FieldW, FieldR and GhostR tabs cover the premise/conclusion of the rule above or their own premise (e.g. Assign's premise "ρ(y) ⊆ ρ(x)" and FieldW's conclusion "ρ(y) ⊆ π(o,f)" are partly hidden). The boxes do not overlap and all 6 rules are covered (cosmetic) |
| lars-birkedal | 2021-POPL-mechanized-logical-relations-for-termination-insensitive-non | p08 | other | Minor: the rule boxes fit correctly and touch without overlapping, but in the packed Fig. 1 each name tab sits over the conclusion of the rule above and hides it (T-binop over T-Var, T-llam over T-app, T-tapp over T-tlam, T-match over T-pair, T-unfold over T-match, T-store over T-unpack, T-load over T-alloc). The same happens on p09 (S-tforall/S-trans, S-lforall/S-sum/S-labeled) and p16 (MWP-mono, MWP-mask-mono, MWP-bind tabs). This is only how the tabs are drawn, not a box error |
| isil-dillig | 2025-PLDI-graphiti-bridging-graph-and-relational-database-queries | p14 | other | Boxes don't overlap, but name tabs sit on top of neighbouring rules' conclusions: the Q-OrderBy tab covers the end of Q-Ret's conclusion (Π_ρ(E')), and the Q-UnionAll tab covers the end of Q-OrderBy's conclusion (OrderBy(Q',a,b)). Cosmetic only. |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p12 | other | Name tabs hide rule text: T-Let1 tab over the "Lab ≜ {(R,x,v)…" line, T-Read tab over "repeat" in T-Repeat's conclusion, T-CAS0 tab over "load" in T-Read's conclusion, T-FAA tab over T-Repeat's conclusion, T-CAS1 tab over "FAA(x,v)", T-Write tab over T-If2's conclusion. |
| viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p13 | other | Boxes are correct, but tabs cover conclusion text of the rule above: M-RMW tab (M-Write), M-SF tab (M-RMW), M-FL tab (M-SF, "↦ b."), M-BPropW tab (M-FO), M-BPropFO tab (M-BPropW), M-PropW tab (M-BPropFL). Cosmetic. |

## Clean

No box problems: viktor-vafeiadis/2010-POPL-structuring-the-verification-of-heap-manipulating-programs, alex-aiken/2016-PLDI-verifying-bit-manipulations-of-floating-point (tab cosmetics only), martin-t-vechev/2019-PLDI-unsupervised-learning-of-api-aliasing-specifications (tab cosmetics only), isil-dillig/2023-PLDI-imageeye-batch-image-processing-using-program-synthesis, ranjit-jhala/2023-PLDI-flux-liquid-types-for-rust, derek-dreyer/2023-POPL-dimsum-a-decentralized-approach-to-multi-language-semantics (mention links only), isil-dillig/2024-POPL-programming-by-demonstration-for-long-horizon-robot-tasks (mention links only), isil-dillig/2025-PLDI-graphiti-bridging-graph-and-relational-database-queries (tab cosmetics only)
