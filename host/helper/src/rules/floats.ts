// Figures, tables, boxes, algorithms and listings: where each one is, and
// the places in the text that point at it.

import type { DocumentLink, Float } from "../../../../cloudflare/src/papers/tei";
import { boxesOf, type Flow, type Layout, type Line } from "./layout";
import {
  CAPTION_ALONE, CAPTION_LABEL, CAPTION_STYLED, FLOAT_CAPTION_PARAGRAPH, FLOAT_FIGURE_EXTENT, FLOAT_FRAME, FLOAT_RULED, FLOAT_SIDE, FLOAT_TABLE_EXTENT, MENTION_FLOAT,
} from "./registry";
import type { Drawn } from "./pdf";
import type { Trace } from "./trace";

// A float as found: the analysis's Float (tei.ts) with the caption line it
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
  x0: Math.min(...rects.map((r) => r.x0)), y0: Math.min(...rects.map((r) => r.y0)),
  x1: Math.max(...rects.map((r) => r.x1)), y1: Math.max(...rects.map((r) => r.y1)),
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
  text: { x0: number; x1: number; y0: number; y1: number }; // the text area
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
// in two columns when that measure is well under the width of the text; its
// text area is where that text is set, on nearly every page.
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
  const text = {
    x0: quantile(body.map((l) => l.x0), 0.02), x1: quantile(body.map((l) => l.x1), 0.98),
    y0: quantile(body.map((l) => l.top), 0.02), y1: quantile(body.map((l) => l.bottom), 0.98),
  };
  const columns = measure < 0.6 * (text.x1 - text.x0)
    ? [{ x0: text.x0, x1: text.x0 + measure }, { x0: text.x1 - measure, x1: text.x1 }]
    : [text];
  return { bodySize, font, leading, measure, text, columns };
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
  const edges = (a: Line, b: Line) => Math.abs(a.x0 - b.x0) <= 1 && Math.abs(a.x1 - b.x1) <= 1;
  // Full: within an indent (two ems) of the measure — justified text fills it.
  const full = candidates.filter((l) => candidates.some((o) => o !== l && stepped(o, l) && (l.x1 - l.x0 >= type.measure - 2 * l.size || edges(o, l))));
  const prose = new Set(full);
  // The short last line of a paragraph (its left edge shared with the
  // line above), and the indented first (its right edge shared with the
  // line below).
  for (const l of candidates) {
    if (full.some((f) => f.baseline < l.baseline && stepped(f, l) && Math.abs(f.x0 - l.x0) <= l.size)) prose.add(l);
    if (full.some((f) => f.baseline > l.baseline && stepped(f, l) && Math.abs(f.x1 - l.x1) <= 1 && l.x0 > f.x0)) prose.add(l);
  }
  // And a paragraph in any font: three lines or more, each a line's
  // spacing under the last, sharing both edges — an abstract, a sidebar's
  // text. (A caption is one too; captions are set apart later.)
  const lines = page.lines.filter((l) => !l.furniture).sort((a, b) => a.baseline - b.baseline);
  // (At least half the measure wide: a table's column of cells can share
  // its edges too.)
  const next = (l: Line) => lines.find((o) => o.baseline > l.baseline + 0.5 * l.size && o.baseline - l.baseline <= 1.6 * l.size && edges(o, l) && sameSize(o.size, l.size)
    && o.x1 - o.x0 >= type.measure / 2);
  for (const l of lines.filter((l) => l.x1 - l.x0 >= type.measure / 2)) {
    const run = [l];
    for (let n = next(l); n && run.length < 3; n = next(n)) run.push(n);
    if (run.length >= 3) run.forEach((r) => prose.add(r));
  }
  return prose;
}

// A heading: bold, at the text's size or above, not running text, and
// numbered, larger than the text, or with running text starting under it.
function headingsOn(page: Page, type: Type, prose: Set<Line>): Line[] {
  return page.lines.filter((l) => !l.furniture && !prose.has(l) && l.bold && l.size >= type.bodySize - 0.5 && /[A-Za-z]{3}/.test(l.text) && (
    /^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s/.test(l.text) || l.size > type.bodySize + 1
    || [...prose].some((p) => p.top > l.top && p.baseline - l.baseline <= 2 * type.leading && Math.abs(p.x0 - l.x0) <= 2 * l.size)));
}

