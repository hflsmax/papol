// A paper's title block, read by rules: title, authors, year, journal, and
// the identifiers printed on its first pages — what the upload form is
// filled with (HeaderMetadata).
//
// It reads the first page's lines as the analyzer lays them out
// (layout.ts): the title is the largest text near the top, the authors the
// names under it before the abstract. The identifiers are looked for as
// the browser looks for them (shared/identifiers.js), so a paper the
// browser found nothing on is not read differently here.

import type { HeaderMetadata } from "../../../cloudflare/src/papers/reading";
import { normalizeTitle } from "../../../cloudflare/src/papers/reading";
import { extractArxivId, extractDoi } from "../../../cloudflare/src/papers/identifiers";
import { layout, type Line } from "./layout";
import { readDoc, type Doc, type PdfDocument } from "./page";
import {
  HEADER_ABSTRACT, HEADER_AFFILIATION, HEADER_AUTHORS, HEADER_CITE_THIS, HEADER_JOURNAL_ABBREVIATION, HEADER_JOURNAL_ISSUE, HEADER_JOURNAL_LINE, HEADER_JOURNAL_VOLUME, HEADER_MASTHEAD, HEADER_PROCEEDINGS, HEADER_NOT_TITLE, HEADER_RUNNING_TITLE,
  HEADER_SUBTITLE, HEADER_TITLE, HEADER_YEAR, HEADER_YEAR_LATE,
} from "./registry";
import { Trace } from "./trace";

// The pages to read (HEADER_PAGES): the title block is ordinarily first but
// can follow a cover leaf; an identifier may be in a footer a page or two on,
// and a scanned title can be recovered from the second or third page's head.
export const HEADER_PAGES = 3;
const PAGES = HEADER_PAGES;
const LATEST_YEAR = new Date().getUTCFullYear() + 1;

export interface HeaderResult {
  header: HeaderMetadata;
  trace: Trace;
}

/** The title block of a document open in the browser (page.ts, PdfDocument). */
export async function readHeader(doc: PdfDocument, OPS: Record<string, number>): Promise<HeaderMetadata | null> {
  const read = await readDoc(doc, OPS, { pages: PAGES });
  return read && headerOf(read).header;
}

