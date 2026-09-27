// A paper's bibliography as the viewer reads it off the page
// (analyzer/src/rules/, run in the browser), and each reference
// looked up only when a user opens it: what was found is kept on the
// paper by what is printed, so a reference is looked up once for everyone.

import { all, newUuid, now, one, statement, type Row } from "../db";
import { refuse } from "../http";
import { type Summary } from "./bibliography";
import { type Paper } from "./detail";
import { extractArxivId } from "./identifiers";
import { resolve, type Printed } from "./resolve";

export interface Reference extends Row, Printed {
  uuid: string;
  paper_sha256: string;
  key: string;
  index: number;
  raw: string | null;
  title: string | null;
  authors: string | null;
  year: number | null;
  journal: string | null;
  doi: string | null;
  arxiv_id: string | null;
  resolved_status: string | null;
  resolved_at: string | null;
  resolution: string | null;
}

// ----------------------------------------------------------- the answers

export function referenceOut(reference: Reference, papolPaperSha256: string | null = null) {
  let resolution: Summary | null = null;
  try { resolution = reference.resolution ? JSON.parse(reference.resolution) : null; } catch { resolution = null; }
  return {
    uuid: reference.uuid, key: reference.key, index: reference.index, raw: reference.raw, title: reference.title, year: reference.year,
    resolved_status: reference.resolved_status, resolution, papol_paper_sha256: papolPaperSha256,
  };
}

// How a work is named in print: its DOI, or its title when it has none.
// A reference is a line off a page with no file behind it, so matching
// it to a paper Papol holds is a guess made on what is printed.
function printedAs(doi: string | null | undefined, title: string | null | undefined): string {
  return doi ? `doi:${doi.trim().toLowerCase()}` : `title:${(title ?? "").trim().toLowerCase()}`;
}

