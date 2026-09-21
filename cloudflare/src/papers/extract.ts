// What a PDF says about itself, for the upload form.
//
// An upload stores the PDF and queues `extract_metadata`; the form polls
// the job and fills itself in from the result. The reading — the
// identifier printed near the front, then the bibliographic APIs — is the
// same whether it runs for the job or for the edit form's "re-read the
// PDF" button, which still answers in the request: it is a button, not
// an upload.
//
// GROBID's reading of the title block is the last resort, for a paper
// that prints no identifier the indexes could answer.

import { extractText, getDocumentProxy } from "unpdf";

import { type Row } from "../db";
import { JobError } from "../jobs/queue";
import { UPLOADS } from "../sync/blobs";
import { byDoi, Unavailable } from "./bibliography";
import * as grobid from "./grobid";
import { arxivDoi, extractArxivId, extractDoi } from "./identifiers";

export { arxivDoi, extractArxivId, extractDoi };

export const KIND = "extract_metadata";

// A title from a filename: the stem, underscores and hyphens as spaces,
// each word capitalized.
export function titleFromFilename(name: string): string {
  const stem = name.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "");
  return stem.replace(/[_-]/g, " ").replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

// Replaceable, so the suite can stand in for the PDF reader.
export const readers = {
  // The text of the first pages, where identifiers are printed.
  // Only the first pages are read: an identifier is printed at the front,
  // and laying out the text of a whole paper costs more CPU than a Worker
  // has to spend on one job.
  async firstPages(bytes: Uint8Array, pages = 3): Promise<string> {
    const pdf = await getDocumentProxy(bytes);
    const texts: string[] = [];
    for (let number = 1; number <= Math.min(pages, pdf.numPages); number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return texts.join("\n");
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
  } else if (grobid.configured(env)) {
    // No identifier the indexes could answer: GROBID reads the title
    // block. A failure here is the filename title the form already has.
    try {
      const header = await grobid.extractHeader(env, bytes);
      metadata.title = header.title ?? metadata.title;
      metadata.authors = header.authors.length ? JSON.stringify(header.authors) : null;
      metadata.journal = header.journal;
      metadata.year = header.year;
    } catch (error) {
      console.warn(`GROBID could not read the header of ${fileName}: ${(error as Error).message}`);
    }
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
