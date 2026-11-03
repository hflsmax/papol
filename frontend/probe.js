// Temporary WebKit probe for the title-block reader (not for merge).
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { identifierInDocument } from '../shared/identifiers.js';
window.probe = async (bytes) => {
  const out = {};
  try {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const worker = new lib.PDFWorker({ port: new Worker(workerUrl, { type: 'module' }) });
    const doc = await lib.getDocument({ data: bytes, worker, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
    out.pages = doc.numPages;
    try { out.id = await identifierInDocument(doc); } catch (e) { out.idError = String(e && e.stack || e); }
    try { const { readHeader } = await import('../analyzer/src/rules/header.ts'); out.header = await readHeader(doc, lib.OPS); } catch (e) { out.headerError = String(e) + '\n' + (e && e.stack); }
    try { const p = await doc.getPage(1); const t = await p.getTextContent(); out.page1Items = t.items.slice(0, 15).map((i) => [i.str, i.fontName, i.transform, i.width]); } catch (e) { out.textError = String(e && e.stack || e); }
  } catch (e) { out.error = String(e && e.stack || e); }
  return out;
};
window.ready = true;
