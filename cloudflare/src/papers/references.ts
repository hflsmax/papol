// A paper's bibliography: read once through GROBID as a job, kept on the
// paper, and each reference looked up only when a user opens it.
//
// A request never waits for the pass. Opening a paper nobody has opened
// before marks it `pending` and queues `analyze_paper`; the job reads the
// PDF through GROBID and writes the references, citation markers and
// document links back; the viewer asks again until the paper says
// `ready`. The job's key is the paper, so two viewers opening one paper
// queue one pass.

import limits from "../../../config/app_limits.json";
import { all, newUuid, now, one, statement, type Row } from "../db";
import { refuse } from "../http";
import { enqueue, JobError, wake } from "../jobs/queue";
import { UPLOADS } from "../files";
import { type Summary } from "./bibliography";
import { type Paper } from "./detail";
import * as helper from "./helper";
import { extractArxivId } from "./identifiers";
import { resolve, type Printed } from "./resolve";

export const KIND = "analyze_paper";

// A pass pending longer than this was interrupted — its Worker died and
// the job was failed for it — and may be started again.
const ANALYSIS_STALE_MS = 15 * 60_000;

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
  page: number | null;
  y: number | null;
  resolved_status: string | null;
  resolved_at: string | null;
  resolution: string | null;
}

// ------------------------------------------------------------- the pass

// Whether this paper wants a pass now. Never for a failure — a PDF GROBID
// could not read will not read differently on the next open.
function mayStart(paper: Paper): boolean {
  if (paper.references_status === null || paper.references_status === undefined) return true;
  if (paper.references_status === "pending") {
    const stamped = paper.references_at as string | null;
    return !stamped || Date.now() - Date.parse(stamped) > ANALYSIS_STALE_MS;
  }
  return false;
}

// Queue a pass over this paper if it wants one. The paper says `pending`
// exactly when a job is on the queue to make it say something else.
export async function requestAnalysis(env: Env, paper: Paper): Promise<boolean> {
  if (!mayStart(paper)) return false;
  const job = enqueue(env.DB, KIND, { paper_sha256: paper.sha256 }, { key: `analyze:${paper.sha256}` });
  paper.references_status = "pending";
  paper.references_error = null;
  paper.references_at = now();
  const results = await env.DB.batch([
    job.statement,
    statement(env.DB, "UPDATE papers SET references_status = ?, references_error = NULL, references_at = ? WHERE sha256 = ?", "pending", paper.references_at, paper.sha256),
  ]);
  if (results[0].meta.changes) await wake(env, [job.uuid]);
  return true;
}

function finishStatement(env: Env, paperSha256: string, status: string, detail: string | null): D1PreparedStatement {
  return statement(env.DB, "UPDATE papers SET references_status = ?, references_error = ?, references_at = ? WHERE sha256 = ?", status, detail, now(), paperSha256);
}

