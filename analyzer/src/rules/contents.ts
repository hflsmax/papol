// A paper's contents read off its printed headings, for a PDF that carries
// no outline of its own: the Navigator's fallback (viewer/src/sections.js).
//
// The numbered headings are findSections' (sections.ts), the same ones a
// "Section 2.1" link lands on. What a paper leaves unnumbered — Abstract,
// Introduction and References in a numbered paper, every heading in one
// that numbers none — is read here, in two steps: a line alone on its row
// that is one of the names papers give their sections, set apart from the
// text (section.unnumbered-name); then any other line set in exactly the
// style of those (section.unnumbered-style).

import { findBibliography } from "./bibliography";
import { findFloats, typeOf, type Found } from "./floats";
import { layout as layOut, type Layout, type Line } from "./layout";
import { readPages, type Page as PdfText, type PdfDocument, type ReadOptions } from "./page";
import { findSections } from "./sections";
import { SECTION_CONTENTS_PAGE, SECTION_IN_SEQUENCE, SECTION_TITLE_WRAPS, SECTION_UNNUMBERED_NAME, SECTION_UNNUMBERED_STYLE } from "./registry";
import { Trace } from "./trace";

export interface Heading {
  number: string; // as printed, "" for none
  title: string;
  level: number; // 0 for a section, 1 for its subsection, …
  page: number; // 1-based
  top: number; // the heading's top, as a fraction of the page from its top
}

type Page = Layout["pages"][number];

const letters = (runs: Line["runs"]) => runs.reduce((n, r) => n + r.text.replace(/\s/g, "").length, 0);
const boldShare = (l: Line) => letters(l.runs.filter((r) => r.bold)) / Math.max(1, letters(l.runs));
const styleOf = (l: Line) => `${l.runs.find((r) => r.text.trim())?.font}@${l.size.toFixed(1)}`;
const clean = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();

// Depth by the number: "2" is a section, "2.1" its subsection; an
// appendix's "A" is a section and "A.1" its subsection; Roman numerals are
// sections.
const levelOf = (number: string) => (/^[IVX]+$/.test(number) ? 0 : number.split(".").length - 1);

