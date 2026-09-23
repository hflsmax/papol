// A PDF's text as positioned runs: what every rule reads.
//
// pdf.js (through unpdf, its build for servers) reports a page's text as
// runs, each a string drawn in one font at one place. A run is kept with
// its box in PDF points measured from the page's top-left, which is the
// space the viewer's fractions are taken of, and with what its font's name
// says about it: bold, italic. Nothing here decides what anything means.

import { getDocumentProxy } from "unpdf";

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

export interface Page {
  number: number; // 1-based
  width: number;
  height: number;
  runs: Run[];
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

export async function readPdf(bytes: Uint8Array): Promise<Doc> {
  // pdf.js takes ownership of the buffer it is given.
  const proxy = await getDocumentProxy(new Uint8Array(bytes));
  const pages: Page[] = [];
  try {
    for (let number = 1; number <= proxy.numPages; number += 1) {
      const page = await proxy.getPage(number);
      const [left, bottom, right, top] = page.view;
      const content = await page.getTextContent();
      // The operator list is what loads a page's fonts, and a font's own
      // name (NOEPIY+LinBiolinumTB) is the only place bold is written down.
      await page.getOperatorList();
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
      pages.push({ number, width: right - left, height: top - bottom, runs });
      page.cleanup();
    }
  } finally {
    await (proxy as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
  return { pages };
}
