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
  // Which characters are drawn as small capitals: a lowercase letter the
  // font draws as a capital (Libertine's u.sc, Computer Modern's cmcsc).
  // Absent where none is (layout.small-capitals).
  smallCaps?: boolean[];
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
// `differences` and `defaultEncoding` are the glyph names a simple font
// draws each code with; pdf.js hands them over only when the document is
// opened with fontExtraProperties.
type FontData = { name?: string; loadedName?: string; differences?: (string | undefined)[]; defaultEncoding?: (string | undefined)[]; fontMatrix?: number[] };

// What a ligature's glyph name spells: its parts joined by "_", each the
// name of a letter with any suffix after a period ("q.sc_u.sc", "f_f_i",
// "uni0071_uni0075"). Undefined for a name that is no ligature, or a part
// that names no single character.
export function ligatureSpelling(name: string | undefined): string | undefined {
  const parts = name?.split("_");
  if (!parts || parts.length < 2) return undefined;
  let spelled = "";
  for (const part of parts) {
    const letter = partSpelling(part);
    if (letter === undefined) return undefined;
    spelled += letter;
  }
  return spelled;
}

// What one part of a glyph name spells: a letter's name with any suffix
// after a period ("q.sc"), or a code point ("uni0071", "u1D45B").
function partSpelling(part: string): string | undefined {
  const base = part.split(".")[0];
  if (/^[A-Za-z]$/.test(base)) return base;
  if (/^(?:uni|u)[0-9A-F]{4,6}$/.test(base)) return String.fromCodePoint(parseInt(base.replace(/^uni|^u/, ""), 16));
  return undefined;
}

// The letters a glyph's name spells, ligature or single: "h.sc" is h,
// "uni0041" A, "f_i" and "fi" fi. Undefined for a name that spells none.
const STANDARD_LIGATURES: Record<string, string> = { ff: "ff", fi: "fi", fl: "fl", ffi: "ffi", ffl: "ffl" };
export function letterSpelling(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const spelled = ligatureSpelling(name) ?? STANDARD_LIGATURES[name] ?? partSpelling(name);
  return spelled && /^\p{L}+$/u.test(spelled) ? spelled : undefined;
}

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
// Beside the table, every glyph each font draws, in the order drawn: the
// same character is drawn by different glyphs of different widths (an "a"
// and the small capital a Libertine sets it in), and only the glyphs a
// run was drawn with place its characters.
// A glyph whose font names it a ligature carries what the name spells
// (layout.ligature): Libertine's small-capital "qu" is one glyph,
// q.sc_u.sc, that the font's ToUnicode maps to "q" alone.
// A glyph whose name marks it a small capital ("u.sc", "a.smcp", "Asmall")
// carries that too.
// pdf.js gives a glyph's width in its font's own units, which are
// thousandths of the size only for most fonts: a font drawn on a grid of
// 2048 to the size (fontMatrix 1/2048) gives a digit 1024, which beside
// the 250 a space pdf.js inserted is put at twice its width (a superscript
// "1 " before "Consider"). `scale` turns a font's units into thousandths.
export type Glyph = { unicode?: string; width?: number; originalCharCode?: number; spelled?: string; small?: boolean };
const SMALL_CAPITAL_GLYPH = /^[A-Za-z]\.(?:sc|smcp|c2sc)(?:$|[._])|^[A-Z]small$|(?:^|_)[a-z]\.sc(?:$|_)/;
// A font set wholly in small capitals: Computer Modern's cmcsc, and the
// fonts that say so in their name.
const SMALL_CAPITAL_FONT = { test: (name: string) => /cmcsc|csc\d|smallcaps|smcp/i.test(name) || /(?:^|[-+_])SC(?:$|[-_\d])|Caps(?:$|[-_])/.test(name) };
// `all` is every glyph of every font in the order drawn.
type Glyphs = { widths: Map<string, Map<string, number>>; glyphs: Map<string, Glyph[]>; all: Glyph[] };
function glyphsDrawn(ops: { fnArray: number[]; argsArray: unknown[] }, OPS: Record<string, number>, names: (id: string) => ((code: number) => string | undefined) | undefined = () => undefined, scale: (id: string) => number = () => 1): Glyphs {
  const widths = new Map<string, Map<string, number>>();
  const glyphs = new Map<string, Glyph[]>();
  const all: Glyph[] = [];
  let font: Map<string, number> | null = null;
  let drawn: Glyph[] | null = null;
  let named: ((code: number) => string | undefined) | undefined;
  let thousandths = 1;
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.setFont) {
      const id = String(args?.[0] ?? "");
      font = widths.get(id) ?? new Map();
      widths.set(id, font);
      drawn = glyphs.get(id) ?? [];
      glyphs.set(id, drawn);
      named = names(id);
      thousandths = scale(id);
    } else if (fn === OPS.showText && font && drawn && Array.isArray(args?.[0])) {
      for (const glyph of args[0] as (Glyph | number)[]) {
        if (typeof glyph !== "object" || !glyph?.unicode || !Number.isFinite(glyph.width)) continue;
        const name = named && glyph.originalCharCode !== undefined ? named(glyph.originalCharCode) : undefined;
        const ligature = ligatureSpelling(name);
        const letters = letterSpelling(name);
        // A font whose ToUnicode was written for another encoding reads the
        // code itself where the encoding names a letter: code 33, "h.sc",
        // read as "!", and "f_i" as "!" too. The name is believed then
        // (layout.glyph-name), and only then: a symbol font names its
        // glyphs after the letters they replace ("j" for "|").
        const echoed = glyph.originalCharCode !== undefined && glyph.unicode === String.fromCharCode(glyph.originalCharCode);
        const spelled = ligature && ligature !== glyph.unicode && ligature.startsWith(glyph.unicode) ? ligature
          : letters && echoed && /^[^\p{L}\p{N}\s]+$/u.test(glyph.unicode) ? letters : undefined;
        const small = Boolean(name && SMALL_CAPITAL_GLYPH.test(name));
        const kept = spelled || small || thousandths !== 1
          ? { ...glyph, width: glyph.width! * thousandths, ...(spelled ? { spelled } : {}), ...(small ? { small } : {}) }
          : glyph;
        drawn.push(kept);
        all.push(kept);
        if (!font.has(glyph.unicode)) font.set(glyph.unicode, kept.width!);
      }
    }
  });
  return { widths, glyphs, all };
}

