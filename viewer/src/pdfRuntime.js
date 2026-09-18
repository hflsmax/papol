import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// PDF.js is most of the viewer's JavaScript. Its module fetch/compilation can
// overlap the React shell, native byte transfer, and local metadata reads.
const workerPort = new Worker(workerUrl, { type: 'module' });
export const pdfjsReady = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
  pdfjs.GlobalWorkerOptions.workerPort = workerPort;
  return pdfjs;
});