/** The title block of a document's first pages, read (page.ts, readDoc). */
export function headerOf(doc: Doc): HeaderResult {
  const trace = new Trace();
  const laid = layout(doc);
  const first = laid.pages[0];
  const text = doc.pages.map((p) => p.text).join("\n");
  const arxiv = extractArxivId(text);
  const doi = (extractDoi(doc.pages[0]?.text ?? "") ?? extractDoi(text))?.toLowerCase() ?? null;
  const empty = { title: null, authors: [], journal: null, year: null, doi, arxiv_id: arxiv };
  if (!first) return { header: empty, trace };

  let lines = inRows(first.lines.filter((l) => !l.furniture));
  // An Elsevier masthead: the journal's name between "Contents lists
  // available" and "journal homepage", and nothing of it the title.
  let journal: string | null = null;
  const homepage = lines.find((l) => HEADER_MASTHEAD.pattern!.test(l.text) && /homepage/i.test(l.text));
  if (homepage) {
    const masthead = lines.filter((l) => l.bottom <= homepage.top && !HEADER_MASTHEAD.pattern!.test(l.text) && letters(l.text) >= 3);
    const name = masthead.sort((a, b) => b.size - a.size)[0];
    if (name) { journal = clean(name); trace.add(HEADER_MASTHEAD.id, 1, journal, []); }
    lines = lines.filter((l) => l.top > homepage.top);
  }

  let titlePage = first;
  let titleSource = lines;
  let titleLines = titleOf(titleSource, laid.bodySize, titlePage.width, titlePage.height, doc.info.title);
  // Covers and publisher leaves can precede the actual title page. Search
  // the other pages already read only when page one has no convincing block.
  for (const page of laid.pages.slice(1)) {
    if (titleLines.length) break;
    const pageLines = inRows(page.lines.filter((line) => !line.furniture));
    const found = titleOf(pageLines, laid.bodySize, page.width, page.height, doc.info.title);
    // On a later body page, an enlarged equation or proposition can gather
    // accidental title-like evidence. A deferred title page is conspicuously
    // larger than body text and begins in its upper half.
    if (found.length && found[0].size >= 1.35 * laid.bodySize && found[0].top < 0.5 * page.height) {
      titlePage = page; titleSource = pageLines; titleLines = found;
    }
  }
  let title: string | null = titleLines.length ? titleLines.map((line) => cleanTitle(line, titleSource, laid.bodySize)).reduce(joinLine) : null;
  let after = titleLines[titleLines.length - 1];
  if (title) {
    trace.add(HEADER_TITLE.id, titlePage.number, title, []);
    const next = titleSource.find((l) => l.top > after.top);
    if (next && isSubtitle(next, after, laid.bodySize)) {
      title = `${title.replace(/[:.]$/, "")}: ${clean(next)}`;
      trace.add(HEADER_SUBTITLE.id, 1, clean(next), []);
      after = next;
    }
  } else {
    title = runningTitle(laid.pages.slice(1), trace) ?? (plausibleInfoTitle(doc.info.title) ? doc.info.title : null);
  }

  const below = after ? titleSource.filter((l) => l.top > after.top) : titleSource;
  // A cover sheet's citation line names the authors outright.
  const cited = HEADER_CITE_THIS.pattern!.exec(lines.map((l) => l.text).join(" "));
  let authors: string[];
  if (cited) {
    authors = cited.groups!.authors.split(/\s*(?:,|\band\b|&)\s*/).map((p) => nameOf(p)).filter((n): n is string => !!n);
    trace.add(HEADER_CITE_THIS.id, 1, cited[0], []);
  } else authors = authorsOf(below, trace);
  // A journal line in any page's head or foot, else an abbreviation in the
  // first page's citation line.
  const pageOne = first.lines.map((l) => l.text).join("\n");
  let lineYear: number | null = null;
  for (const line of laid.pages.flatMap((p) => p.lines)) {
    const rule = [HEADER_JOURNAL_LINE, HEADER_JOURNAL_VOLUME].find((r) => r.pattern!.test(line.text));
    if (!rule) continue;
    const found = rule.pattern!.exec(line.text)!;
    const name = found.groups!.journal.trim();
    journal ??= name === name.toUpperCase() ? name.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : name;
    lineYear ??= found.groups!.year ? Number(found.groups!.year) : null;
    trace.add(rule.id, 1, found[0], []);
    if (lineYear) break;
  }
  // ACM's "In Proceedings of the … (CHI '23)", read across line breaks:
  // the conference's short name.
  const venue = HEADER_PROCEEDINGS.pattern!.exec((doc.pages[0]?.text ?? "").replace(/(\p{L})- (\p{Ll})/gu, "$1$2").replace(/\s+/g, " "));
  if (!journal && venue) { journal = venue.groups!.acronym; trace.add(HEADER_PROCEEDINGS.id, 1, venue[0], []); }
  const abbreviated = HEADER_JOURNAL_ABBREVIATION.pattern!.exec(pageOne)?.groups!.abbr;
  if (!journal && abbreviated) {
    journal = JOURNALS[abbreviated] ?? (abbreviated.startsWith("Phys. Rev. ") ? `Physical Review ${abbreviated.slice(-1)}` : null);
    trace.add(HEADER_JOURNAL_ABBREVIATION.id, 1, abbreviated, []);
    // PACMPL's issue is the conference: "(ICFP)", as Crossref has it.
    const issue = journal ? HEADER_JOURNAL_ISSUE.pattern!.exec(pageOne.replace(/\s+/g, " ")) : null;
    if (issue) { journal = `${journal} (${issue.groups!.issue})`; trace.add(HEADER_JOURNAL_ISSUE.id, 1, issue[0], []); }
  }
  const year = cited ? Number(cited.groups!.year) : yearOf(pageOne, lineYear, arxiv, trace);

  return { header: { title: normalizeTitle(title), authors, journal, year, doi, arxiv_id: arxiv }, trace };
}

