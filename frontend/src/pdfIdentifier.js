// The identifier a chosen PDF prints, read here in the browser.
//
// A paper's DOI or arXiv id is on its first pages, and laying those out
// with PDF.js is CPU the browser has and the Worker does not. The upload
// sends what was found along with the file's name, and the Worker asks
// the indexes about it directly, without fetching the PDF or asking the
// host to read it. Nothing here is worth a dialog: a PDF that cannot be
// read, or takes too long, uploads without an identifier, and the
// Worker reads it as it would have anyway.

import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { identifierIn } from '../../shared/identifiers.js';

// Where an identifier is printed: the front matter, and a footer or two.
export const PAGES_READ = 3;
// Longer than this and the upload goes on without it.
export const READING_TIMEOUT_MS = 20_000;

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

// The text of the first pages of a PDF's bytes, as one string.
export async function firstPagesText(bytes, pages = PAGES_READ) {
  const lib = await pdfjs();
  // Text only: no fonts are loaded, and the warning that the standard
  // ones could not be is not worth the console.
  const task = lib.getDocument({ data: bytes, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    const texts = [];
    for (let number = 1; number <= Math.min(pages, pdf.numPages); number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return texts.join('\n');
  } finally {
    task.destroy().catch(() => {});
  }
}

// The identifier a PDF's first pages print, `{ doi }` or `{ arxiv_id }`,
// or null when none is printed, the file could not be read, or the
// reading took longer than an upload should wait.
export async function readIdentifier(file) {
  let timer;
  const gaveUp = new Promise((resolve) => { timer = setTimeout(() => resolve(null), READING_TIMEOUT_MS); });
  const read = (async () => identifierIn(await firstPagesText(new Uint8Array(await file.arrayBuffer()))))();
  try {
    return await Promise.race([read, gaveUp]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    read.catch(() => {});
  }
}
