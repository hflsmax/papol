// A paper read by rules, from pages already read (page.ts): its references,
// the citations that point at them, and the links to its figures, tables,
// sections, footnotes and named rules, and where its theorems, lemmas,
// definitions and proofs open, in the shapes the Worker stores
// (cloudflare/src/papers/reading.ts). Nothing here reads a file, so the
// viewer runs it in the browser (viewer/src/readingWorker.js) as the host
// does on a PDF (analyze.ts). See registry.ts for how the rules are kept.

import type { Analysis } from "../../../cloudflare/src/papers/reading";
import { findBibliography } from "./bibliography";
import { findContents, type Heading } from "./contents";
import { findCitations } from "./citations";
import { findFloats, findMentions } from "./floats";
import { findFootnoteMarkers, findFootnotes } from "./footnotes";
import { findRuleMentions, findRules } from "./inference";
import { findSectionMentions, findSections } from "./sections";
import { findStatements } from "./statements";
import { flowOf, layout as layOut, type Layout, type Line } from "./layout";
import type { Page } from "./page";
import { Trace } from "./trace";

export interface RulesResult {
  analysis: Analysis;
  trace: Trace;
  stats: { pages: number; bodySize: number; numbering: string; twoColumnPages: number; floats: number; sections: number; footnotes: number; rules: number; statements: number };
}

/**
 * Pages already read (page.ts, readPages), as the viewer reads them in the
 * browser: the analysis, and the headings its Navigator falls back on when
 * the PDF has no outline (contents.ts), from one layout.
 */
export function analyzePages(pages: Page[]): { analysis: Analysis; headings: Heading[] } {
  const layout = layOut({ pages, info: { title: "", author: "" } });
  const { analysis, bibliographyLines, floatValues, trace } = analyzed(layout);
  return { analysis, headings: findContents(layout, bibliographyLines, floatValues, trace) };
}

export function analyzeLayout(layout: Layout): RulesResult {
  const { analysis, trace, stats } = analyzed(layout);
  return { analysis, trace, stats };
}

function analyzed(layout: Layout) {
  const trace = new Trace();
  const bibliography = findBibliography(layout, trace);
  // The text that can cite and mention: everything but the bibliography
  // itself and the page furniture, one flow per page.
  const readable = (line: Line) => !line.furniture && !bibliography.lines.has(line);
  const flows = layout.pages.map((page) => flowOf(page.lines.filter(readable)));
  const floats = findFloats(layout, trace);
  const sections = findSections(layout, bibliography.lines, floats.values(), trace);
  const rules = findRules(layout, bibliography.lines, flows, trace);
  const statements = findStatements(layout, bibliography.lines, floats.values(), trace);
  const links = flows.flatMap((flow) => [
    ...findMentions(flow, floats, layout, trace), ...findSectionMentions(flow, sections, layout, trace), ...findRuleMentions(flow, rules, layout, trace),
  ]);
  const citations = findCitations(layout, flows, bibliography, trace);
  const notes = findFootnotes(layout, trace);
  links.push(...findFootnoteMarkers(layout, notes, citations.flatMap((c) => c.boxes), trace));
  const analysis: Analysis = {
    references: bibliography.entries.map((e) => ({
      key: e.key, index: e.index, raw: e.raw, title: e.title, authors: e.authors, year: e.year,
      journal: e.journal, doi: e.doi, arxiv_id: e.arxiv_id, page: e.page, y: e.y,
    })),
    citations,
    floats: [
      ...floats.values(), ...sections.values(), ...notes.values(), ...statements.values(),
      ...[...rules.values()].map(({ name: _n, shape: _s, bracketed: _b, category: _c, labels: _l, ...rule }) => rule),
    ].map(({ caption: _, ...float }) => float),
    links,
  };
  return {
    analysis, trace, bibliographyLines: bibliography.lines, floatValues: floats.values(),
    stats: {
      pages: layout.pages.length, bodySize: layout.bodySize, numbering: bibliography.numbering,
      twoColumnPages: layout.pages.filter((p) => p.twoColumn).length, floats: floats.size, sections: sections.size, footnotes: notes.size, rules: rules.size, statements: statements.size,
    },
  };
}
