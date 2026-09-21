// Turning a printed reference into a work a user can act on: its title,
// who wrote it, where it appeared, how often it has been cited, where a
// copy can be read. Nothing here is Papol's own knowledge — it is
// CrossRef and OpenAlex — and both are asked only when a user opens a
// reference.
//
// The judgment is in choosing between what they answer, because a
// bibliographic search always returns *something*. Two tests decide. Its
// title must be in the printed reference (or, for a bibliography that
// omits titles, the structured authors, venue and year must agree
// exactly). Its year should be the printed year: titles are not unique
// across time, and CrossRef will happily return the 2019 retrospective
// for the 2016 conference paper. The year ranks rather than rejects,
// because either index may hold the right answer.
//
// CrossRef is free and the better matcher, so it goes first. An OpenAlex
// search is metered, so one is spent only when CrossRef has not answered
// confidently. Looking up by DOI costs nothing, so enrichment is never
// rationed. Whatever comes back is checked again before it is shown.

import limits from "../../../config/app_limits.json";
import {
  crossrefMatch, openalexByArxiv, openalexByDoi, openalexByTitle, summarizeCrossref, summarizeOpenalex, Throttled, Unavailable, type Summary,
} from "./bibliography";
import { extractArxivId } from "./identifiers";

const STOPWORDS = new Set(["a", "an", "the", "of", "on", "in", "for", "and", "or", "to", "with", "by", "from", "at", "as", "is", "are", "be", "using", "via", "its"]);
// How much of a candidate's title must appear in the printed reference.
// Not 1.0: OCR, line-break hyphens and dropped subtitles cost a word.
const TITLE_AGREEMENT = 0.75;
// At or below this many words, a title has no room to lose one.
const SHORT_TITLE = 4;
const YEAR_LIMIT = limits.matching.bibliography_year_distance_max;
// What an unknown year counts as when ranking: worse than agreeing,
// better than disagreeing.
const YEAR_UNKNOWN = 1.5;

export interface Printed {
  raw: string | null;
  title: string | null;
  year: number | null;
  authors?: string | null; // a JSON array, as the row keeps it
  journal?: string | null;
  doi?: string | null;
  arxiv_id?: string | null;
}

export interface Context { raw: string; title: string | null; year: number | null; authors: string[]; journal: string | null }

export function contextOf(reference: Printed): Context {
  let authors: string[] = [];
  try { authors = reference.authors ? JSON.parse(reference.authors) : []; } catch { authors = []; }
  return { raw: (reference.raw ?? "").trim(), title: reference.title ?? null, year: reference.year ?? null, authors, journal: reference.journal ?? null };
}

export function accepts(context: Context, summary: Summary): boolean {
  return titleMatches(summary.title, context.raw, context.title) && yearDistance(summary.year, context.year) <= YEAR_LIMIT;
}

interface Candidate { summary: Summary; provider: "crossref" | "openalex"; rank: number; yearDistance: number }