// What is drawn that could belong to a float (float.graphics): not a page
// background (over half the page), not a speck, not a tint behind running
// text or a running head, and not outside the text area altogether (crop
// marks, a rule in the margin).
// Where a page's floats can be, up and down: under its running head and
// over its foot, or — where it has none — within a leading of the text
// area (float.graphics).
function marginsOf(page: Page, type: Type): { y0: number; y1: number } {
  const furniture = page.lines.filter((l) => l.furniture);
  const heads = furniture.filter((l) => l.bottom <= type.text.y0 + 1), feet = furniture.filter((l) => l.top >= type.text.y1 - 1);
  return {
    y0: heads.length ? Math.max(...heads.map((l) => l.bottom)) : type.text.y0 - type.leading,
    y1: feet.length ? Math.min(...feet.map((l) => l.top)) : type.text.y1 + type.leading,
  };
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
      const next = page.lines.filter((l) => !l.furniture && !captions.has(l) && !lines.includes(l) && sameSize(l.size, first.size)
        && l.baseline > prev.baseline + 0.5 * first.size && l.baseline - prev.baseline <= 1.6 * first.size && across(rectOf(l), span));
      if (!next.length) return lines;
      const top = Math.min(...next.map((l) => l.baseline));
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
interface Piece extends Rect { image: boolean; thin: boolean; text?: Line }
function piecesOf(graphics: (Rect & { image: boolean })[], bounds: Rect[]): Piece[] {
  const touching = (a: Rect, b: Rect) => a.x0 <= b.x1 + 0.5 && b.x0 <= a.x1 + 0.5 && a.y0 <= b.y1 + 0.5 && b.y0 <= a.y1 + 0.5;
  const thin = (g: Rect) => g.x1 - g.x0 < 1.5 || g.y1 - g.y0 < 1.5;
  const loose = graphics.filter((g) => bounds.some((b) => touching(g, b)));
  const joinable = graphics.filter((g) => !loose.includes(g)).sort((a, b) => a.x0 - b.x0);
  const parent = joinable.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
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
  let x0 = Math.min(caption.x0, ...over.map((c) => c.x0));
  let x1 = Math.max(caption.x1, ...over.map((c) => c.x1));
  for (const other of ground.captions) {
    if (other === own) continue;
    const r = union(other.map(rectOf));
    if (gapBetween(r, caption).ys <= 0 || gapBetween(r, caption).xs > 0) continue;
    const middle = r.x0 >= caption.x1 ? (caption.x1 + r.x0) / 2 : (r.x1 + caption.x0) / 2;
    if (r.x0 >= caption.x1) x1 = Math.min(x1, middle); else x0 = Math.max(x0, middle);
  }
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
  // float begins. (A table that begins with a picture is a table of them.)
  if (tableOnly) {
    const ahead = ground.pieces.filter((p) => !taken.has(p) && inside(p) && (side === "below" ? p.y0 > caption.y1 - 1 : p.y1 < caption.y0 + 1))
      .sort((a, b) => (side === "below" ? a.y0 - b.y0 : b.y1 - a.y1));
    const first = ahead[0];
    if (first && !first.text && !first.thin) tableOnly = false;
    else bounds.push(...ahead.filter((p) => !p.text && !p.thin));
  }
  const limit = side === "above"
    ? Math.max(0, ...bounds.filter((b) => b.y1 <= caption.y0 + 1).map((b) => b.y1))
    : Math.min(ground.page.height, ...bounds.filter((b) => b.y0 >= caption.y1 - 1).map((b) => b.y0));
  const starts = (r: Rect) => side === "above" ? r.y0 >= limit - 1 && r.y0 < caption.y1 : r.y1 <= limit + 1 && r.y0 > caption.y0;
  const pieces = ground.pieces.filter((p) => !taken.has(p) && starts(p) && inside(p) && (!tableOnly || p.text || p.thin)
    && !claimed.some((c) => (gapBetween(c, p).xs > 0 && gapBetween(c, p).ys > 0) || (p.x0 >= c.x0 - 1 && p.x1 <= c.x1 + 1 && p.y0 >= c.y0 - 1 && p.y1 <= c.y1 + 1)));
  explain?.(`  ${side}: across ${Math.round(x.x0)}-${Math.round(x.x1)}, bound at ${Math.round(limit)}, ${pieces.length} pieces`);
  for (const p of pieces) explain?.(`    ${p.text ? `text "${p.text.text.slice(0, 30)}"` : p.image ? "image" : "drawn"} ${show(p)}`);
  return { rect: pieces.length ? union([caption, ...pieces]) : caption, pieces };
}

function frameAround(caption: Rect, ground: Ground): Rect | null {
  const size = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);
  const frames = ground.page.drawn.map((d) => ({ x0: d.x, y0: d.y, x1: d.x + d.w, y1: d.y + d.h, image: d.image }))
    .filter((g) => !g.image && size(g) < 0.8 * ground.page.width * ground.page.height && g.x0 <= caption.x0 + 1 && g.x1 >= caption.x1 - 1
      && g.y0 <= caption.y0 + 1 && g.y1 >= caption.y1 - 1 && size(g) >= 4 * size(caption));
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
  const same = rules.filter((r) => Math.abs(width(r) - width(rules[0])) <= 2 && Math.abs(r.x0 - rules[0].x0) <= 2);
  const bounds = [...ground.bounds.filter((l) => !own.includes(l)).map(rectOf), ...claimed].filter((b) => gapBetween(b, { ...rules[0], y0: 0, y1: 1 }).xs > 0 && b.y0 > caption.y1);
  const limit = Math.min(ground.page.height, ...bounds.map((b) => b.y0));
  const last = same.filter((r) => r.y1 <= limit + 1).pop();
  // A caption with one rule under it and nothing closing it is not ruled.
  if (!last || (same.length === 1 && last.y0 - caption.y1 <= type.leading)) return null;
  const span: Rect = { x0: Math.min(caption.x0, last.x0), y0: caption.y0, x1: Math.max(caption.x1, last.x1), y1: last.y1 };
  const within = [...ground.graphics, ...ground.lines.filter((l) => !own.includes(l)).map(rectOf)]
    .filter((r) => r.y0 >= caption.y1 - 1 && r.y1 <= last.y1 + 1 && gapBetween(r, span).xs > 0);
  const over = ground.graphics.find((g) => !g.image && g.y1 - g.y0 < 1.5 && g.y1 <= caption.y0 + 1 && caption.y0 - g.y1 <= type.leading && gapBetween(g, caption).xs > 0);
  return union([span, ...within, ...(over ? [over] : [])]);
}

