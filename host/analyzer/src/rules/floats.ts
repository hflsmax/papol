// Figures, tables, boxes, algorithms and listings: where each one is, and
// the places in the text that point at it.

import { least, most } from "./numbers";
import type { DocumentLink, Float } from "../../../../cloudflare/src/papers/reading";
import { citedAway } from "./cited";
import { boxesOf, type Flow, type Layout, type Line } from "./layout";
import {
  CAPTION_ALONE, CAPTION_LABEL, CAPTION_NOT_WRAPPED, CAPTION_STYLED, FLOAT_CAPTION_OVERLEAF, FLOAT_CAPTION_PARAGRAPH, FLOAT_FIGURE_EXTENT, FLOAT_FRAME, FLOAT_FRONT_MATTER, FLOAT_RULED, FLOAT_SIDE, FLOAT_TABLE_EXTENT, MENTION_CITED, MENTION_FLOAT,
} from "./registry";
import type { Drawn } from "./pdf";
import type { Trace } from "./trace";

// A float as found: the analysis's Float (reading.ts) with the caption line it
// was found by, which its own label is not a mention of.
export interface Found extends Float {
  caption: Line;
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

const PAD = 2; // points around a float's box
const keyOf = (kind: string, number: string) => `${kind}\n${number.toLowerCase()}`;

// ------------------------------------------------------------ extents

type Page = Layout["pages"][number];
interface Rect { x0: number; y0: number; x1: number; y1: number } // points, from the top-left

const rectOf = (l: Line): Rect => ({ x0: l.x0, y0: l.top, x1: l.x1, y1: l.bottom });
const union = (rects: Rect[]): Rect => ({
  x0: least(rects.map((r) => r.x0)), y0: least(rects.map((r) => r.y0)),
  x1: most(rects.map((r) => r.x1)), y1: most(rects.map((r) => r.y1)),
});
const across = (a: Rect, b: Rect) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0;
const isCaption = (l: Line) => CAPTION_LABEL.pattern!.test(l.text) || (l.bold && CAPTION_ALONE.pattern!.test(l.text));
// ------------------------------------------------------ the paper's type
//
// A float is found by what bounds it, never by how far it reaches: a figure
// can be any height, with any space inside it or between it and its caption.
// What bounds it is the paper's own running text, and what that looks like
// is measured from the paper, not assumed.

interface Type {
  bodySize: number;
  font: string; // the font most of the running text is set in
  leading: number; // baseline to baseline, in running text
  measure: number; // the width of a full line of running text
  text: { x0: number; x1: number }; // the text area, across
  margins: { y0: number; y1: number }; // under the running heads, over the feet
  columns: { x0: number; x1: number }[]; // one, or two
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const sameSize = (a: number, b: number) => Math.abs(a - b) <= 0.03 * b; // a size read off a transform, rounded
const shareIn = (l: Line, font: string) => {
  const all = l.runs.reduce((n, r) => n + r.text.replace(/\s/g, "").length, 0);
  return all ? l.runs.filter((r) => r.font === font).reduce((n, r) => n + r.text.replace(/\s/g, "").length, 0) / all : 0;
};
// Words are set a space apart; wider than an em and a half is a gap
// between cells, or between a label and a drawing.
const hasCellGap = (l: Line) => {
  const runs = [...l.runs].sort((x, y) => x.x - y.x);
  return runs.some((r, i) => i > 0 && r.x - (runs[i - 1].x + runs[i - 1].width) > 1.5 * l.size);
};

// The paper's type (float.type): its text font is the font most characters
// at the text's size are set in; its leading, the usual step between lines
// in that font; its measure, the usual width of those lines; and it is set
// in two columns when that measure is well under the width of the text.
export function typeOf(layout: Layout): Type {
  const bodySize = layout.bodySize;
  const chars = new Map<string, number>();
  for (const page of layout.pages) for (const l of page.lines) if (!l.furniture && sameSize(l.size, bodySize))
    for (const r of l.runs) chars.set(r.font, (chars.get(r.font) ?? 0) + r.text.length);
  const font = [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const body = layout.pages.flatMap((p) => p.lines.filter((l) => !l.furniture && sameSize(l.size, bodySize) && shareIn(l, font) >= 0.5 && !hasCellGap(l)));
  const steps: number[] = [];
  for (const page of layout.pages) {
    const lines = page.lines.filter((l) => body.includes(l));
    for (let i = 1; i < lines.length; i += 1) {
      const step = lines[i].baseline - lines[i - 1].baseline;
      if (lines[i].column === lines[i - 1].column && step > 0.8 * bodySize && step < 2 * bodySize) steps.push(step);
    }
  }
  const leading = median(steps) || 1.2 * bodySize;
  const measure = quantile(body.map((l) => l.x1 - l.x0), 0.75);
  const text = { x0: quantile(body.map((l) => l.x0), 0.02), x1: quantile(body.map((l) => l.x1), 0.98) };
  const columns = measure < 0.6 * (text.x1 - text.x0)
    ? [{ x0: text.x0, x1: text.x0 + measure }, { x0: text.x1 - measure, x1: text.x1 }]
    : [text];
  // Up and down, the paper's margins are where its running heads and feet
  // end, on the pages that have them; none, where it has none.
  const all = layout.pages.map(headsOf);
  const margins = {
    y0: most(all.flatMap((h) => h.heads.map((l) => l.bottom))),
    y1: least(all.flatMap((h) => h.feet.map((l) => l.top))),
  };
  if (margins.y0 === -Infinity) margins.y0 = 0;
  return { bodySize, font, leading, measure, text, columns, margins };
}

// Running text (float.prose): in the paper's text font at its size, no
// cell gaps, in a paragraph — a line with another a leading away above or
// below it — and either set to the full measure, justified with that line,
// or the short last line of a paragraph that is. Floats end where it begins.
function proseOn(page: Page, type: Type): Set<Line> {
  const candidates = page.lines.filter((l) => !l.furniture && sameSize(l.size, type.bodySize) && shareIn(l, type.font) >= 0.5 && !hasCellGap(l));
  const stepped = (a: Line, b: Line) => Math.abs(Math.abs(a.baseline - b.baseline) - type.leading) <= 0.25 * type.leading && across(rectOf(a), rectOf(b));
  // Set to the full measure, or justified: a line sharing both its edges
  // with the one a leading above or below (text wrapped beside a figure).
  // (A paragraph is at least half the measure wide: a table's column of
  // cells can share its edges too.)
  // (Nor is it lines as long as each other by having as many characters —
  // monospaced code; justified text is stretched to its width.)
  const edges = (a: Line, b: Line) => Math.abs(a.x0 - b.x0) <= 1 && Math.abs(a.x1 - b.x1) <= 1 && a.x1 - a.x0 >= type.measure / 2
    && a.text.length !== b.text.length;
  // Full: within an indent (two ems) of the measure — justified text fills it.
  // The line a leading from it shows it is in a paragraph whatever it is
  // set in (a line of code words, under a line of text).
  const texty = page.lines.filter((l) => !l.furniture && sameSize(l.size, type.bodySize) && !hasCellGap(l));
  const full = candidates.filter((l) => texty.some((o) => o !== l && stepped(o, l) && (l.x1 - l.x0 >= type.measure - 2 * l.size || edges(o, l))));
  const prose = new Set(full);
  // The short last line of a paragraph (its left edge shared with the
  // line above), and the indented first (its right edge shared with the
  // line below).
  for (const l of candidates) {
    if (full.some((f) => f.baseline < l.baseline && stepped(f, l) && Math.abs(f.x0 - l.x0) <= l.size)) prose.add(l);
    if (full.some((f) => f.baseline > l.baseline && stepped(f, l) && Math.abs(f.x1 - l.x1) <= 1 && l.x0 > f.x0)) prose.add(l);
    // And the last line of a paragraph carried over from the column
    // before, opening its column: no text line above it in the column (a
    // title or an author list across both is not the column's), set at the
    // column's edge, ending a sentence.
    const inColumn = (o: Line) => o.x0 >= l.x0 - 1 && o.x1 <= l.x0 + type.measure + l.size;
    if (/[.?!:]\s*$/.test(l.text) && !candidates.some((o) => o.baseline < l.baseline && across(rectOf(o), rectOf(l)) && inColumn(o))
      && (full.some((f) => f.baseline > l.baseline && Math.abs(f.x0 - l.x0) <= 1) || type.columns.some((c) => Math.abs(c.x0 - l.x0) <= 1.5))) prose.add(l);
  }
  // And a paragraph in any font: three lines or more, each a line's
  // spacing under the last, sharing both edges — an abstract, a sidebar's
  // text. (A caption is one too; captions are set apart later.)
  const lines = page.lines.filter((l) => !l.furniture).sort((a, b) => a.baseline - b.baseline);
  const next = (l: Line) => lines.find((o) => o.baseline > l.baseline + 0.5 * l.size && o.baseline - l.baseline <= 1.6 * l.size && edges(o, l) && sameSize(o.size, l.size));
  for (const l of lines.filter((l) => l.x1 - l.x0 >= type.measure / 2)) {
    const run = [l];
    for (let n = next(l); n && run.length < 3; n = next(n)) run.push(n);
    if (run.length >= 3) run.forEach((r) => prose.add(r));
  }
  // But not the text of a ruled table's cells, however it is set: a line
  // with a vertical rule close on its left, and another on its right (as
  // far off as a cell's short last line leaves it).
  const vertical = page.drawn.filter((d) => d.w < 1.5 && d.h >= 1);
  const ruledBeside = (l: Line, side: "left" | "right") => vertical.some((d) => d.y < l.bottom && d.y + d.h > l.top
    && (side === "left" ? d.x <= l.x0 && l.x0 - d.x <= 1.5 * l.size : d.x >= l.x1));
  for (const l of [...prose]) if (ruledBeside(l, "left") && ruledBeside(l, "right")) prose.delete(l);
  return prose;
}

// A heading: bold, at the text's size or above, not running text, and
// larger than the text, or with running text starting under it — at once,
// or, for a numbered one, within a few lines or under the numbered
// headings stacked beneath it ("3 Method", "3.1 Setup", then text). A
// numbered bold line with a picture under it is a label in a table of
// pictures ("1. Instant Translation"), which bounds no float.
function headingsOn(page: Page, type: Type, prose: Set<Line>): Line[] {
  const NUMBERED = /^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s/;
  const candidates = page.lines.filter((l) => !l.furniture && !prose.has(l) && l.bold && l.size >= type.bodySize - 0.5 && /[A-Za-z]{3}/.test(l.text));
  const proseUnder = (l: Line, leadings: number) => [...prose].some((p) => p.top > l.top && p.baseline - l.baseline <= leadings * type.leading && Math.abs(p.x0 - l.x0) <= 2 * l.size);
  const numberedHeading = (l: Line, depth = 0): boolean => proseUnder(l, 4) || (depth < 3 && candidates.some((h) => h !== l && NUMBERED.test(h.text)
    && h.baseline > l.baseline && h.baseline - l.baseline <= 3 * type.leading && Math.abs(h.x0 - l.x0) <= 2 * l.size && numberedHeading(h, depth + 1)));
  return candidates.filter((l) => l.size > type.bodySize + 1 || proseUnder(l, 2) || (NUMBERED.test(l.text) && numberedHeading(l)));
}

// What is drawn that could belong to a float (float.graphics): not a page
// background (over half the page), not a speck, not a tint behind running
// text or a running head, and not outside the text area altogether (crop
// marks, a rule in the margin).
// Where a page's floats can be, up and down: under its running head and
// over its foot — the paper's, where this page has none (float.graphics).
function marginsOf(page: Page, type: Type): { y0: number; y1: number } {
  const own = headsOf(page);
  return {
    y0: own.heads.length ? most(own.heads.map((l) => l.bottom)) : type.margins.y0,
    y1: own.feet.length ? least(own.feet.map((l) => l.top)) : type.margins.y1,
  };
}

// A page's running heads and feet: furniture in the top or bottom half
// standing alone in the margin — not level with the page's own text (a
// panel letter the furniture rule took).
function headsOf(page: Page): { heads: Line[]; feet: Line[] } {
  const text = page.lines.filter((l) => !l.furniture);
  const furniture = page.lines.filter((l) => l.furniture && !text.some((t) => t.top < l.bottom && t.bottom > l.top));
  return { heads: furniture.filter((l) => l.bottom < page.height / 2), feet: furniture.filter((l) => l.top > page.height / 2) };
}

function graphicsOf(page: Page, type: Type, prose: Set<Line>): (Rect & { image: boolean })[] {
  const area = page.width * page.height;
  const furniture = page.lines.filter((l) => l.furniture);
  const margins = marginsOf(page, type);
  return page.drawn.filter((d: Drawn) => {
    if (d.w * d.h > 0.5 * area || (d.w < 1 && d.h < 1)) return false;
    if (d.x + d.w <= type.text.x0 || d.x >= type.text.x1 || d.y + d.h <= margins.y0 || d.y >= margins.y1) return false;
    const behind = (lines: Iterable<Line>) => [...lines].some((l) => l.x0 >= d.x - 1 && l.x1 <= d.x + d.w + 1 && l.top >= d.y - 1 && l.bottom <= d.y + d.h + 1);
    return !(!d.image && behind(prose)) && !behind(furniture);
  }).map((d) => ({ x0: d.x, y0: d.y, x1: d.x + d.w, y1: d.y + d.h, image: d.image }));
}

// A caption's paragraph (float.caption-paragraph): the lines under its
// first at its size, each overlapping the ones above and a line's leading
// or less below; and a second column of it level with its first line, just
// right of it, when the caption is set smaller than the text (Nature).
function captionParagraph(first: Line, page: Page, captions: Set<Line>, type: Type): Line[] {
  const column = (start: Line): Line[] => {
    const lines = [start];
    let span = rectOf(start);
    for (;;) {
      const prev = lines[lines.length - 1];
      // A rule drawn between two lines ends the paragraph (an algorithm's
      // caption, and the algorithm under its rule) — a rule, at least half
      // the paragraph's width, not a legend's swatch drawn in the text
      // ("with standard Eggbox (red line)").
      const ruled = (l: Line) => page.drawn.some((d) => d.h < 1.5 && d.y >= prev.baseline && d.y <= l.top && d.x < l.x1 && d.x + d.w > l.x0
        && d.w >= 0.5 * (span.x1 - span.x0));
      const next = page.lines.filter((l) => !l.furniture && !captions.has(l) && !lines.includes(l) && sameSize(l.size, first.size)
        && l.baseline > prev.baseline + 0.5 * first.size && l.baseline - prev.baseline <= 1.6 * first.size && across(rectOf(l), span) && !ruled(l));
      if (!next.length) return lines;
      const top = least(next.map((l) => l.baseline));
      const row = next.filter((l) => l.baseline - top < 0.5 * first.size);
      lines.push(...row);
      span = union([span, ...row.map(rectOf)]);
    }
  };
  const lines = column(first);
  const left = union(lines.map(rectOf));
  const beside = page.lines.find((l) => !l.furniture && !captions.has(l) && !lines.includes(l) && sameSize(l.size, first.size)
    && Math.abs(l.baseline - first.baseline) < 0.5 * first.size && l.x0 > left.x1 && l.x0 - left.x1 <= 3 * first.size);
  if (beside && lines.length > 1 && first.size < type.bodySize - 0.5) lines.push(...column(beside));
  return lines;
}

// Everything on a page a float could be made of, and what bounds it.
interface Ground {
  page: Page;
  type: Type;
  graphics: (Rect & { image: boolean })[];
  pieces: Piece[]; // the graphics joined where they touch, and the loose text
  lines: Line[]; // text that may belong to a float: not prose, a heading or a caption
  bounds: Line[]; // prose, headings, and every caption's paragraph
  captions: Line[][];
}

function groundOf(page: Page, type: Type, paragraphs: Line[][]): Ground {
  const inCaption = new Set(paragraphs.flat());
  const prose = proseOn(page, type);
  for (const l of inCaption) prose.delete(l);
  const heads = headingsOn(page, type, prose).filter((l) => !inCaption.has(l));
  // The paper's front matter (float.front-matter): an author's block, known
  // by an email address in it — the address and the lines stacked under it.
  const front = new Set<Line>(page.lines.filter((l) => !l.furniture && FLOAT_FRONT_MATTER.pattern!.test(l.text)));
  for (const l of [...front]) {
    for (let at = l, next: Line | undefined; (next = page.lines.find((o) => !front.has(o) && !inCaption.has(o) && across(rectOf(o), rectOf(at))
      && o.baseline > at.baseline && o.baseline - at.baseline <= 1.6 * at.size)); at = next) front.add(next);
  }
  for (const l of front) prose.add(l);
  const graphics = graphicsOf(page, type, prose);
  const bounds = [...prose, ...heads, ...inCaption];
  // Text in the margins (a running head the furniture rule missed) is no
  // float's, as a drawing there is not.
  const lines = page.lines.filter((l) => !l.furniture && !prose.has(l) && !inCaption.has(l) && !heads.includes(l)
    && l.bottom > marginsOf(page, type).y0 && l.top < marginsOf(page, type).y1);
  return {
    page, type, graphics, lines, bounds, captions: paragraphs,
    pieces: [...piecesOf(graphics, bounds.map(rectOf)), ...lines.map((l) => ({ ...rectOf(l), image: false, thin: false, text: l }))],
  };
}

// A drawing is one thing however it was painted (float.piece): paths and
// images that touch or overlap are joined into one piece, which a float
// takes whole — except a path that crosses running text or a caption,
// which joins nothing.
export interface Piece extends Rect { image: boolean; thin: boolean; text?: Line }
export function piecesOf(graphics: (Rect & { image: boolean })[], bounds: Rect[]): Piece[] {
  const touching = (a: Rect, b: Rect) => a.x0 <= b.x1 + 0.5 && b.x0 <= a.x1 + 0.5 && a.y0 <= b.y1 + 0.5 && b.y0 <= a.y1 + 0.5;
  const thin = (g: Rect) => g.x1 - g.x0 < 1.5 || g.y1 - g.y0 < 1.5;
  const loose = graphics.filter((g) => bounds.some((b) => touching(g, b)));
  const joinable = graphics.filter((g) => !loose.includes(g)).sort((a, b) => a.x0 - b.x0);
  const parent = joinable.map((_, i) => i);
  // Iterative: a long chain of touching strokes would recurse too deep.
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) { const up = parent[i]; parent[i] = root; i = up; }
    return root;
  };
  for (let i = 0; i < joinable.length; i += 1) {
    for (let j = i + 1; j < joinable.length && joinable[j].x0 <= joinable[i].x1 + 0.5; j += 1) {
      if (touching(joinable[i], joinable[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, (Rect & { image: boolean })[]>();
  joinable.forEach((g, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), g]));
  return [
    ...[...groups.values()].map((gs) => ({ ...union(gs), image: gs.some((g) => g.image), thin: gs.every(thin) })),
    ...loose.map((g) => ({ ...g, thin: thin(g) })),
  ];
}

// For scripts/floats.ts: told how each float was bounded.
let explain: ((message: string) => void) | null = null;
export function explainFloats(to: ((message: string) => void) | null): void { explain = to; }
const show = (r: Rect) => `[${Math.round(r.x0)},${Math.round(r.y0)} ${Math.round(r.x1)},${Math.round(r.y1)}]`;

const gapBetween = (a: Rect, b: Rect) => ({
  xs: Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0),
  ys: Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0),
});

// Across, a float has the columns its caption is set across, shared
// halfway with a caption set level with it (float.band).
function acrossOf(caption: Rect, own: Line[], ground: Ground): { x0: number; x1: number } {
  const { type } = ground;
  // The columns the caption is set across — more than a word's width into
  // one — and the caption itself, which may hang out into the margin.
  const over = type.columns.filter((c) => Math.min(c.x1, caption.x1) - Math.max(c.x0, caption.x0) > 2 * type.bodySize);
  let x0 = Math.min(caption.x0, least(over.map((c) => c.x0)));
  let x1 = Math.max(caption.x1, most(over.map((c) => c.x1)));
  for (const other of ground.captions) {
    if (other === own) continue;
    const r = union(other.map(rectOf));
    if (gapBetween(r, caption).ys <= 0 || gapBetween(r, caption).xs > 0) continue;
    const middle = r.x0 >= caption.x1 ? (caption.x1 + r.x0) / 2 : (r.x1 + caption.x0) / 2;
    if (r.x0 >= caption.x1) x1 = Math.min(x1, middle); else x0 = Math.max(x0, middle);
  }
  // Text level with the caption, in its column, is text wrapped around the
  // float: the float is on the caption's side of it (a table set in the
  // right half of a one-column page).
  const wrapped = [...ground.bounds, ...ground.lines].filter((l) => !own.includes(l) && gapBetween(rectOf(l), caption).ys > 0
    && l.text.length >= 20 && l.size >= type.bodySize - 0.5 && l.x0 >= x0 - 1 && l.x1 <= x1 + 1);
  const left = wrapped.filter((l) => l.x1 <= caption.x0 + 1), right = wrapped.filter((l) => l.x0 >= caption.x1 - 1);
  if (left.length) x0 = Math.max(x0, most(left.map((l) => l.x1)) + 1);
  if (right.length) x1 = Math.min(x1, least(right.map((l) => l.x0)) - 1);
  return { x0, x1 };
}

// A float on one side of its caption (float.band): every piece that starts
// between the caption and the first bound that way — running text, a
// heading, another caption, a float already sized — within the caption's
// column. However tall, and however much space inside it. A piece that
// starts there is the float's whole, even where it runs on past the
// caption (a caption set beside its drawing).
function band(caption: Rect, own: Line[], ground: Ground, side: "above" | "below", claimed: Rect[], taken: Set<Piece>, tableOnly: boolean): { rect: Rect; pieces: Piece[] } {
  const x = acrossOf(caption, own, ground);
  // Mostly in the band: more than half of the piece's own width.
  const inside = (r: Rect) => Math.min(r.x1, x.x1) - Math.max(r.x0, x.x0) > 0.5 * (r.x1 - r.x0) || (r.x0 >= x.x0 - 1 && r.x1 <= x.x1 + 1);
  // Text bounds a float where it runs over or under the caption itself;
  // beside it, it is text wrapped around the float.
  const bounds = [
    ...ground.bounds.filter((l) => !own.includes(l)).map(rectOf).filter((b) => Math.min(b.x1, caption.x1) - Math.max(b.x0, caption.x0) > 0),
    ...claimed.filter((b) => Math.min(b.x1, x.x1) - Math.max(b.x0, x.x0) > 0),
  ];
  // A table is text and rules: a picture after them is where the next
  // float begins. (A table that begins with a picture is a table of them —
  // or whose first picture starts within two lines of its first text: a
  // grid of pictures under their labels.)
  if (tableOnly) {
    const ahead = ground.pieces.filter((p) => !taken.has(p) && inside(p) && (side === "below" ? p.y0 > caption.y1 - 1 : p.y1 < caption.y0 + 1))
      .sort((a, b) => (side === "below" ? a.y0 - b.y0 : b.y1 - a.y1));
    // A fill with lines of the table inside it is its cells' shading, not
    // a picture: the table's own.
    const holds = (p: Piece) => ground.lines.filter((l) => l.x0 >= p.x0 - 1 && l.x1 <= p.x1 + 1 && l.top >= p.y0 - 1 && l.bottom <= p.y1 + 1).length >= 2;
    for (const p of ahead) if (!p.text && !p.thin && !p.image && holds(p)) p.thin = true;
    const solid = ahead.filter((p) => !p.thin);
    const firstPicture = solid.find((p) => !p.text);
    const firstText = solid.find((p) => p.text);
    const near = (a: Piece, b: Piece) => (side === "below" ? a.y0 - b.y0 : b.y1 - a.y1) <= 2 * ground.type.leading;
    if (firstPicture && (solid[0] === firstPicture || (firstText && near(firstPicture, firstText)))) tableOnly = false;
    else for (const p of ahead) if (!p.text && !p.thin) bounds.push(p);
  }
  const limit = side === "above"
    ? Math.max(0, most(bounds.filter((b) => b.y1 <= caption.y0 + 1).map((b) => b.y1)))
    : Math.min(ground.page.height, least(bounds.filter((b) => b.y0 >= caption.y1 - 1).map((b) => b.y0)));
  const starts = (r: Rect) => side === "above" ? r.y0 >= limit - 1 && r.y0 < caption.y1 : r.y1 <= limit + 1 && r.y0 > caption.y0;
  const pieces = ground.pieces.filter((p) => !taken.has(p) && starts(p) && inside(p) && (!tableOnly || p.text || p.thin)
    && !claimed.some((c) => (gapBetween(c, p).xs > 0 && gapBetween(c, p).ys > 0) || (p.x0 >= c.x0 - 1 && p.x1 <= c.x1 + 1 && p.y0 >= c.y0 - 1 && p.y1 <= c.y1 + 1)));
  const bounding = bounds.find((b) => Math.abs((side === "above" ? b.y1 : b.y0) - limit) < 0.5);
  const boundText = bounding && ground.bounds.find((l) => l.top === bounding.y0 && l.x0 === bounding.x0)?.text;
  explain?.(`  ${side}: across ${Math.round(x.x0)}-${Math.round(x.x1)}, bound at ${Math.round(limit)}${bounding ? ` by ${boundText ? JSON.stringify(boundText.slice(0, 40)) : show(bounding)}` : ""}, ${pieces.length} pieces`);
  for (const p of pieces) explain?.(`    ${p.text ? `text "${p.text.text.slice(0, 30)}"` : p.image ? "image" : "drawn"} ${show(p)}`);
  // A scanned page is one picture with its text laid over it: a drawing's
  // strokes are in the picture, where nothing here sees them, and only its
  // labels are pieces. The float is the whole band (float.scanned).
  const page = ground.page;
  if (pieces.length && page.drawn.some((d) => d.image && d.w * d.h >= 0.8 * page.width * page.height)) {
    const margins = marginsOf(page, ground.type);
    const fill: Rect = side === "above"
      ? { x0: x.x0, y0: Math.max(limit, margins.y0), x1: x.x1, y1: caption.y1 }
      : { x0: x.x0, y0: caption.y0, x1: x.x1, y1: Math.min(limit, margins.y1) };
    explain?.(`  scanned: the band ${show(fill)}`);
    return { rect: union([caption, fill]), pieces };
  }
  return { rect: pieces.length ? union([caption, ...pieces]) : caption, pieces };
}

function frameAround(caption: Rect, ground: Ground, kind: string): Rect | null {
  const size = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);
  // A figure's or a table's frame does not run over the text around it: a
  // fill or a clip reaching into wrapped text is no frame. (A box's frame
  // holds its own running text.)
  const prose = kind === "box" ? [] : ground.bounds.filter((l) => !(l.top >= caption.y0 - 1 && l.bottom <= caption.y1 + 1));
  const holdsText = (g: Rect) => prose.some((l) => gapBetween(rectOf(l), g).xs > 2 * l.size && gapBetween(rectOf(l), g).ys > 0);
  const frames = ground.page.drawn.map((d) => ({ x0: d.x, y0: d.y, x1: d.x + d.w, y1: d.y + d.h, image: d.image }))
    .filter((g) => !g.image && size(g) < 0.8 * ground.page.width * ground.page.height && g.x0 <= caption.x0 + 1 && g.x1 >= caption.x1 - 1
      && g.y0 <= caption.y0 + 1 && g.y1 >= caption.y1 - 1 && size(g) >= 4 * size(caption) && !holdsText(g));
  return frames.sort((a, b) => size(a) - size(b))[0] ?? null;
}

// A float set between rules (float.ruled) — an algorithm, or a table in
// booktabs: rules as wide as its first under the caption, and the float
// runs down to the last of them before a bound.
function ruledUnder(caption: Rect, own: Line[], ground: Ground, claimed: Rect[]): Rect | null {
  const { type } = ground;
  const x = acrossOf(caption, own, ground);
  const rules = ground.graphics.filter((g) => !g.image && g.y1 - g.y0 < 1.5 && g.y0 >= caption.y1 - 1
    && g.x0 >= x.x0 - type.bodySize && g.x1 <= x.x1 + type.bodySize && g.x1 - g.x0 >= 0.5 * (x.x1 - x.x0)).sort((a, b) => a.y0 - b.y0);
  if (!rules.length) return null;
  const width = (r: Rect) => r.x1 - r.x0;
  // One rule each height: a rule is often painted twice over itself.
  const same = rules.filter((r) => Math.abs(width(r) - width(rules[0])) <= 2 && Math.abs(r.x0 - rules[0].x0) <= 2)
    .filter((r, i, all) => i === 0 || r.y0 - all[i - 1].y0 > 1);
  // Bounded by other captions and floats only: its body reads as prose.
  const bounds = [...ground.captions.filter((c) => c !== own).flat().map(rectOf), ...claimed]
    .filter((b) => gapBetween(b, { ...rules[0], y0: 0, y1: 1 }).xs > 0 && b.y0 > caption.y1);
  const limit = Math.min(ground.page.height, least(bounds.map((b) => b.y0)));
  // The closing rule: past the one right under the caption, if there is one.
  const opening = same[0].y0 - caption.y1 <= type.leading ? same[0] : undefined;
  const last = same.filter((r) => r !== opening && r.y1 <= limit + 1).pop();
  // A caption with one rule under it and nothing closing it is not ruled.
  if (!last) return null;
  const span: Rect = { x0: Math.min(caption.x0, last.x0), y0: caption.y0, x1: Math.max(caption.x1, last.x1), y1: last.y1 };
  const within = [...ground.graphics, ...ground.lines.filter((l) => !own.includes(l)).map(rectOf)]
    .filter((r) => r.y0 >= caption.y1 - 1 && r.y1 <= last.y1 + 1 && gapBetween(r, span).xs > 0.5 * (r.x1 - r.x0));
  explain?.(`  ruled: caption ${show(caption)}, across ${Math.round(x.x0)}-${Math.round(x.x1)}, ${same.length} rules, last ${show(last)}, ${within.length} within ${within.length ? show(union(within)) : ""}`);
  const over = ground.graphics.find((g) => !g.image && g.y1 - g.y0 < 1.5 && g.y1 <= caption.y0 + 1 && caption.y0 - g.y1 <= type.leading && gapBetween(g, caption).xs > 0
    && g.x0 >= x.x0 - type.bodySize && g.x1 <= x.x1 + type.bodySize);
  return union([span, ...within, ...(over ? [over] : [])]);
}

// How much of the page a float is: its caption, and what the caption is
// of — a frame around it, the rules it is set between, or the band on its
// usual side: over a figure's caption, under a table's.
function extentOf(kind: string, paragraph: Line[], ground: Ground, claimed: Rect[], taken: Set<Piece>, trace: Trace): { rect: Rect; rule: string; fixed: boolean } {
  const caption = union(paragraph.map(rectOf));
  if (paragraph.length > 1) trace.add(FLOAT_CAPTION_PARAGRAPH.id, ground.page.number, paragraph[0].text.slice(0, 60), []);
  // A box is drawn as fills of one width stacked against each other — a
  // tinted title band and the panel under it: the frame is all of them.
  const frame = frameAround(caption, ground, kind);
  if (frame) {
    let framed: Rect = frame;
    const fills = ground.page.drawn.filter((d) => !d.image && d.w * d.h < 0.8 * ground.page.width * ground.page.height)
      .map((d) => ({ x0: d.x, y0: d.y, x1: d.x + d.w, y1: d.y + d.h }));
    // (Not a fill that holds another float's caption: that is the next box,
    // stacked under this one.)
    const others = ground.captions.filter((c) => c !== paragraph).flat();
    const holdsOther = (f: Rect) => others.some((l) => l.x0 >= f.x0 - 1 && l.x1 <= f.x1 + 1 && l.top >= f.y0 - 1 && l.bottom <= f.y1 + 1);
    for (let grew = true; grew;) {
      grew = false;
      for (const f of fills) {
        if (holdsOther(f)) continue;
        const stacked = Math.abs(f.x0 - framed.x0) <= 2 && Math.abs(f.x1 - framed.x1) <= 2 && f.y0 <= framed.y1 + ground.type.leading && f.y1 >= framed.y0 - ground.type.leading;
        if (stacked && (f.y0 < framed.y0 || f.y1 > framed.y1)) { framed = union([framed, f]); grew = true; }
      }
    }
    return { rect: union([framed, caption]), rule: FLOAT_FRAME.id, fixed: true };
  }
  if (kind === "algorithm" || kind === "listing") {
    const ruled = ruledUnder(caption, paragraph, ground, claimed);
    if (ruled) return { rect: ruled, rule: FLOAT_RULED.id, fixed: true };
  }
  const { rect, pieces } = band(caption, paragraph, ground, kind === "figure" ? "above" : "below", claimed, taken, kind !== "figure");
  pieces.forEach((p) => taken.add(p));
  const rule = kind === "figure" ? FLOAT_FIGURE_EXTENT.id : FLOAT_TABLE_EXTENT.id;
  return { rect, rule: pieces.length ? rule : FLOAT_CAPTION_PARAGRAPH.id, fixed: false };
}

// A float, as a box: its caption and what the caption is of, which a link
// brings into view.
export function findFloats(layout: Layout, trace: Trace): Map<string, Found> {
  const floats = new Map<string, Found>();
  const type = typeOf(layout);
  explain?.(`type ${JSON.stringify(type)}`);
  // The page before, as its floats left it: what a caption heading the next
  // page may be the caption of (float.caption-overleaf).
  let before: { page: Page; ground: Ground; claimed: Rect[]; taken: Set<Piece> } | null = null;
  for (const page of layout.pages) {
    // Every caption on the page first: each float stops at the others'.
    const found: { kind: string; number: string; line: Line }[] = [];
    const seen = new Set(floats.keys());
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
      // A mention a paragraph wrapped onto the start of a line ("…as
      // indicated in / Table 1.1. Before embarking…") is not a caption: the
      // line above it, a leading up at its edge and its size, runs on into
      // it without ending a sentence (caption.not-wrapped).
      // (At its edge, or indented as a paragraph's first line is.)
      const above = page.lines.find((o) => !o.furniture && o !== line && sameSize(o.size, line.size) && o.x0 >= line.x0 - line.size && o.x0 <= line.x0 + 2.5 * line.size
        && line.baseline - o.baseline > 0.5 * line.size && line.baseline - o.baseline <= 1.6 * line.size && o.x1 - o.x0 >= 0.5 * (line.x1 - line.x0));
      if (above && /[\p{L}\p{N},;]$/u.test(above.text.trim()) && !CAPTION_LABEL.pattern!.test(above.text)) {
        trace.add(CAPTION_NOT_WRAPPED.id, page.number, line.text.slice(0, 80), []);
        continue;
      }
      const kind = kindOf(match.groups.kind);
      const number = match.groups.number;
      const key = keyOf(kind, number);
      // The first caption of a number is the float's; a later one is a
      // continuation ("Table 2 (continued)") or a list of figures.
      if (seen.has(key)) continue;
      seen.add(key);
      const captionBox = { page: page.number, x: line.x0 / page.width, y: line.top / page.height, w: (line.x1 - line.x0) / page.width, h: (line.bottom - line.top) / page.height };
      trace.add(rule.id, page.number, line.text.slice(0, 80), [captionBox]);
      found.push({ kind, number, line });
    }
    const firsts = new Set(found.map((f) => f.line));
    const paragraphs = found.map((f) => captionParagraph(f.line, page, firsts, type));
    const ground = groundOf(page, type, paragraphs);
    // Tables (and the other captioned-above kinds) are sized first, and a
    // figure grows around them, not through them (float.claimed).
    const order = found.map((_, i) => i).sort((a, b) => Number(found[a].kind === "figure") - Number(found[b].kind === "figure"));
    const extents: { rect: Rect; rule: string; fixed: boolean }[] = [];
    const taken = new Set<Piece>();
    const others = (i: number) => extents.filter((e, j) => e && j !== i).map((e) => e.rect);
    for (const i of order) {
      explain?.(`page ${page.number} ${found[i].kind} ${found[i].number}`);
      extents[i] = extentOf(found[i].kind, paragraphs[i], ground, others(i), taken, trace);
    }
    // Then, for a float with nothing on its usual side, what no float took
    // on its other side, up to the next bound: a figure captioned over
    // itself, a table under itself (float.other-side).
    for (const i of order) {
      if (extents[i].fixed || extents[i].rule !== FLOAT_CAPTION_PARAGRAPH.id) continue;
      explain?.(`page ${page.number} ${found[i].kind} ${found[i].number}, other side`);
      const caption = union(paragraphs[i].map(rectOf));
      const { rect, pieces } = band(caption, paragraphs[i], ground, found[i].kind === "figure" ? "below" : "above", others(i), taken, found[i].kind !== "figure");
      if (!pieces.length) continue;
      pieces.forEach((p) => taken.add(p));
      const rule = found[i].kind === "figure" ? FLOAT_FIGURE_EXTENT.id : FLOAT_TABLE_EXTENT.id;
      extents[i] = { rect: union([extents[i].rect, rect]), rule: extents[i].rule === FLOAT_CAPTION_PARAGRAPH.id ? rule : extents[i].rule, fixed: false };
    }
    // Last, once every float has its bands, a figure whose caption has
    // drawings level with it beyond its columns, with no text between and
    // no float's already, is set beside them (float.side): it takes them,
    // and the bands over and under them.
    for (const i of order) {
      if (extents[i].fixed || found[i].kind !== "figure") continue;
      const caption = union(paragraphs[i].map(rectOf));
      const between = (p: Rect) => ground.bounds.some((l) => !paragraphs[i].includes(l) && gapBetween(rectOf(l), caption).ys > 0
        && rectOf(l).x0 >= Math.min(p.x1, caption.x1) - 1 && rectOf(l).x1 <= Math.max(p.x0, caption.x0) + 1);
      const level = ground.pieces.filter((p) => !taken.has(p) && !p.text && !p.thin && gapBetween(p, caption).ys > 0
        && !between(p) && !others(i).some((c) => gapBetween(c, p).xs > 0 && gapBetween(c, p).ys > 0));
      if (!level.length) continue;
      explain?.(`page ${page.number} ${found[i].kind} ${found[i].number}, beside: ${level.length} level`);
      level.forEach((p) => taken.add(p));
      let rect = union([extents[i].rect, ...level]);
      for (const side of ["above", "below"] as const) {
        const more = band(rect, paragraphs[i], ground, side, others(i), taken, false);
        more.pieces.forEach((p) => taken.add(p));
        rect = more.rect;
      }
      extents[i] = { rect, rule: FLOAT_SIDE.id, fixed: false };
    }
    // A figure whose caption heads its page with nothing of its own, where
    // the page before ends in drawings no caption there took, is those
    // drawings: a figure given a page of its own, its caption set overleaf
    // (float.caption-overleaf). The float is the drawings, on that page —
    // what a link to it should show.
    const overleaf: (Rect & { on: Page })[] = [];
    for (const i of order) {
      if (extents[i].fixed || found[i].kind !== "figure" || !before) continue;
      const caption = union(paragraphs[i].map(rectOf));
      // Heading its page: no text but the running heads, and nothing solid
      // drawn, above it.
      const heads = page.lines.some((l) => !l.furniture && l.bottom <= caption.y0 + 1 && !paragraphs[i].includes(l));
      const drawnAbove = page.drawn.some((d) => d.w >= 1.5 && d.h >= 1.5 && d.y + d.h <= caption.y0 + 1 && d.y + d.h > marginsOf(page, type).y0);
      if (heads || drawnAbove) continue;
      // Nothing of its own: at most a rule or a stray line of its caption's
      // scripts beyond the caption.
      const own = extents[i].rect;
      if (caption.y0 - own.y0 > 2 * type.leading || own.y1 - caption.y1 > 2 * type.leading
        || caption.x0 - own.x0 > type.leading || own.x1 - caption.x1 > type.leading) continue;
      const prev = before;
      explain?.(`page ${page.number} ${found[i].kind} ${found[i].number}, overleaf on page ${prev.page.number}`);
      // A page given to the figure — no caption of its own, no running text
      // beside or among what it draws (above or under it, the text ending
      // or resuming) — has all of it: every solid drawing short of a page's
      // background (a full-page picture is over the half that graphicsOf
      // leaves out), and the labels among them.
      const margins = marginsOf(prev.page, type);
      // (Solid ones: a rule is as often the footer's line as the figure's.)
      const art = prev.page.drawn.filter((d) => d.w * d.h < 0.9 * prev.page.width * prev.page.height && d.w >= 1.5 && d.h >= 1.5
        && d.y + d.h > margins.y0 && d.y < margins.y1).map((d) => ({ x0: d.x, y0: d.y, x1: d.x + d.w, y1: d.y + d.h }));
      const whole = art.length ? union(art) : null;
      const within = (r: Rect, w: Rect) => r.x0 >= w.x0 - 1 && r.x1 <= w.x1 + 1 && r.y0 >= w.y0 - 1 && r.y1 <= w.y1 + 1;
      // Running text, that is (a journal's footer line can read as a
      // heading), level with the drawings but not inside them.
      const outside = [...proseOn(prev.page, type)].filter((l) => !whole || (!within(rectOf(l), whole) && gapBetween(rectOf(l), whole).ys > 0));
      let pieces: Rect[];
      if (whole && !prev.ground.captions.length && !prev.claimed.length && !outside.length) {
        pieces = [whole, ...prev.ground.lines.map(rectOf).filter((r) => within(r, whole))];
        explain?.(`  the whole page: ${show(whole)}`);
      } else {
        // Otherwise up from the lowest drawing no float there took — not
        // from the foot: a journal's footer line can read as text.
        const loose = prev.ground.pieces.filter((p) => !prev.taken.has(p) && !p.text && !p.thin);
        if (!loose.length) continue;
        const lowest = most(loose.map((p) => p.y1)) + 1;
        const bottom: Rect = { x0: type.text.x0, y0: lowest, x1: type.text.x1, y1: lowest };
        const grown = band(bottom, [], prev.ground, "above", prev.claimed, prev.taken, false).pieces;
        if (!grown.some((p) => !p.text && !p.thin)) continue;
        grown.forEach((p) => prev.taken.add(p));
        pieces = grown;
      }
      overleaf[i] = { ...union(pieces), on: prev.page };
      extents[i] = { rect: overleaf[i], rule: FLOAT_CAPTION_OVERLEAF.id, fixed: true };
    }
    found.forEach(({ kind, number, line }, i) => {
      // A little room around it, so an outline drawn at its edge does not
      // run through the outermost letters.
      const { rect: exact, rule: sized } = extents[i];
      const on = overleaf[i]?.on ?? page;
      const rect = { x0: Math.max(0, exact.x0 - PAD), y0: Math.max(0, exact.y0 - PAD), x1: Math.min(on.width, exact.x1 + PAD), y1: Math.min(on.height, exact.y1 + PAD) };
      const box = { page: on.number, x: rect.x0 / on.width, y: rect.y0 / on.height, w: (rect.x1 - rect.x0) / on.width, h: (rect.y1 - rect.y0) / on.height };
      floats.set(keyOf(kind, number), { key: `f${floats.size}`, kind, label: number, caption: line, ...box });
      trace.add(sized, on.number, `${kind} ${number}`, [box]);
    });
    before = { page, ground, claimed: extents.filter((e, i) => e && !overleaf[i]).map((e) => e.rect), taken };
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

export function findMentions(flow: Flow, floats: Map<string, Found>, layout: Layout, trace: Trace): DocumentLink[] {
  const links: DocumentLink[] = [];
  const size = (page: number): [number, number] => {
    const p = layout.pages[page - 1];
    return [p.width, p.height];
  };
  const re = new RegExp(MENTION_FLOAT.pattern!.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(flow.text))) {
    const groups = match.groups!;
    // A mention inside a citation, or of a cited work's part, is the cited
    // paper's, not this one's (mention.cited-locator, mention.cited-of).
    if (citedAway(flow.text, match.index, match.index + match[0].length)) {
      trace.add(MENTION_CITED.id, 0, match[0], []);
      continue;
    }
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
        links.push({ float: float.key, label: groups.list.slice(item.start, item.end).trim(), ...box });
      }
      trace.add(MENTION_FLOAT.id, boxes[0]?.page ?? 0, `${groups.kind} ${item.number}`, boxes);
    });
  }
  return links;
}
