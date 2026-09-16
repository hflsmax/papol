const HASH = 'a'.repeat(64);
const ACCOUNT = '77777777-7777-4777-8777-777777777777';
const PAPER_DELAY_MS = 100;
const ANNOTATION_DELAY_MS = 150;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const elapsed = (started) => Math.round(performance.now() - started);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const RUNS = 5;

globalThis.localStorage = {
  getItem: (key) => (key === 'papol.localAccountUuid' ? ACCOUNT : null),
  setItem() {},
  removeItem() {},
};
globalThis.location = new URL(`http://127.0.0.1/viewer/?pdf=${HASH}`);
globalThis.window = {
  location: globalThis.location,
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'viewer', documentWindow: true },
  __TAURI_INTERNALS__: {
    transformCallback: () => 1,
    invoke: async (command, args = {}) => {
      if (command !== 'data_query') return null;
      if (args.queryName === 'paper_by_pdf' || args.queryName === 'paper') {
        await wait(PAPER_DELAY_MS);
        return {
          uuid: ACCOUNT,
          title: 'Benchmark paper',
          sha256: HASH,
        };
      }
      if (args.queryName === 'comments') {
        await wait(ANNOTATION_DELAY_MS);
        return [];
      }
      return [];
    },
  },
  addEventListener() {},
  dispatchEvent() {},
};
globalThis.Event = class Event {
  constructor(type) { this.type = type; }
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: false }, configurable: true,
});

const viewer = await import('../viewer/src/api.js');
const papers = await import('../shared/api/papers.js');

const measurements = [];
for (let run = 0; run < RUNS; run += 1) {
  let started = performance.now();
  const viewerPaper = await viewer.getPaperByPdf(HASH);
  const viewerPaperReady = elapsed(started);
  await viewer.getPaperNotes(viewerPaper);
  const viewerNotesReady = elapsed(started);

  started = performance.now();
  await papers.getPaper(ACCOUNT);
  const paperDetailReady = elapsed(started);
  measurements.push({ viewerPaperReady, viewerNotesReady, paperDetailReady });
}

console.log(JSON.stringify({
  runs: RUNS,
  configuredDelaysMs: { paper: PAPER_DELAY_MS, annotations: ANNOTATION_DELAY_MS },
  medianMs: {
    viewerPaperReady: median(measurements.map((sample) => sample.viewerPaperReady)),
    viewerNotesReady: median(measurements.map((sample) => sample.viewerNotesReady)),
    paperDetailReady: median(measurements.map((sample) => sample.paperDetailReady)),
  },
  measurements,
}, null, 2));
