// A PDF read whole on the host, through unpdf (pdf.js's build for
// servers), page by page as page.ts reads each one.

import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { readPage, type PdfPage } from "./page";
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
    try {
      const meta = (await proxy.getMetadata()).info as { Title?: unknown; Author?: unknown };
      info = { title: typeof meta?.Title === "string" ? meta.Title.trim() : "", author: typeof meta?.Author === "string" ? meta.Author.trim() : "" };
    } catch { /* a PDF with no readable Info dictionary has none */ }
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