// The names Crossref keeps for the abbreviations HEADER_JOURNAL_ABBREVIATION
// knows; "Phys. Rev. E" and its kind are "Physical Review E".
const JOURNALS: Record<string, string> = {
  "Proc. ACM Program. Lang.": "Proceedings of the ACM on Programming Languages",
  "ACM Trans. Graph.": "ACM Transactions on Graphics",
  "Phys. Rev. Lett.": "Physical Review Letters",
  "PNAS": "Proceedings of the National Academy of Sciences",
  "Proc. Natl. Acad. Sci.": "Proceedings of the National Academy of Sciences",
};

const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

// A line's text without its scripts (a title's footnote mark is not part
// of it). Runs are spaced by the gap between them: Nature sets a title's
// words a tenth of an em apart, and the capital and small capitals of one
// word ("XG" "RAMMAR") sit a twentieth apart but change size.
function clean(line: Line): string {
  let out = "";
  let prev: Line["runs"][number] | null = null;
  for (const run of line.runs) {
    if (run.sup || run.sub) continue;
    const smallCaps = prev && Math.abs(prev.size - run.size) > 0.1 * line.size;
    if (prev && run.x - (prev.x + prev.width) > (smallCaps ? 0.15 : 0.05) * line.size) out += " ";
    out += run.text;
    prev = run;
  }
  return out.replace(/\s+/g, " ").trim().replace(/\s*[*∗†‡§¶]+$/u, "");
}

const joinLine = (out: string, text: string) => (/\p{L}-$/u.test(out) ? out.slice(0, -1) + text : `${out} ${text}`);

// Review manuscripts often print source line numbers down the left margin.
// The first one can share the title's baseline and be joined to it by PDF
// extraction ("1 Choreographing Effects"). Remove it only when the page has
// the continuing margin-number sequence that proves what it is.
function cleanTitle(line: Line, lines: Line[], body: number): string {
  const text = clean(line);
  if (!/^\d+\s+\p{L}/u.test(text)) return text;
  const marginNumbers = lines.filter((other) => /^\s*\d+\s*$/.test(other.text) && Math.abs(other.x0 - line.x0) <= body);
  return marginNumbers.length >= 3 ? text.replace(/^\d+\s+/, "") : text;
}

// A line of names, which a title never is: more than one, or one with its
// affiliation, and nothing else. A short title in capitals ("Metamaterial
// Mechanisms") is one part and no name.
function allNames(line: Line): boolean {
  const parts = splitAuthorLine(line);
  const names = parts.filter((p) => nameOf(p)).length;
  return names > 0 && parts.length > 1 && parts.every((p) => nameOf(p) || HEADER_AFFILIATION.pattern!.test(p));
}

// Most of a line's parts are names.
function mostlyNames(line: Line): boolean {
  const parts = splitAuthorLine(line).filter((p) => /\p{L}{2}/u.test(p));
  return parts.length > 0 && parts.filter((p) => nameOf(p)).length * 2 >= parts.length;
}

// A page's lines top to bottom, and those level with each other (the
// pieces of an author row split by the layout's columns) left to right.
function inRows(lines: Line[]): Line[] {
  const sorted = [...lines].sort((a, b) => a.top - b.top);
  const out: Line[] = [];
  let row: Line[] = [];
  for (const line of sorted) {
    if (row.length && line.top - row[0].top > 0.6 * Math.min(line.size, row[0].size)) { out.push(...row.sort((a, b) => a.x0 - b.x0)); row = []; }
    row.push(line);
  }
  return [...out, ...row.sort((a, b) => a.x0 - b.x0)];
}

type TitleCandidate = { lines: Line[]; score: number };

