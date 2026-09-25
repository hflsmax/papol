// A paper read by rules: its references, the citations that point at
// them, and the links to its figures, tables, sections and footnotes, in
// the shapes the Worker stores (cloudflare/src/papers/reading.ts), with no
// model in it. See registry.ts for how the rules are kept.

import type { Analysis } from "../../../../cloudflare/src/papers/reading";
import { findBibliography } from "./bibliography";
import { findCitations } from "./citations";
import { findFloats, findMentions } from "./floats";
import { findFootnoteMarkers, findFootnotes } from "./footnotes";
import { findSectionMentions, findSections } from "./sections";
import { flowOf, layout as layOut, type Line } from "./layout";
import { readPdf } from "./pdf";
import { Trace } from "./trace";

export interface RulesResult {
  analysis: Analysis;
  trace: Trace;
  stats: { pages: number; bodySize: number; numbering: string; twoColumnPages: number; floats: number; sections: number; footnotes: number };
}

export async function analyzeWithRules(bytes: Uint8Array): Promise<RulesResult> {
  const doc = await readPdf(bytes);
  const layout = layOut(doc);
  const trace = new Trace();
  const bibliography = findBibliography(layout, trace);
  // The text that can cite and mention: everything but the bibliography
  // itself and the page furniture, one flow per page.
  const readable = (line: Line) => !line.furniture && !bibliography.lines.has(line);
  const flows = layout.pages.map((page) => flowOf(page.lines.filter(readable)));
  const floats = findFloats(layout, trace);
  const sections = findSections(layout, bibliography.lines, floats.values(), trace);
  const links = flows.flatMap((flow) => [...findMentions(flow, floats, layout, trace), ...findSectionMentions(flow, sections, layout, trace)]);
  const citations = findCitations(layout, flows, bibliography, trace);
  const notes = findFootnotes(layout, trace);
  links.push(...findFootnoteMarkers(layout, notes, citations.flatMap((c) => c.boxes), trace));
  const analysis: Analysis = {
    references: bibliography.entries.map((e) => ({
      key: e.key, index: e.index, raw: e.raw, title: e.title, authors: e.authors, year: e.year,
      journal: e.journal, doi: e.doi, arxiv_id: e.arxiv_id, page: e.page, y: e.y,
    })),
    citations,
    floats: [...floats.values(), ...sections.values(), ...notes.values()].map(({ caption: _, ...float }) => float),
    links,
  };
  return {
    analysis, trace,
    stats: {
      pages: layout.pages.length, bodySize: layout.bodySize, numbering: bibliography.numbering,
      twoColumnPages: layout.pages.filter((p) => p.twoColumn).length, floats: floats.size, sections: sections.size, footnotes: notes.size,
    },
  };
}
