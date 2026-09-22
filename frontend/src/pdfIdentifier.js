// The identifier a chosen PDF prints, read here in the browser.
//
// A paper's DOI or arXiv id is on its first pages, and laying those out
// with PDF.js is CPU the browser has and the Worker does not. The upload
// sends what was found along with the file's name, and the Worker asks
// the indexes about it directly, without fetching the PDF or asking the
// host to read it. The reading itself is shared/identifiers.js, which
// the viewer's "Add to nook" uses on the document it has open.

import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { identifierInDocument, identifierWithin } from '../../shared/identifiers.js';

// PDF.js is loaded the first time a file is chosen, not with the page:
// it is most of a megabyte, and the library page has no other use for it.
let runtime = null;
function pdfjs() {
  runtime ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });
    return lib;
  });
  return runtime;
}

// The identifier in a PDF's bytes, read from a document opened for it.
async function identifierInBytes(bytes) {
  const lib = await pdfjs();
  // Text only: no fonts are loaded, and the warning that the standard
  // ones could not be is not worth the console.
  const task = lib.getDocument({ data: bytes, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  try {
    return await identifierInDocument(await task.promise);
  } finally {
    task.destroy().catch(() => {});
  }
}

// The identifier a PDF's first pages print, `{ doi }` or `{ arxiv_id }`,
// or null when none is printed, the file could not be read, or the
// reading took longer than an upload should wait.
export function readIdentifier(file) {
  return identifierWithin((async () => identifierInBytes(new Uint8Array(await file.arrayBuffer())))());
}