// Words shared by two possible renderings of a title. PDF Info titles are
// useful corroboration, but never the sole answer: they are often filenames,
// templates or stale titles from an earlier draft.
function titleAgreement(a: string, b: string): number {
  const words = (s: string) => new Set(s.normalize("NFKD").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return 0;
  const common = [...left].filter((word) => right.has(word)).length;
  return common / Math.max(left.size, right.size);
}

function titleOf(lines: Line[], body: number, width: number, height: number, infoTitle: string): Line[] {
  // The affiliation under a line of names, set as large as the names.
  const underNames = (l: Line) => {
    const above = lines[lines.indexOf(l) - 1];
    return !!above && allNames(above) && Math.abs(above.size - l.size) < 0.05 * l.size;
  };
  // Judge the visible baseline text after stripping scripts. Drop caps and
  // other decorated initials can otherwise look like enormous title lines:
  // e.g. an introduction beginning with R + superscript "ECENT" cleans to
  // just "R", but its uncleaned text used to outrank the paper's title.
  const abstract = lines.find((line) => HEADER_ABSTRACT.pattern!.test(line.text));
  const cutoff = Math.min(height * 0.7, abstract?.top ?? Infinity);
  const eligible = lines.filter((line) => line.top < cutoff && letters(clean(line)) >= 3
    && !HEADER_NOT_TITLE.pattern!.test(line.text) && !/^(?:fig(?:ure)?\.?|table)\s*\d+\b/i.test(line.text)
    && !/^(?:\d+(?:\.\d+)*|[IVXLCDM]+\.?)\s+(?:introduction|background|methods?|results?|discussion|conclusions?)\b/i.test(line.text)
    && !allNames(line) && !underNames(line));
  const corroborates = plausibleInfoTitle(infoTitle) ? infoTitle : null;
  const candidates: TitleCandidate[] = [];
  for (const start of eligible) {
    if (start.size < body * 1.05) continue;
    const same = (line: Line) => Math.abs(line.size - start.size) <= 0.05 * start.size;
    const block = [start];
    for (const line of eligible) {
      if (line.top <= start.top || !same(line)) continue;
      if (line.top - block[block.length - 1].top > 2.2 * start.size) break;
      block.push(line);
    }
    const text = block.map((line) => cleanTitle(line, lines, body)).reduce(joinLine);
    const last = block[block.length - 1];
    const next = lines.find((line) => line.top > last.top);
    // Names close below a candidate are the strongest evidence that it is a
    // title rather than a logo, a figure label or an opening drop cap.
    const nearby = lines.filter((line) => line.top > last.top
      && line.top <= Math.min(abstract?.top ?? Infinity, last.bottom + 12 * body));
    const authors = authorsOf(nearby, new Trace()).length;
    const words = text.split(/\s+/).filter((word) => /\p{L}/u.test(word));
    const allCaps = letters(text) >= 3 && text === text.toUpperCase();
    const size = Math.min(4, Math.max(0, (start.size / body - 1) * 4));
    const position = Math.max(0, 3 - (4 * start.top) / height);
    const language = words.length >= 2 ? 1 : 0;
    const isolatedCaps = allCaps && words.length <= 2 ? -2 : 0;
    const authorBlock = Math.min(authors, 3) * 2;
    const affiliation = authors > 0 && nearby.some((line) => HEADER_AFFILIATION.pattern!.test(line.text)) ? 0.5 : 0;
    const beforeAbstract = abstract && last.top < abstract.top ? 1 : 0;
    const leadsSubtitle = next && isSubtitle(next, last, body) ? 2 : 0;
    const similarity = corroborates ? titleAgreement(text, corroborates) : 0;
    const agreement = similarity >= 0.7 ? 3 : similarity >= 0.4 ? 1 : 0;
    // A wide line is mild supporting evidence only: short one-word titles
    // and narrow title columns are both legitimate.
    const breadth = (start.x1 - start.x0) / width >= 0.35 ? 0.5 : 0;
    candidates.push({ lines: block, score: size + position + language + isolatedCaps + authorBlock + affiliation + beforeAbstract + leadsSubtitle + agreement + breadth });
  }
  candidates.sort((a, b) => b.score - a.score || a.lines[0].top - b.lines[0].top);
  // Below this, size and position alone did not form a convincing title.
  return candidates[0]?.score >= 5 ? candidates[0].lines : [];
}

// A subtitle: a line set smaller, directly under the title, that is not the
// names. Long ACM subtitles and shorter bold book subtitles both occur.
function isSubtitle(line: Line, title: Line, body: number): boolean {
  const words = clean(line).split(" ");
  const titleText = clean(title);
  if (titleText === titleText.toUpperCase() && titleText.split(/\s+/).length <= 2) return false;
  return line.top - title.top <= 3 * title.size && line.size < title.size * 0.95 && line.size >= body * 0.95
    && letters(line.text) >= 8 && !/^\p{Ll}/u.test(words[0])
    && (words.length >= 6 || ((line.bold || line.size >= 1.5 * body) && words.length >= 3) || words.some((w) => /^\p{Ll}/u.test(w)))
    && !mostlyNames(line) && !HEADER_AFFILIATION.pattern!.test(line.text)
    && !HEADER_NOT_TITLE.pattern!.test(line.text) && !HEADER_ABSTRACT.pattern!.test(line.text) && !isProse(line);
}

// A title set as a picture (a scan) is still the running head of the pages
// after: the head that is not a page number, a journal or the names.
function runningTitle(pages: { lines: Line[]; height: number }[], trace: Trace): string | null {
  for (const page of pages) {
    for (const line of page.lines) {
      if (!line.furniture || line.top > page.height * 0.12) continue;
      const text = clean(line).replace(/^\s*\d+\s*[•·|]?\s*|\s*[•·|]?\s*\d+\s*$/g, "").trim();
      if (letters(text) < 8 || /\d|et al|\bvol\b|journal|transactions|proceedings|letters|\|/i.test(text) || allNames(line)) continue;
      trace.add(HEADER_RUNNING_TITLE.id, page.lines.indexOf(line), text, []);
      return text;
    }
  }
  return null;
}

function plausibleInfoTitle(title: string): boolean {
  return letters(title) >= 8 && /\s/.test(title) && !/\.(?:dvi|pdf|docx?|tex|indd)\b|microsoft word|untitled|^(?:title|paper|manuscript)$/i.test(title);
}

const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "di", "da", "dos", "du", "la", "le", "ter", "zu", "y", "bin", "al"]);

