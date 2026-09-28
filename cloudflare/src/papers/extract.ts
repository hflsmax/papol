// What a PDF says about itself, for the upload form.
//
// An upload stores the PDF and queues `extract_metadata`; the form polls
// the job and fills itself in from the result. The reading is the same
// whether it runs for the job or for the edit form's "re-read the PDF"
// button, which still answers in the request: it is a button, not an
// upload.
//
// The browser reads the paper's first pages before the upload is queued
// and sends what it found along: a DOI or an arXiv id
// (shared/identifiers.js), and the title block, read by rules
// (analyzer/src/rules/header.ts, through shared/printed.js). With
// an identifier, the job asks the indexes about it — network, of which a
// Worker has plenty. Without one, or when no index knows it, the form gets
// the title block as the browser read it, and with no title block, the
// filename. The Worker never reads the PDF.

import { one, type Row } from "../db";
import { JobError } from "../jobs/queue";
import { byDoi, Unavailable, type Summary } from "./bibliography";
import { arxivDoi, extractArxivId, extractDoi } from "./identifiers";
import type { HeaderMetadata } from "./reading";

export { arxivDoi, extractArxivId, extractDoi };

export const KIND = "extract_metadata";

// A DOI or an arXiv id, as the browser read it off the first pages or
// out of the title block.
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
  // What the browser read of the title block, if it read one.
  titleBlock?: HeaderMetadata | null;
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
    header = upload.titleBlock ?? null;
    printed = lookupDoi(header) ?? given;
    known = printed && printed !== given ? await byDoi(env, printed) : null;
  }
  // Known to no index: the form shows the identifier as the browser read
  // it off the page, before what it read in the title block.
  metadata.doi = given ?? printed;
  if (known) {
    Object.assign(metadata, knownFields(known, printed!, metadata.title, upload.titleBlock));
  } else if (header) {
    // No identifier the indexes could answer: the title block as read.
    metadata.title = header.title ?? metadata.title;
    metadata.authors = header.authors.length ? JSON.stringify(header.authors) : null;
    metadata.journal = paperVenue(header.journal);
    metadata.year = header.year;
  }
  return metadata;
}

// The venue a paper is known by. The Proceedings of the ACM journals
// publish conferences as issues — "Proceedings of the ACM on Programming
// Languages (ICFP)" — and a reader knows the paper as an ICFP paper; an
// issue numbered within its year ("OOPSLA2", "CSCW1") is still that
// conference.
//
// A conference's short name carries its year ("CHI '17", "ASPLOS 2024"),
// which the paper's year already says: the venue is the name alone.
export function paperVenue(venue: string | null | undefined): string | null {
  const trimmed = venue?.trim() ?? "";
  const issue = /^Proceedings of the ACM on .+ \((?<issue>[^()]+)\)$/.exec(trimmed)?.groups!.issue;
  if (issue) return issue.replace(/(?<=\p{L})\d$/u, "");
  const conference = /^(?<name>\p{Lu}[\p{L}\d&+-]*(?: \p{Lu}[\p{L}\d&+-]*)?)\s*(?:['’]\s*\d\d|\d{4})$/u.exec(trimmed)?.groups!.name;
  return conference ?? (trimmed || null);
}

// The form's fields as an index knows the work, `asked` being the DOI it
// was asked about. A preprint's index (arXiv, through DataCite) knows no
// venue; the title block may, when the preprint is the published paper
// as its journal typeset it.
function knownFields(known: Summary, asked: string, title: string, titleBlock?: HeaderMetadata | null): Omit<Extracted, "file_path"> {
  return {
    doi: known.doi ?? asked,
    title: known.title ?? title,
    authors: known.authors.length ? JSON.stringify(known.authors) : null,
    journal: paperVenue(known.venue ?? titleBlock?.journal),
    year: known.year,
  };
}

// What the indexes know of an identifier, as the form's fields. The
// browser asks as soon as it has read one off the first pages, while the
// PDF is still going up, so the form has its fields when the bytes are
// in (routes/papers.ts, /api/papers/lookup), with the title block for
// what they leave out. Null when no index knows
// it; throws Unavailable when none could answer.
export async function indexedMetadata(env: Env, identifier: Identifier, uploadedName: string, titleBlock?: HeaderMetadata | null): Promise<Omit<Extracted, "file_path"> | null> {
  const asked = lookupDoi(identifier);
  const known = asked ? await byDoi(env, asked) : null;
  return known ? knownFields(known, asked!, titleFromFilename(uploadedName), titleBlock) : null;
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
  const titleBlock = payload.title_block && typeof payload.title_block === "object" ? (payload.title_block as HeaderMetadata) : null;
  try {
    const metadata = await extractedMetadata(env, { uploadedName: String(payload.uploaded_name || fileName), fileName, identifier, titleBlock });
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

// The edit form's re-read: prefer the identifier the file carries, as the
// browser read it off the title block, over possibly stale or wrongly
// entered paper data. Null when nothing resolved; Unavailable when the
// APIs could not answer.
export async function reextractedMetadata(env: Env, titleBlock: HeaderMetadata | null, paperDoi: string | null): Promise<Reextracted | null> {
  const printed = lookupDoi(titleBlock) ?? paperDoi;
  const known = printed ? await byDoi(env, printed) : null;
  if (!known) return null;
  return { ...knownFields(known, printed!, known.title ?? "", titleBlock), title: known.title };
}