export function findContents(layout: Layout, skip: Set<Line>, floats: Iterable<Found>, trace: Trace): Heading[] {
  const within = [...floats];
  const listing = contentsPages(layout);
  // The paper's own table of contents lists every heading ahead of it; the
  // headings are where it points (section.contents-page).
  const skipped = new Set(skip);
  for (const page of layout.pages) if (listing.has(page.number)) {
    for (const line of page.lines) skipped.add(line);
    trace.add(SECTION_CONTENTS_PAGE.id, page.number, "", []);
  }
  // And a contents without a page of its own — a list on the title page —
  // is a heading with its page number level with it on the right, apart.
  for (const page of layout.pages) for (const line of page.lines) {
    if (page.lines.some((o) => o !== line && /^\d{1,4}$/.test(o.text.trim()) && o.x0 > line.x1 && Math.abs(o.baseline - line.baseline) <= 2)
      && /^\s*(?:\d{1,2}|[A-Z])(?:\.\d{1,2})*\.?\s+\S/.test(line.text)) {
      skipped.add(line);
      trace.add(SECTION_CONTENTS_PAGE.id, page.number, line.text.slice(0, 80), []);
    }
  }
  const type = typeOf(layout);
  // A heading set in a face of its own: every word in a font the text is
  // not set in, upright, and a font little of the paper is set in (a
  // publisher's heading face whose name says nothing of weight:
  // "AdvPS6F01" beside the text's "AdvPS6F00") (section.heading-face).
  const faceShare = new Map<string, number>();
  let total = 0;
  for (const page of layout.pages) for (const line of page.lines) for (const r of line.runs) {
    const n = r.text.replace(/\s/g, "").length;
    faceShare.set(r.font, (faceShare.get(r.font) ?? 0) + n);
    total += n;
  }
  // (Its number may be in the text's face: "1." in CMR10, "Introduction" in
  // the small capitals CMCSC10.)
  const ownFace = (line: Line) => {
    const worded = line.runs.filter((r) => /\p{L}/u.test(r.text));
    return worded.length > 0 && worded.every((r) => r.font !== type.font && !r.italic && (faceShare.get(r.font) ?? 0) < 0.03 * total);
  };
  const capitals = (line: Line) => {
    const word = line.text.replace(/^[\dIVX.\s]+/, "").replace(/[^\p{L}]/gu, "");
    return word.length >= 4 && word === word.toUpperCase();
  };
  // A numbered line that runs on into its paragraph past a full stop
  // ("5 Placeholder Variables. We …") is a numbered paragraph, not a
  // section's heading (section.in-sequence).
  const runsOn = (title: string) => /[.:]\s+\p{L}/u.test(title) && title.split(/\s+/).length > 8;
  const numbered = inSequence([...findSections(layout, skipped, within, trace, {
    setApart: (line) => ownFace(line) || capitals(line),
    heads: (line, title) => !runsOn(title),
    columns: true,
  }).values()], trace);
  const headingLines = new Set(numbered.map((s) => s.caption as Line));
  const out: (Heading & { line?: Line })[] = [];
  for (const s of numbered) {
    const line = s.caption as Line;
    const text = clean(line.text);
    let title = text.replace(/^\S+\s*/, "").replace(/^[.)]\s*/, "");
    // A run-in heading's title ends at its stop; the paragraph runs on.
    const lead = /^(.{2,80}?[^\s.])[.:]\s+\p{Lu}/u.exec(title);
    if (lead && title.split(/\s+/).length > 8) title = lead[1];
    else title = [title, ...wrapped(layout.pages[s.page - 1], line, headingLines, trace)].join(" ");
    out.push({ number: s.label, title, level: levelOf(s.label), page: s.page, top: s.y, line });
  }
  const numberedSections = out.filter((h) => h.level === 0).length;
  const taken = new Set(out.map((h) => h.line));
  const titles = new Set(out.map((h) => h.title.toLowerCase()));
  const inFloat = (line: Line, page: Page) => within.some((f) => f.page === page.number
    && line.x0 / page.width >= f.x - 0.001 && line.x1 / page.width <= f.x + f.w + 0.001
    && line.top / page.height >= f.y - 0.001 && line.bottom / page.height <= f.y + f.h + 0.001);
  // Alone on its row: nothing else at its baseline in its column.
  const alone = (line: Line, page: Page) => !page.lines.some((o) => o !== line && !o.furniture
    && Math.abs(o.baseline - line.baseline) <= 2 && o.column === line.column);
  // Set apart from the text: mostly bold, larger, in capitals, or in a
  // face of its own.
  const setApart = (line: Line) => boldShare(line) > 0.5 || line.size > layout.bodySize + 0.5 || capitals(line) || ownFace(line);
  const candidates: { page: Page; line: Line; text: string }[] = [];
  for (const page of layout.pages) for (const line of page.lines) {
    const text = clean(line.text);
    // The bibliography's own heading is kept with its entries (skip); it
    // heads a section all the same.
    if (line.furniture || taken.has(line) || listing.has(page.number)) continue;
    if (skip.has(line) && !SECTION_UNNUMBERED_NAME.pattern!.test(text)) continue;
    if (line.x1 - line.x0 > type.measure + 1) continue;
    if (inFloat(line, page) || !alone(line, page)) continue;
    candidates.push({ page, line, text });
  }

  const add = (page: Page, line: Line, title: string, rule: string) => {
    out.push({ number: "", title, level: 0, page: page.number, top: line.top / page.height, line });
    taken.add(line);
    titles.add(title.toLowerCase());
    trace.add(rule, page.number, title.slice(0, 80), []);
  };
  // A paper that numbers its sections leaves unnumbered only what stands
  // around them: its abstract, its references, its notices and appendices.
  const around = /^(?:abstract|summary|acknowledge?ments?|references|bibliography|literature cited|works cited|appendix(?: [A-Z])?|appendices|supplementary (?:material|information)|data availability|code availability|author contributions|competing interests|funding)[.:]?$/i;
  const named: { page: Page; line: Line }[] = [];
  for (const { page, line, text } of candidates) {
    if (!SECTION_UNNUMBERED_NAME.pattern!.test(text) || !setApart(line) || line.x1 - line.x0 > 0.8 * type.measure) continue;
    if (numberedSections >= 2 && !around.test(text)) continue;
    const title = text.replace(/[.:]$/, "");
    if (titles.has(title.toLowerCase())) continue;
    named.push({ page, line });
    add(page, line, title, SECTION_UNNUMBERED_NAME.id);
  }

  // A paper that numbers none: its other headings are the lines set as the
  // named ones are, once the style is plain: two named headings set in it,
  // or one and two more lines that read as titles — a magazine names only
  // its "References" and titles the rest ("Maxwell and Szilard"). The style
  // sets them apart from the text, so a heading may run nearly the width of
  // its column ("From experiments to applications"), where a named one must
  // be well short of it.
  if (numberedSections < 2) {
    const titled = candidates.filter(({ line, text }) => !taken.has(line) && setApart(line) && SECTION_UNNUMBERED_STYLE.pattern!.test(text));
    const count = (lines: Line[]) => { const c = new Map<string, number>(); for (const l of lines) c.set(styleOf(l), (c.get(styleOf(l)) ?? 0) + 1); return c; };
    const namedCounts = count(named.map((n) => n.line));
    const titledCounts = count(titled.map((t) => t.line));
    const styles = new Set([...namedCounts].filter(([style, n]) => n >= 2 || n + (titledCounts.get(style) ?? 0) >= 3).map(([style]) => style));
    for (const { page, line, text } of titled) {
      if (!styles.has(styleOf(line))) continue;
      add(page, line, text.replace(/[.:]$/, ""), SECTION_UNNUMBERED_STYLE.id);
    }
  }

  return out
    .sort((a, b) => a.page - b.page || columnOrder(a, b))
    .map(({ line: _, ...heading }) => heading);
}

