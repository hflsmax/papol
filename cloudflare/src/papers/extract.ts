// What a PDF says about itself, for the upload form.
//
// An upload stores the PDF and queues `extract_metadata`; the form polls
// the job and fills itself in from the result. The reading is the same
// whether it runs for the job or for the edit form's "re-read the PDF"
// button, which still answers in the request: it is a button, not an
// upload.
//
// The browser reads the paper's first pages for a DOI or an arXiv id
// before the upload is queued (shared/identifiers.js) and sends it
// along. With one, the job asks the indexes about it — network, of which
// a Worker has plenty — and never fetches the PDF. Without one, or when
// no index knows it, the PDF is read on the host, by the helper beside
// GROBID (host/helper/): the title block, and with it the DOI or arXiv
// id the paper prints or CrossRef knows it by. With no helper, or one
// that is down, the form gets the filename.

import { one, type Row } from "../db";
import { JobError } from "../jobs/queue";
import { byDoi, Unavailable, type Summary } from "./bibliography";
import * as helper from "./helper";
import { arxivDoi, extractArxivId, extractDoi } from "./identifiers";
import { resolve } from "./resolve";
import type { HeaderMetadata } from "./tei";

export { arxivDoi, extractArxivId, extractDoi };

export const KIND = "extract_metadata";

// A DOI or an arXiv id, as the browser read it off the first pages or the
// helper read it off the title block.
export interface Identifier {
  doi?: string | null;
  arxiv_id?: string | null;
}

// A title from a filename: the stem, underscores and hyphens as spaces,
// each word capitalized.
export function titleFromFilename(name: string): string {
  const stem = name.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "");
  return stem.replace(/[_-]/g, " ").replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

// The DOI to ask the indexes about. An arXiv id names the work through
// its DataCite DOI; else the DOI, printed or consolidated.
export function lookupDoi(identifier: Identifier | null | undefined): string | null {
  if (!identifier) return null;
  return identifier.arxiv_id ? arxivDoi(identifier.arxiv_id) : identifier.doi || null;
}

// The title block, read on the host. Null where there is no helper or it
// could not read the file: nothing printed to go on.
async function titleBlock(env: Env, fileName: string): Promise<HeaderMetadata | null> {
  if (!helper.configured(env)) return null;
  try {
    return await helper.header(env, fileName);
  } catch (error) {
    console.warn(`The helper could not read the header of ${fileName}: ${(error as Error).message}`);
    return null;
  }
}

// The work a title block names, found as a printed reference is: searched
// by its title, authors and year, and taken only if the title matches.
// Null when nothing convincing was found or nobody could be asked.
async function byTitle(env: Env, header: HeaderMetadata): Promise<Summary | null> {
  const raw = [header.authors.join(", "), header.title, header.year].filter(Boolean).join(". ");
  try {
    const outcome = await resolve(env, { raw, title: header.title, year: header.year, authors: JSON.stringify(header.authors), journal: header.journal });
    return outcome.status === "ok" && outcome.summary.doi ? outcome.summary : null;
  } catch (error) {
    console.warn(`The title search failed: ${(error as Error).message}`);
    return null;
  }
}

export interface Extracted {
  doi: string | null;
  title: string;
  authors: string | null;
  journal: string | null;
  year: number | null;
  file_path: string;
}

export interface Upload {
  uploadedName: string;
  fileName: string;
  identifier?: Identifier | null;
}

