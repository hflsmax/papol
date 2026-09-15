import { performance } from 'node:perf_hooks';
import { createZoomPageCache } from '../viewer/src/pinchZoom.js';

const PAGES = 120;
const FRAMES = 1_200;
const RUNS = 15;

function documentFixture() {
  let rootQueries = 0;
  let innerQueries = 0;
  const pages = Array.from({ length: PAGES }, () => ({
    isConnected: true,
    dataset: { pageWidth: '612', pageHeight: '792', renderScale: '1' },
    style: {},
    querySelector() { innerQueries += 1; return { style: {} }; },
  }));
  return {
    root: { querySelectorAll() { rootQueries += 1; return pages; } },
    counts: () => ({ rootQueries, innerQueries }),
  };
}

function apply(entries, scale) {
  for (const { page, inner } of entries) {
    page.style.width = `${Number(page.dataset.pageWidth) * scale}px`;
    page.style.height = `${Number(page.dataset.pageHeight) * scale}px`;
    inner.style.transform = `scale(${scale / Number(page.dataset.renderScale)})`;
  }
}

function sample(cached, applyStyles = true) {
  const fixture = documentFixture();
  const cache = createZoomPageCache();
  const started = performance.now();
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const entries = cached
      ? cache.get(fixture.root)
      : [...fixture.root.querySelectorAll('.pdf-page')].map((page) => ({
        page, inner: page.querySelector(':scope > .page-inner'),
      }));
    if (applyStyles) apply(entries, 0.8 + (frame % 120) / 100);
  }
  return { duration: performance.now() - started, ...fixture.counts() };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
// Warm both paths before measuring and alternate their order so JIT and CPU
// frequency changes cannot consistently favour the second implementation.
for (let run = 0; run < 5; run += 1) {
  sample(false);
  sample(true);
  sample(false, false);
  sample(true, false);
}
const legacy = [];
const optimized = [];
const legacyLookup = [];
const optimizedLookup = [];
for (let run = 0; run < RUNS; run += 1) {
  const order = run % 2 ? [true, false] : [false, true];
  for (const cached of order) {
    (cached ? optimized : legacy).push(sample(cached));
    (cached ? optimizedLookup : legacyLookup).push(sample(cached, false));
  }
}
const legacyMs = median(legacy.map(({ duration }) => duration));
const optimizedMs = median(optimized.map(({ duration }) => duration));
const legacyLookupMs = median(legacyLookup.map(({ duration }) => duration));
const optimizedLookupMs = median(optimizedLookup.map(({ duration }) => duration));

console.log(JSON.stringify({
  scenario: { pages: PAGES, frames: FRAMES, runs: RUNS },
  fullFrameMedianMs: { legacy: +legacyMs.toFixed(2), optimized: +optimizedMs.toFixed(2) },
  fullFrameSpeedup: +(legacyMs / optimizedMs).toFixed(2),
  geometryLookupMedianMs: {
    legacy: +legacyLookupMs.toFixed(2), optimized: +optimizedLookupMs.toFixed(2),
  },
  geometryLookupSpeedup: +(legacyLookupMs / optimizedLookupMs).toFixed(2),
  selectorCalls: {
    legacy: legacy[0].rootQueries + legacy[0].innerQueries,
    optimized: optimized[0].rootQueries + optimized[0].innerQueries,
  },
  selectorReductionPct: +(
    (1 - (optimized[0].rootQueries + optimized[0].innerQueries)
      / (legacy[0].rootQueries + legacy[0].innerQueries)) * 100
  ).toFixed(2),
}, null, 2));