// How much of the page a float is: its caption, and what the caption is
// of — a frame around it, the rules it is set between, or the band on its
// usual side: over a figure's caption, under a table's.
function extentOf(kind: string, paragraph: Line[], ground: Ground, claimed: Rect[], taken: Set<Piece>, trace: Trace): { rect: Rect; rule: string; fixed: boolean } {
  const caption = union(paragraph.map(rectOf));
  if (paragraph.length > 1) trace.add(FLOAT_CAPTION_PARAGRAPH.id, ground.page.number, paragraph[0].text.slice(0, 60), []);
  const frame = frameAround(caption, ground);
  if (frame) return { rect: union([frame, caption]), rule: FLOAT_FRAME.id, fixed: true };
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
    // Last, a caption with nothing over or under it is set beside its
    // float (float.side): what is level with it across the text, with no
    // running text between, and then the bands over and under that.
    for (const i of order) {
      if (extents[i].rule !== FLOAT_CAPTION_PARAGRAPH.id) continue;
      explain?.(`page ${page.number} ${found[i].kind} ${found[i].number}, beside`);
      const caption = union(paragraphs[i].map(rectOf));
      const between = (p: Rect) => ground.bounds.some((l) => !paragraphs[i].includes(l) && gapBetween(rectOf(l), caption).ys > 0
        && rectOf(l).x0 >= Math.min(p.x1, caption.x1) - 1 && rectOf(l).x1 <= Math.max(p.x0, caption.x0) + 1);
      const level = ground.pieces.filter((p) => !taken.has(p) && gapBetween(p, caption).ys > 0 && gapBetween(p, caption).xs <= 0
        && (!p.text || !p.thin) && !between(p) && !others(i).some((c) => gapBetween(c, p).xs > 0 && gapBetween(c, p).ys > 0));
      if (!level.some((p) => !p.text)) continue;
      level.forEach((p) => taken.add(p));
      let rect = union([caption, ...level]);
      for (const side of ["above", "below"] as const) {
        const more = band(rect, paragraphs[i], ground, side, others(i), taken, found[i].kind !== "figure");
        more.pieces.forEach((p) => taken.add(p));
        rect = more.rect;
      }
      extents[i] = { rect, rule: FLOAT_SIDE.id, fixed: false };
    }
    found.forEach(({ kind, number, line }, i) => {
      // A little room around it, so an outline drawn at its edge does not
      // run through the outermost letters.
      const { rect: exact, rule: sized } = extents[i];
      const rect = { x0: Math.max(0, exact.x0 - PAD), y0: Math.max(0, exact.y0 - PAD), x1: Math.min(page.width, exact.x1 + PAD), y1: Math.min(page.height, exact.y1 + PAD) };
      const box = { page: page.number, x: rect.x0 / page.width, y: rect.y0 / page.height, w: (rect.x1 - rect.x0) / page.width, h: (rect.y1 - rect.y0) / page.height };
      floats.set(keyOf(kind, number), { key: `f${floats.size}`, kind, label: number, caption: line, ...box });
      trace.add(sized, page.number, `${kind} ${number}`, [box]);
    });
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
