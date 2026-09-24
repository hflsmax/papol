// Footnotes: each note at the foot of a page, and the superscript marks in
// the text that point at it. A note is kept as a float of kind `footnote`
// whose box is the note, so a link to it is stored and followed like a link
// to a figure (cloudflare/src/papers/tei.ts).

import type { Box, DocumentLink } from "../../../../cloudflare/src/papers/tei";
import type { Found } from "./floats";
import type { Layout, Line, Placed } from "./layout";
import { FOOTNOTE_MARKER, FOOTNOTE_NOTE } from "./registry";
import type { Trace } from "./trace";

type Page = Layout["pages"][number];

const NUMBER = /^\s*(\d{1,2})\s*$/;
const keyOf = (page: number, number: string) => `footnote\n${page}\n${number}`;
const sameSize = (a: number, b: number) => Math.abs(a - b) <= 0.03 * b;
const across = (a: Line, b: Line) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0;
const boxOf = (page: Page, x0: number, top: number, x1: number, bottom: number): Box =>
  ({ page: page.number, x: x0 / page.width, y: top / page.height, w: (x1 - x0) / page.width, h: (bottom - top) / page.height });

// The number a note opens with: its first run, raised, and words after it
// (a formula can open with an exponent too).
function openingNumber(line: Line): string | null {
  const first = line.runs[0];
  const rest = line.runs.slice(1).map((r) => r.text).join("").trimStart();
  return first?.sup && /^[\p{L}"“‘(]/u.test(rest) ? NUMBER.exec(first.text)?.[1] ?? null : null;
}

// Every note (footnote.note): a line smaller than the text that opens with
// a raised number, with nothing at the text's size under it in its column —
// the foot of the page; and the lines under it at its size, up to the next
// note. Keyed by page and number: footnotes are numbered through a paper,
// but a mark and its note share a page.
export function findFootnotes(layout: Layout, trace: Trace): Map<string, Found> {
  const notes = new Map<string, Found>();
  for (const page of layout.pages) {
    const lines = page.lines.filter((l) => !l.furniture);
    for (const line of lines) {
      const number = openingNumber(line);
      if (!number || line.size >= layout.bodySize - 0.5) continue;
      if (lines.some((o) => o.top > line.bottom && across(o, line) && sameSize(o.size, layout.bodySize) && !o.runs.every((r) => r.sup || r.sub))) continue;
      const own = [line];
      for (const next of lines.filter((o) => o.top > line.top && across(o, line) && sameSize(o.size, line.size)).sort((a, b) => a.top - b.top)) {
        const last = own[own.length - 1];
        if (openingNumber(next) || next.top - last.bottom > 0.6 * line.size) break;
        own.push(next);
      }
      const box = boxOf(page, Math.min(...own.map((l) => l.x0)), line.top, Math.max(...own.map((l) => l.x1)), own[own.length - 1].bottom);
      if (notes.has(keyOf(page.number, number))) continue;
      notes.set(keyOf(page.number, number), { key: `n${notes.size}`, kind: "footnote", label: number, caption: line, ...box });
      trace.add(FOOTNOTE_NOTE.id, page.number, line.text.slice(0, 80), [box]);
    }
  }
  return notes;
}

// The marks (footnote.marker): a raised number in a line of the text —
// after a word, not opening a note — whose note is on the same page. A
// raised number the paper cites with (`cited` holds those boxes) is a
// citation, not a mark.
export function findFootnoteMarkers(layout: Layout, notes: Map<string, Found>, cited: Box[], trace: Trace): DocumentLink[] {
  const links: DocumentLink[] = [];
  const overlaps = (a: Box, b: Box) => a.page === b.page && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const noteLines = new Set([...notes.values()].map((n) => n.caption));
  for (const page of layout.pages) {
    for (const line of page.lines) {
      if (line.furniture || noteLines.has(line)) continue;
      line.runs.forEach((run: Placed, index) => {
        const number = run.sup ? NUMBER.exec(run.text)?.[1] : undefined;
        if (!number || index === 0 && openingNumber(line)) return;
        const note = notes.get(keyOf(page.number, number));
        if (!note || note.caption === line) return;
        const box = boxOf(page, run.x, run.baseline - run.size, run.x + run.width, run.baseline + 0.2 * run.size);
        if (cited.some((c) => overlaps(c, box))) return;
        links.push({ float: note.key, label: number, ...box });
        trace.add(FOOTNOTE_MARKER.id, page.number, `${line.text.slice(0, 40)} → ${number}`, [box]);
      });
    }
  }
  return links;
}
