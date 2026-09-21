// What a PDF says about itself, for the upload form.
//
// An upload stores the PDF and queues `extract_metadata`; the form polls
// the job and fills itself in from the result. The reading is the same
// whether it runs for the job or for the edit form's "re-read the PDF"
// button, which still answers in the request: it is a button, not an
// upload.
//
// The PDF itself is read on the host, by the helper beside GROBID
// (host/helper/): the title block, and with it the DOI or arXiv id the
// paper prints or CrossRef knows it by. The Worker asks the indexes
// about that identifier — network, of which a Worker has plenty — and
// takes the title block as read only when no index could answer. With
// no helper, or one that is down, the form gets the filename.

import { type Row } from "../db";
import { JobError } from "../jobs/queue";
import { UPLOADS } from "../sync/blobs";
import { byDoi, Unavailable } from "./bibliography";
import * as helper from "./helper";
import { arxivDoi, extractArxivId, extractDoi } from "./identifiers";
import type { HeaderMetadata } from "./tei";

export { arxivDoi, extractArxivId, extractDoi };

export const KIND = "extract_metadata";

// A title from a filename: the stem, underscores and hyphens as spaces,
// each word capitalized.
export function titleFromFilename(name: string): string {
  const stem = name.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "");
  return stem.replace(/[_-]/g, " ").replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

// The title block, read on the host. Null where there is no helper or it
// could not read the file: nothing printed to go on.
async function titleBlock(env: Env, bytes: Uint8Array, fileName: string): Promise<HeaderMetadata | null> {
  if (!helper.configured(env)) return null;
  try {
    return await helper.header(env, bytes);
  } catch (error) {
    console.warn(`The helper could not read the header of ${fileName}: ${(error as Error).message}`);
    return null;
  }
}

// The identifier to ask the indexes about. An arXiv id names the work
// through its DataCite DOI; else the DOI, printed or consolidated.
function identifier(header: HeaderMetadata | null): string | null {
  if (!header) return null;
  return header.arxiv_id ? arxivDoi(header.arxiv_id) : header.doi;
}

export interface Extracted {
  doi: string | null;
  title: string;
  authors: string | null;
  journal: string | null;
  year: number | null;
  file_path: string;
}

// The form's fields: what the APIs know of the identifier the paper
// carries, else what the paper says of itself, else its filename.
// Throws Unavailable when no API could answer about an identifier.
export async function extractedMetadata(env: Env, bytes: Uint8Array, uploadedName: string, fileName: string): Promise<Extracted> {
  const header = await titleBlock(env, bytes, fileName);
  const lookupDoi = identifier(header);
  const metadata: Extracted = { doi: lookupDoi, title: titleFromFilename(uploadedName), authors: null, journal: null, year: null, file_path: fileName };
  const known = lookupDoi ? await byDoi(env, lookupDoi) : null;
  if (known) {
    metadata.doi = known.doi ?? lookupDoi;
    metadata.title = known.title ?? metadata.title;
    metadata.authors = known.authors.length ? JSON.stringify(known.authors) : null;
    metadata.journal = known.venue;
    metadata.year = known.year;
  } else if (header) {
    // No identifier the indexes could answer: the title block as read.
    metadata.title = header.title ?? metadata.title;
    metadata.authors = header.authors.length ? JSON.stringify(header.authors) : null;
    metadata.journal = header.journal;
    metadata.year = header.year;
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

// The edit form's re-read: prefer the identifier the file carries over
// possibly stale or wrongly entered paper data. Null when nothing
// resolved; Unavailable when the APIs could not answer.
export async function reextractedMetadata(env: Env, bytes: Uint8Array, paperDoi: string | null): Promise<Reextracted | null> {
  const lookupDoi = identifier(await titleBlock(env, bytes, "the paper being edited")) ?? paperDoi;
  const known = lookupDoi ? await byDoi(env, lookupDoi) : null;
  if (!known) return null;
  return {
    doi: known.doi ?? lookupDoi, title: known.title, authors: known.authors.length ? JSON.stringify(known.authors) : null,
    journal: known.venue, year: known.year,
  };
}
