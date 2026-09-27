// A PDF file read in Node, through unpdf (pdf.js's build for servers),
// page by page as page.ts reads each one: for the scripts and tests that
// measure the rules on a corpus. The browser reads its own documents
// (page.ts, readPages).

import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { infoOf, readPage, type PdfDocument, type PdfPage } from "./page";
import type { Doc, Page } from "./page";

export type { Doc, Drawn, Page, Run } from "./page";
export { offsetsOf } from "./page";

// `pages`, when given, reads only that many from the front: a title block
// is on the first.
export async function readPdf(bytes: Uint8Array, { pages: limit }: { pages?: number } = {}): Promise<Doc> {
  const { OPS } = await getResolvedPDFJS();
  // pdf.js takes ownership of the buffer it is given.
  const proxy = await getDocumentProxy(new Uint8Array(bytes));
  const pages: Page[] = [];
  let info = { title: "", author: "" };
  try {
    info = await infoOf(proxy as unknown as PdfDocument);
    for (let number = 1; number <= Math.min(proxy.numPages, limit ?? Infinity); number += 1) {
      const page = await proxy.getPage(number);
      pages.push(await readPage(page as unknown as PdfPage, number, OPS as unknown as Record<string, number>));
      page.cleanup();
    }
  } finally {
    await (proxy as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
  return { pages, info };
}
