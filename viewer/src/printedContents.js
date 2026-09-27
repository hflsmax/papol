import { pdfjsReady } from './pdfRuntime.js';

/**
 * The headings printed in a paper, read by the analyzer's rules
 * (host/analyzer/src/rules/contents.ts) for a paper whose PDF has no
 * outline: what readSections falls back on.
 *
 * The rules are loaded only for such a paper, and they read the document
 * the viewer already has open, a page at a time when the browser is idle,
 * so a paper that reads slowly — hundreds of pages, or plots drawn stroke
 * by stroke — keeps the page it is on responsive while it is read.
 */
export async function readPrintedHeadings(doc, { cancelled = () => false } = {}) {
  const [{ readContents }, pdfjs] = await Promise.all([
    import('../../host/analyzer/src/rules/contents.ts'),
    pdfjsReady,
  ]);
  if (cancelled()) return null;
  return readContents(doc, pdfjs.OPS, { cancelled, pause: idle });
}

const idle = () => new Promise((resolve) => {
  if (window.requestIdleCallback) window.requestIdleCallback(() => resolve(), { timeout: 1000 });
  else window.setTimeout(resolve, 0);
});