// Which of these references name a paper Papol already holds: the user
// can open it rather than leave.
export async function papolPapersFor(db: D1Database, references: Reference[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (!references.length) return found;
  const byKey = new Map<string, string>();
  for (const paper of await all<{ sha256: string; doi: string | null; title: string }>(db, "SELECT sha256, doi, title FROM papers WHERE deleted_at IS NULL")) {
    const key = printedAs(paper.doi, paper.title);
    if (!byKey.has(key)) byKey.set(key, paper.sha256);
  }
  for (const reference of references) {
    let resolution: Summary | null = null;
    try { resolution = reference.resolution ? JSON.parse(reference.resolution) : null; } catch { /* unreadable: nothing to match on */ }
    const keys = [
      ...(reference.doi ? [printedAs(reference.doi, null)] : []),
      ...(resolution?.doi ? [printedAs(resolution.doi, null)] : []),
      ...(reference.title ? [printedAs(null, reference.title)] : []),
      ...(resolution?.title ? [printedAs(null, resolution.title)] : []),
    ];
    const match = keys.map((k) => byKey.get(k)).find(Boolean);
    if (match) found.set(reference.uuid, match);
  }
  return found;
}

// Series an index reports as the venue where a bibliography names the
// conference: "Lecture Notes in Computer Science" for a CONCUR paper.
const SERIES = new Set([
  "lecture notes in computer science", "lecture notes in artificial intelligence", "lecture notes in mathematics", "lecture notes in electrical engineering",
  "leibniz international proceedings in informatics", "lipics", "acm sigplan notices", "electronic notes in theoretical computer science",
  "electronic proceedings in theoretical computer science", "communications in computer and information science",
  "advances in intelligent systems and computing", "ifip advances in information and communication technology",
]);

// The index's venue, unless it is only a series and the bibliography
// names the conference; else the venue as printed; else wherever the
// index found a copy — arXiv for a bare preprint — which speaks only
// when nothing else does.
function settleVenue(summary: Summary, reference: Reference): Summary {
  const { host, ...rest } = summary;
  let indexed = summary.venue;
  if (reference.journal && SERIES.has((indexed ?? "").toLowerCase())) indexed = null;
  return { ...rest, venue: indexed || reference.journal || host || null };
}

function citedUrl(raw: string): string | null {
  const match = raw.match(/(https?\s*:\s*\/\/.*?)(?=,\s*(?:19|20)\d{2}[a-z]?\b|\.\s*\[?Accessed\b|$)/i);
  if (!match) return null;
  const url = match[1].replace(/\s+/g, "").replace(/[.,;)]+$/, "");
  return /^https?:\/\/[^/\s]+/.test(url) ? url : null;
}

function urlTitle(url: string | null): string | null {
  const match = url?.match(/^https?:\/\/(?:www\.)?([^/]+)(?:\/(.*))?/);
  if (!match) return null;
  const [, host, path] = match;
  const parts = (path ?? "").split("/").filter(Boolean);
  if (host === "github.com" && parts.length >= 2) return parts.slice(0, 2).join("/");
  if (host === "huggingface.co" && parts.length >= 3 && parts[0] === "datasets") return parts.slice(1, 3).join("/");
  return null;
}

// A useful, honest card when the citation is not an indexed paper. The viewer
// has already read the bibliography, so an unavailable index must not
// turn that local evidence into a broken popup.
export function bibliographyCard(reference: Reference) {
  const raw = reference.raw ?? "";
  let arxivId = reference.arxiv_id || extractArxivId(raw);
  let url: string | null;
  if (reference.doi) url = `https://doi.org/${reference.doi}`;
  else if (arxivId) { arxivId = arxivId.replace(/^arxiv:\s*/i, ""); url = `https://arxiv.org/abs/${arxivId}`; }
  else url = citedUrl(raw);
  let title = reference.title || urlTitle(url);
  if (!title) title = raw.slice(0, 240).trim().replace(/[.,]+$/, "") || "Cited reference";
  let authors: string[] = [];
  try { authors = reference.authors ? JSON.parse(reference.authors) : []; } catch { authors = []; }
  let year = reference.year;
  if (year === null || year === undefined) {
    const years = raw.match(/\b(?:19|20)\d{2}\b/g);
    year = years ? Number(years[years.length - 1]) : null;
  }
  return { title, authors, year, venue: reference.journal ?? null, url, source: "bibliography" };
}

// Look a reference up if it has not been looked up before, and write
// what was found on the row. Lazy on purpose: a paper cites forty works
// and a user opens three of them.
export async function openReference(env: Env, reference: Reference) {
  if (reference.resolved_status === null || reference.resolved_status === undefined) {
    let outcome;
    try { outcome = await resolve(env, reference); } catch (error) {
      console.warn(`Could not resolve reference ${reference.uuid}: ${(error as Error).message}`);
      outcome = { status: "error" as const, summary: null };
    }
    let status: string, summary: object | null;
    if (outcome.status === "ok") { status = "ok"; summary = settleVenue(outcome.summary, reference); }
    else { status = "bibliography"; summary = bibliographyCard(reference); }
    reference.resolved_status = status;
    reference.resolution = summary ? JSON.stringify(summary) : null;
    reference.resolved_at = now();
    await statement(env.DB, "UPDATE paper_references SET resolved_status = ?, resolution = ?, resolved_at = ? WHERE uuid = ?",
      reference.resolved_status, reference.resolution, reference.resolved_at, reference.uuid).run();
  }
  const known = await papolPapersFor(env.DB, [reference]);
  return referenceOut(reference, known.get(reference.uuid) ?? null);
}

// A reference as the viewer read it off the page (the analyzer's rules,
// run in the browser): what is printed, and what the rules made of it.
export interface PrintedReference {
  key: string;
  index: number;
  raw: string;
  title: string | null;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  arxiv_id: string | null;
}

// More rows than any bibliography has: past this, a paper is taking rows
// from whoever holds its digest, not from its bibliography.
const MOST_REFERENCES = 2000;

// One reference the viewer read, looked up the first time anyone opens it.
// What was found is kept by what is printed, so a reference printed the
// same way is never looked up twice, and a better reading of the page —
// the rules improve — can never leave a stale row behind: a reference
// read differently is a different reference.
export async function lookUpPrinted(env: Env, paper: Paper, printed: PrintedReference) {
  const rows = await all<Reference>(env.DB,
    `SELECT * FROM paper_references WHERE paper_sha256 = ? AND raw = ? ORDER BY resolved_status IS NULL, uuid`, paper.sha256, printed.raw);
  let reference = rows[0] ?? null;
  const fields = {
    key: printed.key, index: printed.index, title: printed.title, authors: printed.authors.length ? JSON.stringify(printed.authors) : null,
    year: printed.year, journal: printed.journal, doi: printed.doi, arxiv_id: printed.arxiv_id,
  };
  if (!reference) {
    const count = await one<{ n: number }>(env.DB, "SELECT count(*) AS n FROM paper_references WHERE paper_sha256 = ?", paper.sha256);
    if ((count?.n ?? 0) >= MOST_REFERENCES) refuse(429, "This paper has too many references to look up another");
    reference = {
      uuid: newUuid(), paper_sha256: paper.sha256, raw: printed.raw, ...fields,
      resolved_status: null, resolved_at: null, resolution: null,
    };
    await statement(env.DB,
      `INSERT INTO paper_references (uuid, paper_sha256, "key", "index", raw, title, authors, year, journal, doi, arxiv_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reference.uuid, paper.sha256, fields.key, fields.index, printed.raw, fields.title, fields.authors, fields.year, fields.journal, fields.doi, fields.arxiv_id).run();
  } else if (reference.resolved_status === null || reference.resolved_status === undefined) {
    // Not looked up yet: look it up by what the rules make of it now.
    Object.assign(reference, fields);
    await statement(env.DB,
      `UPDATE paper_references SET "key" = ?, "index" = ?, title = ?, authors = ?, year = ?, journal = ?, doi = ?, arxiv_id = ? WHERE uuid = ?`,
      fields.key, fields.index, fields.title, fields.authors, fields.year, fields.journal, fields.doi, fields.arxiv_id, reference.uuid).run();
  }
  return openReference(env, reference);
}