const sortKey = (c: Candidate): [number, number, number] => [c.yearDistance, c.provider === "crossref" ? 0 : 1, c.rank];
const before = (a: Candidate, b: Candidate) => { const [x, y] = [sortKey(a), sortKey(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };

export type Outcome = { status: "ok"; summary: Summary } | { status: "miss" | "error"; summary: null };

// Look up one reference. `ok` found a work; `miss` found nothing
// convincing; `error` means nobody could be asked just now, worth trying
// again later, so the caller should not remember it as an answer.
export async function resolve(env: Env, reference: Printed): Promise<Outcome> {
  const context = contextOf(reference);
  let lookupFailed = false;
  // Identifiers GROBID read, first: a DOI or an arXiv number is the work.
  for (const [identifier, lookup] of [[reference.doi, openalexByDoi], [reference.arxiv_id || extractArxivId(reference.raw ?? ""), openalexByArxiv]] as const) {
    if (!identifier) continue;
    try {
      const work = await lookup(env, identifier);
      if (work) {
        const summary = summarizeOpenalex(work);
        if (accepts(context, summary)) return { status: "ok", summary };
      }
    } catch (error) {
      if (!(error instanceof Throttled || error instanceof Unavailable)) throw error;
      lookupFailed = true;
      console.warn(`Lookup of ${identifier} unavailable: ${error.message}`);
    }
  }

  let fromCrossref: Candidate[] = [];
  try {
    fromCrossref = candidates(context.raw ? (await crossrefMatch(env, context.raw)).map(summarizeCrossref) : [], "crossref", context);
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    lookupFailed = true;
    console.warn(`CrossRef search unavailable: ${error.message}`);
  }
  const all = [...fromCrossref];
  // An exact-year CrossRef match is enough to avoid the metered search.
  if (!fromCrossref.some((c) => c.yearDistance === 0)) {
    try {
      all.push(...candidates((await openalexByTitle(env, context.title || context.raw)).map(summarizeOpenalex), "openalex", context));
    } catch (error) {
      if (!(error instanceof Throttled || error instanceof Unavailable)) throw error;
      lookupFailed = true;
      console.warn(`OpenAlex search unavailable: ${error.message}${env.PAPOL_OPENALEX_KEY ? "" : " — set the PAPOL_OPENALEX_KEY secret"}`);
    }
  }
  let best: Candidate | null = null;
  for (const candidate of all) if (!best || before(candidate, best)) best = candidate;
  if (!best || best.yearDistance > YEAR_LIMIT) return { status: lookupFailed ? "error" : "miss", summary: null };
  return { status: "ok", summary: await enriched(env, best, context) };
}

export function candidates(summaries: Summary[], provider: "crossref" | "openalex", context: Context): Candidate[] {
  const out: Candidate[] = [];
  summaries.forEach((summary, rank) => {
    const byTitle = titleMatches(summary.title, context.raw, context.title);
    // A compact bibliography may omit article titles. CrossRef's search
    // can still identify the work from authors, venue, year and pages:
    // accept only its top result, and only when the structured fields
    // agree exactly enough to make that unambiguous.
    const byMetadata = provider === "crossref" && rank === 0 && !context.title && metadataMatchesUntitled(summary, context);
    if (!byTitle && !byMetadata) return;
    out.push({ summary, provider, rank, yearDistance: yearDistance(summary.year, context.year) });
  });
  return out;
}

function metadataMatchesUntitled(summary: Summary, context: Context): boolean {
  if (context.year === null || summary.year !== context.year || !context.journal || !context.authors.length) return false;
  const venueWords = contentWords(context.journal);
  const candidateVenue = contentWords(summary.venue ?? "");
  if (!venueWords.size || ![...venueWords].every((w) => candidateVenue.has(w))) return false;
  const candidateNames = nameWords((summary.authors ?? []).join(" "));
  const surnames = new Set<string>();
  for (const author of context.authors) {
    const parts = author.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g);
    if (parts) { const words = nameWords(parts[parts.length - 1]); if (words.size) surnames.add([...words][0]); }
  }
  return surnames.size >= 2 && [...surnames].every((s) => candidateNames.has(s));
}

function nameWords(text: string): Set<string> {
  const ascii = text.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  return new Set((ascii.match(/[A-Za-z]+/g) ?? []).filter((w) => w.length > 1).map((w) => w.toLowerCase()));
}

// Add OpenAlex data to a CrossRef winner without changing its identity.
async function enriched(env: Env, candidate: Candidate, context: Context): Promise<Summary> {
  const summary = candidate.summary;
  if (candidate.provider !== "crossref" || !summary.doi) return summary;
  let work: Record<string, any> | null;
  try { work = await openalexByDoi(env, summary.doi); } catch (error) {
    if (error instanceof Throttled || error instanceof Unavailable) return summary;
    throw error;
  }
  if (!work) return summary;
  const merged = merge(summarizeOpenalex(work), summary, context.year);
  return accepts(context, merged) ? merged : summary;
}

function sane(year: number | null | undefined): year is number {
  return Boolean(year) && year! >= 1500 && year! <= 2100;
}

export function yearDistance(candidate: number | null | undefined, printed: number | null | undefined): number {
  if (!sane(candidate) || !sane(printed)) return YEAR_UNKNOWN;
  return Math.abs(candidate - printed);
}

const present = (value: unknown) => value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && !value.length);

// Prefer the richer record, but never lose a field it happens to lack.
// Except the year: where the two disagree, the one that agrees with the
// printed reference is the one the user is looking at. And never
// shorten a correctly matched title: OpenAlex calls the Emscripten paper
// merely "Emscripten" while CrossRef keeps the printed subtitle.
export function merge(primary: Summary, secondary: Summary, printedYear: number | null): Summary {
  const merged: Record<string, unknown> = {};
  const [one, two] = [primary, secondary] as unknown as Record<string, unknown>[];
  for (const key of new Set([...Object.keys(one), ...Object.keys(two)])) merged[key] = present(one[key]) ? one[key] : two[key];
  if (printedYear) {
    for (const candidate of [primary.year, secondary.year]) if (candidate === printedYear) { merged.year = candidate; break; }
  }
  const titles = [primary.title, secondary.title].filter((t): t is string => Boolean(t));
  if (titles.length) merged.title = titles.reduce((a, b) => (contentWords(b).size > contentWords(a).size ? b : a));
  return merged as unknown as Summary;
}

// Is this candidate's title the one printed in the reference? The test
// is containment, not similarity: the printed reference is a superset of
// the title. A long title may lose a word to a line-break hyphen; a
// short one cannot, since "Graph Attention Networks" and "Structured
// attention networks" share two words of three and are different papers.
export function titleMatches(candidate: string | null | undefined, raw: string, parsedTitle: string | null): boolean {
  const words = contentWords(candidate);
  if (!words.size) return false;
  const haystack = contentWords(`${raw} ${parsedTitle ?? ""}`);
  if (!haystack.size) return false;
  if (words.size === 1) {
    // A one-word result somewhere in a long reference has no identity;
    // usable only when the parser says that exact word is the whole title.
    const parsed = contentWords(parsedTitle);
    return parsed.size === 1 && parsed.has([...words][0]);
  }
  const matched = new Set([...words].filter((w) => haystack.has(w)));
  // PDF line-break recovery can join a real compound ("general- purpose"
  // becomes "generalpurpose"): count both words when their concatenation
  // is present.
  for (const first of words) for (const second of words) if (first !== second && haystack.has(first + second)) { matched.add(first); matched.add(second); }
  const missing = words.size - matched.size;
  if (words.size <= SHORT_TITLE) return missing === 0;
  return matched.size / words.size >= TITLE_AGREEMENT;
}

export function contentWords(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  // Hyphenated line breaks in a PDF split words that should be whole.
  const joined = text.toLowerCase().replace(/-\s+/g, "");
  return new Set((joined.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w)));
}
