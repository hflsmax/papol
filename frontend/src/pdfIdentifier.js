// What a chosen PDF prints, read here in the browser.
//
// A paper's DOI or arXiv id and its title block are on its first pages,
// and laying those out with PDF.js is CPU the browser has and the Worker
// does not. The upload sends what was found along with the file's name,
// and the Worker asks the indexes about it directly, without fetching the
// PDF. The reading itself is shared/printed.js, which the viewer's "Add
// to nook" uses on the document it has open.

import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { identifierWithin } from '../../shared/identifiers.js';
import { printedInDocument } from '../../shared/printed.js';

// PDF.js is loaded the first time a file is chosen, not with the page:
// it is most of a megabyte, and the library page has no other use for it.
// Its worker is kept for every reading and handed to each by name, so a
// reading being put away never takes it from the next one (a file chosen
// again at once would otherwise be read as having no identifier).
let runtime = null;
function pdfjs() {
  runtime ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((lib) => ({
    lib,
    worker: new lib.PDFWorker({ port: new Worker(workerUrl, { type: 'module' }) }),
  }));
  return runtime;
}

// What a PDF's bytes print, read from a document opened for it.
async function identifierInBytes(bytes) {
  const { lib, worker } = await pdfjs();
  // Text only: no fonts are loaded, and the warning that the standard
  // ones could not be is not worth the console.
  const task = lib.getDocument({ data: bytes, worker, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  try {
    return await printedInDocument(await task.promise, lib.OPS);
  } finally {
    task.destroy().catch(() => {});
  }
}

// What a PDF's first pages print, `{ doi }` or `{ arxiv_id }` with its
// `title_block` (shared/printed.js), or null when nothing is printed, the file could not be read, or the
// reading took longer than an upload should wait.
export function readIdentifier(file) {
  return identifierWithin((async () => identifierInBytes(new Uint8Array(await file.arrayBuffer())))());
}

// What the PDF at `href` prints, as readIdentifier reads a chosen file: a
// paper read again from its jacket. Null when it cannot be fetched.
export function readPrintedAt(href) {
  return identifierWithin((async () => {
    const response = await fetch(href, { credentials: 'include' });
    if (!response.ok) return null;
    return identifierInBytes(new Uint8Array(await response.arrayBuffer()));
  })());
}