// One part of an author line as a person's name, or null.
function nameOf(part: string): string | null {
  const cleaned = part.replace(/[*∗†‡§¶✉✝#]+/gu, " ").replace(/\s*\([\p{L}'’.-]+\)\s*/gu, " ")
    .replace(/\s+/g, " ").trim().replace(/^(?:and|&)\s+/i, "");
  if (!cleaned || HEADER_AFFILIATION.pattern!.test(cleaned) || /\d/.test(cleaned)) return null;
  const words = cleaned.split(" ");
  if (words.length < 2 || words.length > 5) return null;
  // An acronym beside ordinary words is an institution: "TU Wien".
  if (words.some((w) => /^\p{Lu}{2,}$/u.test(w)) && words.some((w) => /\p{Ll}/u.test(w))) return null;
  const ok = words.every((w) => PARTICLES.has(w.toLowerCase()) || /^\p{Lu}[\p{L}'’.-]*$/u.test(w) || /^(?:\p{Lu}\.){1,3}-?(?:\p{Lu}\.)?$/u.test(w));
  if (!ok || !words.some((w) => letters(w) >= 2 && !/\.$/.test(w))) return null;
  // A name set in capitals takes ordinary case.
  const plain = cleaned.replace(/[^\p{L}]/gu, "");
  return plain === plain.toUpperCase()
    ? words.map((w) => (/^(?:\p{Lu}\.)+$/u.test(w) ? w : w.toLowerCase().replace(/(^|[-'’])\p{L}/gu, (m) => m.toUpperCase()))).join(" ")
    : cleaned;
}

// TeX sets an accent as a character of its own beside its letter — "Be´rut",
// "C˘at˘alin Hrit,cu" — before the letter or after it. Each goes onto the
// vowel beside it (a cedilla or comma below onto the consonant before).
const ACCENTS: Record<string, string> = { "´": "\u0301", "`": "\u0300", "ˆ": "\u0302", "˜": "\u0303", "¨": "\u0308", "˘": "\u0306", "ˇ": "\u030C", "˚": "\u030A", "˝": "\u030B" };
const VOWEL = /[aeiouyAEIOUY]/;
export function foldAccents(text: string): string {
  let out = text.replace(/([stcSTC])\s?,\s?(?=\p{Ll})/gu, (_, c) => `${c}\u0326`).replace(/([cC])¸/g, "$1\u0327");
  out = out.replace(/(\p{L})?\s?([´`ˆ˜¨˘ˇ˚˝])\s?(\p{L})?/gu, (m, before: string | undefined, accent: string, after: string | undefined) => {
    const mark = ACCENTS[accent];
    if (after && VOWEL.test(after) && !(before && VOWEL.test(before))) return `${before ?? ""}${after}${mark}`;
    if (before) return `${before}${mark}${after ?? ""}`;
    if (after) return `${after}${mark}`;
    return m;
  });
  return out.normalize("NFC");
}

// An author line's text with its marks and wide gaps turned into commas.
function splitAuthorLine(line: Line): string[] {
  let text = "";
  line.runs.forEach((run, i) => {
    if (i > 0) {
      const prev = line.runs[i - 1];
      const gap = run.x - (prev.x + prev.width);
      text += run.sup || run.sub || prev.sup || prev.sub || gap > 1.2 * line.size ? " , " : gap > 0.15 * line.size ? " " : "";
    }
    text += run.sup || run.sub ? "" : run.text;
  });
  return foldAccents(text).split(/\s*(?:,|;|\band\b|&|\s·\s|\s•\s)\s*/u).map((p) => p.trim()).filter(Boolean);
}

function isProse(line: Line): boolean {
  const words = line.text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length < 10) return false;
  const lower = words.filter((w) => /^\p{Ll}/u.test(w) && !PARTICLES.has(w) && w !== "and").length;
  return lower / words.length > 0.4;
}

function authorsOf(lines: Line[], trace: Trace): string[] {
  const names: string[] = [];
  let looked = 0;
  let namedLine: Line | null = null;
  for (const line of lines) {
    if (HEADER_ABSTRACT.pattern!.test(line.text)) { trace.add(HEADER_ABSTRACT.id, 1, line.text, []); break; }
    if (isProse(line)) { if (names.length) break; continue; }
    if (++looked > 40) break;
    // "NAME, Affiliation, City, Country": once a part is not a name, the
    // rest of the line is an address.
    // A line that opens with a phrase is text, not names: a subtitle's
    // "…, and Equi-recursive Types".
    const parts = splitAuthorLine(line);
    // A long final name can wrap its surname onto a centred line of its own.
    // It continues the preceding author row only at the same size and line
    // spacing, before any affiliation begins.
    if (names.length && namedLine && parts.length === 1 && /^\p{Lu}[\p{L}'’.-]+$/u.test(parts[0])
      && Math.abs(line.size - namedLine.size) <= 0.05 * line.size && line.top - namedLine.top <= 1.8 * line.size) {
      names[names.length - 1] += ` ${parts[0]}`;
      trace.add(HEADER_AUTHORS.id, 1, names[names.length - 1], []);
      namedLine = line;
      continue;
    }
    const opening = parts.find((p) => /\p{L}{2}/u.test(p));
    if (opening && !nameOf(opening) && !HEADER_AFFILIATION.pattern!.test(opening) && opening.split(" ").length >= 3) continue;
    let named = false;
    for (const part of parts) {
      if (HEADER_AFFILIATION.pattern!.test(part)) break;
      const name = nameOf(part);
      if (!name) { if (named) break; continue; }
      named = true;
      if (!names.includes(name)) { names.push(name); trace.add(HEADER_AUTHORS.id, 1, name, []); }
    }
    if (named) namedLine = line;
  }
  return names;
}

// The first page's date of publication, the journal line's year, a
// "YYYY, Vol." line or the acceptance, and last an arXiv number's year.
function yearOf(text: string, lineYear: number | null, arxiv: string | null, trace: Trace): number | null {
  const plausible = (y: number | null) => y !== null && y >= 1900 && y <= LATEST_YEAR;
  const published = HEADER_YEAR.pattern!.exec(text);
  if (published && plausible(Number(published.groups!.year))) { trace.add(HEADER_YEAR.id, 1, published[0], []); return Number(published.groups!.year); }
  if (plausible(lineYear)) return lineYear;
  const late = HEADER_YEAR_LATE.pattern!.exec(text);
  const lateYear = late ? Number(late.groups!.vol ?? late.groups!.accepted) : null;
  if (plausible(lateYear)) { trace.add(HEADER_YEAR_LATE.id, 1, late![0], []); return lateYear; }
  const yymm = arxiv?.match(/^(\d{2})(\d{2})\./);
  return yymm ? 2000 + Number(yymm[1]) : null;
}