// The job: read one paper's references through GROBID and store them.
// Any failure is recorded on the paper rather than left as a job that
// failed somewhere, so a PDF that cannot be analyzed says so to the
// viewer instead of being asked about forever.
export async function analyzePaperJob(env: Env, payload: Row): Promise<Row> {
  const paperSha256 = String(payload.paper_sha256);
  const paper = await one<Paper>(env.DB, "SELECT * FROM papers WHERE sha256 = ?", paperSha256);
  if (!paper) throw new JobError("The paper is gone");
  // Only whether the PDF is there: the helper reads it from the bucket.
  const object = paper.file_path ? await env.FILES.head(`${UPLOADS}${paper.file_path}`) : null;
  if (!object) {
    await finishStatement(env, paperSha256, "failed", "The PDF for this paper is missing").run();
    throw new JobError("The PDF for this paper is missing");
  }
  let analysis;
  try {
    analysis = await helper.analyze(env, paper.file_path);
  } catch (error) {
    const detail = String((error as Error).message ?? error).slice(0, limits.text.analysis_error);
    console.warn(`The helper failed on paper ${paperSha256}: ${detail}`);
    await finishStatement(env, paperSha256, "failed", detail).run();
    throw new JobError(detail);
  }
  // A re-analysis replaces what was there. Resolutions are lost with it,
  // which is honest: they were attached to references read a different way.
  const statements = [
    statement(env.DB, "DELETE FROM paper_citations WHERE paper_sha256 = ?", paperSha256),
    statement(env.DB, "DELETE FROM paper_links WHERE paper_sha256 = ?", paperSha256),
    statement(env.DB, "DELETE FROM paper_floats WHERE paper_sha256 = ?", paperSha256),
    statement(env.DB, "DELETE FROM paper_references WHERE paper_sha256 = ?", paperSha256),
  ];
  const uuids = new Map<string, string>();
  for (const ref of analysis.references) {
    const uuid = newUuid();
    uuids.set(ref.key, uuid);
    statements.push(statement(env.DB,
      `INSERT INTO paper_references (uuid, paper_sha256, "key", "index", raw, title, authors, year, journal, doi, arxiv_id, page, y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uuid, paperSha256, ref.key, ref.index, ref.raw, ref.title, ref.authors.length ? JSON.stringify(ref.authors) : null, ref.year, ref.journal, ref.doi, ref.arxiv_id, ref.page, ref.y));
  }
  for (const cite of analysis.citations) {
    const referenceUuid = uuids.get(cite.key);
    if (!referenceUuid) continue;
    statements.push(statement(env.DB, "INSERT INTO paper_citations (uuid, paper_sha256, reference_uuid, label, page, x, y, w, h, inferred) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      newUuid(), paperSha256, referenceUuid, cite.label, cite.page, cite.x, cite.y, cite.w, cite.h, cite.inferred ? 1 : 0));
  }
  const floats = new Map<string, string>();
  for (const float of analysis.floats) {
    const uuid = newUuid();
    floats.set(float.key, uuid);
    statements.push(statement(env.DB, "INSERT INTO paper_floats (uuid, paper_sha256, kind, label, page, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      uuid, paperSha256, float.kind, float.label, float.page, float.x, float.y, float.w, float.h));
  }
  for (const link of analysis.links) {
    const floatUuid = floats.get(link.float);
    if (!floatUuid) throw new JobError(`A link names float ${link.float}, which the analysis does not have`);
    statements.push(statement(env.DB, "INSERT INTO paper_links (uuid, paper_sha256, float_uuid, label, page, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      newUuid(), paperSha256, floatUuid, link.label, link.page, link.x, link.y, link.w, link.h));
  }
  statements.push(finishStatement(env, paperSha256, "ready", null));
  await env.DB.batch(statements);
  return { references: analysis.references.length, citations: analysis.citations.length, floats: analysis.floats.length, links: analysis.links.length };
}

// ----------------------------------------------------------- the answers

export function referenceOut(reference: Reference, papolPaperSha256: string | null = null) {
  let resolution: Summary | null = null;
  try { resolution = reference.resolution ? JSON.parse(reference.resolution) : null; } catch { resolution = null; }
  return {
    uuid: reference.uuid, key: reference.key, index: reference.index, raw: reference.raw, title: reference.title, year: reference.year,
    page: reference.page ?? null, y: reference.y ?? null, resolved_status: reference.resolved_status, resolution, papol_paper_sha256: papolPaperSha256,
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

// Everything the viewer draws for one paper: the list, the markers, the
// cross-references. A reading already done is served whatever the
// analyzer is doing now: references belong to the paper, not to the
// service that read them.
export async function paperReferences(env: Env, paper: Paper) {
  const stored = paper.references_status === "ready";
  if (!helper.configured(env) && !stored) return { paper_sha256: paper.sha256, status: "unavailable", detail: "Reference analysis unavailable", references: [], citations: [], floats: [], links: [] };
  if (helper.configured(env)) await requestAnalysis(env, paper);
  if (paper.references_status !== "ready") {
    return { paper_sha256: paper.sha256, status: paper.references_status || "pending", detail: paper.references_error ?? null, references: [], citations: [], floats: [], links: [] };
  }
  const references = await all<Reference>(env.DB, `SELECT * FROM paper_references WHERE paper_sha256 = ? ORDER BY "index", uuid`, paper.sha256);
  const known = await papolPapersFor(env.DB, references);
  const citations = await all<Row>(env.DB, "SELECT * FROM paper_citations WHERE paper_sha256 = ? AND reference_uuid IS NOT NULL ORDER BY page, y, x, uuid", paper.sha256);
  const floats = await all<Row>(env.DB, "SELECT * FROM paper_floats WHERE paper_sha256 = ? ORDER BY page, y, x, uuid", paper.sha256);
  const links = await all<Row>(env.DB, "SELECT * FROM paper_links WHERE paper_sha256 = ? ORDER BY page, y, x, uuid", paper.sha256);
  return {
    paper_sha256: paper.sha256, status: "ready", detail: null,
    references: references.map((r) => referenceOut(r, known.get(r.uuid) ?? null)),
    citations: citations.map((c) => ({ reference_uuid: c.reference_uuid, label: c.label ?? null, page: c.page, x: c.x, y: c.y, w: c.w, h: c.h, inferred: Boolean(c.inferred) })),
    floats: floats.map((f) => ({ uuid: f.uuid, kind: f.kind, label: f.label, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h })),
    links: links.map((l) => ({ float_uuid: l.float_uuid, label: l.label ?? null, page: l.page, x: l.x, y: l.y, w: l.w, h: l.h })),
  };
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

// A useful, honest card when the citation is not an indexed paper. GROBID
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

// A citation recovered from a PDF's own link layer, registered so it
// gets the same cached lookup as an analyzed reference. The viewer names
// a PDF-native citation by the number printed on the page: "bib0027" is
// entry 27, which the analyzer calls "b26", counting from zero. Matching
// on the spelling alone would append a second row for a reference this
// paper already holds.
export async function previewReference(env: Env, paper: Paper, key: string, raw: string) {
  let reference = await one<Reference>(env.DB, `SELECT * FROM paper_references WHERE paper_sha256 = ? AND "key" = ?`, paper.sha256, key);
  if (!reference && /^\d+$/.test(key)) {
    reference = await one<Reference>(env.DB, `SELECT * FROM paper_references WHERE paper_sha256 = ? AND "index" = ?`, paper.sha256, Number(key) - 1);
  }
  if (!reference) {
    const last = await one<{ n: number | null }>(env.DB, `SELECT max("index") AS n FROM paper_references WHERE paper_sha256 = ?`, paper.sha256);
    reference = {
      uuid: newUuid(), paper_sha256: paper.sha256, key, index: (last?.n ?? -1) + 1, raw, title: null, authors: null, year: null, journal: null,
      doi: null, arxiv_id: null, page: null, y: null, resolved_status: null, resolved_at: null, resolution: null,
    };
    await statement(env.DB, `INSERT INTO paper_references (uuid, paper_sha256, "key", "index", raw) VALUES (?, ?, ?, ?, ?)`, reference.uuid, paper.sha256, key, reference.index, raw).run();
  } else if (!reference.raw) {
    reference.raw = raw;
    await statement(env.DB, "UPDATE paper_references SET raw = ? WHERE uuid = ?", raw, reference.uuid).run();
  }
  return openReference(env, reference);
}

export function referenceOr404(reference: Reference | null): Reference {
  return reference ?? refuse(404, "Reference not found");
}
