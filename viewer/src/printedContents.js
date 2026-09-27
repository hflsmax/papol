import { pdfjsReady } from './pdfRuntime.js';

/**
 * The headings printed in a paper, read by the analyzer's rules
 * (host/analyzer/src/rules/contents.ts) for a paper whose PDF has no
 * outline: what readSections falls back on.
 *
 * Nothing of it is loaded until such a paper is open. The pages are read
 * from the document the viewer already has, one per idle moment, so reading
 * never stands between the reader and the page they are on; most of that
 * is pdf.js's own worker. The rules then run in a worker of their own
 * (contentsWorker.js). `onProgress` is told how far through the pages the
 * reading is, from 0 to 1.
 */
export async function readPrintedHeadings(doc, { cancelled = () => false, onProgress } = {}) {
  const [{ readPages }, pdfjs] = await Promise.all([
    import('../../host/analyzer/src/rules/page.ts'),
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
  return inWorker(pages, cancelled);
}

function inWorker(pages, cancelled) {
  const worker = new Worker(new URL('./contentsWorker.js', import.meta.url), { type: 'module' });
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
      else resolve(data?.headings ?? []);
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'The heading rules failed'));
    };
    worker.postMessage({ pages });
  });
}

const idle = () => new Promise((resolve) => {
  if (window.requestIdleCallback) window.requestIdleCallback(() => resolve(), { timeout: 1000 });
  else window.setTimeout(resolve, 0);
});
