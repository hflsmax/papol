# Box review: gathered problem list (shares 1–6)

Branch showcase-pages-2026-09-30 (rule stage of PR #399, c369d258). Every problem line of share-1.md … share-6.md parsed; the original line text is kept, with the share number added. Kinds: missed, extra, partial, overrun, overlap, wrong-name, other.

## Totals

| measure | count |
|---|---|
| problem lines | 592 |
| kind: missed | 137 |
| kind: extra | 177 |
| kind: partial | 105 |
| kind: overrun | 43 |
| kind: overlap | 47 |
| kind: wrong-name | 20 |
| kind: other | 63 |
| papers with problems | 180 |
| papers clean (union of Clean lists) | 43 |
| of which also have problem lines (mention-link / tab notes only) | 9 |
| papers covered (with problems ∪ clean) | 214 |
| group A (Box geometry) | 207 |
| group B (Extra boxes on non-rules) | 174 |
| group C (Missed rules) | 137 |
| group D (Names, tabs and mention links) | 74 |

### Per share

| share | lines | missed | extra | partial | overrun | overlap | wrong-name | other | papers with problems | clean |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 87 | 22 | 28 | 12 | 7 | 7 | 2 | 9 | 30 | 6 |
| 2 | 106 | 27 | 23 | 16 | 11 | 9 | 4 | 16 | 31 | 9 |
| 3 | 93 | 23 | 32 | 22 | 6 | 2 | 6 | 2 | 25 | 11 |
| 4 | 102 | 23 | 39 | 19 | 7 | 8 | 1 | 5 | 33 | 3 |
| 5 | 101 | 18 | 35 | 13 | 3 | 9 | 1 | 22 | 32 | 8 |
| 6 | 103 | 24 | 20 | 23 | 9 | 12 | 6 | 9 | 29 | 6 |
| all | 592 | 137 | 177 | 105 | 43 | 47 | 20 | 63 | 180 | 43 |

## By paper

Sorted by problem count, descending.

| # | author | paper | count | kinds |
|---|---|---|---|---|
| 1 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | 15 | missed 1, extra 6, partial 5, overlap 3 |
| 2 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | 15 | missed 2, extra 4, partial 2, overrun 1, overlap 1, other 5 |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | 13 | missed 1, extra 7, partial 4, overlap 1 |
| 4 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | 12 | missed 2, extra 3, partial 2, overrun 1, overlap 2, other 2 |
| 5 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | 11 | missed 1, extra 3, partial 3, overrun 1, overlap 1, wrong-name 2 |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | 11 | missed 1, partial 1, overrun 2, overlap 1, wrong-name 3, other 3 |
| 7 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | 11 | missed 3, extra 3, partial 1, overlap 2, other 2 |
| 8 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | 10 | missed 6, partial 1, overrun 1, overlap 1, other 1 |
| 9 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | 10 | missed 3, partial 3, overrun 2, other 2 |
| 10 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | 10 | missed 3, partial 7 |
| 11 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | 10 | missed 1, extra 3, partial 2, overlap 2, wrong-name 1, other 1 |
| 12 | derek-dreyer | 2020-POPL-the-future-is-ours-prophecy-variables-in-separation-logic | 9 | missed 1, extra 1, partial 3, wrong-name 4 |
| 13 | lars-birkedal | 2026-OOPSLA-lawyer-modular-obligations-based-liveness-reasoning-in-highe | 9 | missed 1, extra 3, partial 2, overrun 2, overlap 1 |
| 14 | derek-dreyer | 2022-PLDI-compass-strong-and-compositional-library-specifications-in-r | 8 | partial 4, overrun 2, overlap 1, other 1 |
| 15 | lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | 8 | missed 5, extra 1, overrun 1, other 1 |
| 16 | martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | 8 | missed 3, extra 1, partial 2, overrun 1, overlap 1 |
| 17 | ranjit-jhala | 2016-PLDI-refinement-types-for-typescript | 8 | missed 2, partial 2, overrun 2, wrong-name 2 |
| 18 | viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | 8 | missed 1, extra 3, partial 3, other 1 |
| 19 | alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | 7 | missed 4, extra 1, partial 1, overrun 1 |
| 20 | derek-dreyer | 2017-POPL-a-promising-semantics-for-relaxed-memory-concurrency | 7 | missed 3, extra 2, overlap 1, other 1 |
| 21 | lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | 7 | missed 3, partial 1, overrun 1, overlap 2 |
| 22 | alex-aiken | 2018-POPL-on-automatically-proving-the-correctness-of-math-h-implement | 6 | missed 3, extra 2, partial 1 |
| 23 | derek-dreyer | 2013-ICFP-unifying-refinement-and-hoare-style-reasoning-in-a-logic-for | 6 | missed 4, overrun 2 |
| 24 | derek-dreyer | 2018-POPL-rustbelt-securing-the-foundations-of-the-rust-programming-la | 6 | missed 3, partial 2, wrong-name 1 |
| 25 | derek-dreyer | 2022-OOPSLA-bff-foundational-and-automated-verification-of-bitfield-mani | 6 | extra 2, partial 1, overrun 1, overlap 2 |
| 26 | derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | 6 | missed 1, extra 4, other 1 |
| 27 | derek-dreyer | 2023-OOPSLA-stuttering-for-free | 6 | missed 1, extra 3, overlap 1, other 1 |
| 28 | isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | 6 | missed 1, partial 3, overrun 1, overlap 1 |
| 29 | isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | 6 | missed 2, extra 1, partial 2, other 1 |
| 30 | lars-birkedal | 2023-OOPSLA-spirea-a-mechanized-concurrent-separation-logic-for-weak-per | 6 | missed 1, partial 3, overrun 1, overlap 1 |
| 31 | robbert-krebbers | 2025-ICFP-verified-interpreters-for-dynamic-languages-with-application | 6 | missed 3, partial 2, overrun 1 |
| 32 | isil-dillig | 2011-POPL-precise-reasoning-for-programs-using-containers | 5 | missed 2, extra 2, partial 1 |
| 33 | isil-dillig | 2018-OOPSLA-relational-program-synthesis | 5 | extra 5 |
| 34 | isil-dillig | 2022-OOPSLA-type-directed-synthesis-of-visualizations-from-natural-langu | 5 | missed 4, extra 1 |
| 35 | lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | 5 | missed 3, extra 1, partial 1 |
| 36 | lars-birkedal | 2024-ICFP-error-credits-resourceful-reasoning-about-error-bounds-for-h | 5 | missed 3, partial 1, overrun 1 |
| 37 | lars-birkedal | 2026-OOPSLA-mixtris-mechanised-higher-order-separation-logic-for-mixed-c | 5 | missed 1, partial 2, overrun 1, overlap 1 |
| 38 | lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | 5 | missed 1, partial 1, overrun 1, overlap 2 |
| 39 | ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | 5 | missed 1, partial 2, overlap 2 |
| 40 | robbert-krebbers | 2026-PLDI-backwards-compatible-row-based-exceptions-in-ml | 5 | partial 1, overlap 3, other 1 |
| 41 | derek-dreyer | 2014-POPL-backpack-retrofitting-haskell-with-interfaces | 4 | extra 3, overrun 1 |
| 42 | derek-dreyer | 2022-PLDI-rusthornbelt-a-semantic-foundation-for-functional-verificati | 4 | missed 1, partial 1, overrun 1, overlap 1 |
| 43 | isil-dillig | 2018-POPL-verifying-equivalence-of-database-driven-applications | 4 | extra 2, overrun 2 |
| 44 | lars-birkedal | 2023-PLDI-vmsl-a-separation-logic-for-mechanised-robust-safety-of-virt | 4 | missed 1, partial 3 |
| 45 | lars-birkedal | 2024-POPL-an-axiomatic-basis-for-computer-programming-on-the-relaxed-a | 4 | partial 4 |
| 46 | martin-t-vechev | 2016-OOPSLA-modeling-and-analysis-of-remote-memory-access-programming | 4 | missed 1, extra 1, overrun 1, other 1 |
| 47 | martin-t-vechev | 2024-OOPSLA-synthetiq-fast-and-versatile-quantum-circuit-synthesis | 4 | extra 3, other 1 |
| 48 | ranjit-jhala | 2018-POPL-refinement-reflection-complete-verification-with-smt | 4 | missed 1, extra 1, overrun 1, overlap 1 |
| 49 | ranjit-jhala | 2024-POPL-mechanizing-refinement-types | 4 | missed 1, extra 2, partial 1 |
| 50 | robbert-krebbers | 2023-OOPSLA-proof-automation-for-linearizability-in-separation-logic | 4 | missed 2, partial 1, wrong-name 1 |
| 51 | robbert-krebbers | 2023-PLDI-beyond-backtracking-connections-in-fine-grained-concurrent-s | 4 | missed 3, partial 1 |
| 52 | robbert-krebbers | 2024-PLDI-a-proof-recipe-for-linearizability-in-relaxed-memory-separat | 4 | partial 2, overrun 2 |
| 53 | robbert-krebbers | 2026-POPL-a-relational-separation-logic-for-effect-handlers | 4 | missed 4 |
| 54 | viktor-vafeiadis | 2019-POPL-bridging-the-gap-between-programming-languages-and-hardware | 4 | extra 4 |
| 55 | alex-aiken | 2013-PLDI-terra-a-multi-stage-language-for-high-performance-computing | 3 | missed 1, overrun 2 |
| 56 | alex-aiken | 2014-PLDI-stochastic-optimization-of-floating-point-programs-with-tuna | 3 | extra 2, other 1 |
| 57 | alex-aiken | 2018-PLDI-active-learning-of-points-to-specifications | 3 | missed 1, partial 2 |
| 58 | derek-dreyer | 2010-POPL-a-relational-modal-logic-for-higher-order-stateful-adts | 3 | missed 2, overrun 1 |
| 59 | derek-dreyer | 2013-ICFP-mtac-a-monad-for-typed-tactic-programming-in-coq | 3 | extra 2, overlap 1 |
| 60 | derek-dreyer | 2014-OOPSLA-gps-navigating-weak-memory-with-ghosts-protocols-and-separat | 3 | missed 1, extra 1, overrun 1 |
| 61 | derek-dreyer | 2017-PLDI-repairing-sequential-consistency-in-c-c-11 | 3 | extra 1, overlap 2 |
| 62 | derek-dreyer | 2021-ICFP-ghostcell-separating-permissions-from-data-in-rust | 3 | missed 3 |
| 63 | derek-dreyer | 2021-PLDI-refinedc-automating-the-foundational-verification-of-c-code | 3 | extra 1, partial 2 |
| 64 | derek-dreyer | 2021-PLDI-transfinite-iris-resolving-an-existential-dilemma-of-step-in | 3 | partial 2, overrun 1 |
| 65 | derek-dreyer | 2022-ICFP-later-credits-resourceful-reasoning-for-the-later-modality | 3 | missed 2, wrong-name 1 |
| 66 | derek-dreyer | 2024-PLDI-quiver-guided-abductive-inference-of-separation-logic-specif | 3 | other 3 |
| 67 | lars-birkedal | 2011-ICFP-a-kripke-logical-relation-for-effect-based-program-transform | 3 | extra 1, partial 2 |
| 68 | lars-birkedal | 2017-POPL-interactive-proofs-in-higher-order-concurrent-separation-log | 3 | extra 3 |
| 69 | lars-birkedal | 2018-POPL-a-logical-relation-for-monadic-encapsulation-of-state-provin | 3 | missed 1, wrong-name 1, other 1 |
| 70 | lars-birkedal | 2019-POPL-iron-managing-obligations-in-higher-order-concurrent-separat | 3 | missed 1, partial 1, other 1 |
| 71 | lars-birkedal | 2021-POPL-efficient-and-provable-local-capability-revocation-using-uni | 3 | missed 1, extra 1, other 1 |
| 72 | martin-t-vechev | 2011-PLDI-partial-coherence-abstractions-for-relaxed-memory-models | 3 | other 3 |
| 73 | martin-t-vechev | 2018-OOPSLA-robust-relational-layout-synthesis-from-examples-for-android | 3 | extra 2, other 1 |
| 74 | martin-t-vechev | 2024-OOPSLA-modular-synthesis-of-efficient-quantum-uncomputation | 3 | extra 3 |
| 75 | ranjit-jhala | 2014-ICFP-refinement-types-for-haskell | 3 | missed 3 |
| 76 | ranjit-jhala | 2017-ICFP-local-refinement-typing | 3 | extra 3 |
| 77 | ranjit-jhala | 2019-PLDI-lazy-counterfactual-symbolic-execution | 3 | partial 1, overrun 1, overlap 1 |
| 78 | ranjit-jhala | 2022-OOPSLA-seq2parse-neurosymbolic-parse-error-repair | 3 | extra 3 |
| 79 | sumit-gulwani | 2019-OOPSLA-on-the-fly-synthesis-of-edit-suggestions | 3 | extra 1, overlap 1, other 1 |
| 80 | viktor-vafeiadis | 2015-POPL-common-compiler-optimisations-are-invalid-in-the-c11-memory | 3 | extra 2, overrun 1 |
| 81 | viktor-vafeiadis | 2018-POPL-effective-stateless-model-checking-for-c-c-concurrency | 3 | extra 3 |
| 82 | viktor-vafeiadis | 2019-POPL-grounding-thin-air-reads-with-event-structures | 3 | extra 3 |
| 83 | viktor-vafeiadis | 2022-OOPSLA-model-checking-for-a-multi-execution-memory-model | 3 | extra 3 |
| 84 | viktor-vafeiadis | 2024-OOPSLA-extending-the-c-c-memory-model-with-inline-assembly | 3 | extra 2, other 1 |
| 85 | alex-aiken | 2014-PLDI-first-class-runtime-generation-of-high-performance-types-usi | 2 | missed 1, overlap 1 |
| 86 | alex-aiken | 2017-PLDI-synthesizing-program-input-grammars | 2 | extra 1, other 1 |
| 87 | alex-aiken | 2020-PLDI-first-order-quantified-separators | 2 | extra 2 |
| 88 | alex-aiken | 2022-PLDI-distal-the-distributed-tensor-algebra-compiler | 2 | extra 2 |
| 89 | alex-aiken | 2022-POPL-induction-duality-primal-dual-search-for-invariants | 2 | extra 2 |
| 90 | derek-dreyer | 2013-POPL-the-power-of-parameterization-in-coinductive-proof | 2 | missed 1, overlap 1 |
| 91 | derek-dreyer | 2015-POPL-iris-monoids-and-invariants-as-an-orthogonal-basis-for-concu | 2 | partial 2 |
| 92 | derek-dreyer | 2017-OOPSLA-robust-and-compositional-verification-of-object-capability-p | 2 | missed 1, extra 1 |
| 93 | derek-dreyer | 2023-POPL-conditional-contextual-refinement | 2 | extra 1, overlap 1 |
| 94 | isil-dillig | 2019-PLDI-synthesizing-database-programs-for-schema-refactoring | 2 | extra 2 |
| 95 | isil-dillig | 2022-OOPSLA-automated-transpilation-of-imperative-to-functional-code-usi | 2 | missed 1, extra 1 |
| 96 | isil-dillig | 2022-OOPSLA-synthesis-powered-optimization-of-smart-contracts-via-data-t | 2 | missed 1, overlap 1 |
| 97 | isil-dillig | 2022-POPL-bottom-up-synthesis-of-recursive-functional-programs-using-a | 2 | missed 1, other 1 |
| 98 | isil-dillig | 2024-OOPSLA-control-flow-deobfuscation-using-trace-informed-compositiona | 2 | extra 1, other 1 |
| 99 | isil-dillig | 2026-PLDI-choose-don-t-label-multiple-choice-query-synthesis-for-progr | 2 | extra 2 |
| 100 | lars-birkedal | 2011-POPL-step-indexed-kripke-models-over-recursive-worlds | 2 | missed 1, partial 1 |
| 101 | lars-birkedal | 2017-POPL-a-relational-model-of-types-and-effects-in-higher-order-conc | 2 | extra 1, overrun 1 |
| 102 | lars-birkedal | 2021-POPL-mechanized-logical-relations-for-termination-insensitive-non | 2 | partial 1, other 1 |
| 103 | lars-birkedal | 2024-POPL-asynchronous-probabilistic-couplings-in-higher-order-separat | 2 | missed 2 |
| 104 | lars-birkedal | 2024-POPL-modular-denotational-semantics-for-effects-with-guarded-inte | 2 | extra 1, other 1 |
| 105 | lars-birkedal | 2025-POPL-approximate-relational-reasoning-for-higher-order-probabilis | 2 | missed 2 |
| 106 | lars-birkedal | 2026-PLDI-iris-wasmfx-modular-reasoning-for-wasm-stack-switching | 2 | partial 1, other 1 |
| 107 | martin-t-vechev | 2012-PLDI-dynamic-synthesis-for-relaxed-memory-models | 2 | partial 1, other 1 |
| 108 | martin-t-vechev | 2016-PLDI-sdnracer-concurrency-analysis-for-software-defined-networks | 2 | missed 1, extra 1 |
| 109 | martin-t-vechev | 2018-PLDI-incremental-inference-for-probabilistic-programs | 2 | extra 1, other 1 |
| 110 | robbert-krebbers | 2014-POPL-an-operational-and-axiomatic-semantics-for-non-determinism-a | 2 | missed 1, other 1 |
| 111 | robbert-krebbers | 2018-POPL-intrinsically-typed-definitional-interpreters-for-imperative | 2 | extra 2 |
| 112 | robbert-krebbers | 2020-OOPSLA-knowing-when-to-ask-sound-scheduling-of-name-resolution-in-t | 2 | missed 1, wrong-name 1 |
| 113 | robbert-krebbers | 2025-POPL-affect-an-affine-type-and-effect-system | 2 | missed 2 |
| 114 | sumit-gulwani | 2013-PLDI-static-analysis-for-probabilistic-programs-inferring-whole-p | 2 | extra 2 |
| 115 | sumit-gulwani | 2015-OOPSLA-automating-grammar-comparison | 2 | missed 1, overlap 1 |
| 116 | viktor-vafeiadis | 2013-OOPSLA-relaxed-separation-logic-a-program-logic-for-c11-concurrency | 2 | missed 1, overlap 1 |
| 117 | viktor-vafeiadis | 2019-POPL-on-library-correctness-under-weak-memory-consistency-specify | 2 | extra 2 |
| 118 | viktor-vafeiadis | 2020-PLDI-promising-2-0-global-optimizations-in-relaxed-memory-concurr | 2 | missed 1, other 1 |
| 119 | viktor-vafeiadis | 2021-POPL-persevere-persistency-semantics-for-verification-under-ext4 | 2 | extra 1, other 1 |
| 120 | zhendong-su | 2013-POPL-automatic-detection-of-floating-point-exceptions | 2 | extra 1, other 1 |
| 121 | zhendong-su | 2020-OOPSLA-on-the-unusual-effectiveness-of-type-aware-operator-mutation | 2 | extra 2 |
| 122 | zhendong-su | 2025-OOPSLA-api-guided-dataset-synthesis-to-finetune-large-code-models | 2 | extra 1, other 1 |
| 123 | alex-aiken | 2012-PLDI-concurrent-data-representation-synthesis | 1 | extra 1 |
| 124 | alex-aiken | 2015-OOPSLA-conditionally-correct-superoptimization | 1 | extra 1 |
| 125 | alex-aiken | 2016-PLDI-verifying-bit-manipulations-of-floating-point | 1 | other 1 |
| 126 | alex-aiken | 2024-PLDI-recursive-program-synthesis-using-paramorphisms | 1 | missed 1 |
| 127 | derek-dreyer | 2011-POPL-a-kripke-logical-relation-between-ml-and-assembly | 1 | extra 1 |
| 128 | derek-dreyer | 2016-ICFP-higher-order-ghost-state | 1 | other 1 |
| 129 | derek-dreyer | 2016-POPL-lightweight-verification-of-separate-compilation | 1 | other 1 |
| 130 | derek-dreyer | 2023-POPL-dimsum-a-decentralized-approach-to-multi-language-semantics | 1 | other 1 |
| 131 | derek-dreyer | 2025-PLDI-destabilizing-iris | 1 | extra 1 |
| 132 | derek-dreyer | 2025-PLDI-refinedprosa-connecting-response-time-analysis-with-c-verifi | 1 | other 1 |
| 133 | derek-dreyer | 2026-POPL-endangered-by-the-language-but-saved-by-the-compiler-robust | 1 | other 1 |
| 134 | isil-dillig | 2011-PLDI-precise-and-compact-modular-procedure-summaries-for-heap-man | 1 | extra 1 |
| 135 | isil-dillig | 2012-PLDI-automated-error-diagnosis-using-abductive-inference | 1 | extra 1 |
| 136 | isil-dillig | 2013-OOPSLA-inductive-invariant-generation-via-abductive-inference | 1 | extra 1 |
| 137 | isil-dillig | 2015-PLDI-static-detection-of-asymptotic-performance-bugs-in-collectio | 1 | extra 1 |
| 138 | isil-dillig | 2017-OOPSLA-synthesis-of-data-completion-scripts-using-finite-tree-autom | 1 | other 1 |
| 139 | isil-dillig | 2017-PLDI-component-based-synthesis-of-table-consolidation-and-transfo | 1 | extra 1 |
| 140 | isil-dillig | 2021-POPL-verifying-correct-usage-of-context-free-api-protocols | 1 | missed 1 |
| 141 | isil-dillig | 2023-OOPSLA-automated-translation-of-functional-big-data-queries-to-sql | 1 | extra 1 |
| 142 | isil-dillig | 2023-OOPSLA-data-extraction-via-semantic-regular-expression-synthesis | 1 | other 1 |
| 143 | isil-dillig | 2023-PLDI-automated-detection-of-under-constrained-circuits-in-zero-kn | 1 | partial 1 |
| 144 | isil-dillig | 2024-POPL-programming-by-demonstration-for-long-horizon-robot-tasks | 1 | other 1 |
| 145 | isil-dillig | 2024-POPL-semantic-code-refactoring-for-abstract-data-types | 1 | extra 1 |
| 146 | isil-dillig | 2025-PLDI-graphiti-bridging-graph-and-relational-database-queries | 1 | other 1 |
| 147 | lars-birkedal | 2019-ICFP-implementing-a-modal-dependent-type-theory | 1 | wrong-name 1 |
| 148 | lars-birkedal | 2019-POPL-stktokens-enforcing-well-bracketed-control-flow-and-stack-en | 1 | extra 1 |
| 149 | lars-birkedal | 2021-POPL-distributed-causal-memory-modular-specification-and-verifica | 1 | extra 1 |
| 150 | lars-birkedal | 2025-ICFP-modular-reasoning-about-error-bounds-for-concurrent-probabil | 1 | missed 1 |
| 151 | martin-t-vechev | 2014-PLDI-commutativity-race-detection | 1 | extra 1 |
| 152 | martin-t-vechev | 2015-OOPSLA-scalable-race-detection-for-android-applications | 1 | missed 1 |
| 153 | martin-t-vechev | 2016-POPL-learning-programs-from-noisy-data | 1 | extra 1 |
| 154 | martin-t-vechev | 2018-PLDI-inferring-crypto-api-rules-from-code-changes | 1 | extra 1 |
| 155 | martin-t-vechev | 2018-PLDI-static-serializability-analysis-for-causal-consistency | 1 | extra 1 |
| 156 | martin-t-vechev | 2019-PLDI-unsupervised-learning-of-api-aliasing-specifications | 1 | other 1 |
| 157 | martin-t-vechev | 2019-POPL-an-abstract-domain-for-certifying-neural-networks | 1 | extra 1 |
| 158 | martin-t-vechev | 2021-PLDI-robustness-certification-with-generative-models | 1 | extra 1 |
| 159 | ranjit-jhala | 2012-PLDI-deterministic-parallelism-via-liquid-effects | 1 | partial 1 |
| 160 | ranjit-jhala | 2012-POPL-nested-refinements-a-logic-for-duck-typing | 1 | missed 1 |
| 161 | ranjit-jhala | 2019-PLDI-fact-a-dsl-for-timing-sensitive-computation | 1 | partial 1 |
| 162 | ranjit-jhala | 2020-PLDI-type-error-feedback-via-analytic-program-repair | 1 | extra 1 |
| 163 | ranjit-jhala | 2020-POPL-program-synthesis-by-type-guided-abstraction-refinement | 1 | overlap 1 |
| 164 | ranjit-jhala | 2021-POPL-automatically-eliminating-speculative-leaks-from-cryptograph | 1 | missed 1 |
| 165 | ranjit-jhala | 2025-POPL-generic-refinement-types | 1 | wrong-name 1 |
| 166 | robbert-krebbers | 2020-POPL-actris-session-type-based-reasoning-in-separation-logic | 1 | extra 1 |
| 167 | robbert-krebbers | 2022-PLDI-diaframe-automated-verification-of-fine-grained-concurrent-p | 1 | wrong-name 1 |
| 168 | robbert-krebbers | 2024-POPL-deadlock-free-separation-logic-linearity-yields-progress-for | 1 | partial 1 |
| 169 | sumit-gulwani | 2010-OOPSLA-a-simple-inductive-synthesis-methodology-and-its-application | 1 | extra 1 |
| 170 | sumit-gulwani | 2010-PLDI-the-reachability-bound-problem | 1 | extra 1 |
| 171 | sumit-gulwani | 2011-POPL-automating-string-processing-in-spreadsheets-using-input-out | 1 | extra 1 |
| 172 | sumit-gulwani | 2015-OOPSLA-flashmeta-a-framework-for-inductive-program-synthesis | 1 | extra 1 |
| 173 | sumit-gulwani | 2015-PLDI-flashrelate-extracting-relational-data-from-semi-structured | 1 | extra 1 |
| 174 | sumit-gulwani | 2021-OOPSLA-semantic-programming-by-example-with-pre-trained-models | 1 | extra 1 |
| 175 | viktor-vafeiadis | 2019-OOPSLA-effective-lock-handling-in-stateless-model-checking | 1 | extra 1 |
| 176 | viktor-vafeiadis | 2020-OOPSLA-persistent-owicki-gries-reasoning-a-program-logic-for-reason | 1 | missed 1 |
| 177 | viktor-vafeiadis | 2021-OOPSLA-making-weak-memory-models-fair | 1 | extra 1 |
| 178 | viktor-vafeiadis | 2023-POPL-kater-automating-weak-memory-model-metatheory-and-consistenc | 1 | extra 1 |
| 179 | zhendong-su | 2013-OOPSLA-detecting-api-documentation-errors | 1 | extra 1 |
| 180 | zhendong-su | 2020-POPL-detecting-floating-point-errors-via-atomic-conditions | 1 | extra 1 |

## By cause

### A. Box geometry (207 lines)

kinds partial, overrun, overlap, plus extra/other/wrong-name lines whose description is about box extents (side conditions boxed separately, a label between two rules paired with the wrong one, a name strip across neighbours).

Recurring patterns (lines whose description matches; a line can match several):

- box stops at the bar / ends above the conclusion (conclusion left out): 50
- right edge clips a closing brace, bracket or ⟩ of a Hoare triple / spec: 17
- box takes in the neighbouring rule, row, heading or prose line: 42
- stacked one-line rules: box or tab one line off, overlapping the neighbour: 18
- side condition boxed separately or left outside the box: 12
- ⇛ / ⇛∗ update-glyph cut-offs: 7
- label between two rules paired with the wrong one: 4
- first premise / precondition line above the box top: 23

| share | author | paper | page | kind | what is wrong |
|---|---|---|---|---|---|
| 1 | martin-t-vechev | 2012-PLDI-dynamic-synthesis-for-relaxed-memory-models | p05 | partial | Semantics 2: STORE leaves out its last conclusion line "B′♮(x) = l·pc", CAS leaves out "B′♮(x) = ε" |
| 1 | viktor-vafeiadis | 2013-OOPSLA-relaxed-separation-logic-a-program-logic-for-c11-concurrency | p07 | overlap | right column stacked one-line axioms: A-R box reaches over the A-M line; R-NA tab sits inside the W-NA line (few px, unsure) |
| 1 | derek-dreyer | 2014-POPL-backpack-retrofitting-haskell-with-interfaces | p22 | overrun | WfDepsMod box takes in the definition line "Φ ⊢ Φ′ deps-wf ⇔def …" above its premises |
| 1 | ranjit-jhala | 2016-PLDI-refinement-types-for-typescript | p07 | overrun | Fig. 3 top row: S-VAR box is one strip across S-VAR, S-THIS and S-VARDECL's premises, overlapping S-VARDECL |
| 1 | ranjit-jhala | 2016-PLDI-refinement-types-for-typescript | p07 | partial | S-VARDECL box holds only the conclusion; S-DOTASGN and S-SEQ boxes leave out their names and cut through the premise line |
| 1 | ranjit-jhala | 2016-PLDI-refinement-types-for-typescript | p07 | wrong-name | "S-SKIP" box is a thin strip across the S-DOTASGN premise and the S-SEQ and S-SKIP names; the real S-SKIP rule "δ ⊩ skip ↪ ⟨⟩;δ" is not boxed, overlaps S-SEQ |
| 1 | ranjit-jhala | 2016-PLDI-refinement-types-for-typescript | p07 | overrun | Fig. 4: Q-CAST box is a strip across its name and the premises of R-CAST and R-LIF, leaving out its own conclusion; R-CAST and R-LIF boxes hold only their conclusions and overlap it |
| 1 | ranjit-jhala | 2016-PLDI-refinement-types-for-typescript | p08 | wrong-name | "T-CTXEMP" box is a thin strip across the conclusions of T-NEW and T-CAST; the real T-CTXEMP "Γ ⊢ ⟨⟩ ▷ ·" is not boxed |
| 1 | ranjit-jhala | 2016-PLDI-refinement-types-for-typescript | p08 | partial | T-NEW and T-CAST boxes stop above their conclusions |
| 1 | derek-dreyer | 2017-PLDI-repairing-sequential-consistency-in-c-c-11 | p09 | overlap | Def. 1 and Prop. 1 lists of named one-line constraints: every box sits one line above its own line, so boxes overlap their neighbours; IRREFLEXIVE-HB takes in the "Proposition 1" sentence, COHERENCE-RR's own line is in no box; NO-THIN-AIR is boxed but COHERENCE, ATOMICITY, SC in the same list are not (whether named one-line constraints count as rules is a call to make) |
| 1 | derek-dreyer | 2017-PLDI-repairing-sequential-consistency-in-c-c-11 | p11 | overlap | Def. 6 Power constraints: SC-PER-LOC, POWER-ATOMICITY, POWER-NO-THIN-AIR boxed one line off (POWER-ATOMICITY takes in PROPAGATION), OBSERVATION and PROPAGATION not boxed |
| 1 | ranjit-jhala | 2018-POPL-refinement-reflection-complete-verification-with-smt | p14 | overrun | Fig. 5: ∀-I box takes in ⇒-I stacked above it; ∀-E box takes in ⇒-E and ∨-E's conclusion; ∨-E box stops before its conclusion's second line |
| 1 | ranjit-jhala | 2018-POPL-refinement-reflection-complete-verification-with-smt | p14 | overlap | Fig. 5: ∧-R-E overlaps ∧-L-E's conclusion; ∨-R-I overlaps ∀-I; ∨-E overlaps ∀-E |
| 1 | lars-birkedal | 2019-POPL-iron-managing-obligations-in-higher-order-concurrent-separat | p10 | partial | tinv-open (Fig. 4): box ends about 200px short of the premise's right end, cutting the premise and the bar |
| 1 | derek-dreyer | 2022-PLDI-compass-strong-and-compositional-library-specifications-in-r | p05 | partial | Acq-Read box covers only "{⊒V ∗ ℓ ↦ h} ∗acq ℓ"; the whole postcondition to its right is outside; Rel-Write clips its closing brace |
| 1 | derek-dreyer | 2022-PLDI-compass-strong-and-compositional-library-specifications-in-r | p06 | partial | Abs-Hb-Enq (Fig. 2) box covers only the name and "SeenQueue(q,G0,M0) ∗ ⊒V ⊢"; both lines of the triple are outside |
| 1 | derek-dreyer | 2022-PLDI-compass-strong-and-compositional-library-specifications-in-r | p10 | overrun | Hist-Hb-Stack-Linearizable box also takes in the "interp(to, vs) ::= …" definition block under it (unsure) |
| 1 | derek-dreyer | 2022-PLDI-compass-strong-and-compositional-library-specifications-in-r | p12 | partial | Hb-Exchange (Fig. 5) box stops after the first postcondition line; the ∨ case block and the red local postcondition below are outside; Hb-Push and Hb-Pop right edges clip the closing ⟩ |
| 1 | derek-dreyer | 2022-PLDI-compass-strong-and-compositional-library-specifications-in-r | p12 | overlap | Hb-Push/Hb-Pop/Hb-Exchange stacked edge to edge; Hb-Pop tab inside Hb-Push, Hb-Exchange tab over Hb-Pop's second line (minor) |
| 1 | derek-dreyer | 2022-PLDI-compass-strong-and-compositional-library-specifications-in-r | p13 | overrun | VA-intro box also takes in the separate unnamed "objective(@V P)" to its left (unsure) |
| 1 | derek-dreyer | 2022-PLDI-compass-strong-and-compositional-library-specifications-in-r | p13 | partial | AT-Rel-Write and AT-Acq-Read right edges clip closing braces (minor) |
| 1 | derek-dreyer | 2023-OOPSLA-stuttering-for-free | p20 | overlap | BSim box spans both lines and contains the FSim box |
| 1 | robbert-krebbers | 2023-PLDI-beyond-backtracking-connections-in-fine-grained-concurrent-s | p19 | partial | biabd-def: scope arrows above the formula stick out of the box top (minor) |
| 1 | lars-birkedal | 2023-OOPSLA-spirea-a-mechanized-concurrent-separation-logic-for-weak-per | p09 | overlap | mapsto-store-lb box runs right into MAPSTO-LB-PERS, taking in its conclusion "ℓ ↪na σ⃗" and overlapping its box; its tab hides the printed name |
| 1 | lars-birkedal | 2023-OOPSLA-spirea-a-mechanized-concurrent-separation-logic-for-weak-per | p09 | partial | mapsto-lb-pers box stops after the premises, its conclusion left out |
| 1 | lars-birkedal | 2023-OOPSLA-spirea-a-mechanized-concurrent-separation-logic-for-weak-per | p09 | overrun | pfs-pf box reaches over the heading "Rules for the post-crash modality" and into REC-IN-IF-REC |
| 1 | lars-birkedal | 2023-OOPSLA-spirea-a-mechanized-concurrent-separation-logic-for-weak-per | p09 | partial | rec-in-if-rec box starts too far right, cutting off "RE" of the name and the start of "crashedIn"; overlaps pfs-pf |
| 1 | lars-birkedal | 2023-OOPSLA-spirea-a-mechanized-concurrent-separation-logic-for-weak-per | p10 | partial | Ht-na-alloc, Ht-at-alloc, Ht-na-read right edges clip the closing "}" (minor) |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p06 | partial | awkward-spec box leaves out the first line "{True}" and the postcondition's left brace |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p12 | partial | VAE-spec box leaves out the first line "(\|True\|)" and the left bracket, as awkward-spec on p06 |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p16 | partial | wbwp-definition box covers only the second line; leaves out "wbwp e (\|Φ\|)^O ≜ ∀S. AllStacksExcept(S,O) −∗" (and it is a definition, not a rule) |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p25 | overrun | stacksIN-agree box spans three labelled lines: stacksIN-agree, stacks•IN-unique, stacks∘IN-unique |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p25 | overlap | stacksIN-update box crosses the bottom of stacksIN-agree; stacksIN-create box and tab cross the bottom of stacksIN-update |
| 2 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | p07 | partial | Ht-send, Ht-recv: right edge cuts through the closing brace |
| 2 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | p13 | overrun | RC-init-alloc box takes in the heading "Server Setup Specifications:" |
| 2 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | p13 | partial | Ht-reliable-send, Ht-reliable-try-recv: right edge clips the closing brace |
| 2 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | p20 | overrun | RPC-init-alloc box takes in the heading "RPC Specifications:" |
| 2 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | p24 | partial | write-spec (and slightly follower-read-spec): right edge cuts off the closing brace |
| 2 | isil-dillig | 2022-OOPSLA-synthesis-powered-optimization-of-smart-contracts-via-data-t | p13 | overlap | Stale1/NStale and NStale/Hole boxes share or slightly cross their vertical edges |
| 2 | robbert-krebbers | 2023-OOPSLA-proof-automation-for-linearizability-in-separation-logic | p19 | partial | AU-ACCESS-DIAFRAME leaves out the last line ("⇛ match mv with None ⇒ … end") |
| 2 | lars-birkedal | 2024-POPL-an-axiomatic-basis-for-computer-programming-on-the-relaxed-a | p14 | partial | HT-MICRO-MEMREAD-RDEP-EXT stops after "MemRead os vr x d": whole postcondition and closing brace left out |
| 2 | lars-birkedal | 2024-POPL-an-axiomatic-basis-for-computer-programming-on-the-relaxed-a | p19 | partial | HT-INS-STR-PLN-ARTIFICIALDATA, HT-INS-LDR-PLN-EXT: right edge cuts the precondition's closing brace |
| 2 | lars-birkedal | 2024-POPL-an-axiomatic-basis-for-computer-programming-on-the-relaxed-a | p28 | partial | HT-MICRO-MEMWRITE ends mid-precondition; leaves out "MemWrite os vr x v d", the postcondition and braces |
| 2 | lars-birkedal | 2024-POPL-an-axiomatic-basis-for-computer-programming-on-the-relaxed-a | p29 | partial | HT-MICRO-MEMREAD-RDEP-EXT-LOCAL leaves out both right braces, a trailing "∗" and the tid,Φ subscript |
| 2 | isil-dillig | 2018-POPL-verifying-equivalence-of-database-driven-applications | p15 | overrun | Inductiveness box takes in the prose line after it and touches the Sufficiency box |
| 2 | isil-dillig | 2018-POPL-verifying-equivalence-of-database-driven-applications | p18 | overrun | Πσ introduction box covers axioms 10 and 11; tab covers axiom 9 |
| 2 | lars-birkedal | 2026-OOPSLA-lawyer-modular-obligations-based-liveness-reasoning-in-highe | p05 | partial | noms-exchanges-fuel, noms-increases-eb stop at the bar; conclusions left out |
| 2 | lars-birkedal | 2026-OOPSLA-lawyer-modular-obligations-based-liveness-reasoning-in-highe | p09 | partial | oms-exchanges-fuel, oms-increases-eb cut off their conclusions |
| 2 | lars-birkedal | 2026-OOPSLA-lawyer-modular-obligations-based-liveness-reasoning-in-highe | p09 | overrun | oms-expects-ep takes in the sub-heading "Fuel burning, fork and the full transition of OM" |
| 2 | lars-birkedal | 2026-OOPSLA-lawyer-modular-obligations-based-liveness-reasoning-in-highe | p09 | overlap | oms-expects-ep crosses the top of om-forks and its tab |
| 2 | lars-birkedal | 2026-OOPSLA-lawyer-modular-obligations-based-liveness-reasoning-in-highe | p16 | overrun | MU-inv-alloc-simpl spans the full text width, taking in wrapped prose to its left |
| 2 | martin-t-vechev | 2016-OOPSLA-modeling-and-analysis-of-remote-memory-access-programming | p09 | overrun | R1, F1, GA, PG, CAS-F, LO, WS take in their group headings ("Reads-from relation:" …); no-C and IR do not |
| 2 | derek-dreyer | 2017-POPL-a-promising-semantics-for-relaxed-memory-concurrency | p09 | overlap | UPDATE box top covers the end of the WRITE-HELPER conclusion; SC-FENCE tab covers the end of WRITE |
| 2 | derek-dreyer | 2014-OOPSLA-gps-navigating-weak-memory-with-ghosts-protocols-and-separat | p52 | overrun | GetTicket box and tab cover parts of the MyAllCoherence and NewGhost lines |
| 2 | derek-dreyer | 2022-PLDI-rusthornbelt-a-semantic-foundation-for-functional-verificati | p05 | overrun | mutbor box takes in the next prose line |
| 2 | derek-dreyer | 2022-PLDI-rusthornbelt-a-semantic-foundation-for-functional-verificati | p10 | partial | LftL-borrow starts right of "▷P ⇛" and stops before "⇛∗ ▷P)"; LftL-bor-acc stops before "⇛∗ &αP ∗ [α]q)" |
| 2 | derek-dreyer | 2022-PLDI-rusthornbelt-a-semantic-foundation-for-functional-verificati | p10 | overlap | LftL-bor-acc box and tab cross LftL-borrow and hide its conclusion; mut-update tab hides "VOx(â)" of mut-agree |
| 2 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | p17 | overrun | Fig. 9 two-column axioms: ora-assoc, ora-comm, ora-core-id span the row and take in ORA-⊑-REFL, ORA-⊑-TRANS, ORA-⊑-OP |
| 2 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | p17 | overlap | ora-valid-mono reaches into the right column and crosses the ora-unit-valid box |
| 2 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | p17 | partial | ora-unit-valid covers only the label, not V(ε) |
| 2 | robbert-krebbers | 2026-PLDI-backwards-compatible-row-based-exceptions-in-ml | p07 | overlap | Fig. 2 packed tightly: Rec-Typed meets Exn-Typed/Raise-Typed, Let-Exn-Typed meets Match-Exn-Typed; Raise-Typed, Match-Exn-Typed and Sub-Typed tabs cover conclusions |
| 2 | robbert-krebbers | 2026-PLDI-backwards-compatible-row-based-exceptions-in-ml | p07 | overlap | Arrow-Sub box bottom and the Forall-Row-Intro-Sub tab run through Arrow-Sub's conclusion; Exn-Sub tab on the bottom of Row-Sub |
| 2 | robbert-krebbers | 2026-PLDI-backwards-compatible-row-based-exceptions-in-ml | p14 | partial | Inv-Open right edge cuts the closing "}" and trailing "∗"; Fork-R's trailing "∗" also outside |
| 2 | robbert-krebbers | 2026-PLDI-backwards-compatible-row-based-exceptions-in-ml | p18 | overlap | Exn-Map-Proj box and tab cross the bottom of Exn-Map-Agree and cover its conclusion |
| 3 | derek-dreyer | 2013-ICFP-unifying-refinement-and-hoare-style-reasoning-in-a-logic-for | p06 | overrun | ACSQ box also takes in the table of seven unnamed atomic-triple axioms above it; its right edge cuts the CAS lines. |
| 3 | derek-dreyer | 2013-ICFP-unifying-refinement-and-hoare-style-reasoning-in-a-logic-for | p06 | overrun | AIN box reaches down into the "Derived rules" heading. |
| 3 | lars-birkedal | 2011-POPL-step-indexed-kripke-models-over-recursive-worlds | p06 | partial | ∀-INTRO box clips "∀ξ.τ" at the right and leaves the side condition "ξ ∉ Δ" outside. |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p05 | partial | wp-conj0 box stops just under the bar; the conclusion "wp t1{Q1} ∧ wp t2{Q2} ⊢ wp (t1+t2){Q1∧Q2}" is outside. |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p08 | partial | wp-proj (WP-PROJi) box covers only the name and premise; the conclusion "Πi.P ⊢ wp t′ {Πi.Q}" is outside. |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p08 | overlap | A blue "proj( )" box on WP-PROJi's conclusion and side condition proj(t) overlaps the wp-proj box and hides its premise under its tab; proj(t) is a side condition, not a rule (also extra). |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p09 | partial | wp-idx-post0 and wp-idx-swap0: side conditions "j ∉ supp(t)" and "i ∉ idx(Q)" right of each bar are outside the boxes. |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p17 | partial | wp-proj (WP-PROJ): side condition "I = supp(t1)" right of the bar is outside the box. |
| 3 | alex-aiken | 2018-PLDI-active-learning-of-points-to-specifications | p04 | partial | assign: box cuts through the conclusion "x →Assign y", whose bottom is outside, partly under the "load" tab. |
| 3 | alex-aiken | 2018-PLDI-active-learning-of-points-to-specifications | p04 | partial | allocation: box ends just below the "New" label; conclusion "x → o" is cut off, under the "backwards" tab. |
| 3 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | p06 | partial | ru-start-spec box leaves out the "(k,V)∈m" subscript and closing bracket of the postcondition. |
| 3 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | p06 | partial | ru-commit-spec box covers only the name and first precondition line; the rest of the precondition, "commit c" and the postcondition are outside. |
| 3 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | p11 | partial | rc-start-spec cuts off the "(k,V)∈m" subscript and closing bracket; rc-write-spec's right edge clips "Some v⟩". |
| 3 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | p11 | partial | rc-commit-spec ends after "v. ConnectionState(c, CanStart) ∗"; the two-case postcondition disjunction is outside. |
| 3 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | p16 | partial | si-commit-spec ends after "v. ConnectionState(c, CanStart) ∗" (postcondition disjunction outside, precondition bracket sticks out right); si-write-spec's right edge cuts "True)"; si-read-spec clips the final "⟩". |
| 3 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | p22 | partial | Ht-read-handler box's right edge cuts the postcondition before its closing "}^srv". |
| 3 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | p29 | partial | Wait-spec and Weak-wait-spec boxes cover only name and precondition; "wait c k cond" and the postcondition below are outside. |
| 3 | robbert-krebbers | 2025-ICFP-verified-interpreters-for-dynamic-languages-with-application | p15 | partial | β-MATCH box ends at the bar; the conclusion "(λm.e1) {nonrec d} →μ e1[indirects α]" is outside. |
| 3 | robbert-krebbers | 2025-ICFP-verified-interpreters-for-dynamic-languages-with-application | p15 | overrun | bin-op box extends over the "Evaluation contexts:" heading and the K^deep ::= [e1,□,e2] grammar line. |
| 3 | robbert-krebbers | 2025-ICFP-verified-interpreters-for-dynamic-languages-with-application | p16 | partial | binop-eq-attr box leaves out the rule's last line "dom e = dom d and x1 ⊏ ... ⊏ xn cover dom e}". |
| 3 | alex-aiken | 2013-PLDI-terra-a-multi-stage-language-for-high-performance-computing | p04 | overrun | SLET box also takes in SAPP above it (top edge cuts SAPP's premises); SAPP has no box of its own. |
| 3 | alex-aiken | 2013-PLDI-terra-a-multi-stage-language-for-high-performance-computing | p04 | overrun | TYFUN2 box also takes in TYFUN1 (top edge cuts its premise "F̂(l) = Ṫ"); TYFUN1 has no box of its own. |
| 3 | lars-birkedal | 2024-ICFP-error-credits-resourceful-reasoning-about-error-bounds-for-h | p24 | overrun | step-simple box starts one line high and takes in the prose line "of the premises above the line holds):"; its tab sits on the line before. |
| 3 | lars-birkedal | 2024-ICFP-error-credits-resourceful-reasoning-about-error-bounds-for-h | p25 | partial | step-exp box misses the first premise row "red(ρ1) Pr_step(ρ1)[¬R] ≤ ε1 ∃r.∀ρ2.E2(ρ2) ≤ r" and its bottom edge runs into the next prose line. |
| 3 | derek-dreyer | 2020-POPL-the-future-is-ours-prophecy-variables-in-separation-logic | p15 | partial | RDCSS-SPEC-SEQ box starts at the RDCSS(...) line; the precondition {ℓm ↦ m ∗ ℓn ↦ n} above is left out. |
| 3 | derek-dreyer | 2020-POPL-the-future-is-ours-prophecy-variables-in-separation-logic | p16 | extra | Blue "phys_atomic(e)" box on the INV rule's premise line (a side condition), overlapping the inv box. |
| 3 | derek-dreyer | 2020-POPL-the-future-is-ours-prophecy-variables-in-separation-logic | p16 | partial | inv box's top edge runs through the premise {R ∗ P} e {v. R ∗ Q(v)}. |
| 3 | derek-dreyer | 2020-POPL-the-future-is-ours-prophecy-variables-in-separation-logic | p17 | partial | RDCSS-SPEC-IDEAL and RDCSS-SPEC boxes start at the RDCSS(...) line and leave out the precondition line above each. |
| 3 | isil-dillig | 2023-PLDI-automated-detection-of-under-constrained-circuits-in-zero-kn | p13 | partial | Op (Fig. 9) box's bottom edge cuts through the conclusion Δ ⊢ e1 ⊙ e2 : {v1 ⊙ v2 \| (v1,v2) ∈ Ω1 × Ω2}. |
| 3 | alex-aiken | 2014-PLDI-first-class-runtime-generation-of-high-performance-types-usi | p06 | overlap | TYCTOR/TYUNWRAP/TYEXOAPP boxes are stacked with each tab inside the box above; LCTX and LERROR tabs cover the C′ grammar line. |
| 3 | alex-aiken | 2018-POPL-on-automatically-proving-the-correctness-of-math-h-implement | p09 | partial | R3 box's bottom edge cuts through the last where-line "K′ = K2[e1 ⊛ e2 ↦ (A′δ, false)]". |
| 4 | derek-dreyer | 2010-POPL-a-relational-modal-logic-for-higher-order-stateful-adts | p09 | overrun | POP-MONO box also takes in the line below it, "p ∝ a.(B′,H′) ∈ C.L", which is the first premise of ∝-INTRO |
| 4 | isil-dillig | 2011-POPL-precise-reasoning-for-programs-using-containers | p06 | partial | Update box stops at the bar's right end and leaves out the rule's side condition "(⊗ ∈ {◇, ♣})" printed just right of the conclusion (minor) |
| 4 | derek-dreyer | 2013-ICFP-mtac-a-monad-for-typed-tactic-programming-in-coq | p06 | overlap | the extra signature-table boxes cross each other (mfix/mmatch rows, is_var/is_evar rows) |
| 4 | derek-dreyer | 2015-POPL-iris-monoids-and-invariants-as-an-orthogonal-basis-for-concu | p04 | partial | RET box's bottom edge runs through the conclusion text "{v. v = w}", cutting off the lower half; FRAME box's bottom edge also grazes the conclusion "{P ∗ R} e {v. Q ∗ R}" (minor) |
| 4 | derek-dreyer | 2015-POPL-iris-monoids-and-invariants-as-an-orthogonal-basis-for-concu | p09 | partial | STS box's bottom edge cuts the subscript E⊎{ι} off the conclusion (minor) |
| 4 | lars-birkedal | 2017-POPL-a-relational-model-of-types-and-effects-in-higher-order-conc | p05 | overrun | The ACSQ box's top edge sits one text line too high: it takes in the prose line "consequence." (the end of the sentence "Iris features the following atomic rule-of-consequence.") above the rule. |
| 4 | derek-dreyer | 2018-POPL-rustbelt-securing-the-foundations-of-the-rust-programming-la | p23 | partial | LftL-borrow box stops before the final "⇛* ▷P)"; LftL-bor-acc box stops after "[κ]_q" and leaves out "⇛* ▷P * (▷P ⇛* &full P * [κ]_q)"; LftL-reborrow box stops after "&full P" and leaves out "⇛* &κ'full P * ([†κ'] ⇛* &κfull P)" (each box ends at the ⇛* update glyph) |
| 4 | derek-dreyer | 2018-POPL-rustbelt-securing-the-foundations-of-the-rust-programming-la | p27 | partial | LftL-na-acc box stops at the ⇛* glyph and leaves out "⇛* ▷P * (▷P ⇛* [κ]_q * [Na:t])" |
| 4 | ranjit-jhala | 2019-PLDI-fact-a-dsl-for-timing-sensitive-computation | p08 | partial | The Tr-Br-If box's bottom edge cuts off the last line of the conclusion ("S1'; S2' }"), which sits below the box. |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p04 | extra | box "atomic(e)" drawn on the side condition atomic(e) on SC-CInv-Acc's premise line (not a rule) |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p04 | overlap | extra "atomic(e)" box crosses the SC-CInv-Acc box interior |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p04 | partial | SC-CInv-Acc box's top edge sits mid-premise: it cuts off the rule name "SC-CInv-Acc" and the top half of the premise {P} e {v. I * Q} |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p18 | extra | box "atomic(e)" drawn on the side condition on Raw-CInv-Acc's premise line |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p18 | overlap | extra "atomic(e)" box crosses the Raw-CInv-Acc box |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p18 | partial | Raw-CInv-Acc box's top edge cuts through the premise and leaves out the rule name "Raw-CInv-Acc" |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p20 | partial | Raw-CInv-Model-Update box ends after "PartialV(q,Vtok)" and leaves out the ⇛ and the whole right-hand side "FullV(V' ⊔ Vi) * PartialV(q, V' ⊔ Vtok)" |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p26 | extra | two "atomic(e)" boxes drawn on the side conditions of SC-LftL-at-Acc and Rlx-LftL-at-Acc |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p26 | overlap | each "atomic(e)" box crosses its rule's box (SC-LftL-at-Acc, Rlx-LftL-at-Acc) |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p26 | partial | SC-LftL-at-Acc and Rlx-LftL-at-Acc boxes start mid-premise, cutting off the rule name and the upper part of the premise |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p27 | partial | LftL-full-acc and LftL-full-ret boxes stop at the ⇛ and leave out the right-hand side ("P * Ret(κ,P,q)" and "&full P * [κ]q") |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p17 | other | L-Order box actually covers the WAIT rule body plus the L-ORDER label; L-ORDER's own rule (IsEdge(e) / LockOrder(e,N) ∈ H, to the right of its label) is outside the box. The label was paired with the rule to its left, not its right |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p17 | other | Min-Atom box covers the MIN-LOCK rule body plus the MIN-ATOM label; MIN-ATOM's own rule (this.fld ∈ F / ¬a_fld ∈ S) is outside the box. Same left/right label mix-up |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p38 | partial | Reg-Frag-1 box covers only the REG-FRAG-1 label and the left line-number margin; the rule body (Exit(v) ≡ goto l … / L,(F,E) ⊢ v ↪ v') is outside the box |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p38 | partial | CCR-Statement box covers only the CCR-STATEMENT label and the line-number margin; the rule (G ≡ (F,E) … / S,G ⊢ s ⇝ s'1;…;s'n) is outside the box |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p38 | other | Frag-Stmt box covers the FRAG-STMT label plus the top premises of the SIG rule (SigOp(s) …, s'' = s'[ExplSig…]); FRAG-STMT's own rule (Frag(s) … / (L,A,P),G ⊢ s ⇝ s'') is outside it |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p38 | overlap | Frag-Stmt box and Sig box cross each other (Sig box's top-right corner is inside the Frag-Stmt box) |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p38 | other | CCR box covers METHOD's rule body (S,G ⊢ ci ⇝ c'i / S,G ⊢ m(v){…} ⇝ …) plus the CCR label; CCR's own rule (right of its label) is outside the box |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p38 | overrun | Fld-1 box spans both FLD-1 and FLD-2 (the FLD-2 label and its whole rule are inside the Fld-1 box) |
| 4 | derek-dreyer | 2022-OOPSLA-bff-foundational-and-automated-verification-of-bitfield-mani | p09 | extra | blue box "is_mask(𝑡2)" drawn over the premise row of the Ty-mask rule; is_mask(t2) is a premise, not a rule. Its tab also covers the spot where the rule's name label sits |
| 4 | derek-dreyer | 2022-OOPSLA-bff-foundational-and-automated-verification-of-bitfield-mani | p09 | partial | Ty-mask box starts partway down the premise row (top edge runs through the premise text "e1 ▷e t1@bf_term…"), so the name label and the top of the premises are outside the box |
| 4 | derek-dreyer | 2022-OOPSLA-bff-foundational-and-automated-verification-of-bitfield-mani | p09 | overlap | the is_mask(𝑡2) box and the Ty-mask box cross over the premise row |
| 4 | derek-dreyer | 2022-OOPSLA-bff-foundational-and-automated-verification-of-bitfield-mani | p14 | overrun | Fig. 6 is a table with one named rule per row. The "Ty-concat" box covers three rows (Ty-merge, Ty-set, Ty-concat), and the "Ty-clear" box covers two rows (Ty-not, Ty-clear) |
| 4 | derek-dreyer | 2022-OOPSLA-bff-foundational-and-automated-verification-of-bitfield-mani | p18 | overlap | the purple "is_mask(mask)" box spans the whole conclusion row of all four rules and crosses the two orange is_mask(𝑡) boxes. The right orange box also cuts off the first premise is_mask(v) |
| 4 | ranjit-jhala | 2024-POPL-mechanizing-refinement-types | p54 | partial | FT-PRIM box is a thin strip (about y 708-728) through the middle of the conclusion "Γ ⊢F c : ⌊ty(c)⌋" and the name "FT-PRIM": the top half of the name and the bottom of the conclusion fall outside the box |
| 4 | robbert-krebbers | 2024-PLDI-a-proof-recipe-for-linearizability-in-relaxed-memory-separat | p11 | overrun | OmoAuth-Insert-Last box runs down past its conclusion and takes in the section heading "Proof rules for read-only events (§3.3):" |
| 4 | robbert-krebbers | 2024-PLDI-a-proof-recipe-for-linearizability-in-relaxed-memory-separat | p11 | overrun | OmoAuth-Insert-Ro box runs down past its conclusion and takes in the heading "Proof rule for general write events (§3.4):" |
| 4 | robbert-krebbers | 2024-PLDI-a-proof-recipe-for-linearizability-in-relaxed-memory-separat | p15 | partial | Stack-Try-Pop-Spec-Comp box ends after the first conclusion line ("v. ··· * Token(γo,e) *"); the rest of the conclusion (⟨H, omo. Stack(...)⟩ try_pop(s) and the two disjunct lines) is outside the box |
| 4 | robbert-krebbers | 2024-PLDI-a-proof-recipe-for-linearizability-in-relaxed-memory-separat | p15 | partial | OmoLoc-CAS box covers only the name and premise; the bar and the whole three-line conclusion (⟨H,omo. ℓ↦(H,omo)⟩ CAS^o(ℓ,vr,vw) ⟨b. ...⟩) are outside it |
| 4 | lars-birkedal | 2026-OOPSLA-mixtris-mechanised-higher-order-separation-logic-for-mixed-c | p09 | partial | In Fig. 5's top row, Wp-load's box covers only the "WP-LOAD" name; Wp-store's box covers name and premise but stops above the bar; Wp-free's box stops partway through the conclusion; Wp-alloc's box leaves out its own "WP-ALLOC" name |
| 4 | lars-birkedal | 2026-OOPSLA-mixtris-mechanised-higher-order-separation-logic-for-mixed-c | p09 | overrun | Wp-alloc's box is a thin strip across the whole conclusion row, taking in the conclusions of Wp-load (wp !ℓ ...), Wp-store (wp ℓ ← w ...) and Wp-free (wp free ℓ {True}); its edges also cut through that text |
| 4 | lars-birkedal | 2026-OOPSLA-mixtris-mechanised-higher-order-separation-logic-for-mixed-c | p09 | overlap | Wp-alloc strip crosses the lower part of the Wp-free box |
| 4 | lars-birkedal | 2026-OOPSLA-mixtris-mechanised-higher-order-separation-logic-for-mixed-c | p17 | partial | Wp-new-sync box's right edge cuts off the closing brace "}" of the postcondition (minor) |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p14 | overrun | RD-Assign box spans the whole bottom row of axioms, taking in the RD-Lock and RD-Unlock axiom bodies ("[τ↦H] lock l [...]" and "[τ↦H] unlock l [...]"); it should cover only "RD-Assign / [emp] x:=e [ok: emp]" |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p14 | partial | RD-Lock and RD-Unlock boxes cover only the name labels; their axiom lines (below the names) are outside their boxes (inside the RD-Assign box instead). The RD-Lock box also has the RD-Assign box's top edge running through its label |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p14 | overlap | RD-Lock and RD-Unlock boxes overlap the RD-Assign box |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p24 | partial | SV-Acq, SV-Rel, SV-Acq-G and SV-Rel-G boxes' right edges sit on or just inside the closing "]" of each postcondition, so the final bracket is clipped/hidden (minor) |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p25 | overlap | The same derivation boxes cut through the formulas and overlap each other: SeqEr/ParEr/Cons are stacked across the middle derivation, and the ParEr and Cons tabs cover formula text |
| 5 | viktor-vafeiadis | 2015-POPL-common-compiler-optimisations-are-invalid-in-the-c11-memory | p11 | overrun | The same OW-adj box spans both columns, taking in the left column's "Repeated Read. The first transformation we consider is eliminat-..." prose and the 5.1 section heading line |
| 5 | lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p09 | overrun | P-Var box takes in the "Path typing" section heading above the rule |
| 5 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p12 | wrong-name | Box tabbed "T-Read" covers the T-While rule (while ... → if ...) plus T-Read's premise line; T-Read's bar, conclusion and name sit outside it |
| 5 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p12 | partial | T-ReadL box cuts off its premise (s'=s[a↦s(e)] is at the top edge, under the tab); T-Write box holds only the conclusion line, with its premise, bar and (T-Write) name above it |
| 5 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p12 | overlap | Boxes and tabs overlap in Fig. 4: T-ReadL/T-CAS0, T-CAS0/T-FAA (FAA tab over the CAS0 conclusion), T-CAS1 tab over the T-Read conclusion, T-Fence/P-Step (P-Step tab over the "fence" conclusion), M-Read*/M-RMW* (RMW tab over the Read* conclusion), M-RMW*/M-BProp* (BProp* tab over the RMW* conclusion) |
| 5 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p13 | partial | SilentP box's left edge is right of its conclusion's start, so "P, S" of the conclusion is outside the box |
| 5 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p13 | overlap | SilentM tab sits on SilentP's conclusion ("P, S ... M, PB, B ⇒") |
| 5 | derek-dreyer | 2021-PLDI-refinedc-automating-the-foundational-verification-of-c-code | p04 | partial | side conditions printed right of the rules are outside the boxes: T-goto ("Σ = (C, (ℓ,n), ∃x. τ(x);H(x))"), T-assign ("p1 = K[ℓ1]"), T-return ("Σ = ..."), T-annotS ("p = K[ℓ]") |
| 5 | derek-dreyer | 2021-PLDI-refinedc-automating-the-foundational-verification-of-c-code | p05 | partial | T-cas box stops at the bar and its conclusion "⊢EXPR CAS(e1,e2,e3) {v,τ. G(v,τ)}" is outside; side condition "p = K[ℓ]" is outside the boxes of T-use and T-addr-of |
| 5 | lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | p14 | partial | INV-OPEN-CLWP box stops after the second premise; the third premise "e is atomic" and the right end of the bar are outside the box |
| 5 | lars-birkedal | 2021-POPL-mechanized-logical-relations-for-termination-insensitive-non | p18 | partial | MWP-bind-gen box covers only the name and the first premise BindCond(a,a',f,g); the second premise (mwp ... K[v] ...), the bar and the conclusion mwp K[e] {Φ} are outside |
| 5 | ranjit-jhala | 2012-PLDI-deterministic-parallelism-via-liquid-effects | p07 | partial | T-UNFOLD box starts at the third premise line. The first two premise lines ("Γ ⊢ v : {ν : ref(l̃, i_y) \| ν ≠ 0}" and "h = h0 ∗ l̃ ↦ n_k:τ_k, i⁺:τ⁺") are outside the box, and the tab sits on the second line. |
| 5 | lars-birkedal | 2026-PLDI-iris-wasmfx-modular-reasoning-for-wasm-stack-switching | p17 | partial | ewp-contnew box covers only the name and the premise "F.inst.types[i] = ft". The full-width bar and the 3-line conclusion "ewp [ref.func addr; cont.new i] ; F ⟨Ψ⟩ {w F', ∃kaddr ...}" are outside it |
| 5 | ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | p12 | partial | R-Loop-Upd box covers only the name and premises and stops above the inference bar; the conclusion (Γ, Δ, [for q in Q do A end]_p ∥ ∏q:Q.[B;C]_q, Ψ ⇝ Γ, Δ', ∏q:Q.[C]_q, Ψ') is left outside |
| 5 | ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | p13 | partial | R-Recv-Unfold box's bottom edge runs through the middle of the last conclusion line (Γ,Δ,([x ← recv(q*,t)]_p ∥ ∏q:Q'\{q}.A ∥ [A]_q*),Ψ), so that line is cut in half |
| 5 | ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | p13 | overlap | R-Send-Unfold and R-Recv-Unfold boxes are stacked with no gap: the R-Recv-Unfold tab covers the start of R-Send-Unfold's second conclusion line. R-Recv-Unfold's right edge also touches R-Compose-Resid's left edge |
| 5 | ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | p14 | overlap | R-While-Repeat/R-if-then and R-While-Remove/R-if-else boxes touch with no gap: the R-if-then and R-if-else tabs sit on top of the last conclusion lines of R-While-Repeat (Γ',Δ',[while true do A end]_p ∥ [C]_q, Ψ') and R-While-Remove (Γ',Δ',[C]_q, Ψ'), hiding their start |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p12 | partial | The T-If2 box holds only the premise, bar and label. Its conclusion "if (v) then C1 else C2 → C" is below the box, partly under the T-Write tab. |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p12 | overlap | The T-CAS0 box's top-right corner touches or slightly overlaps the bottom-left of the T-FAA box. The rules are packed tight (T-Let1/T-If1 and T-Read/T-CAS0 edges nearly touch too). |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p21 | overlap | The Fig. 10 table boxes overlap and nest: tso-rf2 overlaps tso-rf1 and nvo-loc, nvo-loc overlaps nvo-wu-fofl and nvo-fofl-d, and all sit inside tso-mo. |
| 5 | sumit-gulwani | 2019-OOPSLA-on-the-fly-synthesis-of-edit-suggestions | p20 | overlap | The BP-threshold box (table header and first row) overlaps the BP-transient box (next rows). |
| 6 | lars-birkedal | 2011-ICFP-a-kripke-logical-relation-for-effect-based-program-transform | p05 | partial | Fig. 1: the bottom edge runs through the conclusion (cut off or under the next tab) for T-Ax, T-Unit, T-Int, T-Pair, T-Proji, T-Fix, T-App, T-Alloc, T-Deref. |
| 6 | lars-birkedal | 2011-ICFP-a-kripke-logical-relation-for-effect-based-program-transform | p05 | partial | T-Sub box leaves out the side condition "(FRV(ε2) ⊆ Π)" on its right. |
| 6 | alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p08 | partial | The E-Unpack box covers only the "[E-Unpack]" label and the premise M' = M[ρ1/r1,…]; it leaves out the other premises, the bar and the conclusion. |
| 6 | alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p08 | overrun | The E-Reduce box and its tab start on E-Write's conclusion line (write(e1,e2) ↦ l, E'++…), covering it. |
| 6 | derek-dreyer | 2013-POPL-the-power-of-parameterization-in-coinductive-proof | p06 | overlap | Fig. 4: INCL, REFL, IF and APPV boxes share edges; the IF tab is inside the INCL box and covers the start of INCL's conclusion "(e,e') ∈ r^ctx"; the APPV tab sits on IF's bottom. |
| 6 | isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p04 | partial | Int: the box's bottom edge runs through the conclusion "Ψ ⊢i e : e′" and the Bool 2 tab sits on it. |
| 6 | isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p05 | overrun | Com: the box stretches across the column gap into the right-column prose ("false under Ψ … (R;C)⊗P", "The If 3 rule describes…"). |
| 6 | isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p05 | partial | If 3: the box covers only the first two premises, missing the third premise, the bar, the conclusion and the "(If 3)" label; it also reaches into right-column prose and the top of If 4. |
| 6 | isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p05 | partial | If 4: the box starts at the second premise; "Ψ ⊢ e : e′" and most of "Ψ∧e ⊢ L⊗P : S1" are outside. |
| 6 | isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p05 | overlap | If 3's box crosses the top of the If 4 box and its tab. |
| 6 | sumit-gulwani | 2015-OOPSLA-automating-grammar-comparison | p09 | overlap | The TESTCASES box and tab overlap the bottom of INDUCT and cover the start of INDUCT's conclusion ("C ⊢ α op β"). |
| 6 | isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p05 | partial | Minor: the right end of the bar sticks a few pixels out of the Step and Consq boxes. |
| 6 | isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p07 | partial | Minor: the right end of Flatten's bar sticks out of its box. |
| 6 | ranjit-jhala | 2019-PLDI-lazy-counterfactual-symbolic-execution | p08 | partial | Let box stops after "(let x = e1 in e2, H, P) ↪"; the second conclusion line "(e2′, H{x′ = e1′}, P)" is outside. |
| 6 | ranjit-jhala | 2019-PLDI-lazy-counterfactual-symbolic-execution | p08 | overrun | App-Lam box's top takes in Let's second conclusion line. |
| 6 | ranjit-jhala | 2019-PLDI-lazy-counterfactual-symbolic-execution | p08 | overlap | Tabs cover the conclusion above: Var-Red (App-Lam tab), App (Pr-L), Pr-L (Pr, Case-Ev), Case-Ev (Case-Sym), Ch-L (Assume-Ev), Assert-Ev (Assert-Crash). |
| 6 | martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p19 | partial | ite-q box covers only the premise line and the bar; the conclusion (Γc, Γ ⊢ if ec then et else ef …) is outside. |
| 6 | martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p19 | overlap | Boxes share edges: const/var/var-const; !W/W/!C; C's top edge and tab sit on the bottoms of !W and W; rev and call-rev touch, call-rev's tab inside the rev box. |
| 6 | martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p22 | partial | func-eval box in Fig. 34(b) is a thin strip around the bar only, cutting through the built-in-eval conclusion above and the C premise below. |
| 6 | martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p22 | overrun | var-const box (G.2.3) also takes in the heading line "G.2.3 [var-const]. The rule is". |
| 6 | ranjit-jhala | 2020-POPL-program-synthesis-by-type-guided-abstraction-refinement | p10 | overlap | Minor: stacked T-Var / T-Comp / T-App / T-Fun boxes share borders, each tab inside the box above; the T-Var tab overlaps the judgment box "Λ;Γ⊢E::t". |
| 6 | derek-dreyer | 2021-PLDI-transfinite-iris-resolving-an-existential-dilemma-of-step-in | p07 | partial | StoreT box starts below the rule's own "StoreT" label, which is hidden under the tab. |
| 6 | derek-dreyer | 2021-PLDI-transfinite-iris-resolving-an-existential-dilemma-of-step-in | p07 | overrun | StoreT box runs across the figure and takes in StoreS's conclusion line and the heading "Termination-preserving refinements in Refinement_SHL:"; the TPPureT tab falls inside it. |
| 6 | derek-dreyer | 2021-PLDI-transfinite-iris-resolving-an-existential-dilemma-of-step-in | p07 | partial | StoreS box ends at its bar; its conclusion "{ℓ ↦src v1 ∗ src(K[ℓ := v2])} e_t {v.Q}" falls inside the StoreT box instead (StoreS/StoreT overlap). |
| 6 | viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p18 | partial | T-Repeat box ends above its conclusion "repeat C →τ:ε if (C) then (repeat C) else 0". |
| 6 | viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p18 | partial | T-If2 box ends above its conclusion "if (v) then C1 else C2 →τ:ε C"; the T-Write tab sits on it. |
| 6 | viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p18 | partial | Minor: "nt" of "ntstore" in T-NTW's conclusion starts left of the box and is under the T-CAS0 tab. |
| 6 | lars-birkedal | 2023-PLDI-vmsl-a-separation-logic-for-mechanised-robust-safety-of-virt | p08 | partial | SS-mov box ends just below the bar; the conclusion (SSWP Normal @ i {...}) is outside and the edge cuts the reg/mem superscripts. |
| 6 | lars-birkedal | 2023-PLDI-vmsl-a-separation-logic-for-mechanised-robust-safety-of-virt | p10 | partial | SS-share box covers only the name and first premise line; premise lines 2–3, the bar and the SSWP conclusion are outside. |
| 6 | lars-birkedal | 2023-PLDI-vmsl-a-separation-logic-for-mechanised-robust-safety-of-virt | p10 | partial | SS-run box cuts through the second premise line (R0@0 ↦ Run) and leaves out the bar and the conclusion. |
| 6 | derek-dreyer | 2023-POPL-conditional-contextual-refinement | p13 | overlap | The CHL tab sits on the CHR box and covers the start of CHR's conclusion ("T ≲"); TKL does the same to TKR; CHR/CHL and TKR/TKL share borders. |
| 6 | lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p07 | overlap | Fig. 1 row boxes share borders and tabs cover rule text: rwp-store's hides the start of RWP-LOAD, rwp-frame's hides "∗ rwp" in RWP-MONO, rwp-val's part of RWP-RAND. |
| 6 | lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p21 | partial | ref-model-prog box covers only the label and "reducible(ρ1) reducible(m1)"; the other premises, the bar and the conclusion "m1 ≲ ρ1" are outside. |
| 6 | lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p27 | overrun | Lemma A.1 rows: rwp-pure takes in RWP-ALLOC, rwp-store takes in RWP-RAND, rwp-frame takes in RWP-TAPE-ALLOC. |
| 6 | lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p27 | overlap | Minor: row boxes share borders and tabs cover formula text (rwp-load, rwp-store hide "(ℓ ↦ v"; rwp-val the RAND row; rwp-frame the RWP-MONO row; rwp-coupl-rand the "Lemma A.2 (Model rules)" heading). |
| 6 | robbert-krebbers | 2024-POPL-deadlock-free-separation-logic-linearity-yields-progress-for | p11 | partial | The Sub-recv and Sub-send boxes end just below the bar, so each conclusion line (?(x1)⟨v1⟩{P1}; p1 ⊑ … and !(x1)⟨v1⟩{P1}; p1 ⊑ …) is cut off. |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p05 | overlap | link-qeue-ghost's tab covers part of make-ghost-link's formula ("d2 e2 v2 ⇛∗"); the two boxes share an edge. |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p05 | partial | The link-spec box's left edge cuts through the opening "{" of "{c ↣ prot ∗ d ↣ prot‾}". |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p19 | overrun | chan-symmetric box covers three lines: the unlabelled send and recv specs and the CHAN-SYMMETRIC line; it should cover only the last. |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p22 | overrun | proto-symmetric box covers both PROTO-RECV (2 lines) and the PROTO-SYMMETRIC line. |
| 6 | lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | p09 | partial | ht-frame: the right edge cuts the end of the conclusion "{Q ∗ R}"; the ht-inv-alloc and ht-inv-open tabs sit on the conclusions of ht-frame and ht-load. |
| 6 | lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | p11 | overlap | The ht-rand-tape tab and top edge sit over ht-alloc-tape's conclusion "{True} tape N {κ. κ ↪ (N,ε)}". |
| 6 | lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | p14 | overrun | err-split's box also covers the neighbouring rule ERR-1 (⚡(1) / False). |
| 6 | lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | p20 | overlap | spec-step-exp's tab and top edge sit on spec-step-err-1 and hide its conclusion "sstep σ ρ ε {Φ}"; its top edge also meets spec-step-ret and spec-step-continuous. |

