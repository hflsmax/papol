// A PDF's text as positioned runs: what every rule reads.
//
// pdf.js (through unpdf, its build for servers) reports a page's text as
// runs, each a string drawn in one font at one place. A run is kept with
// its box in PDF points measured from the page's top-left, which is the
// space the viewer's fractions are taken of, and with what its font's name
// says about it: bold, italic. Nothing here decides what anything means.

import { least, most } from "./numbers";
import { getDocumentProxy, getResolvedPDFJS } from "unpdf";

export interface Run {
  text: string;
  x: number; // left edge
  baseline: number; // from the top of the page, growing down
  width: number;
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
}

export interface Doc {
  pages: Page[];
}

// Bold, as fonts name it: "Bold", "Semibold", "Medi" (Nimbus), "cmbx"
// (Computer Modern), and the Libertine and Biolinum convention of a
// trailing B ("LinBiolinumTB", "LinLibertineTB") or Bd.
const BOLD_WORD = /bold|black|heavy|semibold|demi|medi(?!um)|\.b\b|-b$|cmbx|bx\d/i;
const BOLD_SUFFIX = /[a-z]T?B$|Bd$|-Bd/;
const BOLD = { test: (name: string) => BOLD_WORD.test(name) || BOLD_SUFFIX.test(name) };
const ITALIC = /italic|oblique|cmti|cmmi|-it\b|\.i\b|-i$/i;

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

export async function readPdf(bytes: Uint8Array): Promise<Doc> {
  const { OPS } = await getResolvedPDFJS();
  // pdf.js takes ownership of the buffer it is given.
  const proxy = await getDocumentProxy(new Uint8Array(bytes));
  const pages: Page[] = [];
  try {
    for (let number = 1; number <= proxy.numPages; number += 1) {
      const page = await proxy.getPage(number);
      const [left, bottom, right, top] = page.view;
      const content = await page.getTextContent();
      // The operator list is what loads a page's fonts — a font's own name
      // (NOEPIY+LinBiolinumTB) is the only place bold is written down — and
      // it is also what the page draws.
      const operators = await page.getOperatorList();
      const drawn = drawnOn(operators, OPS as unknown as Record<string, number>, page.view);
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
          size,
          font,
          bold: BOLD.test(font),
          italic: ITALIC.test(font),
        });
      }
      pages.push({ number, width: right - left, height: top - bottom, runs, drawn });
      page.cleanup();
    }
  } finally {
    await (proxy as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
  return { pages };
}
