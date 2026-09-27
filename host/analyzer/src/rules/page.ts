// A PDF page's text as positioned runs: what every rule reads.
//
// pdf.js (through unpdf, its build for servers) reports a page's text as
// runs, each a string drawn in one font at one place. A run is kept with
// its box in PDF points measured from the page's top-left, which is the
// space the viewer's fractions are taken of, and with what its font's name
// says about it: bold, italic. Nothing here decides what anything means.

import { least, most } from "./numbers";

export interface Run {
  text: string;
  x: number; // left edge
  baseline: number; // from the top of the page, growing down
  width: number;
  // Where each character begins, measured from `x`, and where the last one
  // ends: one more entry than `text` has characters. Absent when the font's
  // glyphs could not be read, and then each character is taken to be as
  // wide as any other.
  offsets?: number[];
  size: number; // the font's height on the page
  font: string;
  bold: boolean;
  italic: boolean;
}

// Something drawn: a path painted or an image, as the box it covers, in
// the same points from the page's top-left as a run.
export interface Drawn {
  x: number;
  y: number;
  w: number;
  h: number;
  image: boolean;
}

export interface Page {
  number: number; // 1-based
  width: number;
  height: number;
  runs: Run[];
  drawn: Drawn[];
  // Every item's text, rotated ones too, joined as the browser joins them
  // to look for an identifier (shared/identifiers.js): arXiv prints its
  // number up the margin.
  text: string;
}

export interface Doc {
  pages: Page[];
  // The PDF's own Info dictionary, where its maker filled it in.
  info: { title: string; author: string };
}

// Bold, as fonts name it: "Bold", "Semibold", "Medi" (Nimbus), "cmbx"
// (Computer Modern), and the Libertine and Biolinum convention of a
// trailing B ("LinBiolinumTB", "LinLibertineTB"), with the OpenType
// build's O before it ("LinBiolinumOB") and an italic's I or O after it
// ("LinLibertineTBI", "LinBiolinumTBO"), or Bd.
const BOLD_WORD = /bold|black|heavy|semibold|demi|medi(?!um)|\.b\b|-b$|cmbx|bx\d/i;
const BOLD_SUFFIX = /[a-z][TO]?B[IO]?$|Bd$|-Bd/;
const BOLD = { test: (name: string) => BOLD_WORD.test(name) || BOLD_SUFFIX.test(name) };
// Italic, likewise: the words, Computer Modern's cmti, and Libertine's and
// Biolinum's trailing I, after the build's letters and before an optical
// size ("LinLibertineTI", "LinLibertineOI", "LinLibertineZI7", "LinBiolinumTI").
const ITALIC_WORD = /italic|oblique|cmti|cmmi|-it\b|\.i\b|-i$/i;
const ITALIC = { test: (name: string) => ITALIC_WORD.test(name) || /Lin(?:Libertine|Biolinum)[A-Z]*I\d?$/.test(name) };

type TextItem = { str: string; transform: number[]; width: number; height: number; fontName: string };
type FontData = { name?: string; loadedName?: string };

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// What a page paints that is not text, walked through its operator list:
// every path that is filled or stroked (a clip is declared, not painted)
// and every image, each as the box it covers once the transforms in force
// are applied. How much of it is a figure is decided by the rules
// (floats.ts), not here.
function drawnOn(ops: { fnArray: number[]; argsArray: unknown[] }, OPS: Record<string, number>, view: number[]): Drawn[] {
  const [left, , , top] = view;
  const painted = new Set([OPS.fill, OPS.eoFill, OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const images = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintSolidColorImageMask]);
  const out: Drawn[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const add = (x0: number, y0: number, x1: number, y1: number, image: boolean) => {
    const corners = [apply(ctm, x0, y0), apply(ctm, x1, y0), apply(ctm, x0, y1), apply(ctm, x1, y1)];
    const xs = corners.map((c) => c[0] - left), ys = corners.map((c) => top - c[1]);
    const box = { x: least(xs), y: least(ys), w: most(xs) - least(xs), h: most(ys) - least(ys), image };
    if ([box.x, box.y, box.w, box.h].every(Number.isFinite)) out.push(box);
  };
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args as unknown as Matrix);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = args?.[0] as Matrix | null;
      if (matrix && matrix.length === 6) ctm = multiply(ctm, Array.from(matrix) as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.constructPath) {
      const op = args?.[0] as number;
      const minMax = args?.[2] as Record<number, number> | null;
      if (painted.has(op) && minMax && Number.isFinite(minMax[0])) add(minMax[0], minMax[1], minMax[2], minMax[3], false);
    } else if (images.has(fn)) add(0, 0, 1, 1, true);
  });
  return out;
}

// How wide each character is in each font, in thousandths of the font
// size, read from the glyphs the page draws. pdf.js reports a run of text
// with its width but not where inside it any character falls, and spacing
// its characters evenly misplaces a word late in a line by as much as a
// word: in "shearing and rigid cells. Figure 3" the narrow letters before
// "Figure" put it eight points to the right of where it is printed. The
// fonts' own widths put it within a fraction of a point.
type Glyph = { unicode?: string; width?: number };
function glyphWidths(ops: { fnArray: number[]; argsArray: unknown[] }, OPS: Record<string, number>): Map<string, Map<string, number>> {
  const fonts = new Map<string, Map<string, number>>();
  let font: Map<string, number> | null = null;
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.setFont) {
      const id = String(args?.[0] ?? "");
      font = fonts.get(id) ?? new Map();
      fonts.set(id, font);
    } else if (fn === OPS.showText && font && Array.isArray(args?.[0])) {
      for (const glyph of args[0] as (Glyph | number)[]) {
        if (typeof glyph !== "object" || !glyph?.unicode || !Number.isFinite(glyph.width) || font.has(glyph.unicode)) continue;
        font.set(glyph.unicode, glyph.width!);
      }
    }
  });
  return fonts;
}