### B. Extra boxes on non-rules (174 lines)

kind extra: boxes drawn on things that are not inference rules.

Recurring patterns (lines whose description matches; a line can match several):

- ≜ / ≝ / ≐ definitions (relations, predicates, invariants, protocols): 43
- grammar productions and syntax tables: 21
- table cells, rows and column headers: 36
- code, pseudocode, algorithms and program listings: 24
- diagrams, charts, plots and figure nodes: 23
- bulleted / labelled axioms and definition clauses (consistency conditions): 31
- derivation trees, proof steps and proof outlines: 20
- prose sentences and list items: 28
- equations, fractions and spec triples with an equation tag: 18
- names taken from a premise, subscript or arrow subscript: 8

| share | author | paper | page | kind | what is wrong |
|---|---|---|---|---|---|
| 1 | sumit-gulwani | 2010-OOPSLA-a-simple-inductive-synthesis-methodology-and-its-application | p04 | extra | "Inductive-SynthesisL(ϕ)" box covers the Figure 2 pseudocode |
| 1 | isil-dillig | 2011-PLDI-precise-and-compact-modular-procedure-summaries-for-heap-man | p05 | extra | "Program P" and "Function F" boxes on the §3 grammar, overlapping and misaligned |
| 1 | derek-dreyer | 2014-POPL-backpack-retrofitting-haskell-with-interfaces | p05 | extra | "stamps" box covers the definition "(stamps) K ν̄ ≝ μα.K ν̄ for some α∉fv(ν̄)", not a rule |
| 1 | derek-dreyer | 2014-POPL-backpack-retrofitting-haskell-with-interfaces | p26 | extra | "dspc" box covers the merge definition "dspc₁ ⊕ dspc₂ ≝ … where {…}" (§6.5); p40 mention links to it |
| 1 | derek-dreyer | 2014-POPL-backpack-retrofitting-haskell-with-interfaces | p27 | extra | "f:ftypm" box covers grammar right-hand sides in the §7.1 syntax table; p45 mention links to it |
| 1 | sumit-gulwani | 2015-OOPSLA-flashmeta-a-framework-for-inductive-program-synthesis | p16 | extra | two overlapping "N/A" boxes cover Table 1 rows (Gulwani [7]…Udupa et al. [37], Katayama [15]) |
| 1 | derek-dreyer | 2017-PLDI-repairing-sequential-consistency-in-c-c-11 | p08 | extra | "reads-before" and "happens-before" boxes cover relation definitions (rb ≜ rf⁻¹;mo, hb ≜ (sb∪sw)⁺) |
| 1 | derek-dreyer | 2017-OOPSLA-robust-and-compositional-verification-of-object-capability-p | p15 | extra | CanWrap (and IsRmon, IsWmon p17, IsMon p19, IsPrivval p21) are named ≜ definitions in rule figures; the paper calls IsPrivval a "rule", so possibly acceptable (unsure) |
| 1 | martin-t-vechev | 2018-PLDI-inferring-crypto-api-rules-from-code-changes | p08 | extra | "No-duplicates (fdup)" box covers prose in a list of filter conditions (tail of No-additions plus half of No-duplicates) |
| 1 | viktor-vafeiadis | 2018-POPL-effective-stateless-model-checking-for-c-c-concurrency | p09 | extra | "init" box covers Fig. 6 (SB litmus program and execution graph), name taken from the "[init]" node; spurious "[init]" mentions on p07, p19 |
| 1 | viktor-vafeiadis | 2018-POPL-effective-stateless-model-checking-for-c-c-concurrency | p12 | extra | "happens-before" box on the definition "G.hb ≜ (G.sb ∪ G.sw)⁺"; prose "happens-before" becomes mention links on p12, p14, p30 |
| 1 | viktor-vafeiadis | 2018-POPL-effective-stateless-model-checking-for-c-c-concurrency | p13 | extra | "SC-before" box on the G.scb definition and "sc-acyclicity" box on one bullet of Def. 3.7 (siblings COMPLETENESS, VALID MO, COHERENCE, ATOMICITY, SBRF unboxed) |
| 1 | ranjit-jhala | 2018-POPL-refinement-reflection-complete-verification-with-smt | p21 | extra | "where" box covers the PLE rows of the Fig. 9 algorithm table |
| 1 | viktor-vafeiadis | 2019-POPL-on-library-correctness-under-weak-memory-consistency-specify | p08 | extra | "MP-lib" box covers program code (right thread of the MP-lib litmus test) |
| 1 | viktor-vafeiadis | 2019-POPL-on-library-correctness-under-weak-memory-consistency-specify | p15 | extra | "P1" box covers the example client programs (P1) and (P2); bogus P1 mention links on p15, p16 |
| 1 | alex-aiken | 2020-PLDI-first-order-quantified-separators | p05 | extra | Table 1 cells boxed as rules "NP-complete", "k-depth", "k-prenex" (overlapping each other); the paper has no inference rules, so every mention link to them on p01, p02, p04, p05, p08, p09, p14 is spurious |
| 1 | alex-aiken | 2020-PLDI-first-order-quantified-separators | p06 | extra | "X V1" box on the Figure 2 structure tables m0/m1; spurious mention on the "X V1" header cell |
| 1 | robbert-krebbers | 2020-POPL-actris-session-type-based-reasoning-in-separation-logic | p14 | extra | "sort_protheadfg" and "sort_prottailfg" boxes cover protocol definitions (≜ μ(rec…)), not rules |
| 1 | viktor-vafeiadis | 2021-OOPSLA-making-weak-memory-models-fair | p14 | extra | "TSO-happens-before" and "RA-happens-before" boxes cover relation definitions (G.hb_TSO ≜ …, G.hb_RA ≜ …), two definitions each |
| 1 | isil-dillig | 2022-OOPSLA-type-directed-synthesis-of-visualizations-from-natural-langu | p13 | extra | "hCLS" box on the BERT architecture diagram (Fig. 15); p14 mention links to it |
| 1 | isil-dillig | 2022-OOPSLA-automated-transpilation-of-imperative-to-functional-code-usi | p17 | extra | "Application A", "Expression E", "Variable V", "Constant C" boxes on the Fig. 11 grammar |
| 1 | ranjit-jhala | 2022-OOPSLA-seq2parse-neurosymbolic-parse-error-repair | p11 | extra | Fig. 12 API/type-signature table: "PCFG", "partialParse", "predictDL", "predict" boxes, offset a row, partialParse and predictDL overlapping |
| 1 | ranjit-jhala | 2022-OOPSLA-seq2parse-neurosymbolic-parse-error-repair | p15 | extra | "Program 𝑃" box on Algorithm 2 pseudocode, cutting off lines 3–4 |
| 1 | ranjit-jhala | 2022-OOPSLA-seq2parse-neurosymbolic-parse-error-repair | p19 | extra | "Abstracted" and "NoPCFG" boxes on column-group headers of the Fig. 14 table |
| 1 | derek-dreyer | 2023-OOPSLA-stuttering-for-free | p19 | extra | "ii" box around the (i)/(ii)/(iii) list of implications in §5.3; gives "(ii)" mention links across the paper (p02, p06, p10–p13, p15–p17, p19, p20, p23, p25, p26) |
| 1 | derek-dreyer | 2023-OOPSLA-stuttering-for-free | p20 | extra | "BSim" and "FSim" boxes on the §6.1.1 simulation definitions |
| 1 | derek-dreyer | 2023-OOPSLA-stuttering-for-free | p21 | extra | "MSim" and "EFSim" boxes on the §6.1.2 simulation definitions |
| 1 | isil-dillig | 2024-OOPSLA-control-flow-deobfuscation-using-trace-informed-compositiona | p07 | extra | "Prog 𝑃", "Expr 𝐸", "Var 𝑉" boxes on the Fig. 5 grammar, each cutting across rows |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p03 | extra | (VAE-sts) is a state-transition diagram (circles and arrows), not a rule; the box is also a thin strip through the circles |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p18 | extra | (bad-concurrency) is a program, not a rule; box also covers only its second line |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p21 | extra | (VAE-check) is a one-line program, not a rule |
| 2 | zhendong-su | 2025-OOPSLA-api-guided-dataset-synthesis-to-finetune-large-code-models | p23 | extra | "CodeLlama-7b" box on Table 8 cells |
| 2 | viktor-vafeiadis | 2019-POPL-grounding-thin-air-reads-with-event-structures | p05 | extra | Coh-ES box on an event-structure diagram, also cutting off the St(X,1)/St(X,2) row |
| 2 | viktor-vafeiadis | 2019-POPL-grounding-thin-air-reads-with-event-structures | p11 | extra | "non-initialization" box on a prose bullet of Definition 2 |
| 2 | viktor-vafeiadis | 2019-POPL-grounding-thin-air-reads-with-event-structures | p11 | extra | Synchronizes-with, Happens-before are relation definitions (≜); Synchronizes-with also misses its second line |
| 2 | isil-dillig | 2023-OOPSLA-automated-translation-of-functional-big-data-queries-to-sql | p09 | extra | "Aggregate G" box on the Fig. 7 grammar; tab covers "Sub-sketch" |
| 2 | isil-dillig | 2018-POPL-verifying-equivalence-of-database-driven-applications | p15 | extra | "Sufficiency", "Inductiveness" boxes on numbered proof conditions (1), (2) |
| 2 | isil-dillig | 2018-POPL-verifying-equivalence-of-database-driven-applications | p18 | extra | "Πσ introduction" box on a numbered list of equational axioms (Fig. 11); if these count, the other 10 are missed |
| 2 | lars-birkedal | 2026-OOPSLA-lawyer-modular-obligations-based-liveness-reasoning-in-highe | p05 | extra | two "NOM" boxes on the arrow subscript in the conclusions of NOMS-EXCHANGES-FUEL and NOMS-INCREASES-EB, overlapping those rules |
| 2 | lars-birkedal | 2026-OOPSLA-lawyer-modular-obligations-based-liveness-reasoning-in-highe | p09 | extra | two "OM" boxes on the conclusions of OMS-EXCHANGES-FUEL, OMS-INCREASES-EB (same as p05) |
| 2 | lars-birkedal | 2026-OOPSLA-lawyer-modular-obligations-based-liveness-reasoning-in-highe | p14 | extra | nondet-inv is an invariant definition (≜), not a rule |
| 2 | martin-t-vechev | 2016-OOPSLA-modeling-and-analysis-of-remote-memory-access-programming | p05 | extra | "wa" box on a row of the Fig. 3 litmus-test header; stray mention links on sub-figure captions a)–d) |
| 2 | derek-dreyer | 2017-POPL-a-promising-semantics-for-relaxed-memory-concurrency | p12 | extra | sb-loc, release-seq, to-be-released, sync, happens-before are relation definitions; boxes and tabs overlap each other and hide the text |
| 2 | derek-dreyer | 2017-POPL-a-promising-semantics-for-relaxed-memory-concurrency | p13 | extra | WW/RW/WR/RR-coherence, No-promises are bullet-list consistency axioms; tabs hide text; Atomicity and SC left unboxed |
| 2 | derek-dreyer | 2014-OOPSLA-gps-navigating-weak-memory-with-ghosts-protocols-and-separat | p26 | extra | "∀tF" box on an unnamed ghost-move rule, name taken from the premise |
| 2 | zhendong-su | 2013-OOPSLA-detecting-api-documentation-errors | p03 | extra | "sentence" box on Figure 1 screenshot text; its mention links on "sentence" in prose follow (p11) |
| 2 | sumit-gulwani | 2015-PLDI-flashrelate-extracting-relational-data-from-semi-structured | p06 | extra | "Type T" box on grammar productions in Fig. 5(a) |
| 2 | isil-dillig | 2024-POPL-semantic-code-refactoring-for-abstract-data-types | p12 | extra | Stmt, Atom, Expr, LHS, Pred boxes on Fig. 7 grammar productions; they also overlap one another |
| 2 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | p11 | other | MoSeL-entail (a definition) boxed but the equally labelled definition (persistence-simple) is not; same kind on p06 MoSeL-entail-1 |
| 2 | zhendong-su | 2020-OOPSLA-on-the-unusual-effectiveness-of-type-aware-operator-mutation | p03 | extra | "Approach" box on the Fig. 2 comparison table |
| 2 | zhendong-su | 2020-OOPSLA-on-the-unusual-effectiveness-of-type-aware-operator-mutation | p11 | extra | "Z3", "CVC4" boxes on Fig. 9 table column headers; mention links on "CVC4" in prose follow (p20) |
| 2 | sumit-gulwani | 2010-PLDI-the-reachability-bound-problem | p02 | extra | "Transition-system(휋6)" box on the Fig. 1(e) transition-system formulas; garbled glyph in the name |
| 3 | isil-dillig | 2018-OOPSLA-relational-program-synthesis | p04 | extra | inversion, reflexivity, anti-symmetry, transitivity, totality, equals-hashcode: labelled conjuncts of a relational spec, not rules; the stacked boxes are also a line off. Their "anti-symmetry" mention links on p02, p18, p21–p23 follow. |
| 3 | isil-dillig | 2018-OOPSLA-relational-program-synthesis | p05 | extra | "associativity" box on a spec conjunction. |
| 3 | isil-dillig | 2018-OOPSLA-relational-program-synthesis | p08 | extra | Two "v3" boxes on Fig. 5 diagram nodes (hierarchical trees T1, T2). |
| 3 | isil-dillig | 2018-OOPSLA-relational-program-synthesis | p13 | extra | "+1" box on an HFTA hypergraph edge and two "x1" boxes on tree edges in Fig. 9; the "+1" mentions (and one on p32 inside "j+1") follow. |
| 3 | isil-dillig | 2018-OOPSLA-relational-program-synthesis | p16 | extra | "+1" box on the HFTA H3 hypergraph edges in Fig. 10. |
| 3 | zhendong-su | 2020-POPL-detecting-floating-point-errors-via-atomic-conditions | p13 | extra | "j/N" box on a displayed equation σ_j = σ_st^((N−j)/N) · σ_end^(j/N). |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p07 | extra | The §2.3 derivation tree (steps WP-CONJ0, WP-PROJi) is boxed as "wp-conj0" and "wp-proj"; derivation steps, and the two boxes overlap on the middle judgment. |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p08 | extra | "hyper-store" box on three lines of prose ("index i, while keeping ... and obtain"). |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p08 | extra | "IdemSeq" box on the displayed spec triple (IDEMSEQt), an equation tag, not a rule; its top edge also cuts through the prose line above. |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p09 | extra | Derivation tree (steps WP-CONJ0, (3), (2)) boxed as "wp-conj0"; the box also cuts through the struck-through line under step (3). |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p10 | extra | "IdemLoop" box on the displayed spec triple (IDEMLOOPt), not a rule. |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p22 | extra | "IdemSeq" box on the (IDEMSEQt) spec triple, not a rule; also runs into the struck-through (IDEM3t) line below. |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p22 | extra | "Idem 3" box on three lines of prose ("generality of LHC rules ... (i) ... (iv)"). |
| 3 | ranjit-jhala | 2020-PLDI-type-error-feedback-via-analytic-program-repair | p07 | extra | "DataSet" and "Predictor" boxed in the Fig. 6 API table (≐ definition rows), not rules; boxes are also shifted a row down. |
| 3 | martin-t-vechev | 2024-OOPSLA-synthetiq-fast-and-versatile-quantum-circuit-synthesis | p06 | extra | "Circuit 𝐶" box on a node of the Fig. 1 flowchart. |
| 3 | martin-t-vechev | 2024-OOPSLA-synthetiq-fast-and-versatile-quantum-circuit-synthesis | p17 | extra | "C SWAP" box on two Table 4 cells (C√SWAP, C√iSWAP rows). |
| 3 | martin-t-vechev | 2024-OOPSLA-synthetiq-fast-and-versatile-quantum-circuit-synthesis | p19 | extra | "T-depth" box on the Table 6 column-group header. |
| 3 | viktor-vafeiadis | 2022-OOPSLA-model-checking-for-a-multi-execution-memory-model | p10 | extra | non-contradictory, well-justified, no-thin-air, coherent, well-fenced, certified: named axioms in a bullet list (Def. 3.8), no premises or bar. |
| 3 | viktor-vafeiadis | 2022-OOPSLA-model-checking-for-a-multi-execution-memory-model | p11 | extra | grounded, no-bait-and-switch: bullet-list axioms; no-bait-and-switch also takes in the prose line "and also:" of Def. 3.10. |
| 3 | viktor-vafeiadis | 2022-OOPSLA-model-checking-for-a-multi-execution-memory-model | p12 | extra | no-thin-air, coherent (Def. 3.11, RC11 axioms): bullet-list axioms. |
| 3 | isil-dillig | 2012-PLDI-automated-error-diagnosis-using-abductive-inference | p03 | extra | "Program P" box on the language grammar; it also cuts through it, leaving out the "Predicate p" lines. |
| 3 | lars-birkedal | 2017-POPL-interactive-proofs-in-higher-order-concurrent-separation-log | p58 | extra | Slide derivation tree: "wp-seq" box on the last derivation step (WP-SEQ conclusion), not a rule; its left edge also starts right of the bar. |
| 3 | lars-birkedal | 2017-POPL-interactive-proofs-in-higher-order-concurrent-separation-log | p59 | extra | Same derivation: "wp-store" and "wp-seq" boxes on derivation steps; they overlap (wp-seq tab on the WP-STORE conclusion). |
| 3 | lars-birkedal | 2017-POPL-interactive-proofs-in-higher-order-concurrent-separation-log | p63–p69 | extra | Each later build of the derivation has one large "wp-store" box wrapping several stacked steps (∗-MONO, −∗-INTRO, WP-STORE, more on p66–p69); bottom edge cuts across the lower WP-STORE step. p60–p62 correctly have none. |
| 3 | isil-dillig | 2019-PLDI-synthesizing-database-programs-for-schema-refactoring | p04 | extra | Fig. 5 grammar boxed as "Update U", "Query Q", "Join J"; boxes overlap each other and cut through grammar lines. |
| 3 | isil-dillig | 2019-PLDI-synthesizing-database-programs-for-schema-refactoring | p07 | extra | Fig. 6 sketch grammar boxed as "Update U", "Query Q", "Join J", "TabList L", overlapping each other (Fig. 7 Attrs and JoinChain are fine). |
| 3 | isil-dillig | 2015-PLDI-static-detection-of-asymptotic-performance-bugs-in-collectio | p04 | extra | Fig. 4 grammar boxed as "Program P" (and the box leaves out its last line). |
| 3 | alex-aiken | 2018-POPL-on-automatically-proving-the-correctness-of-math-h-implement | p08 | extra | "δ2" box on the fraction 1/a(x) δ″ inside the inv(...) definition, an equation. |
| 3 | alex-aiken | 2018-POPL-on-automatically-proving-the-correctness-of-math-h-implement | p28 | extra | "δ2" box on the same fraction in the inv(A) definition, Appendix A.1. |
| 3 | lars-birkedal | 2021-POPL-efficient-and-provable-local-capability-revocation-using-uni | p13 | extra | Two "SingleStep" boxes: SingleStep is the execution mode inside each Fig. 6 Hoare triple, not a rule name (the rules are unnamed). Each box runs from one rule's postcondition into the next rule's premises, cutting both in half. |
| 3 | martin-t-vechev | 2019-POPL-an-abstract-domain-for-certifying-neural-networks | p11 | extra | "ex−e−x" box on the fraction (e^x − e^−x)/(e^x + e^−x) in the prose tanh definition; the page has no rules. |
| 4 | isil-dillig | 2011-POPL-precise-reasoning-for-programs-using-containers | p03 | extra | "Program P" box around the language grammar (Program P ::= e+ / Expression e ::= ...), not a rule; it also cuts off the last production line |
| 4 | isil-dillig | 2011-POPL-precise-reasoning-for-programs-using-containers | p14 | extra | "ii" box around the proof case list "(i) v ≁ ... or (ii) S(l,i) ≁ ..." in the soundness proof, not a rule |
| 4 | alex-aiken | 2012-PLDI-concurrent-data-representation-synthesis | p03 | extra | "Concurrency-safety", "W/W" and "S/S" boxes are all on the Fig. 1 table (column header / header cells / data rows), not rules; the S/S box also cuts through the table rows |
| 4 | derek-dreyer | 2013-ICFP-mtac-a-monad-for-typed-tactic-programming-in-coq | p06 | extra | All 10 boxes (ret, bind, raise, mtry, mfix, mmatch, nu, abs, is_var, is_evar) are on Fig. 2, a table of inductive-type constructor signatures ("name : type"), not inference rules. The boxes are also shifted one row off their labels (e.g. the "ret" box covers the ○ row). |
| 4 | derek-dreyer | 2013-ICFP-mtac-a-monad-for-typed-tactic-programming-in-coq | p38 | extra | All 4 boxes (hash, array_make, array_get, array_set) are on Fig. 16, a constructor-signature table, not rules. They are also shifted one row off their labels (e.g. the "hash" box covers the ○ / ... rows, and "array_set" covers the array_set and array_length rows). |
| 4 | sumit-gulwani | 2013-PLDI-static-analysis-for-probabilistic-programs-inferring-whole-p | p04 | extra | "b−a" box covers the Density Function column of Table 2 plus the Figure 4 code listing, not a rule (and the listing's last line is cut) |
| 4 | sumit-gulwani | 2013-PLDI-static-analysis-for-probabilistic-programs-inferring-whole-p | p06 | extra | "non-terminating" box on the prose "p_non-terminating ≥ 1 − c", not a rule |
| 4 | martin-t-vechev | 2014-PLDI-commutativity-race-detection | p05 | extra | Two boxes labelled "o:w:k" and "o:r:k" sit on rows of the Fig. 7(b) table (access-point cells plus the condition column); these are table cells, not rules, and the two boxes also overlap each other |
| 4 | alex-aiken | 2015-OOPSLA-conditionally-correct-superoptimization | p08 | extra | "UnsafeAxioms U" box around the Figure 5 grammar of conditions, not a rule |
| 4 | martin-t-vechev | 2016-PLDI-sdnracer-concurrency-analysis-for-software-defined-networks | p02 | extra | "S1" box around the network diagram in Fig. 1 |
| 4 | martin-t-vechev | 2016-POPL-learning-programs-from-noisy-data | p08 | extra | box "rules" drawn on the label "rules:" in the Fig. 4 tree-completion diagram (a list of grammar productions Property → x/y/log/info), not an inference rule |
| 4 | lars-birkedal | 2017-POPL-a-relational-model-of-types-and-effects-in-higher-order-conc | p13 | extra | The "!hI" box is on a step of a proof outline (the program line "!h_I" plus its surrounding {..} assertions, down to "h_I := inj2 ..."), not a rule. |
| 4 | martin-t-vechev | 2018-PLDI-static-serializability-analysis-for-causal-consistency | p05 | extra | box "R2" on the definition "(R2) ⟲ ⊆ U×Q, and u⟲q iff uq≡qu and for all v∈U," — a prose relation definition, not an inference rule; also partial, since the definition goes on to the next displayed line "uv≡vu or v⟲q or u▷v" that sits outside the box. Siblings R1, D1–D3 (same style) are correctly left unboxed |
| 4 | robbert-krebbers | 2018-POPL-intrinsically-typed-definitional-interpreters-for-imperative | p10 | extra | "weaken-val" box around Agda type signatures weaken-val / weaken-env (code), not a rule |
| 4 | robbert-krebbers | 2018-POPL-intrinsically-typed-definitional-interpreters-for-imperative | p13 | extra | "included-refl" box around the Agda instance declaration (included-refl / included-step), code, not a rule |
| 4 | viktor-vafeiadis | 2019-OOPSLA-effective-lock-handling-in-stateless-model-checking | p09 | extra | box "init" drawn around prose line "tion, wb ⊆ mo, which (similarly to lb) infers the order between writes." spanning into the Fig. 8 graph's "[init]" node; not a rule (the paper has no inference rules on this page) |
| 4 | lars-birkedal | 2019-POPL-stktokens-enforcing-well-bracketed-control-flow-and-stack-en | p18 | extra | The "local_data" box is on the first line of the splitStack definition in Fig. 11 (auxiliary function definitions), not a rule; the name comes from the subscript c_local_data. |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p07 | extra | Alloc-Safe and Free-Safe boxed, but they are prose safety conditions (italic sentences with a label), not inference rules (low confidence) |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p17 | extra | Cancel-Safe boxed, but it is a prose safety condition, not a rule (low confidence; same as Alloc-Safe) |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p19 | extra | Sync-Ghost boxed, but it is a prose property statement, not a rule (low confidence) |
| 4 | martin-t-vechev | 2021-PLDI-robustness-certification-with-generative-models | p08 | extra | "Probabilistic" box and "CelebA" box on rows of Table 1 (a results table, not a rule); the two boxes also overlap each other |
| 4 | lars-birkedal | 2021-POPL-distributed-causal-memory-modular-specification-and-verifica | p17 | extra | box "Consistent DB" drawn over the Fig. 10 architecture diagram (Session Manager / Causally Consistent DB blocks), not a rule |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p17 | extra | Aux-Defs box on the auxiliary definitions line (Mutex(F,N) = …, LockOrder(...) = …). It is a definition with no bar, not a rule |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p22 | extra | "ArrayBlockingeue" box (tab also misspelled) and "CountableThreadPool" box on plot titles/legends in Fig. 9 performance charts |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p27 | extra | "ArrayBlockingeue" box on plot title/legend in Fig. 10 chart |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p30 | extra | "ConcurrencyroleSupport" box and "RoundTripWorker" box on plot titles/legends in Fig. 13 charts |
| 4 | alex-aiken | 2022-POPL-induction-duality-primal-dual-search-for-invariants | p11 | extra | all 5 boxes (k-provability, k-abstract-reachability ×3, k-provability) are on cells/rows of Table 1 (concept table), not rules. The paper has no inference rules here |
| 4 | alex-aiken | 2022-POPL-induction-duality-primal-dual-search-for-invariants | p16 | extra | box with tab "𝛼 𝑆Ƹ𝐻" on part of the Fig. 4 lattice diagram ("α̂(S_H) / Ñ = 0") — a diagram, not a rule. Its right edge also clips "α̂(S_H)" |
| 4 | derek-dreyer | 2022-OOPSLA-bff-foundational-and-automated-verification-of-bitfield-mani | p18 | extra | the four inductive is_mask rules under "Predicates" are unnamed (no labels), yet they carry 3 boxes named "is_mask(𝑡)", "is_mask(𝑡)", "is_mask(mask)" |
| 4 | viktor-vafeiadis | 2023-POPL-kater-automating-weak-memory-model-metatheory-and-consistenc | p09 | extra | "po-properties" box is on a single displayed line of assumptions with an equation tag (rf = rfi ∪ rfe, rfi ⊆ po, po;po ⊆ po); no bar and no rule list, so it looks like a tagged equation rather than an inference rule (low confidence) |
| 4 | ranjit-jhala | 2024-POPL-mechanizing-refinement-types | p26 | extra | S-BASE and T-SUB boxes sit on steps of a worked example derivation (get 10 4 : ArrayN a 10 -> a), not on rule definitions. The T-SUB box also leaves out its own premises (Γ ⊢ 4 : Int{v:v=4} and the subtyping premise sit above the box top) |
| 4 | ranjit-jhala | 2024-POPL-mechanizing-refinement-types | p54 | extra | "Typing" (orange box) is on the figure heading "Typing" of Fig 4.2, not a rule; its box covers empty space and runs down to the FT-PRIM box |
| 4 | martin-t-vechev | 2024-OOPSLA-modular-synthesis-of-efficient-quantum-uncomputation | p15 | extra | "Synthesize-Uncomputation(f)" box is on algorithm pseudocode in Fig. 7 (it also takes in the Ensure-Uncomputed subprocedure), not an inference rule |
| 4 | martin-t-vechev | 2024-OOPSLA-modular-synthesis-of-efficient-quantum-uncomputation | p18 | extra | boxes "Synthesize-Classical(f)", "Make-Classical( )", "Make-Adjoint( )" and "Synthesize-Adjoint(f)" are on pseudocode in Fig. 8, not rules; they also cut the code off (Synthesize-Adjoint stops at line 9 of 15, Synthesize-Classical cuts line 9) and overlap each other |
| 4 | martin-t-vechev | 2024-OOPSLA-modular-synthesis-of-efficient-quantum-uncomputation | p19 | extra | boxes "Erase-Uncomputation(f)" and two "Propagate-Garbage( )" boxes are on pseudocode in Fig. 9, not rules; the Propagate-Garbage boxes span both code columns (mixing Connect-Garbage and Erase-Uncomputation lines) and cross each other |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p18 | extra | Box "Par" drawn around an example derivation (PAR then CONS steps, "(derived via Seq, Atom and CISL_RD axioms on p. 14)") that is not a rule definition; the box also starts partway through, leaving out the left "(derived" text |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p24 | extra | "Subv-Split" box is on an equivalence (res(k) ⇔ ∃k1…kn …, tagged (SUBV-SPLIT) at the right), not an inference rule; its tab also sits on the prose line above ("that a global view ... always be split") |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p25 | extra | All four boxes (Par, SeqEr, ParEr, Cons) are on steps of the proof derivations in Fig. 14 (Examples 7.1/7.2), not on rule definitions |
| 5 | viktor-vafeiadis | 2015-POPL-common-compiler-optimisations-are-invalid-in-the-c11-memory | p11 | extra | "OW-adj" box is on a transformation equation "W_X(l,v');W_X(l,v) ~> skip;W_X(l,v) (OW-adj)", not an inference rule (the matching RAR-adj/RAW-adj equations are not boxed) |
| 5 | viktor-vafeiadis | 2015-POPL-common-compiler-optimisations-are-invalid-in-the-c11-memory | p14 | extra | "rf" box is on part of an execution graph (A.7, around the rf edge and the "(RACE)" label), not a rule |
| 5 | lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p06 | extra | "Domain-Bad" box sits on a displayed recursive domain equation (SemType/SemVal ≅ ...), not an inference rule; the matching (Domain) equation below has no box, so the two are handled inconsistently |
| 5 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p12 | extra | Two overlapping "TId:Lab" boxes cover the Fig. 4a header lines (thread and program transition signatures plus the Lab definition); these are not rules |
| 5 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p15 | extra | tso-total, tso-po, tso-rf1, tso-rf2, nvo-total, nvo-tso are bullet-list axioms of a definition (PTSO-validity), not inference rules; their tabs also hide the start of each line, and the tso-rf2 tab sits on the tso-rf1 line |
| 5 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p16 | extra | nvo-psf, nvo-pre, nvo-pers: bullet-list definition axioms boxed as rules; tabs hide the start of each line |
| 5 | sumit-gulwani | 2011-POPL-automating-string-processing-in-spreadsheets-using-input-out | p03 | extra | "Token T" box is on a grammar production (Token T := C+ \| [¬C]+) in Fig. 1, not a rule |
| 5 | derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p09 | extra | Fig. 4 is value-relation definition clauses, not inference rules: VALUE-LOC, VALUE-FNPTR, VALUE-PAIR are boxed (VALUE-INT, VALUE-BOOL on the same figure are not, so it is inconsistent too); the value-fnptr tab sits on top of the value-loc box |
| 5 | derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p16 | extra | DATA-RACE-CTX is a labelled displayed equation (contextual refinement example), not an inference rule |
| 5 | derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p21 | extra | Fig. 13 proof-overview diagram rows boxed as rules "language-specific" and "language-independent" (the parenthesised labels are row annotations); these false names also produce spurious prose mention boxes on p21 (4x) and on p05/p18 ("language-independent", "(language-specific)") |
| 5 | derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p23 | extra | displayed definition of H_C(l_s,q_h) (with a case split) boxed as rule "exploit_frac( )"; it is not a rule |
| 5 | derek-dreyer | 2021-PLDI-refinedc-automating-the-foundational-verification-of-c-code | p03 | extra | Table 1 (judgment table) cells boxed as rules "r-expressions" and "l-expressions"; the l-expressions box also covers only the READ row, cutting through the table |
| 5 | alex-aiken | 2022-PLDI-distal-the-distributed-tensor-algebra-compiler | p03 | extra | Fig. 4 grammar (syntax of tensor distribution notation) boxed as rule "Machines M" |
| 5 | alex-aiken | 2022-PLDI-distal-the-distributed-tensor-algebra-compiler | p08 | extra | Fig. 14 grammar (concrete index notation syntax) boxed as rule "Tensors T" |
| 5 | lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | p23 | extra | Three unnamed spec-side rules (Cfork rule and the two yield rules) are boxed with the name "CurTh(j)", which is their first premise, not a rule name. None of the four rules on the page has a printed name, so no box is needed |
| 5 | viktor-vafeiadis | 2024-OOPSLA-extending-the-c-c-memory-model-with-inline-assembly | p11 | extra | No-Thin-Air box sits on a bulleted consistency condition in Definition 3.1 ("acyclic(po ∪ rf) (NO-THIN-AIR)"). It is not an inference rule, and the sibling conditions Coherence/SC/Atomicity are rightly unboxed. |
| 5 | viktor-vafeiadis | 2024-OOPSLA-extending-the-c-c-memory-model-with-inline-assembly | p13 | extra | Coherence-II and Coherence-III boxes sit on bulleted consistency conditions in Definition 3.5, not rules. The two boxes also overlap/touch, and Coherence-III's tab covers the Coherence-II line. |
| 5 | alex-aiken | 2014-PLDI-stochastic-optimization-of-floating-point-programs-with-tuna | p03 | extra | "NaN" box on the NaN row of the IEEE-754 table in Figure 1. It is a table row, not a rule, and its tab also covers the "Infinity" row above. |
| 5 | alex-aiken | 2014-PLDI-stochastic-optimization-of-floating-point-programs-with-tuna | p04 | extra | "β−p" box on equation (8). It is not a rule, and the box spans both columns, taking in right-column prose and equation (13). |
| 5 | isil-dillig | 2013-OOPSLA-inductive-invariant-generation-via-abductive-inference | p03 | extra | "Conditional C" box on the language grammar (Statement/Expression/Conditional productions). It is not a rule, and it starts mid-grammar. |
| 5 | derek-dreyer | 2025-PLDI-destabilizing-iris | p10 | extra | eval-def box covers the displayed definition "e ⇓ v ≜ ∃h. ..." (EVAL-DEF). It is a labelled definition (≜), not an inference rule (borderline, since prose later cites it like a rule) |
| 5 | zhendong-su | 2013-POPL-automatic-detection-of-floating-point-exceptions | p04 | extra | "Divide-by-Zero" box covers the lower half of the rewriting-rule definition T(x / y) = {Invalid / Divide-by-Zero / Overflow / ...}, a case-split equation, not a named inference rule. The box also misses the "T(x / y) =" left side, and its tab sits on the "x ⊙ y otherwise" line of T(x ⊙ y). The name comes from a case label inside the equation |
| 5 | alex-aiken | 2017-PLDI-synthesizing-program-input-grammars | p10 | extra | Box named "by" drawn around the prose "Results. We estimate the precision of Ĉ by\|E_prec∩L*\|/\|E_prec\|, where E_prec consists of ...". This is text, not a rule |
| 5 | martin-t-vechev | 2018-PLDI-incremental-inference-for-probabilistic-programs | p16 | extra | All 5 boxes (ZQ, ZQ, ZQ, ZP left column; ZP right column) sit on equational derivation steps inside the proofs of Lemma 4 and Lemma 5, cutting through fractions Z_Q/Z_P. None is a rule. The left-column boxes also overlap each other and cut the lines they sit on (e.g. "Z_Q/Z_P Pr[u~Q]/Σ..." split) |
| 5 | lars-birkedal | 2024-POPL-modular-denotational-semantics-for-effects-with-guarded-inte | p07 | extra | Box "IT" drawn on the commutative diagram (the P <-h/k-> IT square, with f/g/fold/unfold arrows); this is a diagram, not an inference rule |
| 5 | martin-t-vechev | 2018-OOPSLA-robust-relational-layout-synthesis-from-examples-for-android | p06 | extra | Box "Section 6" drawn on part of the Fig. 4 overview diagram (Robustness Properties / User Feedback / <Button ...> XML); not a rule |
| 5 | martin-t-vechev | 2018-OOPSLA-robust-relational-layout-synthesis-from-examples-for-android | p17 | extra | Box "X YK" drawn on the display equation Z(ρ,v) = Σ ∏ P_fk(c ∣ f_k(c,v))^w_k; not a rule |
| 5 | sumit-gulwani | 2021-OOPSLA-semantic-programming-by-example-with-pre-trained-models | p20 | extra | Box "subject-verb" drawn on the body rows of Table 1 (GPT-3 names, taken from a table cell); not a rule |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p21 | extra | Fig. 10 is a table of axioms, not inference rules, but it has 6 large purple boxes (tso-mo, tso-rf1, tso-rf2, nvo-loc, nvo-wu-fofl, nvo-fofl-d). Each spans several table rows, including the header and the "✓ in Fig. 3" column. |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p26 | extra | The nvo-fofl-d box covers a prose paragraph ("nvo has the added benefit … in Def. 2."). |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p26 | extra | The p-tso and p-tso-wu boxes cover bulleted axiom definitions (dom(...) ⊆ P) that have labels but are not inference rules. |
| 5 | sumit-gulwani | 2019-OOPSLA-on-the-fly-synthesis-of-edit-suggestions | p20 | extra | The BP-threshold and BP-transient boxes cover rows of Table 2, a configuration table. The paper has no inference rules there. |
| 6 | lars-birkedal | 2011-ICFP-a-kripke-logical-relation-for-effect-based-program-transform | p15 | extra | A "ε−ρ" box is around a line of proof prose in Lemma 22. |
| 6 | derek-dreyer | 2011-POPL-a-kripke-logical-relation-between-ml-and-assembly | p19 | extra | "List X" box covers the first 5 rows of a definitions/grammar table (List X, Loc, Word, Val, Lvalue ::= …), stopping partway through it. |
| 6 | alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p20 | extra | Both "part_list" boxes sit on Listing 5 code (lines 170–176 and 188–202); not rules. |
| 6 | isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p02 | extra | "Statement S" box is on the Figure 2 language grammar. |
| 6 | isil-dillig | 2017-PLDI-component-based-synthesis-of-table-consolidation-and-transfo | p04 | extra | "Hypothesis H" box covers the Figure 4 grammar for hypotheses (Term / Qualifier / Hypothesis productions). |
| 6 | ranjit-jhala | 2017-ICFP-local-refinement-typing | p27 | extra | The "By 16" box is on proof steps (Hence / By 16), not a rule. |
| 6 | ranjit-jhala | 2017-ICFP-local-refinement-typing | p28 | extra | The "By IH", "By 18" and "By 19" boxes are on steps of the proof table, not rules. |
| 6 | ranjit-jhala | 2017-ICFP-local-refinement-typing | p29 | extra | The "By IH" (lines 22–23), "By 23", "By IH" (24) and "By 24" boxes are on proof steps, not rules. |
| 6 | lars-birkedal | 2018-POPL-a-logical-relation-for-monadic-encapsulation-of-state-provin | p05 | other | Only "Λ hoisting" is boxed out of 12 like-formatted labelled refinements with no bar (Fig. 2: Neutrality, Commutativity, Idempotency, Rec hoisting, Λ hoisting, η expansion rec/Λ, β reduction rec/Λ; Fig. 3: Left/Right Identity, Associativity); box all or none (likely extra). Its tab covers "e1 in rec" of the Rec hoisting line. |
| 6 | viktor-vafeiadis | 2019-POPL-bridging-the-gap-between-programming-languages-and-hardware | p02 | extra | "RISC-V" box covers left-column prose ("…of Kang et al. [2017] to IMM…") and part of the Fig. 1 diagram. |
| 6 | viktor-vafeiadis | 2019-POPL-bridging-the-gap-between-programming-languages-and-hardware | p08 | extra | "happens-before" and "from-read/read-before" boxes are around relation definitions (sw ≜ …, hb ≜ …, fr ≜ …); the from-read tab covers the hb line. |
| 6 | viktor-vafeiadis | 2019-POPL-bridging-the-gap-between-programming-languages-and-hardware | p13 | extra | rf-completeness, co-totality, coherence, atomicity, no-thin-air are bullet items of Definition 3.11, not rules; their tabs hide each bullet's start. |
| 6 | viktor-vafeiadis | 2019-POPL-bridging-the-gap-between-programming-languages-and-hardware | p24 | extra | fwbob-cov, ppo-iss, acq-iss, w-strong-iss are bullet conditions of Definition 7.3; fwbob-cov also takes in "and the following hold:". |
| 6 | martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p22 | extra | Fig. 34(a)–(c) derivation trees are boxed: var, var, const in (a); built-in-eval, func-eval, C, W in (b); C, W in (c) (rest of (c) unboxed). |
| 6 | viktor-vafeiadis | 2021-POPL-persevere-persistency-semantics-for-verification-under-ext4 | p07 | extra | ow-na box is on a one-line example program (pwrite(df,"bar",0); labelled (OW-NA)), not a rule. |
| 6 | viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p17 | extra | "internal" and "external" box labelled consistency axioms (bullet formulas) of Definition 6, not inference rules (policy call). |
| 6 | viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p18 | extra | "MM-internal" and "MM-external" box the axiom bullets of Definition 7 (policy call). |
| 6 | viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p23 | extra | "external-revised", "strict-persist", "weak-persist" box the axiom bullets of Definition 10 (policy call); strict/weak share an edge and each tab covers the axiom above. |
| 6 | derek-dreyer | 2023-POPL-conditional-contextual-refinement | p19 | extra | "Prefix-closed" box is around a two-line display of properties (Prefix-closed) and (Postfix-closed), implications not rules, one box for both. |
| 6 | isil-dillig | 2026-PLDI-choose-don-t-label-multiple-choice-query-synthesis-for-progr | p05 | extra | "Coverage" box is around the two conditions of Definition 3.1, (Mutual exclusion) and (Coverage); definition clauses, not rules. |
| 6 | isil-dillig | 2026-PLDI-choose-don-t-label-multiple-choice-query-synthesis-for-progr | p08 | extra | "IA" box is around OMT hard constraints in Fig. 5, not rules, and runs into the (SAT) constraint (a_t ⇒ A_t); the (IA) mention links on p08 and p31–p33 follow it. |

### C. Missed rules (137 lines)

kind missed: printed rules that got no box.

Recurring patterns (lines whose description matches; a line can match several):

- bar-less axioms with a [NAME] or small-caps label: 23
- labels at the left margin, right of the bar, or beside/under the rule: 19
- names starting with a modality or star glyph (□, ▷, ⊡, ⟨affine⟩, ★, ⇛, ≼, ∝, ↑): 26
- names ending in " [S]", containing "#", "+", "′", "∗" or a ":" / space: 16
- wide / full-width rules and large grey-shaded rules: 12
- two-column axiom lists and rules set beside boxed siblings: 28
- Hoare-triple / spec rules (-SPEC, Ht-*) with no bar: 8
- whole figure or row unboxed: 9

| share | author | paper | page | kind | what is wrong |
|---|---|---|---|---|---|
| 1 | viktor-vafeiadis | 2013-OOPSLA-relaxed-separation-logic-a-program-logic-for-c11-concurrency | p07 | missed | CAS* (left column, five premises, label on the right) has no box |
| 1 | ranjit-jhala | 2014-ICFP-refinement-types-for-haskell | p03 | missed | ≼-BASE (right column, name right of the bar) has no box |
| 1 | ranjit-jhala | 2014-ICFP-refinement-types-for-haskell | p07 | missed | Fig. 4 ≼-BASE and ≼-FUN have no boxes |
| 1 | ranjit-jhala | 2014-ICFP-refinement-types-for-haskell | p08 | missed | Fig. 6 ≼-BASE-D has no box |
| 1 | ranjit-jhala | 2016-PLDI-refinement-types-for-typescript | p07 | missed | S-THIS has no box of its own |
| 1 | ranjit-jhala | 2016-PLDI-refinement-types-for-typescript | p08 | missed | Fig. 5 T-CST has no box |
| 1 | derek-dreyer | 2017-OOPSLA-robust-and-compositional-verification-of-object-capability-p | p19 | missed | MEMBRANESPEC in Fig. 9 (triple below IsMon) has no box |
| 1 | ranjit-jhala | 2018-POPL-refinement-reflection-complete-verification-with-smt | p14 | missed | Fig. 5: ⇒-I and ⇒-E have no boxes of their own |
| 1 | lars-birkedal | 2019-POPL-iron-managing-obligations-in-higher-order-concurrent-separat | p04 | missed | displayed "P ∗ Q ⊢ P" labelled (AFFINE) has no box |
| 1 | isil-dillig | 2022-OOPSLA-type-directed-synthesis-of-visualizations-from-natural-langu | p10 | missed | Fig. 11: BASE-TRANS, BASE-REF (axiom), TABLE-WIDTH (axiom), FUNC; Fig. 12: SYMMETRY, DATA have no boxes |
| 1 | isil-dillig | 2022-OOPSLA-type-directed-synthesis-of-visualizations-from-natural-langu | p31 | missed | Fig. 21: SUB, SCATTER, BIN have no boxes (Bar, Line, Area are boxed) |
| 1 | isil-dillig | 2022-OOPSLA-type-directed-synthesis-of-visualizations-from-natural-langu | p32 | missed | Fig. 22: FILTER, SELECT, SUMM-MEAN, SUMM-COUNT have no boxes (SUMM-MEAN's label got a mention link instead) |
| 1 | isil-dillig | 2022-OOPSLA-type-directed-synthesis-of-visualizations-from-natural-langu | p35 | missed | Fig. 24: LOGICAL OPERATORS, SEMANTIC TERM, CARD, VAR-1, VAR-2, FILTER OP-1, FILTER OP-2, PROJ-1, PROJ-2, FILTER-2 have no boxes (only Syn-1, Syn-2, Max, Min, Filter-1 boxed) |
| 1 | isil-dillig | 2022-OOPSLA-automated-transpilation-of-imperative-to-functional-code-usi | p11 | missed | Fig. 9: ≠-↑, ≃-↑, NTerm-↑, VarTerm-↑, FirstOrderTerm-↑, HigherOrderTerm-↑ have no boxes (only S-NTerm-↑ boxed) |
| 1 | derek-dreyer | 2023-OOPSLA-stuttering-for-free | p10 | missed | REFL+ and SEQ+ (bottom of page, full premise/bar/conclusion rules) have no boxes |
| 1 | robbert-krebbers | 2023-PLDI-beyond-backtracking-connections-in-fine-grained-concurrent-s | p15 | missed | Fig. 6: R−∗∗, R∗⊤, R∗∗, R∗∨, the large R∗A above "Inversion phase", L∗ and L−∗ have no boxes (11 others correct; tabs for R𝐴, R−∗𝐻 lose the italic letter in drawing only) |
| 1 | robbert-krebbers | 2023-PLDI-beyond-backtracking-connections-in-fine-grained-concurrent-s | p16 | missed | displayed rule (R∗A) under the side-condition annotations has no box |
| 1 | robbert-krebbers | 2023-PLDI-beyond-backtracking-connections-in-fine-grained-concurrent-s | p19 | missed | Fig. 8: R∃∗A has no box; the labelled definition CONNECTION-DEF is unboxed while BIABD-DEF just above is boxed (inconsistent) |
| 1 | lars-birkedal | 2023-OOPSLA-spirea-a-mechanized-concurrent-separation-logic-for-weak-per | p09 | missed | Fig. 5 named axioms LB-PERSISTENT-FLUSH-STORE and OBJ-NOFLUSH-NOBUFFER have no boxes |
| 1 | lars-birkedal | 2024-POPL-asynchronous-probabilistic-couplings-in-higher-order-separat | p05 | missed | REL-COUPLE-TAPE-L, a rule about as wide as the column (between the REL-ALLOC-TAPE-L and REL-RAND-TAPE-L boxes), has no box |
| 1 | lars-birkedal | 2024-POPL-asynchronous-probabilistic-couplings-in-higher-order-separat | p11 | missed | Fig. 4: REL-COUPLE-TAPE-L (full-width, between REL-COUPLE-RANDS and REL-COUPLE-TAPE-R) has no box, likely the same cause as p05 |
| 1 | lars-birkedal | 2025-ICFP-modular-reasoning-about-error-bounds-for-concurrent-probabil | p03 | missed | ERR-1 (bottom row, right of HT-RAND-EXP; premise ↯(1), conclusion False) has no box |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p25 | missed | (stacks•IN-unique) and (stacks∘IN-unique) have no box of their own |
| 2 | isil-dillig | 2022-POPL-bottom-up-synthesis-of-recursive-functional-programs-using-a | p14 | missed | ANGELIC RECURSION, UNEVAL PROD, SWITCH LEFT, SWITCH RIGHT (two-word names) have no box |
| 2 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | p07 | missed | Ht-newsocket (Fig. 2, top right) has no box |
| 2 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | p13 | missed | Ht-make-server-socket [S], Ht-listen [S], Ht-accept [S], Ht-make-client-socket [S], Ht-connect [S] (names ending in "[S]") |
| 2 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | p20 | missed | Ht-rpc-start [S], Ht-rpc-connect [S], Ht-rpc-request [S] |
| 2 | isil-dillig | 2022-OOPSLA-synthesis-powered-optimization-of-smart-contracts-via-data-t | p09 | missed | Fig. 6 Wrap1-Fld, Wrap2-Fld, Unwrap1-Fld, Unwrap2-Fld |
| 2 | robbert-krebbers | 2023-OOPSLA-proof-automation-for-linearizability-in-separation-logic | p11 | missed | IRIS-□-INTRO, □-ELIM, □-DUP (names starting with a modality glyph) |
| 2 | robbert-krebbers | 2023-OOPSLA-proof-automation-for-linearizability-in-separation-logic | p20 | missed | ABDUCT-WP-VAL (left of ABDUCT-SYM-EX-LOGATOM) |
| 2 | ranjit-jhala | 2012-POPL-nested-refinements-a-logic-for-duck-typing | p07 | missed | bar-less axioms with [NAME] labels in Fig. 2: E-APP, E-LET, E-TAPP, E-IFTRUE, E-IFFALSE |
| 2 | isil-dillig | 2021-POPL-verifying-correct-usage-of-context-free-api-protocols | p11 | missed | Fig. 10: only (If) boxed; (API), (Seq), (Method), (Class) missed |
| 2 | lars-birkedal | 2026-OOPSLA-lawyer-modular-obligations-based-liveness-reasoning-in-highe | p15 | missed | axiom OU-EB-0 ("OU {elb 0}", Fig. 10 top left) |
| 2 | martin-t-vechev | 2016-OOPSLA-modeling-and-analysis-of-remote-memory-access-programming | p09 | missed | rule (C) under no-C in Fig. 4 |
| 2 | derek-dreyer | 2017-POPL-a-promising-semantics-for-relaxed-memory-concurrency | p06 | missed | (THREAD: FULFILL UPDATE) in Fig. 2 |
| 2 | derek-dreyer | 2017-POPL-a-promising-semantics-for-relaxed-memory-concurrency | p09 | missed | (MEMORY: NEW), (MEMORY: FULFILL), (SYSTEM CALL), (MACHINE STEP) in Fig. 3 (colon and spaced names) |
| 2 | derek-dreyer | 2017-POPL-a-promising-semantics-for-relaxed-memory-concurrency | p13 | missed | (MACHINE STEP) in Fig. 6 |
| 2 | derek-dreyer | 2014-OOPSLA-gps-navigating-weak-memory-with-ghosts-protocols-and-separat | p52 | missed | axioms GetPerms, LkPermExclusive, UnusedUnPerms, UseUnPerm, UsedPermsPure, MyAllCoherence, NewGhost (only GetTicket boxed) |
| 2 | derek-dreyer | 2022-ICFP-later-credits-resourceful-reasoning-for-the-later-modality | p10 | missed | CreditTimeless ("timeless(£n)", Fig. 3) |
| 2 | derek-dreyer | 2022-ICFP-later-credits-resourceful-reasoning-for-the-later-modality | p26 | missed | ReceiptTimeless ("timeless(⧗n)", Fig. 7) |
| 2 | derek-dreyer | 2022-PLDI-rusthornbelt-a-semantic-foundation-for-functional-verificati | p05 | missed | ENDLFT (right column) |
| 2 | robbert-krebbers | 2014-POPL-an-operational-and-axiomatic-semantics-for-non-determinism-a | p10 | missed | (add funs) at the bottom of Fig. 1 |
| 2 | viktor-vafeiadis | 2020-PLDI-promising-2-0-global-optimizations-in-relaxed-memory-concurr | p11 | missed | Fig. 2 (MEMORY: NEW), (MEMORY: FULFILL), (SYSTEM CALL), (MACHINE NORMAL), (MACHINE SYSTEM CALL), (MACHINE FAIL); the 10 boxed ones are right |
| 2 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | p12 | missed | Fig. 5 □-MONO, □-IDEM, □-AFFINE, □-ELIM, □-DUP, □-SEP-AND (names starting with a modality glyph) |
| 2 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | p13 | missed | □-INTRO |
| 2 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | p14 | missed | ⟨affine⟩-INTRO, ⊡-INTRO |
| 2 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | p15 | missed | Fig. 8 RA-ASSOC, RA-COMM, RA-CORE-ID, RA-VALID-OP, RA-UNIT-OP (only RA-CORE-IDEM, RA-CORE-MONO, RA-UNIT-VALID boxed) |
| 2 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | p17 | missed | ORA-CORE-IDEM, ORA-CORE-MONO, ORA-VALID-OP, ORA-⊑-OP-CORE, ORA-⊑-UNIT-CORE, ORA-UNIT-OP |
| 2 | derek-dreyer | 2018-ICFP-mosel-a-general-extensible-modal-framework-for-interactive-p | p22 | missed | CONSEQUENCE-FRAME (top of page) |
| 3 | derek-dreyer | 2013-ICFP-unifying-refinement-and-hoare-style-reasoning-in-a-logic-for | p05 | missed | Fig. 4 "□I" and "LÖB" have no box. |
| 3 | derek-dreyer | 2013-ICFP-unifying-refinement-and-hoare-style-reasoning-in-a-logic-for | p06 | missed | RET (named axiom, no premises) has no box. |
| 3 | derek-dreyer | 2013-ICFP-unifying-refinement-and-hoare-style-reasoning-in-a-logic-for | p07 | missed | Fig. 6 SPLITISL (named two-line ⇔ axiom) has no box (borderline: no bar). |
| 3 | derek-dreyer | 2013-ICFP-unifying-refinement-and-hoare-style-reasoning-in-a-logic-for | p09 | missed | Fig. 7 SFORK (named axiom, no premises) has no box. |
| 3 | lars-birkedal | 2011-POPL-step-indexed-kripke-models-over-recursive-worlds | p06 | missed | Fig. 8 PROJ-1 and PROJ-2 (right of APP) have no box. |
| 3 | derek-dreyer | 2022-OOPSLA-proving-hypersafety-compositionally | p16 | missed | WP-IFI in Fig. 7 (between wp-assign and wp-while) has no box. |
| 3 | alex-aiken | 2018-PLDI-active-learning-of-points-to-specifications | p04 | missed | (call parameter) and (call return) in Fig. 2 have no box. |
| 3 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | p06 | missed | RU-INIT-CLIENT-SPEC and RU-INIT-KVS-SPEC (top of Fig. 3) have no box. |
| 3 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | p11 | missed | RC-INIT-CLIENT-SPEC and RC-INIT-KVS-SPEC (top of Fig. 5) have no box. |
| 3 | lars-birkedal | 2025-ICFP-reasoning-about-weak-isolation-levels-in-separation-logic | p16 | missed | SI-INIT-CLIENT-SPEC and SI-INIT-KVS-SPEC (top of Fig. 10) have no box. |
| 3 | robbert-krebbers | 2025-ICFP-verified-interpreters-for-dynamic-languages-with-application | p07 | missed | β ((λx.e1) e2 → e1[x := e2]) beside APP in Fig. 1 has no box. |
| 3 | robbert-krebbers | 2025-ICFP-verified-interpreters-for-dynamic-languages-with-application | p10 | missed | β ((λs.e1) e2 → e1[s := e2]) below ABS/APP in Fig. 3 has no box. |
| 3 | robbert-krebbers | 2025-ICFP-verified-interpreters-for-dynamic-languages-with-application | p15 | missed | β and LET-ATTR-ATTR in Fig. 4 have no box. |
| 3 | alex-aiken | 2013-PLDI-terra-a-multi-stage-language-for-high-performance-computing | p04 | missed | SBAS, SVAR (Fig. 2), TVAR, TAPP (Fig. 3), LTQUOTE (Fig. 1) have no box. |
| 3 | lars-birkedal | 2024-ICFP-error-credits-resourceful-reasoning-about-error-bounds-for-h | p21 | missed | PRESAMPLE-EXP and PRESAMPLE-PLANNER (names on the right) have no box; alloc-tape, load-tape, presample are fine. |
| 3 | lars-birkedal | 2024-ICFP-error-credits-resourceful-reasoning-about-error-bounds-for-h | p28 | missed | STATESTEP-SIMPLE has no box. |
| 3 | lars-birkedal | 2024-ICFP-error-credits-resourceful-reasoning-about-error-bounds-for-h | p29 | missed | STATESTEP-EXP (top of page, three premise rows) has no box. |
| 3 | derek-dreyer | 2020-POPL-the-future-is-ours-prophecy-variables-in-separation-logic | p09 | missed | SEQUENCE-PROPHECY-SIMPLE-RESOLUTION-TYPED (under the creation-typed box) has no box. |
| 3 | alex-aiken | 2014-PLDI-first-class-runtime-generation-of-high-performance-types-usi | p06 | missed | Fig. 2 TyVar, TyApp, TyFun, TyInt; Fig. 3 TCtx, TApp, TUnwrap; Fig. 4 LApp, LRunProp, LProp: 10 named rules, no box (names beside, some under, the rule). |
| 3 | alex-aiken | 2018-POPL-on-automatically-proving-the-correctness-of-math-h-implement | p15 | missed | R10, R11, R12 in Fig. 6 (Dekker rules) have no box. |
| 3 | alex-aiken | 2018-POPL-on-automatically-proving-the-correctness-of-math-h-implement | p19 | missed | R4′ (extended bit-mask rule in the text) has no box. |
| 3 | alex-aiken | 2018-POPL-on-automatically-proving-the-correctness-of-math-h-implement | p21 | missed | R1′ and R2′ (two axioms side by side, each with a bar) have no box. |
| 3 | lars-birkedal | 2021-POPL-efficient-and-provable-local-capability-revocation-using-uni | p06 | missed | Fig. 3: RepeatStandby, RepeatHalt, RepeatFail, ExecSingle (bar-less reduction rules with small-caps names) have no box; only RepeatSingle is boxed. |
| 4 | derek-dreyer | 2010-POPL-a-relational-modal-logic-for-higher-order-stateful-adts | p09 | missed | many named rules in Fig. 8 have no box: L-WEAKEN, ▷-MONO, ▷-WEAKEN, LÖB, □-INTRO, □-INTRO-ABS, □-INTRO-TERM, □-ELIM, ▷□-SWAP, ∝-INTRO, ∝-ELIM, ↑-EXPAND, ↑-REDUCE, ↑-UNROLL, ↑-RETURN, ↑-BIND, ↑-IMPURE |
| 4 | derek-dreyer | 2010-POPL-a-relational-modal-logic-for-higher-order-stateful-adts | p10 | missed | □-SHIFT (left of SEP-∨ in Fig. 9) has no box |
| 4 | isil-dillig | 2011-POPL-precise-reasoning-for-programs-using-containers | p06 | missed | Fig. 6 rules titled "Read from Position Dependent Container", "Read from Value Dependent Container", "Write to Value Dependent Container", "Write to Position Dependent Container" and "Container Allocation" have no box; Newval/Update in the same style are boxed |
| 4 | isil-dillig | 2011-POPL-precise-reasoning-for-programs-using-containers | p07 | missed | Fig. 7 rules "Key, value pair at kth Iteration for pos_adt" and "Key, value pair at kth Iteration for val_adt" have no box; Foreach/Fix in the same style are boxed |
| 4 | martin-t-vechev | 2016-PLDI-sdnracer-concurrency-analysis-for-software-defined-networks | p05 | missed | SWITCHDATAPLANE, SWITCHCONTROLPLANE, SWITCHBUFFER, HOST, CONTROLLER, DATAPLANE, CONTROLPLANETO, CONTROLPLANEFROM, TIME1, TIME2 have no box (Fig. 2; only BARRIERPRE/BARRIERPOST are boxed) |
| 4 | derek-dreyer | 2018-POPL-rustbelt-securing-the-foundations-of-the-rust-programming-la | p23 | missed | LftL-begin (top-left of Fig. 4) has no box |
| 4 | derek-dreyer | 2018-POPL-rustbelt-securing-the-foundations-of-the-rust-programming-la | p25 | missed | LftL-bor-fracture (left of LftL-fract-acc in Fig. 5) has no box |
| 4 | derek-dreyer | 2018-POPL-rustbelt-securing-the-foundations-of-the-rust-programming-la | p27 | missed | LftL-bor-na (left of Fig. 6) has no box |
| 4 | derek-dreyer | 2020-POPL-rustbelt-meets-relaxed-memory | p10 | missed | Fig. 3: Ghost-Mod, iRC11-CInv-New, iRC11-CInv-FAA-Rlx (the only one with a bar), iRC11-CInv-Tok, iRC11-CInv-Cancel have no box; neighbours NA-Write/NA-Read/Dealloc/Rel-fence/Acq-fence in the same style are boxed |
| 4 | viktor-vafeiadis | 2020-OOPSLA-persistent-owicki-gries-reasoning-a-program-logic-for-reason | p11 | missed | (REC) at the bottom of Fig. 3, just above the caption, has no box |
| 4 | ranjit-jhala | 2021-POPL-automatically-eliminating-speculative-leaks-from-cryptograph | p20 | missed | Sol-Empty (axiom "SOL-EMPTY / σ ⊢ ∅" in Fig. 11, set alongside the boxed Sol-Set/Sol-Trans/Sol-Stable/Sol-Flow) has no box |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p17 | missed | RACE-1, RACE-2, WAIT, MIN-LOCK, MAX-PAR have no box (Fig. 8; labels sit left of each rule) |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p38 | missed | ENTRY-FRAG, METHOD, FLD-2 (as its own box), MTR have no box (Fig. 16) |
| 4 | ranjit-jhala | 2024-POPL-mechanizing-refinement-types | p96 | missed | Rule "WFLIST" (WF-List, Figure 9.4 left, name typeset "WFL̄IST" with a stray macron) has no box; its neighbour WF-LISTR is boxed |
| 4 | lars-birkedal | 2025-POPL-approximate-relational-reasoning-for-higher-order-probabilis | p07 | missed | wp-couple-rand-rand-err-le (named rule with a bar, name above it) has no box |
| 4 | lars-birkedal | 2025-POPL-approximate-relational-reasoning-for-higher-order-probabilis | p15 | missed | wp-couple-rand-rand-err-le and wp-couple-rand-rand-err-ge (displayed rules with a bar, name above) have no box; wp-couple-tape-tape-err-ge in the same style on the same page is boxed |
| 4 | robbert-krebbers | 2025-POPL-affect-an-affine-type-and-effect-system | p19 | missed | ModeSub-O, ModeSub-Nil and RowSub-Nil (axioms in Fig. 5, set among the boxed ModeSub-M, ModeSub-Cons, RowSub-Once, RowSub-Multi and RowSub-Cons) have no box |
| 4 | robbert-krebbers | 2025-POPL-affect-an-affine-type-and-effect-system | p20 | missed | ModeSub-MBang and RowSub-FMBang (displayed named axioms at the top of the page, same style as the boxed axioms on p14, p17 and p19) have no box |
| 4 | lars-birkedal | 2026-OOPSLA-mixtris-mechanised-higher-order-separation-logic-for-mixed-c | p12 | missed | PROTO-IN-REFL (p ∈ p), printed right next to the boxed PROTO-IN-CHOICE, has no box |
| 4 | robbert-krebbers | 2026-POPL-a-relational-separation-logic-for-effect-handlers | p10 | missed | BIND (displayed rule "BIND  traversable(Kl,Kr,T)  T⊑F / el≲er⟨T⟩{...} ⊢ Kl[el]≲Kr[er]⟨F⟩{R}", mid-page below "a sound bind rule ... is formulated as follows") has no box, while its neighbours STANDARD-BIND and UNSOUND-BIND are boxed |
| 4 | robbert-krebbers | 2026-POPL-a-relational-separation-logic-for-effect-handlers | p11 | missed | BETA in Fig. 1c (pure-reduction rules, left of MULTI-SHOT) has no box; the other Fig. 1 rules are boxed |
| 4 | robbert-krebbers | 2026-POPL-a-relational-separation-logic-for-effect-handlers | p19 | missed | whole of Fig. 5 "Reasoning rules of blaze" unboxed: EFFECT-L-★, EFFECT-R-★, ADD-LABEL-L-★, ADD-LABEL-R-★, NEW-THEORY-★, INTRODUCTION-★, BIND-★, EXHAUSTION-★ (8 rules; names end in ★) |
| 4 | robbert-krebbers | 2026-POPL-a-relational-separation-logic-for-effect-handlers | p23 | missed | whole of Fig. 7 "Reasoning rules for concurrency" unboxed: FORK-L-★, FORK-R-★, LOGICAL-FORK-★, THREAD-SWAP-★ (4 rules; names end in ★) |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p08 | missed | DC-Error axiom (top-left of Fig. 4, name "DC-Error" above "[emp] L:error [er(L): emp]") has no box; the other 9 DC-* axioms are boxed correctly |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p24 | missed | SV-CS and SV-CS-G (named derived rules with premises, bar and conclusion in Fig. 13) have no boxes |
| 5 | lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p09 | missed | Fig. 4: T-{}-I, T-{}-E and T-∀-E_p (name tabs beside the bar) have no box |
| 5 | lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p10 | missed | Fig. 5: <:-⊤, ∧1-<:, ∧2-<:, ⊥-<:, <:-Refl (named axioms), <:-∧ and ∀-<:-∀ (rules with a bar) have no box |
| 5 | lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p13 | missed | Fig. 6: T-{}-I, T-∀-E_p and D-∀ have no box |
| 5 | lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p14 | missed | Fig. 7: <:-⊤, ∧1-<:, ∧2-<:, ⊥-<:, <:-Refl, <:-∨1, <:-∨2, Distr-∧-∨-<: (axioms; the axiom <:-Add-Later on the same page is boxed) plus <:-∧, ∨-<:, μ-<:-μ, μ-<:, <:-μ and ∀-<:-∀ have no box |
| 5 | lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p17 | missed | Fig. 8: Impl-▷, Löb, ⇛-Mono, ⇛-Intro, ⇛-Trans and ⇛-Frame have no box (only ▷-Intro/Mono/Impl and Saved-Pred-* are boxed) |
| 5 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p12 | missed | T-Seq1 has no box; T-While has no box of its own (see next line) |
| 5 | alex-aiken | 2024-PLDI-recursive-program-synthesis-using-paramorphisms | p05 | missed | TVar (named axiom Γ,v:τ ⊢ v:τ) has no box, while Tabs, Tapp, Tctr and Tpara are boxed |
| 5 | derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p07 | missed | SIM-CALL (named axiom, centred between SIM-FRAME and SIM-BIND in Fig. 3) has no box |
| 5 | martin-t-vechev | 2015-OOPSLA-scalable-race-detection-for-android-applications | p08 | missed | Fig. 4: CALLBACKREG#1, CALLBACKREG#2, MSGBEGIN#1, MSGBEGIN#2 have no box; Fig. 5: IPCASYNC has no box (all the names with "#" or in the last Fig. 5 rule were skipped) |
| 5 | lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | p03 | missed | Named rule HOARE-BIND (inadmissible in presence of continuations), drawn with name over bar, has no box |
| 5 | lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | p08 | missed | Named rule INADMISSIBLE-BIND at page bottom (name over the bar) has no box |
| 5 | lars-birkedal | 2019-ICFP-mechanized-relational-verification-of-concurrent-programs-wi | p14 | missed | FST-CLWP (top-left of Fig. 5) has no box; the other Fig. 5 rules are boxed |
| 5 | ranjit-jhala | 2017-OOPSLA-verifying-distributed-programs-via-canonical-sequentializati | p15 | missed | R-Loop-Repeat (Fig. 4.8) has its name printed above the rule but has no box |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p12 | missed | (T-FO), (T-FL) and (Prog) in the bottom row of Fig. 6 are named rules with no box. |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p15 | missed | (SilentS) and (Crash) in Fig. 8 are named rules with no box. Only SilentP and Step are boxed. |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p17 | missed | (M-PropP), the last rule of Fig. 9, has no box. Its label only has a cyan mention link on it. |
| 6 | alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p08 | missed | Figure 4 left column has no boxes on T-Read, T-Write, T-Reduce, T-New, T-UpRgn, T-DnRgn, T-NewColor, T-Color, T-Partition, T-Unpack, T-Call, T-Program; right column none on E-Read, E-Write, E-DnRgn, E-NewColor, E-Color, E-Partition, E-Pack, E-Call. Only T-Pack, E-Reduce, E-New, E-UpRgn and E-Unpack are boxed. |
| 6 | alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p09 | missed | The displayed rule [E-Add] in the left column (5 premises, bar, conclusion) has only a mention box and no rule box. |
| 6 | alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p22 | missed | The axioms (T-Bool), (T-Int) and (T-Null) in Figure 12 are not boxed. |
| 6 | alex-aiken | 2013-OOPSLA-language-support-for-dynamic-hierarchical-data-partitioning | p23 | missed | The axiom (E-Null) in Figure 13 is not boxed. |
| 6 | derek-dreyer | 2013-POPL-the-power-of-parameterization-in-coinductive-proof | p12 | missed | (COEN), a labelled displayed principle "x ⊑ f(μy. f(y) ⊔ x ⊔ νf) ⟹ x ⊑ νf", has no box (written as an implication, no bar; borderline). |
| 6 | isil-dillig | 2014-PLDI-consolidation-of-queries-with-user-defined-functions | p05 | missed | Figure 5 rules with the label at the left margin have no box: Skip 1, Skip 2, Skip 3, Assign, Step, Seq, If 1, If 2. |
| 6 | sumit-gulwani | 2015-OOPSLA-automating-grammar-comparison | p11 | missed | BRANCHEXT (labelled "BRANCHEXT.", premises x = aw and ∀b∈Σ…, bar, conclusion C ⊢ α op_x β) in the left column has no box. |
| 6 | isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p05 | missed | Figure 5: (Expand), (Lift), (♭-intro 1), (♭-intro 2), (♭-elim), (Assoc) have no box. |
| 6 | isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p07 | missed | Figure 6: (Transform − single), (Transform − multi), (Fusion 1), (Fusion 2) have no box. |
| 6 | lars-birkedal | 2018-POPL-a-logical-relation-for-monadic-encapsulation-of-state-provin | p22 | missed | Fig. 8: EXCLUSIVE (top right), FULL-EXCLUSIVE (second row) and FPFN-OPERATION-SUCCESS (case-split definition) have no box. |
| 6 | martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p09 | missed | func-eval (Fig. 9) and λ-abs (Fig. 10), labels right of the bar, have no box. |
| 6 | martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p19 | missed | func-eval and eval-λ-abs (Fig. 28, large grey-shaded rules) have no box. |
| 6 | martin-t-vechev | 2020-PLDI-silq-a-high-level-quantum-language-with-safe-uncomputation-a | p23 | missed | Restated rules !W (G.2.4), W (G.2.5), !C (G.2.6), C (G.2.7) have no boxes (the same kind on p22, var and var-const, is boxed). |
| 6 | robbert-krebbers | 2020-OOPSLA-knowing-when-to-ask-sound-scheduling-of-name-resolution-in-t | p14 | missed | Op-Edge in Figure 8 (named axiom with no bar, below Op-Node-Stale and Op-Data) is not boxed. |
| 6 | derek-dreyer | 2021-ICFP-ghostcell-separating-permissions-from-data-in-rust | p18 | missed | MonoInit (top-left of the monotone counter rules, "True ⇛ ∃γ. MonoVal(γ,n)") has no box; its three siblings are boxed. |
| 6 | derek-dreyer | 2021-ICFP-ghostcell-separating-permissions-from-data-in-rust | p19 | missed | GhostLftLookup (label "(GhostLftLookup)", a "key rule" in the text) has no box; the same style on p20 (BrandedIndexSub) is boxed. |
| 6 | derek-dreyer | 2021-ICFP-ghostcell-separating-permissions-from-data-in-rust | p23 | missed | TokInit, TokUpdate, TokSplit and TokCombine (GhostToken proof rules) have no boxes. |
| 6 | viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p20 | missed | Figure 9: M-PropW+NTW and M-PropFL+FO+SF have no box. |
| 6 | lars-birkedal | 2023-PLDI-vmsl-a-separation-logic-for-mechanised-robust-safety-of-virt | p10 | missed | WP-SSWP and RC-hold (named boxed-label rules in Fig. 6) have no boxes. |
| 6 | lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p07 | missed | Fig. 1 rows RWP-ALLOC and RWP-RAND have no box. |
| 6 | lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p10 | missed | RWP-TAPE-ALLOC ("∀ι. ι↪(N,ε) −∗ Φ(ι) ⊢ rwp tape N {Φ}") has no box; its label carries a mention link on "RWP-TAPE" only, pointing to rwp-tape. |
| 6 | lars-birkedal | 2024-ICFP-almost-sure-termination-by-guarded-refinement | p27 | missed | RWP-ALLOC, RWP-RAND and RWP-TAPE-ALLOC have no box of their own; the partial "RWP-TAPE" mention recurs. |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p22 | missed | PROTO-RECV has no box of its own; it sits inside the proto-symmetric box. |
| 6 | lars-birkedal | 2026-PLDI-contextual-refinement-of-higher-order-concurrent-probabilist | p14 | missed | ERR-1 has no box of its own. |

### D. Names, tabs and mention links (74 lines)

kinds wrong-name and other: tab text, tabs hiding printed text, mention links and one wrong PDF.

Recurring patterns (lines whose description matches; a line can match several):

- small-caps "qu" ligature read as "q" (uniqe, conseqence, Eqiv, qeue, qo/): 14
- glyph missing from the tab font (μ blank, κ dropped, ▷ as ◁, garbled): 3
- name tabs covering the text of the rule above or a heading: 19
- mention links on ordinary prose words or code: 18
- mention links shifted by one character / clipped last letter: 12
- spurious mention links following a false rule box: 12
- mention links to the wrong rule: 2
- wrong PDF: 1
- premise superscript / subscript taken into the name: 1

| share | author | paper | page | kind | what is wrong |
|---|---|---|---|---|---|
| 1 | martin-t-vechev | 2012-PLDI-dynamic-synthesis-for-relaxed-memory-models | p04 | other | Semantics 1 stacked rules: LOAD-B, FLUSH, CAS-F, JOIN tabs hide the last conclusion line of the rule above; boxes right |
| 1 | lars-birkedal | 2019-POPL-iron-managing-obligations-in-higher-order-concurrent-separat | p10 | other | hoare-fork-emp, inv-open, tinv-dup tabs hide part of the section headings above them; hoare-bind leaves out its side condition "K a call-by-value evaluation context" (unsure) |
| 1 | derek-dreyer | 2022-PLDI-compass-strong-and-compositional-library-specifications-in-r | p06 | other | Fig. 2 stacked rules: Seq-Deq, SC-Deq, Abs-So-Deq tabs cover their printed names; Abs-Hb-Deq tab sits on Abs-Hb-Enq's last line and its right edge clips ⟩ (boxes touch, unsure whether they overlap) |
| 1 | derek-dreyer | 2023-OOPSLA-stuttering-for-free | p14 | other | prose word "dual" linked as a mention of DUAL (also p22 "(dual)", p24) |
| 1 | isil-dillig | 2024-OOPSLA-control-flow-deobfuscation-using-trace-informed-compositiona | p07 | other | mention links on prose "(ite)" p07, "while" p12, and table cells "ite" p32, p37 |
| 1 | derek-dreyer | 2024-PLDI-quiver-guided-abductive-inference-of-separation-logic-specif | p07 | other | one-rule-per-row wp table: each tab sits on the row above and hides its start (wp-let … wp-assert); abd-res-ctx tab covers the "Abduction Rules" heading; box extents correct |
| 1 | derek-dreyer | 2024-PLDI-quiver-guided-abductive-inference-of-separation-logic-specif | p10 | other | Fig. 5: ex-inst, ex-loc, ex-pointsto, ex-unfold, ex-pred tabs cover the row above |
| 1 | derek-dreyer | 2024-PLDI-quiver-guided-abductive-inference-of-separation-logic-specif | p14 | other | Fig. 8: ex-pure, ex-pure-blocked, ex-eq, ex-lift, ex-done tabs cover the row above |
| 1 | derek-dreyer | 2026-POPL-endangered-by-the-language-but-saved-by-the-compiler-robust | p07 | other | Fig. 3: wp-load tab hides part of the paper's framed definition "{P} e {v.Q} ≜ …"; wp-borrow and wp-return tabs touch the boxes above (minor) |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p09 | wrong-name | tab "wbHoare-conseqence" for WBHOARE-CONSEQUENCE (small-caps "qu" ligature text-layer quirk) |
| 2 | lars-birkedal | 2024-POPL-the-logical-essence-of-well-bracketed-control-flow | p11 | wrong-name | tabs "stack-system-uniqe", "stack-user-uniqe" for STACK-SYSTEM-UNIQUE, STACK-USER-UNIQUE (same "qu" quirk) |
| 2 | isil-dillig | 2022-POPL-bottom-up-synthesis-of-recursive-functional-programs-using-a | p14 | other | mention of "UNEVAL PROD" links only "UNEVAL" (to the Uneval rule) |
| 2 | zhendong-su | 2025-OOPSLA-api-guided-dataset-synthesis-to-finetune-large-code-models | p20 | other | mention links on "CodeLlama-7b" in Table 7 (follow from the false rule on p23; same on p22 in the Fig. 6a legend) |
| 2 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | p10 | other | proto-⊑-l tab covers the second line of proto-recv-l (Fig. 3 boxes stacked edge to edge) |
| 2 | lars-birkedal | 2023-ICFP-verifying-reliable-network-components-in-a-distributed-separ | p24 | other | observe-at-leader, leader-observes-first, linear-order stacked with no gap; tabs hide the line above ("GlobalInv", prose "Coq formalization") |
| 2 | martin-t-vechev | 2011-PLDI-partial-coherence-abstractions-for-relaxed-memory-models | p04 | other | boxes stacked with no gap; tabs of LOAD-B, FLUSH, CAS-F cover the conclusion above (LOAD-G, STORE, CAS-T) |
| 2 | martin-t-vechev | 2011-PLDI-partial-coherence-abstractions-for-relaxed-memory-models | p07 | other | same in Sem. 3: tabs of STORE-H, STORE-S, FLUSH-H, FLUSH-SN, FENCE, CAS-F, FLUSH-E cover the conclusion above |
| 2 | martin-t-vechev | 2011-PLDI-partial-coherence-abstractions-for-relaxed-memory-models | p05 | other | mention link on the plain word "fence" in prose (also "flush" on p06, p07) |
| 2 | derek-dreyer | 2025-PLDI-refinedprosa-connecting-response-time-analysis-with-c-verifi | p14 | other | read-step-failure tab covers the grammar line above; boxes correct |
| 2 | robbert-krebbers | 2023-OOPSLA-proof-automation-for-linearizability-in-separation-logic | p11 | wrong-name | tab "◁-intro" for ▷-INTRO |
| 2 | derek-dreyer | 2016-POPL-lightweight-verification-of-separate-compilation | p05 | other | mention link on "return" in "the return state" (prose, not the RETURN rule) |
| 2 | martin-t-vechev | 2016-OOPSLA-modeling-and-analysis-of-remote-memory-access-programming | p09 | other | mention link on "lo-" (hyphenated "local") |
| 2 | derek-dreyer | 2017-POPL-a-promising-semantics-for-relaxed-memory-concurrency | p06 | other | mention links on lowercase prose words "update", "write", "happens-before" (also "promise" on p04) |
| 2 | derek-dreyer | 2022-ICFP-later-credits-resourceful-reasoning-for-the-later-modality | p26 | wrong-name | tab "InvPreAlloc N" for InvPreAlloc (premise superscript 𝒩 taken into the name) |
| 2 | robbert-krebbers | 2014-POPL-an-operational-and-axiomatic-semantics-for-non-determinism-a | p10 | other | tightly packed rules: tabs of e-base, e-free, e-load, expr, return, label, block cover the conclusion above |
| 2 | viktor-vafeiadis | 2020-PLDI-promising-2-0-global-optimizations-in-relaxed-memory-concurr | p10 | other | mention links on READ-HELPER, WRITE-HELPER stop one letter short |
| 2 | isil-dillig | 2017-OOPSLA-synthesis-of-data-completion-scripts-using-finite-tree-autom | p06 | other | every "GetCell" in prose links to the GetCell rule though it names the DSL construct (p06, p07, p10, p14, p16, p18, p22, p23, p24; p24 inside the Fig. 18 grammar); rule boxes on p12 are right |
| 2 | robbert-krebbers | 2026-PLDI-backwards-compatible-row-based-exceptions-in-ml | p08 | other | mention links shifted about one character left, clipping the last small-caps letter (p08, p09, p14, p15, p17, p18, p19) |
| 3 | robbert-krebbers | 2022-PLDI-diaframe-automated-verification-of-fine-grained-concurrent-p | p03 | wrong-name | Tab reads "locked-uniqe" for LOCKED-UNIQUE (small-caps "qu" ligature in the text layer). |
| 3 | derek-dreyer | 2020-POPL-the-future-is-ours-prophecy-variables-in-separation-logic | p08 | wrong-name | Tabs "seqence-prophecy-creation", "seqence-prophecy-simple-resolution" for SEQUENCE-… (small-caps U lost); same on p09, p10, p13. |
| 3 | derek-dreyer | 2020-POPL-the-future-is-ours-prophecy-variables-in-separation-logic | p09 | wrong-name | "seqence-prophecy-creation-typed" for SEQUENCE-PROPHECY-CREATION-TYPED. |
| 3 | derek-dreyer | 2020-POPL-the-future-is-ours-prophecy-variables-in-separation-logic | p10 | wrong-name | "seqence-prophecy-resolution" for SEQUENCE-PROPHECY-RESOLUTION; also a mention link on the rule's own premise phys_atomic(e). |
| 3 | derek-dreyer | 2020-POPL-the-future-is-ours-prophecy-variables-in-separation-logic | p13 | wrong-name | "seqence-prophecy-creation", "seqence-prophecy-simple-resolution". |
| 3 | martin-t-vechev | 2024-OOPSLA-synthetiq-fast-and-versatile-quantum-circuit-synthesis | p01 | other | Paper has no rules, so every mention link ("C√SWAP", "T-depth", incl. a figure axis label) is false: p01, p02, p11, p13, p14, p16, p17, p19–p23, p25. |
| 3 | lars-birkedal | 2019-ICFP-implementing-a-modal-dependent-type-theory | p15 | wrong-name | Tabs read "qo/var", "qo/reflect", "qo/ty", "qo/pi-tp", ... for printed QUO/VAR, QUO/REFLECT, ... (small-caps "qu" ligature); 11 rules. |
| 3 | lars-birkedal | 2021-POPL-efficient-and-provable-local-capability-revocation-using-uni | p05 | other | Mention links "SingleStep" (also p12, p14) point at the execution mode; follow-on of p13. |
| 4 | derek-dreyer | 2018-POPL-rustbelt-securing-the-foundations-of-the-rust-programming-la | p16 | wrong-name | tab reads "F-conseqence" but the rule is F-CONSEQUENCE (missing "u") |
| 4 | isil-dillig | 2022-OOPSLA-synthesizing-fine-grained-synchronization-protocols-for-impl | p38 | other | Sig box covers FRAG-STMT's rule body plus the SIG label, not SIG's rule on the right (SigOp(s) … / … ⊢ s ⇝ s') |
| 5 | lars-birkedal | 2020-ICFP-scala-step-by-step-soundness-for-dot-with-step-indexed-logic | p09 | other | P-μ-I and P-μ-E tabs draw as "P- -I" / "P- -E" because the μ glyph is missing from the tab font (same on p13; Sngl_pq-<: / Sngl_qp-<: tabs draw as "Sngl  -<:" on p10 and p14) |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p06 | other | Mention links: "Par" in "Par. 7" / "Par. 8" (short for Parameter) is linked as the PAR rule. The same happens on p08 ("Par 4") and p11 ("Par. 4") |
| 5 | derek-dreyer | 2022-POPL-concurrent-incorrectness-separation-logic | p15 | other | Mention links in Fig. 8 and in the text are shifted by one character (e.g. "R[D-LOCK]", "R[D-WRITE]": the box starts after the first letter). The same happens on p20 ("D[D-LOCK]", etc.) |
| 5 | viktor-vafeiadis | 2018-OOPSLA-persistence-semantics-for-weak-memory-integrating-epoch-pers | p16 | other | Mention links in prose are shifted left by a few characters (e.g. "(TSO-TOTA\|L)", "(TSO-P\|O)", "(TSO-R\|F1)"); same on p25 ("(NVO-TSO)", "(NVO-PSF)", "(NVO-PRE)", "(NVO-PERS)") |
| 5 | derek-dreyer | 2022-POPL-simuliris-a-separation-logic-framework-for-verifying-concurr | p14 | other | cyan mention box on "exploit_frac(c)" inside the premise of RELEASE-EXPLOIT; it's a function name, not a rule (it comes from the bogus exploit_frac rule on p23) |
| 5 | derek-dreyer | 2023-POPL-dimsum-a-decentralized-approach-to-multi-language-semantics | p19 | other | Mention link "SIM-VIS" matches a substring of the longer names NO-SIM-VIS-EX-COMM and SIM-VIS-ALL-COMM, both in the Fig. 10 labels and in the prose, so it links to the wrong rule. (Fig. 10's named principles have no inference bar and no boxes, which is consistent with the rest.) |
| 5 | viktor-vafeiadis | 2024-OOPSLA-extending-the-c-c-memory-model-with-inline-assembly | p14 | other | Mention boxes are shifted about one character left of the text (also on p11, p16, p17, p18, p22, p24: TerminateStep, Coherence-II, No-Thin-Air). The "COHERENCE-III" mention on p14 (and on p16/p18) is boxed as "COHERENCE-II" with the last "I" left outside, so it probably resolves to the wrong condition. |
| 5 | alex-aiken | 2014-PLDI-stochastic-optimization-of-floating-point-programs-with-tuna | p04 | other | Spurious mention links on the ordinary word "NaN" (also on p06 twice and p08), caused by the bogus NaN rule. |
| 5 | lars-birkedal | 2026-PLDI-iris-wasmfx-modular-reasoning-for-wasm-stack-switching | p10 | other | Small-caps mention boxes sit about one character too far left on every page of this paper (p08, p10, p11, p13, p14, p18, p19, p20): they cut off the last letter (e.g. REDUCE-SUSPEND-TRANSLA\|TE, REDUCE-LABE\|L, EWP-RESUM\|E) and take in the space before the name |
| 5 | zhendong-su | 2013-POPL-automatic-detection-of-floating-point-exceptions | p01 | other | Knock-on from the bogus rule above: every prose use of the exception name "Divide-by-Zero" is linked as a rule mention on p01, p02, p03 (including a Table 1 cell) and p10 (including the Table 3 caption) |
| 5 | alex-aiken | 2017-PLDI-synthesizing-program-input-grammars | p08 | other | Knock-on from the bogus "by" rule: the ordinary word "by" ("ruled out by the check") is linked as a rule mention |
| 5 | martin-t-vechev | 2018-PLDI-incremental-inference-for-probabilistic-programs | p16 | other | Knock-on: stray mention boxes on the Z_P and Z_Q symbols inside the Lemma 6 and Lemma 7 proofs |
| 5 | lars-birkedal | 2024-POPL-modular-denotational-semantics-for-effects-with-guarded-inte | p05 | other | Cyan mention link on the prose word "It" ("It satisfies the following rule"), which points at the fake rule "IT"; the same thing happens on p08 (the "IT" inside get_fun's type) and p14 ("It combines the computational rule...") |
| 5 | martin-t-vechev | 2018-OOPSLA-robust-relational-layout-synthesis-from-examples-for-android | p07 | other | Cyan mention link on "(Section 6)" in the prose, pointing at the fake rule "Section 6" |
| 5 | isil-dillig | 2024-POPL-programming-by-demonstration-for-long-horizon-robot-tasks | p15 | other | Mention links (not boxes) on ordinary words and code: "loop" in prose (p14, p15), code keyword `let` (p11), `goto` (p09), "disjunction" (p16). None of these refer to a rule. |
| 5 | sumit-gulwani | 2019-OOPSLA-on-the-fly-synthesis-of-edit-suggestions | p21 | other | Spurious mention links on BP-threshold / BP-transient table cells in Tables 3–5 (p20, p21), in prose (p21) and on a Fig. 8 axis label (p23). They come from the false rule boxes on p20. |
| 5 | alex-aiken | 2016-PLDI-verifying-bit-manipulations-of-floating-point | p09 | other | The RND box's tab sits on FLOP's conclusion line ("e1 ⊗f e2 ▷ ...") and hides part of it; the FLOP and RND boxes touch at that point (minor) |
| 5 | martin-t-vechev | 2019-PLDI-unsupervised-learning-of-api-aliasing-specifications | p09 | other | Table 2 boxes are packed so tightly that the Assign, FieldW, FieldR and GhostR tabs cover the premise/conclusion of the rule above or their own premise (e.g. Assign's premise "ρ(y) ⊆ ρ(x)" and FieldW's conclusion "ρ(y) ⊆ π(o,f)" are partly hidden). The boxes do not overlap and all 6 rules are covered (cosmetic) |
| 5 | lars-birkedal | 2021-POPL-mechanized-logical-relations-for-termination-insensitive-non | p08 | other | Minor: the rule boxes fit correctly and touch without overlapping, but in the packed Fig. 1 each name tab sits over the conclusion of the rule above and hides it (T-binop over T-Var, T-llam over T-app, T-tapp over T-tlam, T-match over T-pair, T-unfold over T-match, T-store over T-unpack, T-load over T-alloc). The same happens on p09 (S-tforall/S-trans, S-lforall/S-sum/S-labeled) and p16 (MWP-mono, MWP-mask-mono, MWP-bind tabs). This is only how the tabs are drawn, not a box error |
| 5 | isil-dillig | 2025-PLDI-graphiti-bridging-graph-and-relational-database-queries | p14 | other | Boxes don't overlap, but name tabs sit on top of neighbouring rules' conclusions: the Q-OrderBy tab covers the end of Q-Ret's conclusion (Π_ρ(E')), and the Q-UnionAll tab covers the end of Q-OrderBy's conclusion (OrderBy(Q',a,b)). Cosmetic only. |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p12 | other | Name tabs hide rule text: T-Let1 tab over the "Lab ≜ {(R,x,v)…" line, T-Read tab over "repeat" in T-Repeat's conclusion, T-CAS0 tab over "load" in T-Read's conclusion, T-FAA tab over T-Repeat's conclusion, T-CAS1 tab over "FAA(x,v)", T-Write tab over T-If2's conclusion. |
| 5 | viktor-vafeiadis | 2020-POPL-persistency-semantics-of-the-intel-x86-architecture | p13 | other | Boxes are correct, but tabs cover conclusion text of the rule above: M-RMW tab (M-Write), M-SF tab (M-RMW), M-FL tab (M-SF, "↦ b."), M-BPropW tab (M-FO), M-BPropFO tab (M-BPropW), M-PropW tab (M-BPropFL). Cosmetic. |
| 6 | derek-dreyer | 2016-ICFP-higher-order-ghost-state | p10 | other | Wrong PDF: the source (pure.au.dk …/3607856.pdf) is Jacobs, Hinrichsen, Krebbers, "Dependent Session Protocols in Separation Logic from First Principles" (ICFP 2023), not "Higher-order ghost state". Its boxes are correct. |
| 6 | isil-dillig | 2016-PLDI-cartesian-hoare-logic-for-verifying-k-safety-properties | p09 | other | Mention link on the English word "If" in "If it is the" points to the If rule. |
| 6 | lars-birkedal | 2018-POPL-a-logical-relation-for-monadic-encapsulation-of-state-provin | p21 | wrong-name | Tab reads "SavedPred-Eqiv", label is SAVEDPRED-EQUIV. |
| 6 | robbert-krebbers | 2020-OOPSLA-knowing-when-to-ask-sound-scheduling-of-name-resolution-in-t | p12 | wrong-name | The tab reads "Eqivalent" but the label is EQUIVALENT (small-caps "qu" ligature read as q). |
| 6 | viktor-vafeiadis | 2021-POPL-persevere-persistency-semantics-for-verification-under-ext4 | p22 | other | Two mention links on "[REC]" in "[REC]; rb; pb; rf; [REC]" point to the rule, but here [REC] is the set of recovery events. |
| 6 | viktor-vafeiadis | 2022-POPL-extending-intel-x86-consistency-and-persistency-formalising | p20 | other | Mention link covers only "M-PropFL" of "M-PropFL+FO+SF" (name cut at "+"). |
| 6 | isil-dillig | 2023-OOPSLA-data-extraction-via-semantic-regular-expression-synthesis | p07 | other | Mention links on small-caps rule names in prose sit about one character too far left and cut off the last letter (TRANS/SEMANTIC p07; CONCRETE-INFEASIBLE/HOLE-INFEASIBLE/HOLE-FEASIBLE p12; SKETCH-NESTED-FAIL/HOLE-FAIL p17; CONST-SEMANTIC, STAR-2, OPTIONAL, CONST-CHARSEQ, HOLE-FEASIBLE p30–p32). Rule boxes are all correct. |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p04 | wrong-name | Tab reads "link-qeue-lat", label is LINK-QUEUE-LAT (small-caps "qu" read as q). |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p05 | wrong-name | Tab reads "link-qeue-ghost", label is LINK-QUEUE-GHOST. |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p18 | other | make-ghost-link-self's tab covers part of make-ghost-link's formula; make-ghost-link's tab covers "Enq e" in the enqueue spec line above. |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p22 | other | proto-send's tab covers "True ⇛∗" at the start of PROTO-ALLOC; proto-symmetric's tab covers "prot_own" in PROTO-SEND. |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p23 | wrong-name | Tab reads "uniqe", label is UNIQUE. |
| 6 | robbert-krebbers | 2024-OOPSLA-verified-lock-free-session-channels-with-linking | p23 | other | Tabs cover the rule above: symmetric's tab covers "R a a' ⊢" in IRREFLEXIVE, pair-update's covers "⇆γ R ∗" in PAIR-ADD. |
| 6 | ranjit-jhala | 2025-POPL-generic-refinement-types | p16 | wrong-name | Tabs read "≡ /l" and "≡ /r"; labels are ≡κ/L and ≡κ/R (math-italic κ dropped, likely a tab-font glyph). |

## Clean papers (union of Clean lists)

- sumit-gulwani/2010-POPL-continuity-analysis-of-programs (share 3)
- viktor-vafeiadis/2010-POPL-structuring-the-verification-of-heap-manipulating-programs (share 5)
- martin-t-vechev/2011-PLDI-partial-coherence-abstractions-for-relaxed-memory-models (share 2) (also has mention-link / tab lines)
- viktor-vafeiadis/2011-POPL-relaxed-memory-concurrency-and-verified-compilation (share 1)
- ranjit-jhala/2012-OOPSLA-dependent-types-for-javascript (share 2)
- ranjit-jhala/2012-PLDI-verifying-gpu-kernels-by-test-amplification (share 6)
- ranjit-jhala/2015-ICFP-bounded-refinement-types (share 3)
- ranjit-jhala/2016-ICFP-dynamic-witnesses-for-static-type-errors-or-ill-typed-progra (share 1)
- martin-t-vechev/2016-OOPSLA-probabilistic-model-for-code-with-decision-trees (share 3)
- alex-aiken/2016-PLDI-verifying-bit-manipulations-of-floating-point (share 5) (also has mention-link / tab lines)
- derek-dreyer/2016-POPL-lightweight-verification-of-separate-compilation (share 2) (also has mention-link / tab lines)
- viktor-vafeiadis/2016-POPL-taming-release-acquire-consistency (share 3)
- isil-dillig/2017-OOPSLA-synthesis-of-data-completion-scripts-using-finite-tree-autom (share 2) (also has mention-link / tab lines)
- derek-dreyer/2018-ICFP-mtac2-typed-tactics-for-backward-reasoning-in-coq (share 6)
- martin-t-vechev/2018-PLDI-bayonet-probabilistic-inference-for-networks (share 6)
- isil-dillig/2018-POPL-program-synthesis-using-abstraction-refinement (share 2)
- viktor-vafeiadis/2019-OOPSLA-weak-persistency-semantics-from-the-ground-up-formalising-th (share 2)
- martin-t-vechev/2019-PLDI-unsupervised-learning-of-api-aliasing-specifications (share 5) (also has mention-link / tab lines)
- derek-dreyer/2020-POPL-stacked-borrows-an-aliasing-model-for-rust (share 2)
- derek-dreyer/2020-POPL-the-high-level-benefits-of-low-level-sandboxing (share 1)
- lars-birkedal/2021-ICFP-client-server-sessions-in-linear-logic (share 2)
- lars-birkedal/2021-ICFP-theorems-for-free-from-separation-logic-specifications (share 1)
- robbert-krebbers/2021-POPL-intrinsically-typed-compilation-with-nameless-labels (share 3)
- lars-birkedal/2022-OOPSLA-le-temps-des-cerises-efficient-temporal-stack-safety-on-capa (share 6)
- sumit-gulwani/2022-OOPSLA-neurosymbolic-repair-for-low-code-formula-languages (share 6)
- derek-dreyer/2022-PLDI-islaris-verification-of-machine-code-against-authoritative-i (share 4)
- isil-dillig/2022-POPL-soltype-refinement-types-for-arithmetic-overflow-in-solidity (share 3)
- robbert-krebbers/2023-ICFP-dependent-session-protocols-in-separation-logic-from-first-p (share 3)
- ranjit-jhala/2023-PLDI-flux-liquid-types-for-rust (share 5)
- isil-dillig/2023-PLDI-imageeye-batch-image-processing-using-program-synthesis (share 5)
- lars-birkedal/2023-PLDI-iris-wasm-robust-and-modular-verification-of-webassembly-pro (share 4)
- derek-dreyer/2023-POPL-dimsum-a-decentralized-approach-to-multi-language-semantics (share 5) (also has mention-link / tab lines)
- robbert-krebbers/2024-OOPSLA-multris-functional-verification-of-multiparty-message-passin (share 4)
- lars-birkedal/2024-OOPSLA-tachis-higher-order-separation-logic-with-credits-for-expect (share 3)
- isil-dillig/2024-PLDI-from-batch-to-stream-automatic-generation-of-online-algorith (share 6)
- isil-dillig/2024-POPL-programming-by-demonstration-for-long-horizon-robot-tasks (share 5) (also has mention-link / tab lines)
- lars-birkedal/2024-POPL-trillium-higher-order-concurrent-and-distributed-separation (share 3)
- isil-dillig/2025-OOPSLA-active-learning-for-neurosymbolic-program-synthesis (share 1)
- isil-dillig/2025-PLDI-graphiti-bridging-graph-and-relational-database-queries (share 5) (also has mention-link / tab lines)
- derek-dreyer/2025-PLDI-refinedprosa-connecting-response-time-analysis-with-c-verifi (share 2) (also has mention-link / tab lines)
- derek-dreyer/2026-ICFP-mode-crossing (share 3)
- alex-aiken/2026-OOPSLA-fully-automatic-type-inference-for-borrows-with-lifetimes (share 1)
- lars-birkedal/2026-PLDI-modular-verification-of-differential-privacy-in-probabilisti (share 3)
