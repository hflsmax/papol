# Interaction performance benchmarks

Performance work on an interaction needs two kinds of evidence: a small,
deterministic benchmark for the operation being changed and a browser benchmark
for what the reader actually sees. A faster helper does not by itself prove a
smoother frame sequence.

## PDF pinch zoom

Run the geometry microbenchmark from `viewer/`:

```sh
npm run benchmark:pinch
```

It models 1,200 zoom frames over 120 pages and compares repeated DOM discovery
with the page cache. Use it to catch lookup regressions and report both elapsed
time and selector-call counts. Its synthetic elements do not perform browser
layout or paint, so do not use its speedup as a smoothness claim.

Run the end-to-end browser benchmark with:

```sh
npm run benchmark:pinch:smoothness
```

The harness starts an isolated Vite server and headless Chrome, serves the real
15-page Attention PDF, and uses the desktop opened-file path. For each fresh
load it waits for the first canvas and text layer. This is the point where the
viewer looks loaded but background page previews are still warming—the state
that exposed the original hitch.

Each sample then:

1. Scrolls to four document positions containing lazy page shells.
2. Dispatches the first pinch burst without yielding after the scroll.
3. Sends four control-wheel pinch events per animation frame for 60 frames.
4. Alternates zoom-in and zoom-out sessions to avoid hitting scale limits.
5. Allows 300 ms for the gesture to settle before moving to the next position.

The legacy and optimized paths each get three fresh loads by default. Their
order alternates so the second implementation does not consistently benefit
from warm caches or CPU frequency changes. Every completed Chrome target is
closed so its PDF rendering cannot contaminate later samples.

The benchmark reports:

- input-to-visual-frame latency at p50, p95, p99, and maximum;
- animation-frame intervals and counts above 20 ms and 33.34 ms;
- synchronous zoom-handler work;
- missed visual updates;
- browser long-task count and duration;
- lazy pages remaining after each session, proving that mounting happened
  during the workload.

Intentional 300 ms settle periods must not be included in frame-gap metrics.
Reset the previous-frame timestamp at every session boundary. This mistake can
make a healthy implementation appear to drop one frame per session.

For a slower-machine stress pass:

```sh
PAPOL_BENCHMARK_RUNS=5 PAPOL_BENCHMARK_CPU=4 \
  npm run benchmark:pinch:smoothness
```

`PAPOL_BENCHMARK_RUNS` controls fresh loads per implementation and
`PAPOL_BENCHMARK_CPU` controls Chrome's CPU throttling factor. On macOS the
harness uses Google Chrome from `/Applications` by default. Set
`PAPOL_BENCHMARK_CHROME` to another Chrome-compatible executable when needed.

## Interpreting results

Prioritize p95/p99 and worst-frame intervals over mean throughput. A single
100–200 ms frame is visible as a broken gesture even when the median remains
16.7 ms. Check missed updates as well: coalescing several events into one frame
is expected, but every requested visual frame in this harness should change the
scale.

Run the benchmark several times when tail results differ by only a few
milliseconds. Headless Chrome, process scheduling, and thermal state add noise.
A useful change should improve the relevant tail repeatedly or remove a known
source of competing main-thread work.

The browser harness validates event handling, PDF.js contention, layout, and
animation scheduling. It does not synthesize a physical macOS trackpad or run
inside Tauri's WebKit view. Finish interaction work with a manual check on that
runtime, especially when changing Safari `gesturestart`/`gesturechange`/
`gestureend` behavior.

## Adding another interaction benchmark

Keep the same structure:

1. Reproduce the user's timing and application state, not only the final UI.
2. Define an in-product legacy switch that changes only the behavior under
   comparison and is activated solely by the benchmark URL.
3. Use fresh browser targets, alternate run order, and close every target.
4. Measure response latency, frame intervals, synchronous work, long tasks, and
   correctness in the same run.
5. Separate intentional waits from active-interaction frames.
6. Include deterministic unit tests for scheduling, cancellation, and lost
   input independently of the timing benchmark.
7. State what the harness cannot represent and perform the relevant manual
   platform check.