// The lines a numbered heading's title wraps onto: each straight below the
// last, in its column, in the face and size the title is set in, starting
// where the title starts (a hanging indent past the number) or where the
// heading does; never another heading, and never past a heading that ends
// at a stop (section.title-wraps).
function wrapped(page: Page, heading: Line, headings: Set<Line>, trace: Trace): string[] {
  const start = /^\s*\S+\s*(?:[.)]\s*)?/.exec(heading.text)?.[0].length ?? 0;
  const at = heading.chars[start];
  const run = at && at.run >= 0 ? heading.runs[at.run] : undefined;
  if (!run) return [];
  const titleX = run.x + (run.offsets?.[at.at] ?? 0);
  const more: string[] = [];
  let last = heading;
  while (more.length < 2 && !/[.:;]\s*$/.test(last.text)) {
    const next = page.lines
      .filter((l) => l !== last && !l.furniture && l.column === heading.column && l.baseline > last.baseline + 1)
      .sort((a, b) => a.baseline - b.baseline)[0];
    if (!next || headings.has(next) || next.baseline - last.baseline > 1.5 * heading.size) break;
    // Every word of it in the title's face: a bold run-in lead on the
    // paragraph below ("Methodology. To assess …") is not.
    const worded = next.runs.filter((r) => /\p{L}/u.test(r.text));
    if (!worded.length || worded.some((r) => r.font !== run.font || r.bold !== run.bold || r.italic !== run.italic)) break;
    if (Math.abs(next.size - heading.size) > 0.3 || /[.:]\s+\p{L}/u.test(next.text)) break;
    if (Math.abs(next.x0 - titleX) > 2 && Math.abs(next.x0 - heading.x0) > 2) break;
    more.push(clean(next.text));
    last = next;
  }
  if (more.length) trace.add(SECTION_TITLE_WRAPS.id, page.number, clean(heading.text).slice(0, 80), []);
  return more;
}

