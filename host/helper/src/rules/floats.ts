// Figures, tables, boxes, algorithms and listings: where each one is, and
// the places in the text that point at it.

import type { DocumentLink, Float } from "../../../../cloudflare/src/papers/tei";
import { boxesOf, type Flow, type Layout, type Line } from "./layout";
import {
  CAPTION_ALONE, CAPTION_LABEL, CAPTION_STYLED, FLOAT_CAPTION_PARAGRAPH, FLOAT_FIGURE_EXTENT, FLOAT_FRAME, FLOAT_SIDE_CAPTION, FLOAT_TABLE_EXTENT, MENTION_FLOAT,
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
// Fonts that set code and mathematics: a line in them is part of a figure
// (a listing, a grammar, a rule of inference), not running text.
const MONO = /mono|courier|typewriter|cmtt|inconsolata|menlo|consol|sourcecode|lmmono/i;
const MATH = /^(cmmi|cmsy|cmex|cmbsy|msbm|msam|eufm|rsfs|stix|lmmath|mathjax|symbol|cambriamath)|math|italic.*math/i;

// A line of running text (float.prose): set at the text's size, in a text
// font, and reading as words. Floats end where it begins.
function isProse(l: Line, bodySize: number): boolean {
  if (l.furniture || Math.abs(l.size - bodySize) > 0.08 * bodySize || l.text.length < 30) return false;
  const letters = (pick: (font: string) => boolean) => l.runs.filter((r) => pick(r.font)).reduce((n, r) => n + r.text.replace(/\s/g, "").length, 0);
  const all = Math.max(1, letters(() => true));
  if (letters((f) => MONO.test(f)) / all > 0.5) return false;
  const symbols = (l.text.match(/[=+<>≤≥→←↦⊢∀∃λΓΔ∈∉⊆∪∩∧∨¬|:{}\[\]_^]/g) ?? []).length;
  if ((letters((f) => MATH.test(f)) + symbols) / all > 0.3) return false;
  // A table's row is words too, but set apart in cells.
  const runs = [...l.runs].sort((x, y) => x.x - y.x);
  if (runs.some((r, i) => i > 0 && r.x - (runs[i - 1].x + runs[i - 1].width) > 1.5 * l.size)) return false;
  const tokens = l.text.split(/\s+/).filter(Boolean);
  const words = tokens.filter((t) => /^[(“"‘']?[A-Za-z][a-z’'-]+[.,;:)”"’']*$/.test(t)).length;
  return words >= 0.6 * tokens.length;
}
// A heading: a short bold line at the text's size or above, numbered, or
// larger than the text, or with prose starting under it. Floats end at it;
// a bold table head is none of these.
function isHeading(l: Line, bodySize: number, prose: Line[]): boolean {
  if (l.furniture || !l.bold || l.size < 0.95 * bodySize || !/[A-Za-z]{3}/.test(l.text) || l.text.length >= 80) return false;
  return /^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s/.test(l.text) || l.size >= 1.1 * bodySize
    || prose.some((p) => p.top > l.top && p.top - l.bottom <= 1.2 * l.size && Math.abs(p.x0 - l.x0) <= 2 * l.size);
}

// What is drawn that could belong to a float (float.graphics).
function graphicsOf(page: Page, prose: Line[]): (Rect & { image: boolean })[] {
  const furniture = page.lines.filter((l) => l.furniture);
  const area = page.width * page.height;
  return page.drawn.filter((d: Drawn) => {
    if (d.w * d.h > 0.5 * area) return false;
    if (d.w < 2 && d.h < 2) return false;
    const inMargin = d.y + d.h < page.height * 0.06 || d.y > page.height * 0.94;
    const rule = d.h < 2 && d.w > page.width * 0.6 && (d.y < page.height * 0.12 || d.y > page.height * 0.88);
    const behind = (lines: Line[]) => lines.some((l) => l.x0 >= d.x - 1 && l.x1 <= d.x + d.w + 1 && l.top >= d.y - 1 && l.bottom <= d.y + d.h + 1);
    // A tint or a box behind running text, or behind a running head, is
    // not a figure.
    return !inMargin && !rule && !(!d.image && behind(prose)) && !behind(furniture);
  }).map((d) => ({ x0: d.x, y0: d.y, x1: d.x + d.w, y1: d.y + d.h, image: d.image }));
}

// A caption's paragraph, by where its lines are (float.caption-paragraph):
// the lines under its first at its size, each overlapping the ones above
// it and no more than line spacing below them; and a second column of it
// set beside the first, level with it (Nature's wide captions).
function captionParagraph(first: Line, page: Page, captions: Set<Line>, bodySize: number): Line[] {
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.12 * b;
  const column = (start: Line): Line[] => {
    const lines = [start];
    let span = rectOf(start);
    for (;;) {
      const prev = lines[lines.length - 1];
      const next = page.lines.filter((l) => !l.furniture && !captions.has(l) && !lines.includes(l) && near(l.size, first.size)
        && l.top >= prev.top + 0.3 * prev.size && l.top - prev.bottom <= 0.6 * prev.size && across(rectOf(l), span));
      if (!next.length) return lines;
      const top = Math.min(...next.map((l) => l.top));
      const row = next.filter((l) => l.top - top < 0.3 * first.size);
      lines.push(...row);
      span = union([span, ...row.map(rectOf)]);
    }
  };
  const lines = column(first);
  const left = union(lines.map(rectOf));
  // A second column: level with the first line, just to its right, at its
  // size, and the size is a caption's rather than the text's.
  const beside = page.lines.find((l) => !l.furniture && !captions.has(l) && !lines.includes(l) && Math.abs(l.size - first.size) <= 0.05 * first.size
    && Math.abs(l.top - first.top) < 0.3 * first.size && l.x0 > left.x1 && l.x0 - left.x1 <= 3 * first.size);
  if (beside && lines.length > 1 && first.size < 0.95 * bodySize) lines.push(...column(beside));
  return lines;
}

// Everything on a page a float could be made of, and what stops it.
interface Ground {
  page: Page;
  bodySize: number;
  graphics: (Rect & { image: boolean })[];
  lines: Line[]; // text that may belong to a float: not prose, not a caption
  barriers: Line[]; // prose, headings, and every caption's paragraph
  mid: number | null; // the gutter, when the page is set in two columns
}

function groundOf(page: Page, bodySize: number, paragraphs: Line[][]): Ground {
  const inCaption = new Set(paragraphs.flat());
  const proseLines = page.lines.filter((l) => isProse(l, bodySize));
  const prose = new Set(proseLines);
  // The short last line of a paragraph is prose too: at the text's size,
  // directly under a line of prose.
  for (const l of page.lines) {
    if (prose.has(l) || l.furniture || inCaption.has(l) || Math.abs(l.size - bodySize) > 0.08 * bodySize) continue;
    if (proseLines.some((p) => l.top > p.top && l.top - p.bottom <= 0.6 * p.size && Math.abs(l.x0 - p.x0) <= 2)) prose.add(l);
  }
  const heads = page.lines.filter((l) => !inCaption.has(l) && isHeading(l, bodySize, proseLines));
  const mid = page.width / 2;
  const twoColumn = proseLines.some((l) => l.x1 < mid) && proseLines.some((l) => l.x0 > mid);
  return {
    page, bodySize,
    graphics: graphicsOf(page, [...prose]),
    lines: page.lines.filter((l) => !l.furniture && !prose.has(l) && !inCaption.has(l) && !heads.includes(l)),
    barriers: [...prose, ...heads, ...inCaption],
    mid: twoColumn ? mid : null,
  };
}

// For scripts/floats.ts: told what each float took in and what it would not.
let explain: ((message: string) => void) | null = null;
export function explainFloats(to: ((message: string) => void) | null): void { explain = to; }
const show = (r: Rect) => `[${Math.round(r.x0)},${Math.round(r.y0)} ${Math.round(r.x1)},${Math.round(r.y1)}]`;

const gapBetween = (a: Rect, b: Rect) => ({
  v: Math.max(0, a.y0 - b.y1, b.y0 - a.y1),
  h: Math.max(0, a.x0 - b.x1, b.x0 - a.x1),
  xs: Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0),
  ys: Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0),
});

// Grow a float from its caption, to one side (float.figure-extent,
// float.table-extent): whatever is drawn or set there, not prose, joins
// once it touches what has grown so far — over a gap of up to three lines
// for a drawing, one and a half for text — unless prose, a heading or
// another caption lies between. On a two-column page a caption set in one
// column keeps its float in that column (float.column).
function grow(caption: Rect, own: Line[], ground: Ground, side: "above" | "below" | "beside", claimed: Rect[], rules: boolean): { rect: Rect; graphics: number; lines: number } {
  const { bodySize, mid } = ground;
  const allowed = (r: Rect) => side === "beside" ? true : side === "above"
    ? r.y0 < caption.y0 - 1 || (r.y1 <= caption.y1 + 2 && r.y0 >= caption.y0 - 1)
    : r.y1 > caption.y1 + 1 || (r.y0 >= caption.y0 - 2 && r.y1 <= caption.y1 + 1);
  const column = mid === null ? null : caption.x1 <= mid + 5 ? "left" : caption.x0 >= mid - 5 ? "right" : null;
  const inColumn = (r: Rect) => column === null || (column === "left" ? r.x1 <= mid! + 5 : r.x0 >= mid! - 5);
  type Item = { rect: Rect; drawn: boolean };
  // A table is text and the rules between it; a picture next to one is
  // another float's.
  const drawn = rules ? ground.graphics.filter((g) => !g.image && (g.x1 - g.x0 < 3 || g.y1 - g.y0 < 3)) : ground.graphics;
  const items: Item[] = [
    ...drawn.map((g) => ({ rect: g as Rect, drawn: true })),
    ...ground.lines.filter((l) => !own.includes(l)).map((l) => ({ rect: rectOf(l), drawn: false })),
  ].filter((i) => allowed(i.rect) && inColumn(i.rect) && !claimed.some((c) => i.rect.x0 >= c.x0 - 1 && i.rect.x1 <= c.x1 + 1 && i.rect.y0 >= c.y0 - 1 && i.rect.y1 <= c.y1 + 1));
  const barriers = [...ground.barriers.filter((l) => !own.includes(l)).map(rectOf), ...claimed];
  const blocked = (a: Rect, b: Rect) => barriers.some((w) => {
    const g = gapBetween(a, b);
    if (g.xs > 0) {
      const lo = Math.min(a.y1, b.y1), hi = Math.max(a.y0, b.y0);
      return w.y0 >= lo - 1 && w.y1 <= hi + 1 && Math.min(w.x1, a.x1, b.x1) > Math.max(w.x0, a.x0, b.x0);
    }
    const lo = Math.min(a.x1, b.x1), hi = Math.max(a.x0, b.x0);
    return w.x0 >= lo - 1 && w.x1 <= hi + 1 && Math.min(w.y1, a.y1, b.y1) > Math.max(w.y0, a.y0, b.y0);
  });
  let rect = caption;
  let graphics = 0, lines = 0;
  const left = new Set(items);
  for (let changed = true; changed;) {
    changed = false;
    for (const item of left) {
      const g = gapBetween(item.rect, rect);
      const vLimit = (item.drawn ? 3 : 1.5) * bodySize;
      const hLimit = (item.drawn ? 2.5 : 1) * bodySize;
      const touches = (g.xs > 0 && g.v <= vLimit) || (g.ys > 0 && g.h <= hLimit) || (g.v <= 0.3 * bodySize && g.h <= 0.3 * bodySize);
      if (!touches) continue;
      if (blocked(item.rect, rect)) { explain?.(`  ${side} blocked ${item.drawn ? "drawn" : "text"} ${show(item.rect)}`); continue; }
      // Nothing the float takes in may cover a barrier: prose beside a
      // drawing stays outside it.
      const next = union([rect, item.rect]);
      const covered = barriers.find((w) => gapBetween(w, next).xs > 0.5 && gapBetween(w, next).ys > 0.5);
      if (covered) { explain?.(`  ${side} would cover ${show(covered)} with ${item.drawn ? "drawn" : "text"} ${show(item.rect)}`); continue; }
      explain?.(`  ${side} took ${item.drawn ? "drawn" : "text"} ${show(item.rect)}`);
      rect = next;
      left.delete(item);
      if (item.drawn) graphics += 1; else lines += 1;
      changed = true;
    }
  }
  return { rect, graphics, lines };
}

function frameAround(caption: Rect, ground: Ground): Rect | null {
  const size = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);
  const frames = ground.page.drawn.map((d) => ({ x0: d.x, y0: d.y, x1: d.x + d.w, y1: d.y + d.h, image: d.image }))
    .filter((g) => !g.image && size(g) < 0.8 * ground.page.width * ground.page.height && g.x0 <= caption.x0 + 1 && g.x1 >= caption.x1 - 1
      && g.y0 <= caption.y0 + 1 && g.y1 >= caption.y1 - 1 && size(g) >= 4 * size(caption));
  return frames.sort((a, b) => size(a) - size(b))[0] ?? null;
}

// How much of the page a float is: its caption, and what the caption is of.
function extentOf(kind: string, paragraph: Line[], ground: Ground, claimed: Rect[], trace: Trace): { rect: Rect; rule: string } {
  const caption = union(paragraph.map(rectOf));
  if (paragraph.length > 1) trace.add(FLOAT_CAPTION_PARAGRAPH.id, ground.page.number, paragraph[0].text.slice(0, 60), []);
  const frame = frameAround(caption, ground);
  if (frame) return { rect: union([frame, caption]), rule: FLOAT_FRAME.id };
  // A figure is over its caption, a table under it; the other side only
  // when there is nothing on the usual one.
  const sides: ("above" | "below")[] = kind === "figure" ? ["above", "below"] : ["below", "above"];
  const grown = sides.map((side) => grow(caption, paragraph, ground, side, claimed, kind !== "figure"));
  explain?.(`  caption ${show(caption)}: ${grown.map((g, i) => `${sides[i]} ${g.graphics} drawn ${g.lines} text ${show(g.rect)}`).join("; ")}`);
  const pick = grown.find((g) => g.graphics > 0) ?? grown.find((g) => g.lines >= 2);
  const rule = kind === "figure" ? FLOAT_FIGURE_EXTENT.id : FLOAT_TABLE_EXTENT.id;
  if (pick) return { rect: pick.rect, rule };
  // A caption set beside its figure, level with it, across a wider space
  // than one within a figure (float.side-caption).
  const level = ground.graphics.filter((g) => !g.image || kind === "figure")
    .filter((g) => Math.min(g.y1, caption.y1 + ground.bodySize) > Math.max(g.y0, caption.y0 - ground.bodySize)
      && Math.max(g.x0 - caption.x1, caption.x0 - g.x1) <= 6 * ground.bodySize
      && !claimed.some((c) => gapBetween(c, g).xs > 0 && gapBetween(c, g).ys > 0));
  if (kind === "figure" && level.length) {
    const seed = union([caption, ...level]);
    const side = grow(seed, paragraph, ground, "beside", claimed, false);
    const covered = ground.barriers.some((w) => !paragraph.includes(w) && gapBetween(rectOf(w), side.rect).xs > 0.5 && gapBetween(rectOf(w), side.rect).ys > 0.5);
    explain?.(`  beside ${level.length} level, ${side.graphics} drawn ${side.lines} text ${show(side.rect)}${covered ? ", covers prose" : ""}`);
    if (!covered) return { rect: side.rect, rule: FLOAT_SIDE_CAPTION.id };
  }
  return { rect: caption, rule: FLOAT_CAPTION_PARAGRAPH.id };
}

// A float, as a box: its caption and what the caption is of, which a link
// brings into view.
export function findFloats(layout: Layout, trace: Trace): Map<string, Found> {
  const floats = new Map<string, Found>();
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
    const paragraphs = found.map((f) => captionParagraph(f.line, page, firsts, layout.bodySize));
    const ground = groundOf(page, layout.bodySize, paragraphs);
    // Tables (and the other captioned-above kinds) are sized first, and a
    // figure grows around them, not through them (float.claimed).
    const order = found.map((_, i) => i).sort((a, b) => Number(found[a].kind === "figure") - Number(found[b].kind === "figure"));
    const extents: { rect: Rect; rule: string }[] = [];
    for (const i of order) {
      explain?.(`page ${page.number} ${found[i].kind} ${found[i].number}`);
      extents[i] = extentOf(found[i].kind, paragraphs[i], ground, extents.filter(Boolean).map((e) => e.rect), trace);
    }
    found.forEach(({ kind, number, line }, i) => {
      const { rect, rule: sized } = extents[i];
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
