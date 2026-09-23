// Figures, tables, boxes, algorithms and listings: where each one is, and
// the places in the text that point at it.

import { boxesOf, type Flow, type Layout, type Line } from "./layout";
import { CAPTION_ALONE, CAPTION_LABEL, CAPTION_REGION, CAPTION_STYLED, MENTION_FLOAT } from "./registry";
import type { Trace } from "./trace";

export interface Float {
  kind: string; // figure, table, box, algorithm, listing
  number: string; // as printed: "3", "3.12", "S4"
  page: number;
  y: number; // where a link to it lands, as a fraction of the page
  caption: Line;
}

export interface FloatLink {
  kind: string;
  label: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  target_page: number;
  target_y: number;
}

export function kindOf(word: string): string {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.startsWith("fig")) return "figure";
  if (w.startsWith("tab")) return "table";
  if (w.startsWith("box")) return "box";
  if (w.startsWith("alg")) return "algorithm";
  if (w.startsWith("listing")) return "listing";
  return w;
}

const keyOf = (kind: string, number: string) => `${kind}\n${number.toLowerCase()}`;

// Where a figure is: the space above its caption in the caption's column,
// down from the nearest text above it. A table (or an algorithm, or a
// listing) is captioned above itself and starts at its caption.
function targetOf(kind: string, caption: Line, lines: Line[], height: number, bodySize: number): number {
  if (kind !== "figure") return caption.top / height;
  // Only text counts: a figure's own labels ("a", "optimize", an axis) are
  // inside the figure, and stopping at them would land in its middle.
  const above = lines.filter((l) => !l.furniture && l !== caption && l.bottom <= caption.top + 0.5
    && l.x1 > caption.x0 && l.x0 < caption.x1 && l.text.length >= 30 && l.size >= 0.85 * bodySize);
  const nearest = above.reduce((best, l) => Math.max(best, l.bottom), 0);
  // Text right above the caption: whatever the figure is, it is not above.
  if (caption.top - nearest < 2.5 * bodySize) return caption.top / height;
  return nearest / height;
}

export function findFloats(layout: Layout, trace: Trace): Map<string, Float> {
  const floats = new Map<string, Float>();
  for (const page of layout.pages) {
    for (const line of page.lines) {
      if (line.furniture) continue;
      let rule = CAPTION_LABEL;
      let match = CAPTION_LABEL.pattern!.exec(line.text);
      if (!match && line.bold) { rule = CAPTION_ALONE; match = CAPTION_ALONE.pattern!.exec(line.text); }
      if (!match && (line.runs[0]?.bold || line.size <= 0.93 * layout.bodySize)) {
        rule = CAPTION_STYLED;
        match = CAPTION_STYLED.pattern!.exec(line.text);
      }
      if (!match?.groups) continue;
      const kind = kindOf(match.groups.kind);
      const number = match.groups.number;
      const key = keyOf(kind, number);
      // The first caption of a number is the float's; a later one is a
      // continuation ("Table 2 (continued)") or a list of figures.
      if (floats.has(key)) continue;
      const y = targetOf(kind, line, page.lines, page.height, layout.bodySize);
      floats.set(key, { kind, number, page: page.number, y, caption: line });
      trace.add(rule.id, page.number, line.text.slice(0, 80), [{ page: page.number, x: line.x0 / page.width, y: line.top / page.height, w: (line.x1 - line.x0) / page.width, h: (line.bottom - line.top) / page.height }]);
      trace.add(CAPTION_REGION.id, page.number, `${kind} ${number}`, [{ page: page.number, x: 0, y, w: 1, h: 0.002 }]);
    }
  }
  return floats;
}

// Each number a mention lists, with where it sits in the match: "Figs. 3
// and 4" is two mentions, "Figures 3–5" three (the middle one has no print
// of its own, and borrows the range's).
function numbersIn(list: string): { number: string; start: number; end: number }[] {
  const out: { number: string; start: number; end: number }[] = [];
  const re = /(S?\d{1,3}(?:\.\d{1,3})?)([a-z](?:\s*[-–—]\s*[a-z](?![a-z]))?)?/g;
  let previous: { value: number; start: number; end: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(list))) {
    const number = match[1];
    const start = match.index, end = match.index + match[0].length;
    const between = previous ? list.slice(previous.end, start) : "";
    const value = Number(number.replace(/^S/, ""));
    // A range: fill in what it leaves unprinted, pointing at the whole range.
    if (previous && /^\s*(?:[-–—]|to)\s*$/.test(between) && Number.isInteger(value) && value > previous.value && value - previous.value <= 20) {
      for (let n = previous.value + 1; n < value; n += 1) out.push({ number: String(n), start: previous.start, end });
    }
    out.push({ number, start, end });
    previous = { value, start, end };
  }
  return out;
}

export function findMentions(flow: Flow, floats: Map<string, Float>, layout: Layout, trace: Trace): FloatLink[] {
  const links: FloatLink[] = [];
  const size = (page: number): [number, number] => {
    const p = layout.pages[page - 1];
    return [p.width, p.height];
  };
  const re = new RegExp(MENTION_FLOAT.pattern!.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(flow.text))) {
    const groups = match.groups!;
    const kind = kindOf(groups.kind);
    const listStart = match.index + match[0].length - groups.list.length;
    // A caption's own label is not a pointer to itself.
    const first = flow.at[match.index];
    if (first && first.char <= 1) {
      const float = floats.get(keyOf(kind, numbersIn(groups.list)[0]?.number ?? ""));
      if (float && float.caption === first.line) continue;
    }
    numbersIn(groups.list).forEach((item, index) => {
      const float = floats.get(keyOf(kind, item.number));
      if (!float) return;
      // The first number takes the word before it too: "Figure 3" is one
      // thing to press, not a "3" with a word beside it.
      const from = index === 0 ? match!.index : listStart + item.start;
      const boxes = boxesOf(flow, from, listStart + item.end, size);
      for (const box of boxes) {
        links.push({ kind, label: groups.list.slice(item.start, item.end).trim(), ...box, target_page: float.page, target_y: float.y });
      }
      trace.add(MENTION_FLOAT.id, boxes[0]?.page ?? 0, `${groups.kind} ${item.number}`, boxes);
    });
  }
  return links;
}
