import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// PDF.js is most of the viewer's JavaScript. Its module fetch/compilation can
// overlap the React shell, native byte transfer, and local metadata reads.
let workerPort = null;
if (typeof Worker === 'function') {
  try {
    workerPort = new Worker(workerUrl, { type: 'module' });
  } catch {
    // PDF.js retains its own well-tested worker fallback below.
  }
}
export const pdfjsReady = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
  if (workerPort) pdfjs.GlobalWorkerOptions.workerPort = workerPort;
  else pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
});
