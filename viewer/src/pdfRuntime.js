import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// PDF.js is most of the viewer's JavaScript. Its module fetch/compilation can
// overlap the React shell, native byte transfer, and local metadata reads.
const workerPort = new Worker(workerUrl, { type: 'module' });
export const pdfjsReady = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
  pdfjs.GlobalWorkerOptions.workerPort = workerPort;
  return pdfjs;
});

// Pieces of the pdf.js viewer Papol uses (its find controller), loaded when
// first wanted: the module is large and most readings never search. It
// reads the core library from a global as it loads.
let viewerReady = null;
export const pdfViewerReady = () => {
  viewerReady ??= pdfjsReady.then((pdfjs) => {
    globalThis.pdfjsLib ??= pdfjs;
    return import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
  });
  return viewerReady;
};