// The form's fields: what the APIs know of the identifier the browser
// read or the paper carries, else what the paper says of itself, else
// its filename. Throws Unavailable when no API could answer about an
// identifier.
export async function extractedMetadata(env: Env, upload: Upload): Promise<Extracted> {
  const metadata: Extracted = { doi: null, title: titleFromFilename(upload.uploadedName), authors: null, journal: null, year: null, file_path: upload.fileName };
  const given = lookupDoi(upload.identifier);
  let known = given ? await byDoi(env, given) : null;
  let header: HeaderMetadata | null = null;
  let printed = given;
  if (!known) {
    header = await titleBlock(env, upload.fileName);
    printed = lookupDoi(header) ?? given;
    known = printed && printed !== given ? await byDoi(env, printed) : null;
    // Nothing printed to look up: the work its title names, as a
    // reference is resolved — which GROBID's header did with Crossref.
    if (!printed && header?.title) {
      known = await byTitle(env, header);
      printed = known?.doi ?? null;
    }
  }
  // Known to no index: the form shows the identifier as the browser read
  // it off the page, before what GROBID made of the title block.
  metadata.doi = given ?? printed;
  if (known) {
    Object.assign(metadata, knownFields(known, printed!, metadata.title));
  } else if (header) {
    // No identifier the indexes could answer: the title block as read.
    metadata.title = header.title ?? metadata.title;
    metadata.authors = header.authors.length ? JSON.stringify(header.authors) : null;
    metadata.journal = header.journal;
    metadata.year = header.year;
  }
  return metadata;
}

// The form's fields as an index knows the work, `asked` being the DOI it
// was asked about.
function knownFields(known: Summary, asked: string, title: string): Omit<Extracted, "file_path"> {
  return {
    doi: known.doi ?? asked,
    title: known.title ?? title,
    authors: known.authors.length ? JSON.stringify(known.authors) : null,
    journal: known.venue,
    year: known.year,
  };
}

// What the indexes know of an identifier, as the form's fields. The
// browser asks as soon as it has read one off the first pages, while the
// PDF is still going up, so the form has its fields when the bytes are
// in (routes/papers.ts, /api/papers/lookup). Null when no index knows
// it; throws Unavailable when none could answer.
export async function indexedMetadata(env: Env, identifier: Identifier, uploadedName: string): Promise<Omit<Extracted, "file_path"> | null> {
  const asked = lookupDoi(identifier);
  const known = asked ? await byDoi(env, asked) : null;
  return known ? knownFields(known, asked!, titleFromFilename(uploadedName)) : null;
}

// A paper Papol holds already of the same work: one carrying the DOI the
// reading resolved, under another digest. The PDF is the paper's
// identity, and a DOI may well have versions — a preprint, the published
// article — so this is an offer for the form to make, never a rule.
export interface KnownVersion {
  sha256: string;
  title: string;
  file_path: string;
}

export async function knownVersion(db: D1Database, doi: string | null, digest: string): Promise<KnownVersion | null> {
  if (!doi) return null;
  return one<KnownVersion>(
    db,
    "SELECT sha256, title, file_path FROM papers WHERE lower(trim(doi)) = lower(trim(?)) AND sha256 != ? AND deleted_at IS NULL ORDER BY created_at, sha256 LIMIT 1",
    doi, digest,
  );
}

// The job: answer with the form's fields for the stored PDF, and, when
// Papol already holds a version of the work, which one — `existing`.
export async function extractMetadataJob(env: Env, payload: Row): Promise<Row> {
  const fileName = String(payload.file_path);
  const identifier = payload.identifier && typeof payload.identifier === "object" ? (payload.identifier as Identifier) : null;
  try {
    const metadata = await extractedMetadata(env, { uploadedName: String(payload.uploaded_name || fileName), fileName, identifier });
    const existing = await knownVersion(env.DB, metadata.doi, fileName.slice(0, 64));
    return existing ? { ...metadata, existing } : { ...metadata };
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
export async function reextractedMetadata(env: Env, fileName: string, paperDoi: string | null): Promise<Reextracted | null> {
  const printed = lookupDoi(await titleBlock(env, fileName)) ?? paperDoi;
  const known = printed ? await byDoi(env, printed) : null;
  if (!known) return null;
  return {
    doi: known.doi ?? printed, title: known.title, authors: known.authors.length ? JSON.stringify(known.authors) : null,
    journal: known.venue, year: known.year,
  };
}