// The numbered headings that keep the paper's count: in reading order, a
// section is kept when it is the next number (or the one after, a heading
// missed between), and a subsection when its section was kept. Anything
// else is a list item, a figure's panel, or an equation's number that
// passed for a heading (section.in-sequence).
function inSequence(found: Found[], trace: Trace): Found[] {
  const ordered = [...found].sort((a, b) => a.page - b.page || (a.caption as Line).index - (b.caption as Line).index);
  const kept: Found[] = [];
  const keptTop = new Set<string>();
  let last = -1;
  // One numbered section is not a numbering: a line of affiliations "1
  // University of …", a lone numbered paragraph.
  const tops = ordered.filter((s) => /^\d+$/.test(s.label));
  if (tops.length < 2) {
    for (const s of tops) trace.add(SECTION_IN_SEQUENCE.id, s.page, `dropped ${s.label}: alone`, []);
    return ordered.filter((s) => !/^\d/.test(s.label));
  }
  for (const s of ordered) {
    if (/^\d+$/.test(s.label)) {
      const n = Number(s.label);
      if (last < 0 ? n > 2 : n !== last + 1 && n !== last + 2) {
        trace.add(SECTION_IN_SEQUENCE.id, s.page, `dropped ${s.label}`, []);
        continue;
      }
      last = n;
      keptTop.add(s.label);
      kept.push(s);
    } else if (/^\d/.test(s.label)) {
      if (keptTop.has(s.label.split(".")[0])) kept.push(s);
    } else {
      kept.push(s);
    }
  }
  return kept;
}

// Pages of a table of contents: the page headed "Contents", and those
// after it that carry on listing — most of their lines ending in a page
// number, or being one.
function contentsPages(layout: Layout): Set<number> {
  const pages = new Set<number>();
  const listingShare = (page: Page) => {
    const lines = page.lines.filter((l) => !l.furniture);
    return lines.filter((l) => /(?:^|\s|\.)\d{1,4}$/.test(l.text.trim())).length / Math.max(1, lines.length);
  };
  for (const page of layout.pages) {
    if (!page.lines.some((l) => !l.furniture && /^(?:table of )?contents$/i.test(clean(l.text)))) continue;
    if (listingShare(page) < 0.3) continue;
    pages.add(page.number);
    for (let next = page.number + 1; next <= layout.pages.length && listingShare(layout.pages[next - 1]) >= 0.3; next += 1) pages.add(next);
  }
  return pages;
}

// Within a page, in reading order: the order the layout read the lines in.
function columnOrder(a: Heading & { line?: Line }, b: Heading & { line?: Line }): number {
  if (a.line && b.line) return a.line.index - b.line.index;
  return a.top - b.top;
}

/**
 * The contents of an open pdf.js document, read page by page (readPages)
 * and then by the rules (contentsOfPages). The viewer runs the two apart,
 * the rules in a worker of their own (viewer/src/paperReading.js).
 * Resolves to null when cancelled between pages.
 */
export async function readContents(
  doc: PdfDocument,
  OPS: Record<string, number>,
  options: ReadOptions = {},
): Promise<Heading[] | null> {
  const pages = await readPages(doc, OPS, options);
  return pages && contentsOfPages(pages);
}

/** The contents of pages already read (readPages). */
export function contentsOfPages(pages: PdfText[]): Heading[] {
  const layout = layOut({ pages, info: { title: "", author: "" } });
  const trace = new Trace();
  const bibliography = findBibliography(layout, trace);
  const floats = findFloats(layout, trace);
  return findContents(layout, bibliography.lines, floats.values(), trace);
}
