// What a PDF says about itself, for the upload form.
//
// An upload stores the PDF and queues `extract_metadata`; the form polls
// the job and fills itself in from the result. The reading — the
// identifier printed near the front, then the bibliographic APIs — is the
// same whether it runs for the job or for the edit form's "re-read the
// PDF" button, which still answers in the request: it is a button, not
// an upload.
//
// GROBID's reading of the title block, the last resort for a paper that
// prints no identifier, comes with the reference pass: it needs the TEI
// parsing that pass brings. Until then such a paper gets its filename
// for a title, which is what the form always let the user correct.

import { extractText, getDocumentProxy } from "unpdf";

import { type Row } from "../db";
import { JobError } from "../jobs/queue";
import { UPLOADS } from "../sync/blobs";
import { byDoi, Unavailable } from "./bibliography";

export const KIND = "extract_metadata";

const ARXIV_ID = /(?:arXiv\s*:\s*|arxiv\s*\.\s*org\s*\/\s*abs\s*\/\s*)((?:\d{4}\s*\.\s*\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\s*\/\s*\d{7})(?:v\d+)?)/i;
const DOI = /10\.\d{4,9}\/[^\s\])>"]+/gi;

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

// A title from a filename: the stem, underscores and hyphens as spaces,
// each word capitalized.
export function titleFromFilename(name: string): string {
  const stem = name.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "");
  return stem.replace(/[_-]/g, " ").replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

// Replaceable, so the suite can stand in for the PDF reader.
export const readers = {
  // The text of the first pages, where identifiers are printed.
  async firstPages(bytes: Uint8Array, pages = 3): Promise<string> {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: false });
    return (text as string[]).slice(0, pages).join("\n");
  },
};

export interface Extracted {
  doi: string | null;
  title: string;
  authors: string | null;
  journal: string | null;
  year: number | null;
  file_path: string;
}

// The form's fields, read off the bytes and what the APIs know of the
// identifier they print. Throws Unavailable when no API could answer.
export async function extractedMetadata(env: Env, bytes: Uint8Array, uploadedName: string, fileName: string): Promise<Extracted> {
  let text = "";
  try {
    text = await readers.firstPages(bytes);
  } catch (error) {
    console.warn(`Could not read ${fileName}: ${(error as Error).message}`);
  }
  const doi = extractDoi(text);
  const arxivId = extractArxivId(text);
  const lookupDoi = arxivId ? arxivDoi(arxivId) : doi;
  const metadata: Extracted = { doi: lookupDoi, title: titleFromFilename(uploadedName), authors: null, journal: null, year: null, file_path: fileName };
  const known = lookupDoi ? await byDoi(env, lookupDoi) : null;
  if (known) {
    metadata.doi = known.doi ?? lookupDoi;
    metadata.title = known.title ?? metadata.title;
    metadata.authors = known.authors.length ? JSON.stringify(known.authors) : null;
    metadata.journal = known.venue;
    metadata.year = known.year;
  }
  return metadata;
}

// The job: read the stored PDF and answer with the form's fields.
export async function extractMetadataJob(env: Env, payload: Row): Promise<Row> {
  const fileName = String(payload.file_path);
  const object = await env.FILES.get(`${UPLOADS}${fileName}`);
  if (!object) throw new JobError("PDF file not found");
  const bytes = new Uint8Array(await object.arrayBuffer());
  try {
    return { ...(await extractedMetadata(env, bytes, String(payload.uploaded_name || fileName), fileName)) };
  } catch (error) {
    if (error instanceof Unavailable) throw new JobError("Metadata lookup failed");
    throw error;
  }
}

export interface Reextracted {
  doi: string | null;
  title: string | null;
  authors: string | null;
  journal: string | null;
  year: number | null;
}

// The edit form's re-read: prefer the identifier printed in the file over
// possibly stale or wrongly entered paper data. Null when nothing
// resolved; Unavailable when the APIs could not answer.
export async function reextractedMetadata(env: Env, bytes: Uint8Array, paperDoi: string | null): Promise<Reextracted | null> {
  let text = "";
  try { text = await readers.firstPages(bytes); } catch { /* an unreadable PDF has nothing printed to prefer */ }
  const doi = extractDoi(text);
  const arxivId = extractArxivId(text);
  const lookupDoi = (arxivId ? arxivDoi(arxivId) : doi) ?? paperDoi;
  const known = lookupDoi ? await byDoi(env, lookupDoi) : null;
  if (!known) return null;
  return {
    doi: known.doi ?? lookupDoi, title: known.title, authors: known.authors.length ? JSON.stringify(known.authors) : null,
    journal: known.venue, year: known.year,
  };
}