// A run's character offsets from the glyphs it was drawn with, read from
// `from` in its font's glyphs: each character takes its own glyph's
// width (a ligature's characters share theirs), a space pdf.js inserted
// for a gap a quarter of the size, the whole stretched to the width
// pdf.js measured. Undefined where the glyphs there do not spell the run.
// `text` is the run as its glyphs spell it: where a ligature's name spells
// more than the text layer says (q.sc_u.sc read as "q"), the letters
// left out are put back (layout.ligature).
export function offsetsAlong(text: string, width: number, glyphs: Glyph[], from: number, scale?: number): { offsets: number[]; next: number; text: string; small: boolean[] } | undefined {
  if ([...text].length !== text.length) return undefined;
  const widths: number[] = [];
  const small: boolean[] = [];
  let i = 0, j = from, spelled = "", gap = false;
  while (i < text.length) {
    const glyph = glyphs[j], unicode = glyph?.unicode ?? "";
    if (unicode && text.startsWith(unicode, i)) {
      const letters = glyph!.spelled && !text.startsWith(glyph!.spelled, i) ? glyph!.spelled : unicode;
      if ([...letters].length !== letters.length) return undefined;
      for (let k = 0; k < letters.length; k += 1) { widths.push(glyph!.width! / letters.length); small.push(Boolean(glyph!.small)); }
      spelled += letters;
      i += unicode.length; j += 1;
    } else if (text[i] === " " && /^\s$/.test(unicode)) { widths.push(glyph!.width!); small.push(false); spelled += " "; i += 1; j += 1; }
    else if (text[i] === " ") { widths.push(250); small.push(false); spelled += " "; i += 1; gap = i === text.length; }
    else return undefined;
  }
  const sum = widths.reduce((s, w) => s + w, 0);
  if (!(sum > 0)) return undefined;
  const offsets = [0];
  let at = 0;
  // Where the glyphs at the size drawn (`scale`, the font size across) (layout.blanks)
  // come near the width measured, the glyphs keep their widths and the
  // blanks take up the rest, as a justified line or a gap between two
  // pieces of text puts it there: stretching every glyph instead puts a
  // word after a narrow gap (": // RD-Lock") a point off.
  const blanks = [...spelled].filter((c) => c === " ").length;
  const natural = scale ? (sum * scale) / 1000 : 0;
  // One word and the blank pdf.js put after it for the gap to the next
  // piece of text: the gap is as wide as the word leaves, so the glyphs
  // keep their widths and the blank takes the rest. Stretching the word
  // instead set a superscript "1" before "Consider" half again its width.
  const word = natural - (widths[widths.length - 1] * (scale ?? 0)) / 1000;
  if (gap && blanks === 1 && word > 0 && word <= width) {
    for (let k = 0; k < widths.length - 1; k += 1) { at += (widths[k] * scale!) / 1000; offsets.push(at); }
    offsets.push(width);
    return { offsets, next: j, text: spelled, small };
  }
  if (blanks && natural > 0 && Math.abs(width - natural) <= 0.15 * width) {
    const extra = (width - natural) / blanks;
    for (let k = 0; k < widths.length; k += 1) { at += (widths[k] * scale!) / 1000 + (spelled[k] === " " ? extra : 0); offsets.push(at); }
    // A blank squeezed to less than half its width says the glyphs are
    // not all at that size (capitals faked small: "S EMPTY" with MPTY set
    // smaller), and then the whole is stretched as before.
    const narrowest = Math.min(...widths.filter((w, k) => spelled[k] === " ").map((w) => (w * scale!) / 1000 + extra - (w * scale!) / 2000));
    if (narrowest >= 0) return { offsets, next: j, text: spelled, small };
    offsets.length = 1; at = 0;
  }
  for (const w of widths) { at += w; offsets.push((at / sum) * width); }
  return { offsets, next: j, text: spelled, small };
}

