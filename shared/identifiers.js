// Identifiers printed in a paper: a DOI, an arXiv number.
//
// The port of cloudflare/src/papers/identifiers.ts for the browser, which
// reads an upload's first pages before the Worker sees the paper
// (frontend/src/pdfIdentifier.js) and sends what it found along with the
// upload. The two must agree, so a change to one is a change to the other.

const ARXIV_ID = /(?:arXiv\s*:\s*|arxiv\s*\.\s*org\s*\/\s*abs\s*\/\s*)((?:\d{4}\s*\.\s*\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\s*\/\s*\d{7})(?:v\d+)?)/i;
const DOI = /10\.\d{4,9}\/[^\s\])>"]+/gi;

// The first complete-looking DOI in extracted text. Layout extraction can
// split a DOI across lines, and PNAS papers print a supporting-information
// URL before the canonical footer DOI, which comes out as the incomplete
// `10.1073/pnas.`: a suffix without a digit yields to a later, complete one.
export function extractDoi(text) {
  let fallback = null;
  for (const match of String(text || '').matchAll(DOI)) {
    const candidate = match[0].replace(/[.,;:]+$/, '');
    fallback = fallback ?? candidate;
    if (/\d/.test(candidate.split('/', 2)[1] ?? '')) return candidate;
  }
  return fallback;
}

// An arXiv id printed explicitly or in an arxiv.org URL.
export function extractArxivId(text) {
  const match = ARXIV_ID.exec(String(text || ''));
  return match ? match[1].replace(/\s+/g, '') : null;
}

// What the upload sends: `{ arxiv_id }` when the pages name an arXiv
// number, else `{ doi }` when they print a DOI, else null. An arXiv id
// first, as the Worker's own reading has it: a preprint's pages may
// print a DOI it cites before any of its own.
export function identifierIn(text) {
  const arxivId = extractArxivId(text);
  if (arxivId) return { arxiv_id: arxivId };
  const doi = extractDoi(text);
  return doi ? { doi } : null;
}

// Where an identifier is printed: the front matter, and a footer or two.
export const PAGES_READ = 3;

// The identifier the first pages of an open PDF.js document print, as
// `identifierIn` has it. The upload form opens a document for this alone
// (frontend/src/pdfIdentifier.js); the viewer has one open already.
export async function identifierInDocument(pdf, pages = PAGES_READ) {
  const texts = [];
  for (let number = 1; number <= Math.min(pages, pdf.numPages); number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return identifierIn(texts.join('\n'));
}

// Longer than this and the send goes on without an identifier.
export const IDENTIFIER_TIMEOUT_MS = 20_000;

// What `reading` finds, or null when it finds nothing, fails, or takes
// longer than a send should wait. Nothing here is worth a dialog: the
// PDF is sent without an identifier, and the Worker reads it as it
// would have anyway.
export async function identifierWithin(reading, timeoutMs = IDENTIFIER_TIMEOUT_MS) {
  let timer;
  const gaveUp = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    return await Promise.race([reading, gaveUp]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    Promise.resolve(reading).catch(() => {});
  }
}