// A run's character offsets, from its font's widths stretched to the width
// pdf.js measured, which carries what the widths do not: kerning, and the
// spacing a justified line adds. A character the page never drew alone (half
// of a ligature) is taken at the font's average; a space pdf.js inserted for
// a gap, at a quarter of the size, which is what most fonts make it.
export function offsetsOf(text: string, width: number, font: Map<string, number> | undefined): number[] | undefined {
  // Characters outside the basic plane take two places in `text`: keep those
  // runs even rather than misnumber them.
  if (!font?.size || [...text].length !== text.length) return undefined;
  let total = 0;
  for (const w of font.values()) total += w;
  const average = total / font.size;
  const widths = Array.from(text, (c) => font.get(c) ?? (c === " " ? 250 : average));
  const sum = widths.reduce((s, w) => s + w, 0);
  if (!(sum > 0)) return undefined;
  const offsets = [0];
  let at = 0;
  for (const w of widths) { at += w; offsets.push((at / sum) * width); }
  return offsets;
}

// One page of a pdf.js document as runs and drawings. Takes pdf.js's page
// and its OPS table from whichever build the caller runs, so the viewer can
// read the page it has already opened (see contents.ts) and the host its own.
export interface PdfPage {
  view: number[];
  commonObjs: { get(id: string): unknown };
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
}

export async function readPage(page: PdfPage, number: number, OPS: Record<string, number>): Promise<Page> {
  const [left, bottom, right, top] = page.view;
  const content = await page.getTextContent();
  // The operator list is what loads a page's fonts — a font's own name
  // (NOEPIY+LinBiolinumTB) is the only place bold is written down — and
  // it is also what the page draws.
  const operators = await page.getOperatorList();
  const drawn = drawnOn(operators, OPS, page.view);
  const widths = glyphWidths(operators, OPS);
  const fonts = new Map<string, string>();
  const fontName = (id: string) => {
    if (!fonts.has(id)) {
      let name = "";
      try { name = (page.commonObjs.get(id) as FontData)?.name ?? ""; } catch { name = ""; }
      fonts.set(id, name.replace(/^[A-Z]{6}\+/, ""));
    }
    return fonts.get(id)!;
  };
  const runs: Run[] = [];
  for (const raw of content.items as TextItem[]) {
    if (!("str" in raw) || !raw.str || !raw.str.trim()) continue;
    const [a, b, c, d, e, f] = raw.transform;
    // Rotated text (a margin note set sideways, an axis label) is not
    // part of anything read here.
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0 || d <= 0) continue;
    const size = Math.hypot(c, d) || raw.height;
    const font = fontName(raw.fontName);
    runs.push({
      text: raw.str,
      x: e - left,
      baseline: top - f,
      width: raw.width,
      offsets: offsetsOf(raw.str, raw.width, widths.get(raw.fontName)),
      size,
      font,
      bold: BOLD.test(font),
      italic: ITALIC.test(font),
    });
  }
  const text = (content.items as TextItem[]).map((item) => ("str" in item ? item.str : "")).join(" ");
  return { number, width: right - left, height: top - bottom, runs, drawn, text };
}

export interface PdfDocument { numPages: number; getPage(number: number): Promise<unknown> }
export interface ReadOptions {
  cancelled?: () => boolean;
  pause?: () => Promise<void>;
  onPage?: (read: number, of: number) => void;
}

/**
 * Every page of an open pdf.js document, read from the document the caller
 * already has — the viewer's own — with pdf.js's OPS table from the same
 * build. `pause` is awaited before each page, so a reader can give way to
 * whatever else the page is doing, and `onPage` told after each; each page
 * is let go once read (pdf.js keeps nothing of it that a render still
 * needs). Resolves to null when cancelled between pages.
 */
export async function readPages(
  doc: PdfDocument,
  OPS: Record<string, number>,
  { cancelled = () => false, pause = async () => {}, onPage }: ReadOptions = {},
): Promise<Page[] | null> {
  const pages: Page[] = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    await pause();
    if (cancelled()) return null;
    const page = (await doc.getPage(number)) as PdfPage & { cleanup?: () => void };
    pages.push(boundDrawn(await readPage(page, number, OPS)));
    page.cleanup?.();
    onPage?.(number, doc.numPages);
  }
  return cancelled() ? null : pages;
}

// A page drawn in hundreds of thousands of strokes (a plot exported point by
// point) is one picture to the float rules, which walk every stroke against
// every other and took a minute and a half over one such paper. Its strokes
// are taken as the one box they cover. (It also keeps what a reader posts
// to a worker small.)
const MOST_DRAWN = 5000;
function boundDrawn(page: Page): Page {
  if (page.drawn.length <= MOST_DRAWN) return page;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of page.drawn) {
    x0 = Math.min(x0, d.x); y0 = Math.min(y0, d.y); x1 = Math.max(x1, d.x + d.w); y1 = Math.max(y1, d.y + d.h);
  }
  return { ...page, drawn: [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0, image: false }] };
}
