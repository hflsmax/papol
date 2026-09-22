// Identifiers printed in a PDF or a reference: a DOI, an arXiv number.
//
// The browser reads the same two off an upload's first pages before the
// Worker sees the paper (shared/identifiers.js is the port of this file);
// the whole-value forms below are what the upload route holds a given
// identifier to.

const ARXIV_ID = /(?:arXiv\s*:\s*|arxiv\s*\.\s*org\s*\/\s*abs\s*\/\s*)((?:\d{4}\s*\.\s*\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\s*\/\s*\d{7})(?:v\d+)?)/i;
const DOI = /10\.\d{4,9}\/[^\s\])>"]+/gi;

export const ARXIV_ID_FORM = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i;
export const DOI_FORM = /^10\.\d{4,9}\/[^\s\])>"]+$/i;

// The first complete-looking DOI in extracted text. Layout extraction can
// split a DOI across lines, and PNAS papers print a supporting-information
// URL before the canonical footer DOI, which comes out as the incomplete
// `10.1073/pnas.`: a suffix without a digit yields to a later, complete one.
export function extractDoi(text: string): string | null {
  let fallback: string | null = null;
  for (const match of text.matchAll(DOI)) {
    const candidate = match[0].replace(/[.,;:]+$/, "");
    fallback = fallback ?? candidate;
    if (/\d/.test(candidate.split("/", 2)[1] ?? "")) return candidate;
  }
  return fallback;
}

// An arXiv id printed explicitly or in an arxiv.org URL.
export function extractArxivId(text: string): string | null {
  const match = ARXIV_ID.exec(text);
  return match ? match[1].replace(/\s+/g, "") : null;
}

// The stable DataCite DOI for a versioned arXiv identifier.
export function arxivDoi(arxivId: string): string {
  return `10.48550/arXiv.${arxivId.replace(/v\d+$/i, "")}`;
}
