// What a PDF's first pages print, read in the browser before it is sent:
// its DOI or arXiv id (identifiers.js) and its title block — title,
// authors, venue, year — by the analyzer's own rules
// (analyzer/src/rules/header.ts). The Worker has too little CPU to
// lay out a page, so an upload carries both, and the server asks the
// indexes from them and fills what they do not know from the title block.

import { identifierInDocument } from './identifiers.js';

// The rules are loaded with the first PDF read, not with the page.
const rules = () => import('../analyzer/src/rules/header.ts');

// `{ doi }` or `{ arxiv_id }` with `title_block`, or null when the pages
// print neither. `OPS` is the PDF.js build's operator list table.
export async function printedInDocument(pdf, OPS) {
  const [identifier, titleBlock] = await Promise.all([
    identifierInDocument(pdf),
    rules().then(({ readHeader }) => readHeader(pdf, OPS)).catch(() => null),
  ]);
  const read = titleBlock && Object.values(titleBlock).some((value) => (Array.isArray(value) ? value.length : value)) ? titleBlock : null;
  if (!identifier && !read) return null;
  return { ...(identifier || {}), ...(read ? { title_block: read } : {}) };
}
