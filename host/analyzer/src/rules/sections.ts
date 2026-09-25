// Numbered sections: where each one begins, and the places in the text
// that point at it ("Section 2.1", "§3"). A section is kept as a float of
// kind `section` whose box is its heading's line, as wide as the column it
// is set in, so a link to it is stored and followed like a link to a
// figure (cloudflare/src/papers/reading.ts).

import type { DocumentLink } from "../../../../cloudflare/src/papers/reading";
import { typeOf, type Found } from "./floats";
import { boxesOf, type Flow, type Layout, type Line } from "./layout";
import { MENTION_SECTION, SECTION_HEADING } from "./registry";
import type { Trace } from "./trace";

const keyOf = (number: string) => `section\n${number.toLowerCase()}`;

// A contents entry: the title ends in its page number, or runs to it along
// dot leaders.
const isContents = (title: string) => /\s\d{1,4}$/.test(title.trim()) || /\.\s?\.\s?\.|…/.test(title);

// Every numbered heading (section.heading): a line opening with a section
// number and a capitalised title, mostly bold or larger than the text,
// and not inside a float. The first line for a number is the section's; `skip`
// holds lines that are no one's heading (the bibliography's).
export function findSections(layout: Layout, skip: Set<Line>, floats: Iterable<Found>, trace: Trace): Map<string, Found> {
  const sections = new Map<string, Found>();
  const type = typeOf(layout);
  // Nothing inside a float heads a section: a figure's "70 Hz" label.
  const within = [...floats];
  const inFloat = (line: Line, page: Layout["pages"][number]) => within.some((f) => f.page === page.number
    && line.x0 / page.width >= f.x - 0.001 && line.x1 / page.width <= f.x + f.w + 0.001
    && line.top / page.height >= f.y - 0.001 && line.bottom / page.height <= f.y + f.h + 0.001);
  for (const page of layout.pages) {
    for (const line of page.lines) {
      if (line.furniture || skip.has(line)) continue;
      // Normalised, so a mathematical italic "𝜆" reads as the letter "λ".
      const match = SECTION_HEADING.pattern!.exec(line.text.normalize("NFKC"));
      if (!match?.groups || isContents(match.groups.title) || inFloat(line, page)) continue;
      // Mostly bold — the title too, not only a list item's number — or
      // larger than the text by more than the half point the text's size is
      // measured to (layout.ts).
      const letters = (runs: Line["runs"]) => runs.reduce((n, r) => n + r.text.replace(/\s/g, "").length, 0);
      const set = letters(line.runs.filter((r) => r.bold)) > letters(line.runs) / 2 || line.size > layout.bodySize + 0.5;
      if (!set) continue;
      const number = match.groups.number;
      if (sections.has(keyOf(number))) continue;
      // Across, the box is the column the section begins in — its heading's
      // column on a page set in two, else the text's width — so a link can
      // bring that column into view from its top (section.column).
      const middle = (line.x0 + line.x1) / 2;
      const column = (page.twoColumn && type.columns.length > 1 && type.columns.find((c) => middle >= c.x0 && middle <= c.x1)) || type.text;
      const x0 = Math.min(column.x0, line.x0), x1 = Math.max(column.x1, line.x1);
      const box = { page: page.number, x: x0 / page.width, y: line.top / page.height, w: (x1 - x0) / page.width, h: (line.bottom - line.top) / page.height };
      sections.set(keyOf(number), { key: `s${sections.size}`, kind: "section", label: number, caption: line, ...box });
      trace.add(SECTION_HEADING.id, page.number, line.text.slice(0, 80), [box]);
    }
  }
  return sections;
}

// The numbers a mention lists, with where each sits: "Sections 3 and 4" is
// two, "§§2–4" three (the middle one has no print of its own and points at
// the whole range).
function numbersIn(list: string): { number: string; start: number; end: number }[] {
  const out: { number: string; start: number; end: number }[] = [];
  const re = /(?:\d{1,2}|[A-Z](?=\.\d))(?:\.\d{1,2}){0,3}/g;
  let previous: { number: string; start: number; end: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(list))) {
    const number = match[0];
    const start = match.index, end = start + number.length;
    const between = previous ? list.slice(previous.end, start) : "";
    if (previous && /^\s*(?:[-–—]|to)\s*$/.test(between) && /^\d+$/.test(previous.number) && /^\d+$/.test(number)) {
      for (let n = Number(previous.number) + 1; n < Number(number); n += 1) out.push({ number: String(n), start: previous.start, end });
    }
    out.push({ number, start, end });
    previous = { number, start, end };
  }
  return out;
}

// Mentions of sections (mention.section), as links to their headings.
export function findSectionMentions(flow: Flow, sections: Map<string, Found>, layout: Layout, trace: Trace): DocumentLink[] {
  const links: DocumentLink[] = [];
  const size = (page: number): [number, number] => [layout.pages[page - 1].width, layout.pages[page - 1].height];
  const re = new RegExp(MENTION_SECTION.pattern!.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(flow.text))) {
    const groups = match.groups!;
    const listStart = match.index + match[0].length - groups.list.length;
    numbersIn(groups.list).forEach((item, index) => {
      const section = sections.get(keyOf(item.number));
      if (!section) return;
      // The first number takes the word before it: "Section 2.1" is one
      // thing to press.
      const from = index === 0 ? match!.index : listStart + item.start;
      const boxes = boxesOf(flow, from, listStart + item.end, size);
      for (const box of boxes) links.push({ float: section.key, label: groups.list.slice(item.start, item.end).trim(), ...box });
      trace.add(MENTION_SECTION.id, boxes[0]?.page ?? 0, `${groups.kind} ${item.number}`, boxes);
    });
  }
  return links;
}
