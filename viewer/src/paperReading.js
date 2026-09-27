import { pdfjsReady } from './pdfRuntime.js';
import { keepReading, keptReading } from './readingCache.js';

/**
 * A paper read in the browser by the analyzer's rules
 * (analyzer/src/rules/paper.ts): its references, the citations that
 * point at them, the links to its figures, tables, sections and footnotes,
 * and its printed headings, which the Navigator falls back on when the PDF
 * has no outline.
 *
 * It is read from the document the viewer already has, so a paper opened
 * from disk is read the same as one from the library, and offline. Nothing
 * is kept anywhere: the reading is always the rules' current one. The pages
 * are read one per idle moment, so reading never stands between the reader
 * and the page they are on; most of that is pdf.js's own worker. The rules
 * then run in a worker of their own (readingWorker.js). `onProgress` is told
 * how far through the pages the reading is, from 0 to 1.
 *
 * A paper read before on this device, by the same rules, is not read
 * again (readingCache.js): its reading is there at once, with no progress
 * to show.
 *
 * Resolves to { headings, analysis }, or null when cancelled.
 */
export async function readPaper(doc, { cancelled = () => false, onProgress } = {}) {
  const started = performance.now();
  const kept = await keptReading(doc);
  if (cancelled()) return null;
  if (kept) {
    measure(started, doc, true);
    return kept;
  }
  const [{ readPages }, pdfjs] = await Promise.all([
    import('../../analyzer/src/rules/page.ts'),
    pdfjsReady,
  ]);
  if (cancelled()) return null;
  onProgress?.(0);
  const pages = await readPages(doc, pdfjs.OPS, {
    cancelled,
    pause: idle,
    onPage: (read, of) => onProgress?.(read / of),
  });
  if (!pages || cancelled()) return null;
  const read = await inWorker(pages, cancelled);
  if (!read) return null;
  const paper = { headings: read.headings, analysis: viewerAnalysis(read.analysis) };
  keepReading(doc, paper);
  measure(started, doc, false);
  return paper;
}

/**
 * The analysis as the viewer draws it: the shape the Worker once served
 * from its tables, keyed by the analyzer's own keys. A reference's `uuid`
 * is its key ("b11"), a float's is its key, and a citation names the
 * references it means. A marker that names none of them leads nowhere and
 * is left out.
 */
export function viewerAnalysis(analysis) {
  const keys = new Set(analysis.references.map((r) => r.key));
  return {
    status: 'ready',
    detail: null,
    references: analysis.references.map((r) => ({
      ...r,
      uuid: r.key,
      resolved_status: null,
      resolution: null,
      papol_paper_sha256: null,
    })),
    citations: analysis.citations
      .map((c) => ({
        reference_uuids: c.keys.filter((key) => keys.has(key)),
        label: c.label ?? null,
        inferred: Boolean(c.inferred),
        boxes: c.boxes.map(({ page, x, y, w, h }) => ({ page, x, y, w, h })),
      }))
      .filter((c) => c.reference_uuids.length && c.boxes.length),
    floats: analysis.floats.map((f) => ({ uuid: f.key, kind: f.kind, label: f.label, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h })),
    links: analysis.links.map((l) => ({ float_uuid: l.float, label: l.label ?? null, page: l.page, x: l.x, y: l.y, w: l.w, h: l.h })),
  };
}

/** What the viewer shows while the paper is being read. */
export const READING = Object.freeze({ status: 'pending', detail: null, references: [], citations: [], floats: [], links: [] });

/** What it shows when the reading failed: no references, and no error bar. */
export const UNREAD = Object.freeze({ status: 'failed', detail: null, references: [], citations: [], floats: [], links: [] });

/**
 * A reference's card from what is printed alone, for when nobody can look
 * it up: a paper opened from disk, or no network. The same card the Worker
 * makes when the indexes know nothing (cloudflare/src/papers/references.ts,
 * bibliographyCard).
 */
export function printedCard(reference) {
  const raw = reference.raw ?? '';
  let url = null;
  if (reference.doi) url = `https://doi.org/${reference.doi}`;
  else if (reference.arxiv_id) url = `https://arxiv.org/abs/${String(reference.arxiv_id).replace(/^arxiv:\s*/i, '')}`;
  const years = raw.match(/\b(?:19|20)\d{2}\b/g);
  return {
    ...reference,
    resolved_status: 'bibliography',
    resolution: {
      title: reference.title || raw.slice(0, 240).trim().replace(/[.,]+$/, '') || 'Cited reference',
      authors: Array.isArray(reference.authors) ? reference.authors : [],
      year: reference.year ?? (years ? Number(years[years.length - 1]) : null),
      venue: reference.journal ?? null,
      url,
      source: 'bibliography',
    },
  };
}

// How long the reading took, for the browser's performance tools
// (Performance panel, or performance.getEntriesByName('papol:reading')).
function measure(start, doc, kept) {
  try {
    performance.measure('papol:reading', { start, detail: { pages: doc.numPages, kept } });
  } catch {
    // A browser without measure details reads the same.
  }
}

function inWorker(pages, cancelled) {
  const worker = new Worker(new URL('./readingWorker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    // A document closed while the rules run takes their answer with it.
    const watch = window.setInterval(() => {
      if (!cancelled()) return;
      finish();
      resolve(null);
    }, 250);
    const finish = () => {
      window.clearInterval(watch);
      worker.terminate();
    };
    worker.onmessage = ({ data }) => {
      finish();
      if (data?.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'The analyzer rules failed'));
    };
    worker.postMessage({ pages });
  });
}

const idle = () => new Promise((resolve) => {
  if (window.requestIdleCallback) window.requestIdleCallback(() => resolve(), { timeout: 1000 });
  else window.setTimeout(resolve, 0);
});
