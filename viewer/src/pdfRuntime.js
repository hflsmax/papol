import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// PDF.js is most of the viewer's JavaScript. Its module fetch/compilation can
// overlap the React shell, native byte transfer, and local metadata reads.
const workerPort = new Worker(workerUrl, { type: 'module' });
export const pdfjsReady = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
  pdfWorker = new pdfjs.PDFWorker({ port: workerPort });
  return pdfjs;
});

// The one worker every document is opened with, passed to getDocument by
// name. Left for pdf.js to find from a global port, it would belong to
// whichever document took it last, and closing that document would tear
// it down under the next one ("the worker is being destroyed").
let pdfWorker = null;
export const documentWorker = () => pdfWorker;

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