// How far ahead in a font's glyphs a run is looked for when the glyphs
// at the cursor do not spell it (text pdf.js dropped or reordered).
const LOOK_AHEAD = 400;

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
  const fontData = (id: string): FontData | undefined => {
    try { return page.commonObjs.get(id) as FontData; } catch { return undefined; }
  };
  // Each code's glyph name, where the font says: its encoding's
  // differences, else the encoding it was built with.
  const glyphNames = (id: string) => {
    const font = fontData(id);
    if (!font?.differences && !font?.defaultEncoding) return undefined;
    return (code: number) => font.differences?.[code] || font.defaultEncoding?.[code] || undefined;
  };
  const thousandths = (id: string) => { const m = fontData(id)?.fontMatrix?.[0]; return m && m > 0 ? m * 1000 : 1; };
  const { widths, glyphs, all } = glyphsDrawn(operators, OPS, glyphNames, thousandths);
  const cursors = new Map<string, number>();
  let cursor = 0; // in `all`: just past the last run found there
  const along = (text: string, width: number, drawn: Glyph[], at: number, to: number, scale: number) => {
    for (let from = at; from < Math.min(drawn.length, to); from += 1) {
      const found = offsetsAlong(text, width, drawn, from, scale);
      if (found) return found;
    }
    return undefined;
  };
  // The run's offsets from the glyphs it was drawn with, taken in order
  // from its font's glyphs. pdf.js names one font for a run drawn in more
  // ("(uniqe)": the brackets in the text's face, the name in small
  // capitals; "uniqe property", the name in small capitals and the rest
  // not), and those are found among every font's glyphs in the order drawn,
  // on from the last run found there and else from the page's first. Only
  // where no glyphs spell the run are its font's widths taken: another
  // font's widths put a small-capital name a letter off where it is printed
  // (layout.fonts).
  // The run as its glyphs spell it comes back with them.
  const offsetsFor = (id: string, text: string, width: number, scale: number): { offsets?: number[]; text: string; small?: boolean[] } => {
    const drawn = glyphs.get(id);
    if (drawn?.length) {
      const at = cursors.get(id) ?? 0;
      const found = along(text, width, drawn, at, at + LOOK_AHEAD, scale);
      if (found) { cursors.set(id, found.next); return found; }
    }
    const found = along(text, width, all, cursor, all.length, scale) ?? along(text, width, all, 0, cursor, scale);
    if (found) { cursor = found.next; return found; }
    return { offsets: offsetsOf(text, width, widths.get(id)), text };
  };
  const fonts = new Map<string, string>();
  const fontName = (id: string) => {
    if (!fonts.has(id)) {
      let name = "";
      name = fontData(id)?.name ?? "";
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
    const spelled = offsetsFor(raw.fontName, raw.str, raw.width, a);
    const smallCaps = SMALL_CAPITAL_FONT.test(font) ? Array.from(spelled.text, () => true) : spelled.small;
    runs.push({
      text: spelled.text,
      x: e - left,
      baseline: top - f,
      width: raw.width,
      offsets: spelled.offsets,
      ...(smallCaps?.some(Boolean) ? { smallCaps } : {}),
      size,
      font,
      bold: BOLD.test(font),
      italic: ITALIC.test(font),
    });
  }
  const text = (content.items as TextItem[]).map((item) => ("str" in item ? item.str : "")).join(" ");
  return { number, width: right - left, height: top - bottom, runs, drawn, text };
}

export interface PdfDocument { numPages: number; getPage(number: number): Promise<unknown>; getMetadata?(): Promise<{ info?: unknown }> }
export interface ReadOptions {
  // Only this many pages from the front: a title block is on the first.
  pages?: number;
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
  { pages: limit, cancelled = () => false, pause = async () => {}, onPage }: ReadOptions = {},
): Promise<Page[] | null> {
  const pages: Page[] = [];
  const last = Math.min(doc.numPages, limit ?? Infinity);
  for (let number = 1; number <= last; number += 1) {
    await pause();
    if (cancelled()) return null;
    const page = (await doc.getPage(number)) as PdfPage & { cleanup?: () => void };
    pages.push(boundDrawn(await readPage(page, number, OPS)));
    page.cleanup?.();
    onPage?.(number, last);
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

/** The PDF's own Info dictionary, where its maker filled it in. */
export async function infoOf(doc: PdfDocument): Promise<Doc["info"]> {
  try {
    const meta = (await doc.getMetadata?.())?.info as { Title?: unknown; Author?: unknown } | undefined;
    return { title: typeof meta?.Title === "string" ? meta.Title.trim() : "", author: typeof meta?.Author === "string" ? meta.Author.trim() : "" };
  } catch {
    // A PDF with no readable Info dictionary has none.
    return { title: "", author: "" };
  }
}

/** A document read as the rules read it: its pages and its Info. */
export async function readDoc(doc: PdfDocument, OPS: Record<string, number>, options: ReadOptions = {}): Promise<Doc | null> {
  const pages = await readPages(doc, OPS, options);
  return pages && { pages, info: await infoOf(doc) };
}
