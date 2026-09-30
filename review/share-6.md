# Rule box review, share 6 of 6

Showcase branch showcase-pages-2026-09-30 (rule stage of PR #399, c369d258). Share 6 = manifest papers at index ≡ 5 (mod 6): 35 papers, 218 pages, every page read by one of seven reviewers; flagged pages spot-checked by the lead (Aiken p08, Silq p19, Consolidation p05, Transfinite Iris p07 confirmed).

Problems by kind: missed 24, partial 23, extra 20, overlap 12, overrun 9, other 9, wrong-name 6 (103 lines).

Recurring causes worth one fix each: small-caps "qu" read as q in tab names (Eqivalent, Eqiv, qeue, uniqe); boxes that stop at the bar and drop the conclusion (Birkedal ICFP'11, VMSL, x86 T-Repeat/T-If2, Silq ite-q, deadlock-free Sub-recv/send); labelled bullet axioms and definition clauses boxed as rules (Vafeiadis POPL'19, POPL'22, Choose Don't Label, CCR Prefix-closed); proof-table steps boxed ("By IH", "By 16" in Local Refinement Typing); left-margin labels in a figure column missed (Consolidation Fig. 5, Aiken Fig. 4); stacked one-line rules where one box swallows the next row (almost-sure termination p27, lock-free channels p19/p22, x86 err-split).

## Pages checked

- lars-birkedal/2011-ICFP-a-kripke-logical-relation-for-effect-based-program-transform: p05, p06, p15, p16, p18
- derek-dreyer/2011-POPL-a-kripke-logical-relation-between-ml-and-assembly: p19
- ranjit-jhala/2012-PLDI-verifying-gpu-kernels-by-test-amplification: p05
- alex-aiken/2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning: p08, p09, p20, p21, p22, p23, p24, p25, p26, p27
- derek-dreyer/2013-POPL-the-power-of-parameterization-in-coinductive-proof: p03, p05, p06, p10, p12
- isil-dillig/2014-PLDI-consolidation-of-queries-with-user-defined-functions: p04, p05, p06, p07, p08
- sumit-gulwani/2015-OOPSLA-automating-grammar-comparison: p08, p09, p10, p11, p14, p17, p18
- derek-dreyer/2016-ICFP-higher-order-ghost-state: p10, p11, p12, p13, p14
- isil-dillig/2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties: p02, p05, p06, p07, p08, p09, p15, p16, p17, p18
- isil-dillig/2017-PLDI-component-based-synthesis-of-table-consolidation-and-transfo: p04, p08, p09
- ranjit-jhala/2017-ICFP-local-refinement-typing: p27, p28, p29
- martin-t-vechev/2018-PLDI-bayonet-probabilistic-inference-for-networks: p06, p07, p08
- derek-dreyer/2018-ICFP-mtac2-typed-tactics-for-backward-reasoning-in-coq: p26
- lars-birkedal/2018-POPL-a-logical-relation-for-monadic-encapsulation-of-state-provin: p05, p07, p08, p14, p21, p22, p24
- ranjit-jhala/2019-PLDI-lazy-counterfactual-symbolic-execution: p07, p08
- viktor-vafeiadis/2019-POPL-bridging-the-gap-between-programming-languages-and-hardware: p02, p03, p08, p13, p19, p24, p25
- martin-t-vechev/2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a: p04, p07, p08, p09, p18, p19, p21, p22, p23, p25, p26
- ranjit-jhala/2020-POPL-program-synthesis-by-type-guided-abstraction-refinement: p10, p11, p12
- robbert-krebbers/2020-OOPSLA-knowing-when-to-ask-sound-scheduling-of-name-resolution-in-t: p06, p07, p08, p12, p13, p14, p15, p20, p21
- derek-dreyer/2021-PLDI-transfinite-iris-resolving-an-existential-dilemma-of-step-in: p07, p08, p09, p10, p11, p12, p13
- viktor-vafeiadis/2021-POPL-persevere-persistency-semantics-for-verification-under-ext4: p07, p08, p16, p18, p19, p20, p22, p26
- derek-dreyer/2021-ICFP-ghostcell-separating-permissions-from-data-in-rust: p18, p19, p20, p22, p23
- sumit-gulwani/2022-OOPSLA-neurosymbolic-repair-for-low-code-formula-languages: p10, p11, p14, p15, p16, p17
- lars-birkedal/2022-OOPSLA-le-temps-des-cerises-efficient-temporal-stack-safety-on-capa: p23, p24, p25
- viktor-vafeiadis/2022-POPL-extending-intel-x86-consistency-and-persistency-formalising: p17, p18, p19, p20, p21, p23, p24, p25, p26
- isil-dillig/2023-OOPSLA-data-extraction-via-semantic-regular-expression-synthesis: p07, p08, p09, p11, p12, p16, p17, p30, p31, p32, p34
- lars-birkedal/2023-PLDI-vmsl-a-separation-logic-for-mechanised-robust-safety-of-virt: p08, p09, p10, p11, p13, p16
- derek-dreyer/2023-POPL-conditional-contextual-refinement: p07, p08, p09, p13, p16, p17, p19
- lars-birkedal/2024-ICFP-almost-sure-termination-by-guarded-refinement: p07, p08, p09, p10, p11, p13, p15, p20, p21, p22, p27
- robbert-krebbers/2024-POPL-deadlock-free-separation-logic-linearity-yields-progress-for: p09, p10, p11, p12, p13, p14
- robbert-krebbers/2024-OOPSLA-verified-lock-free-session-channels-with-linking: p04, p05, p14, p15, p16, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27
- isil-dillig/2024-PLDI-from-batch-to-stream-automatic-generation-of-online-algorith: p07, p11, p12
- ranjit-jhala/2025-POPL-generic-refinement-types: p13, p14, p15, p16, p17, p18, p19
- isil-dillig/2026-PLDI-choose-don-t-label-multiple-choice-query-synthesis-for-progr: p05, p08, p31, p32, p33
- lars-birkedal/2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist: p08, p09, p10, p11, p12, p13, p14, p15, p17, p19, p20

## Problems

| author | paper | page | kind | what is wrong |
|---|---|---|---|---|
| lars-birkedal | 2011-ICFP-a-kripke-logical-relation-for-effect-based-program-transform | p05 | partial | Fig. 1: the bottom edge runs through the conclusion (cut off or under the next tab) for T-Ax, T-Unit, T-Int, T-Pair, T-Proji, T-Fix, T-App, T-Alloc, T-Deref. |
| lars-birkedal | 2011-ICFP-a-kripke-logical-relation-for-effect-based-program-transform | p05 | partial | T-Sub box leaves out the side condition "(FRV(ε2) ⊆ Π)" on its right. |
| lars-birkedal | 2011-ICFP-a-kripke-logical-relation-for-effect-based-program-transform | p15 | extra | A "ε−ρ" box is around a line of proof prose in Lemma 22. |
| derek-dreyer | 2011-POPL-a-kripke-logical-relation-between-ml-and-assembly | p19 | extra | "List X" box covers the first 5 rows of a definitions/grammar table (List X, Loc, Word, Val, Lvalue ::= …), stopping partway through it. |
| alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p08 | missed | Figure 4 left column has no boxes on T-Read, T-Write, T-Reduce, T-New, T-UpRgn, T-DnRgn, T-NewColor, T-Color, T-Partition, T-Unpack, T-Call, T-Program; right column none on E-Read, E-Write, E-DnRgn, E-NewColor, E-Color, E-Partition, E-Pack, E-Call. Only T-Pack, E-Reduce, E-New, E-UpRgn and E-Unpack are boxed. |
| alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p08 | partial | The E-Unpack box covers only the "[E-Unpack]" label and the premise M' = M[ρ1/r1,…]; it leaves out the other premises, the bar and the conclusion. |
| alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p08 | overrun | The E-Reduce box and its tab start on E-Write's conclusion line (write(e1,e2) ↦ l, E'++…), covering it. |
| alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p09 | missed | The displayed rule [E-Add] in the left column (5 premises, bar, conclusion) has only a mention box and no rule box. |
| alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p20 | extra | Both "part_list" boxes sit on Listing 5 code (lines 170–176 and 188–202); not rules. |
| alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p22 | missed | The axioms (T-Bool), (T-Int) and (T-Null) in Figure 12 are not boxed. |
| alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p23 | missed | The axiom (E-Null) in Figure 13 is not boxed. |
| derek-dreyer | 2013-POPL-the-power-of-parameterization-in-coinductive-proof | p06 | overlap | Fig. 4: INCL, REFL, IF and APPV boxes share edges; the IF tab is inside the INCL box and covers the start of INCL's conclusion "(e,e') ∈ r^ctx"; the APPV tab sits on IF's bottom. |
| derek-dreyer | 2013-POPL-the-power-of-parameterization-in-coinductive-proof | p12 | missed | (COEN), a labelled displayed principle "x ⊑ f(μy. f(y) ⊔ x ⊔ νf) ⟹ x ⊑ νf", has no box (written as an implication, no bar; borderline). |
| isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p04 | partial | Int: the box's bottom edge runs through the conclusion "Ψ ⊢i e : e′" and the Bool 2 tab sits on it. |
| isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p05 | overrun | Com: the box stretches across the column gap into the right-column prose ("false under Ψ … (R;C)⊗P", "The If 3 rule describes…"). |
| isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p05 | partial | If 3: the box covers only the first two premises, missing the third premise, the bar, the conclusion and the "(If 3)" label; it also reaches into right-column prose and the top of If 4. |
| isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p05 | partial | If 4: the box starts at the second premise; "Ψ ⊢ e : e′" and most of "Ψ∧e ⊢ L⊗P : S1" are outside. |
| isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p05 | overlap | If 3's box crosses the top of the If 4 box and its tab. |
| isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p05 | missed | Figure 5 rules with the label at the left margin have no box: Skip 1, Skip 2, Skip 3, Assign, Step, Seq, If 1, If 2. |
| sumit-gulwani | 2015-OOPSLA-automating-grammar-comparison | p09 | overlap | The TESTCASES box and tab overlap the bottom of INDUCT and cover the start of INDUCT's conclusion ("C ⊢ α op β"). |
| sumit-gulwani | 2015-OOPSLA-automating-grammar-comparison | p11 | missed | BRANCHEXT (labelled "BRANCHEXT.", premises x = aw and ∀b∈Σ…, bar, conclusion C ⊢ α op_x β) in the left column has no box. |
| derek-dreyer | 2016-ICFP-higher-order-ghost-state | p10 | other | Wrong PDF: the source (pure.au.dk …/3607856.pdf) is Jacobs, Hinrichsen, Krebbers, "Dependent Session Protocols in Separation Logic from First Principles" (ICFP 2023), not "Higher-order ghost state". Its boxes are correct. |
| isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p02 | extra | "Statement S" box is on the Figure 2 language grammar. |
| isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p05 | missed | Figure 5: (Expand), (Lift), (♭-intro 1), (♭-intro 2), (♭-elim), (Assoc) have no box. |
| isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p05 | partial | Minor: the right end of the bar sticks a few pixels out of the Step and Consq boxes. |
| isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p07 | missed | Figure 6: (Transform − single), (Transform − multi), (Fusion 1), (Fusion 2) have no box. |
| isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p07 | partial | Minor: the right end of Flatten's bar sticks out of its box. |
| isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p09 | other | Mention link on the English word "If" in "If it is the" points to the If rule. |
| isil-dillig | 2017-PLDI-component-based-synthesis-of-table-consolidation-and-transfo | p04 | extra | "Hypothesis H" box covers the Figure 4 grammar for hypotheses (Term / Qualifier / Hypothesis productions). |
| ranjit-jhala | 2017-ICFP-local-refinement-typing | p27 | extra | The "By 16" box is on proof steps (Hence / By 16), not a rule. |
| ranjit-jhala | 2017-ICFP-local-refinement-typing | p28 | extra | The "By IH", "By 18" and "By 19" boxes are on steps of the proof table, not rules. |
| ranjit-jhala | 2017-ICFP-local-refinement-typing | p29 | extra | The "By IH" (lines 22–23), "By 23", "By IH" (24) and "By 24" boxes are on proof steps, not rules. |
| lars-birkedal | 2018-POPL-a-logical-relation-for-monadic-encapsulation-of-state-provin | p05 | other | Only "Λ hoisting" is boxed out of 12 like-formatted labelled refinements with no bar (Fig. 2: Neutrality, Commutativity, Idempotency, Rec hoisting, Λ hoisting, η expansion rec/Λ, β reduction rec/Λ; Fig. 3: Left/Right Identity, Associativity); box all or none (likely extra). Its tab covers "e1 in rec" of the Rec hoisting line. |
| lars-birkedal | 2018-POPL-a-logical-relation-for-monadic-encapsulation-of-state-provin | p21 | wrong-name | Tab reads "SavedPred-Eqiv", label is SAVEDPRED-EQUIV. |
| lars-birkedal | 2018-POPL-a-logical-relation-for-monadic-encapsulation-of-state-provin | p22 | missed | Fig. 8: EXCLUSIVE (top right), FULL-EXCLUSIVE (second row) and FPFN-OPERATION-SUCCESS (case-split definition) have no box. |
| ranjit-jhala | 2019-PLDI-lazy-counterfactual-symbolic-execution | p08 | partial | Let box stops after "(let x = e1 in e2, H, P) ↪"; the second conclusion line "(e2′, H{x′ = e1′}, P)" is outside. |
| ranjit-jhala | 2019-PLDI-lazy-counterfactual-symbolic-execution | p08 | overrun | App-Lam box's top takes in Let's second conclusion line. |
| ranjit-jhala | 2019-PLDI-lazy-counterfactual-symbolic-execution | p08 | overlap | Tabs cover the conclusion above: Var-Red (App-Lam tab), App (Pr-L), Pr-L (Pr, Case-Ev), Case-Ev (Case-Sym), Ch-L (Assume-Ev), Assert-Ev (Assert-Crash). |
| viktor-vafeiadis | 2019-POPL-bridging-the-gap-between-programming-languages-and-hardware | p02 | extra | "RISC-V" box covers left-column prose ("…of Kang et al. [2017] to IMM…") and part of the Fig. 1 diagram. |
| viktor-vafeiadis | 2019-POPL-bridging-the-gap-between-programming-languages-and-hardware | p08 | extra | "happens-before" and "from-read/read-before" boxes are around relation definitions (sw ≜ …, hb ≜ …, fr ≜ …); the from-read tab covers the hb line. |
| viktor-vafeiadis | 2019-POPL-bridging-the-gap-between-programming-languages-and-hardware | p13 | extra | rf-completeness, co-totality, coherence, atomicity, no-thin-air are bullet items of Definition 3.11, not rules; their tabs hide each bullet's start. |
| viktor-vafeiadis | 2019-POPL-bridging-the-gap-between-programming-languages-and-hardware | p24 | extra | fwbob-cov, ppo-iss, acq-iss, w-strong-iss are bullet conditions of Definition 7.3; fwbob-cov also takes in "and the following hold:". |
| martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p09 | missed | func-eval (Fig. 9) and λ-abs (Fig. 10), labels right of the bar, have no box. |
| martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p19 | missed | func-eval and eval-λ-abs (Fig. 28, large grey-shaded rules) have no box. |
| martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p19 | partial | ite-q box covers only the premise line and the bar; the conclusion (Γc, Γ ⊢ if ec then et else ef …) is outside. |
| martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p19 | overlap | Boxes share edges: const/var/var-const; !W/W/!C; C's top edge and tab sit on the bottoms of !W and W; rev and call-rev touch, call-rev's tab inside the rev box. |
| martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p22 | extra | Fig. 34(a)–(c) derivation trees are boxed: var, var, const in (a); built-in-eval, func-eval, C, W in (b); C, W in (c) (rest of (c) unboxed). |
| martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p22 | partial | func-eval box in Fig. 34(b) is a thin strip around the bar only, cutting through the built-in-eval conclusion above and the C premise below. |
| martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p22 | overrun | var-const box (G.2.3) also takes in the heading line "G.2.3 [var-const]. The rule is". |
| martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p23 | missed | Restated rules !W (G.2.4), W (G.2.5), !C (G.2.6), C (G.2.7) have no boxes (the same kind on p22, var and var-const, is boxed). |
| ranjit-jhala | 2020-POPL-program-synthesis-by-type-guided-abstraction-refinement | p10 | overlap | Minor: stacked T-Var / T-Comp / T-App / T-Fun boxes share borders, each tab inside the box above; the T-Var tab overlaps the judgment box "Λ;Γ⊢E::t". |
| robbert-krebbers | 2020-OOPSLA-knowing-when-to-ask-sound-scheduling-of-name-resolution-in-t | p12 | wrong-name | The tab reads "Eqivalent" but the label is EQUIVALENT (small-caps "qu" ligature read as q). |
| robbert-krebbers | 2020-OOPSLA-knowing-when-to-ask-sound-scheduling-of-name-resolution-in-t | p14 | missed | Op-Edge in Figure 8 (named axiom with no bar, below Op-Node-Stale and Op-Data) is not boxed. |
| derek-dreyer | 2021-PLDI-transfinite-iris-resolving-an-existential-dilemma-of-step-in | p07 | partial | StoreT box starts below the rule's own "StoreT" label, which is hidden under the tab. |
| derek-dreyer | 2021-PLDI-transfinite-iris-resolving-an-existential-dilemma-of-step-in | p07 | overrun | StoreT box runs across the figure and takes in StoreS's conclusion line and the heading "Termination-preserving refinements in Refinement_SHL:"; the TPPureT tab falls inside it. |
| derek-dreyer | 2021-PLDI-transfinite-iris-resolving-an-existential-dilemma-of-step-in | p07 | partial | StoreS box ends at its bar; its conclusion "{ℓ ↦src v1 ∗ src(K[ℓ := v2])} e_t {v.Q}" falls inside the StoreT box instead (StoreS/StoreT overlap). |
| viktor-vafeiadis | 2021-POPL-persevere-persistency-semantics-for-verification-under-ext4 | p07 | extra | ow-na box is on a one-line example program (pwrite(df,"bar",0); labelled (OW-NA)), not a rule. |
| viktor-vafeiadis | 2021-POPL-persevere-persistency-semantics-for-verification-under-ext4 | p22 | other | Two mention links on "[REC]" in "[REC]; rb; pb; rf; [REC]" point to the rule, but here [REC] is the set of recovery events. |
| derek-dreyer | 2021-ICFP-ghostcell-separating-permissions-from-data-in-rust | p18 | missed | MonoInit (top-left of the monotone counter rules, "True ⇛ ∃γ. MonoVal(γ,n)") has no box; its three siblings are boxed. |
| derek-dreyer | 2021-ICFP-ghostcell-separating-permissions-from-data-in-rust | p19 | missed | GhostLftLookup (label "(GhostLftLookup)", a "key rule" in the text) has no box; the same style on p20 (BrandedIndexSub) is boxed. |
| derek-dreyer | 2021-ICFP-ghostcell-separating-permissions-from-data-in-rust | p23 | missed | TokInit, TokUpdate, TokSplit and TokCombine (GhostToken proof rules) have no boxes. |
| viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p17 | extra | "internal" and "external" box labelled consistency axioms (bullet formulas) of Definition 6, not inference rules (policy call). |
| viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p18 | partial | T-Repeat box ends above its conclusion "repeat C →τ:ε if (C) then (repeat C) else 0". |
| viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p18 | partial | T-If2 box ends above its conclusion "if (v) then C1 else C2 →τ:ε C"; the T-Write tab sits on it. |
| viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p18 | partial | Minor: "nt" of "ntstore" in T-NTW's conclusion starts left of the box and is under the T-CAS0 tab. |
| viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p18 | extra | "MM-internal" and "MM-external" box the axiom bullets of Definition 7 (policy call). |
| viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p20 | missed | Figure 9: M-PropW+NTW and M-PropFL+FO+SF have no box. |
| viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p20 | other | Mention link covers only "M-PropFL" of "M-PropFL+FO+SF" (name cut at "+"). |
| viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p23 | extra | "external-revised", "strict-persist", "weak-persist" box the axiom bullets of Definition 10 (policy call); strict/weak share an edge and each tab covers the axiom above. |
| isil-dillig | 2023-OOPSLA-data-extraction-via-semantic-regular-expression-synthesis | p07 | other | Mention links on small-caps rule names in prose sit about one character too far left and cut off the last letter (TRANS/SEMANTIC p07; CONCRETE-INFEASIBLE/HOLE-INFEASIBLE/HOLE-FEASIBLE p12; SKETCH-NESTED-FAIL/HOLE-FAIL p17; CONST-SEMANTIC, STAR-2, OPTIONAL, CONST-CHARSEQ, HOLE-FEASIBLE p30–p32). Rule boxes are all correct. |
| lars-birkedal | 2023-PLDI-vmsl-a-separation-logic-for-mechanised-robust-safety-of-virt | p08 | partial | SS-mov box ends just below the bar; the conclusion (SSWP Normal @ i {...}) is outside and the edge cuts the reg/mem superscripts. |
| lars-birkedal | 2023-PLDI-vmsl-a-separation-logic-for-mechanised-robust-safety-of-virt | p10 | partial | SS-share box covers only the name and first premise line; premise lines 2–3, the bar and the SSWP conclusion are outside. |
| lars-birkedal | 2023-PLDI-vmsl-a-separation-logic-for-mechanised-robust-safety-of-virt | p10 | partial | SS-run box cuts through the second premise line (R0@0 ↦ Run) and leaves out the bar and the conclusion. |
| lars-birkedal | 2023-PLDI-vmsl-a-separation-logic-for-mechanised-robust-safety-of-virt | p10 | missed | WP-SSWP and RC-hold (named boxed-label rules in Fig. 6) have no boxes. |
| derek-dreyer | 2023-POPL-conditional-contextual-refinement | p13 | overlap | The CHL tab sits on the CHR box and covers the start of CHR's conclusion ("T ≲"); TKL does the same to TKR; CHR/CHL and TKR/TKL share borders. |
| derek-dreyer | 2023-POPL-conditional-contextual-refinement | p19 | extra | "Prefix-closed" box is around a two-line display of properties (Prefix-closed) and (Postfix-closed), implications not rules, one box for both. |
| lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p07 | missed | Fig. 1 rows RWP-ALLOC and RWP-RAND have no box. |
| lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p07 | overlap | Fig. 1 row boxes share borders and tabs cover rule text: rwp-store's hides the start of RWP-LOAD, rwp-frame's hides "∗ rwp" in RWP-MONO, rwp-val's part of RWP-RAND. |
| lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p10 | missed | RWP-TAPE-ALLOC ("∀ι. ι↪(N,ε) −∗ Φ(ι) ⊢ rwp tape N {Φ}") has no box; its label carries a mention link on "RWP-TAPE" only, pointing to rwp-tape. |
| lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p21 | partial | ref-model-prog box covers only the label and "reducible(ρ1) reducible(m1)"; the other premises, the bar and the conclusion "m1 ≲ ρ1" are outside. |
| lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p27 | overrun | Lemma A.1 rows: rwp-pure takes in RWP-ALLOC, rwp-store takes in RWP-RAND, rwp-frame takes in RWP-TAPE-ALLOC. |
| lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p27 | missed | RWP-ALLOC, RWP-RAND and RWP-TAPE-ALLOC have no box of their own; the partial "RWP-TAPE" mention recurs. |
| lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p27 | overlap | Minor: row boxes share borders and tabs cover formula text (rwp-load, rwp-store hide "(ℓ ↦ v"; rwp-val the RAND row; rwp-frame the RWP-MONO row; rwp-coupl-rand the "Lemma A.2 (Model rules)" heading). |
| robbert-krebbers | 2024-POPL-deadlock-free-separation-logic-linearity-yields-progress-for | p11 | partial | The Sub-recv and Sub-send boxes end just below the bar, so each conclusion line (?(x1)⟨v1⟩{P1}; p1 ⊑ … and !(x1)⟨v1⟩{P1}; p1 ⊑ …) is cut off. |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p04 | wrong-name | Tab reads "link-qeue-lat", label is LINK-QUEUE-LAT (small-caps "qu" read as q). |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p05 | wrong-name | Tab reads "link-qeue-ghost", label is LINK-QUEUE-GHOST. |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p05 | overlap | link-qeue-ghost's tab covers part of make-ghost-link's formula ("d2 e2 v2 ⇛∗"); the two boxes share an edge. |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p05 | partial | The link-spec box's left edge cuts through the opening "{" of "{c ↣ prot ∗ d ↣ prot‾}". |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p18 | other | make-ghost-link-self's tab covers part of make-ghost-link's formula; make-ghost-link's tab covers "Enq e" in the enqueue spec line above. |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p19 | overrun | chan-symmetric box covers three lines: the unlabelled send and recv specs and the CHAN-SYMMETRIC line; it should cover only the last. |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p22 | missed | PROTO-RECV has no box of its own; it sits inside the proto-symmetric box. |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p22 | overrun | proto-symmetric box covers both PROTO-RECV (2 lines) and the PROTO-SYMMETRIC line. |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p22 | other | proto-send's tab covers "True ⇛∗" at the start of PROTO-ALLOC; proto-symmetric's tab covers "prot_own" in PROTO-SEND. |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p23 | wrong-name | Tab reads "uniqe", label is UNIQUE. |
| robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p23 | other | Tabs cover the rule above: symmetric's tab covers "R a a' ⊢" in IRREFLEXIVE, pair-update's covers "⇆γ R ∗" in PAIR-ADD. |
| ranjit-jhala | 2025-POPL-generic-refinement-types | p16 | wrong-name | Tabs read "≡ /l" and "≡ /r"; labels are ≡κ/L and ≡κ/R (math-italic κ dropped, likely a tab-font glyph). |
| isil-dillig | 2026-PLDI-choose-don-t-label-multiple-choice-query-synthesis-for-progr | p05 | extra | "Coverage" box is around the two conditions of Definition 3.1, (Mutual exclusion) and (Coverage); definition clauses, not rules. |
| isil-dillig | 2026-PLDI-choose-don-t-label-multiple-choice-query-synthesis-for-progr | p08 | extra | "IA" box is around OMT hard constraints in Fig. 5, not rules, and runs into the (SAT) constraint (a_t ⇒ A_t); the (IA) mention links on p08 and p31–p33 follow it. |
| lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | p09 | partial | ht-frame: the right edge cuts the end of the conclusion "{Q ∗ R}"; the ht-inv-alloc and ht-inv-open tabs sit on the conclusions of ht-frame and ht-load. |
| lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | p11 | overlap | The ht-rand-tape tab and top edge sit over ht-alloc-tape's conclusion "{True} tape N {κ. κ ↪ (N,ε)}". |
| lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | p14 | overrun | err-split's box also covers the neighbouring rule ERR-1 (⚡(1) / False). |
| lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | p14 | missed | ERR-1 has no box of its own. |
| lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | p20 | overlap | spec-step-exp's tab and top edge sit on spec-step-err-1 and hide its conclusion "sstep σ ρ ε {Φ}"; its top edge also meets spec-step-ret and spec-step-continuous. |

## Clean

- ranjit-jhala/2012-PLDI-verifying-gpu-kernels-by-test-amplification
- martin-t-vechev/2018-PLDI-bayonet-probabilistic-inference-for-networks
- derek-dreyer/2018-ICFP-mtac2-typed-tactics-for-backward-reasoning-in-coq
- sumit-gulwani/2022-OOPSLA-neurosymbolic-repair-for-low-code-formula-languages
- lars-birkedal/2022-OOPSLA-le-temps-des-cerises-efficient-temporal-stack-safety-on-capa
- isil-dillig/2024-PLDI-from-batch-to-stream-automatic-generation-of-online-algorith
