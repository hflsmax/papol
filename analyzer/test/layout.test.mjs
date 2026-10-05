// Where a stretch of text was printed: the boxes a link or a citation is
// drawn in, placed by the font's own widths rather than by spacing a run's
// characters evenly.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(os.tmpdir(), `papol-rules-layout-${process.pid}.mjs`);
await esbuild.build({
  stdin: { contents: 'export { boxesOf, layout } from "./layout"; export { offsetsOf, offsetsAlong, ligatureSpelling } from "./page";', resolveDir: path.join(here, "../src/rules"), loader: "ts" },
  outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
const { boxesOf, layout, offsetsOf, offsetsAlong, ligatureSpelling } = await import(pathToFileURL(out).href);

// Times Roman's widths, as the page draws them, for what the line below uses.
const times = new Map(Object.entries({
  " ": 250, ".": 250, "3": 500, F: 556, a: 444, c: 444, d: 500, e: 444, g: 500, h: 500,
  i: 278, l: 278, m: 778, n: 500, o: 500, r: 333, s: 389, t: 278, u: 500, w: 722, y: 500,
}));

// One line as a flow: its text, each character pointing at the run it is in.
function flowOf(run) {
  const line = { page: 1, runs: [run], chars: Array.from(run.text, (_, at) => ({ run: 0, at })) };
  return { text: run.text, at: Array.from(run.text, (_, char) => ({ line, char })) };
}

test("a character's place is its font's widths stretched to the run", () => {
  const offsets = offsetsOf("ii", 10, new Map([["i", 278]]));
  assert.deepEqual(offsets, [0, 5, 10]);
  const narrowFirst = offsetsOf("im", 111.1, new Map([["i", 278], ["m", 833]]));
  assert.equal(narrowFirst.length, 3);
  assert.ok(Math.abs(narrowFirst[1] - 27.8) < 0.01);
  assert.equal(narrowFirst[2], 111.1);
});

test("a run's characters take the widths of the glyphs it was drawn with (Virtualizing Continuations, page 11)", () => {
  // "are raise," in Libertine: "raise" set in small capitals, wider than
  // the lowercase glyphs the font's table has for the same letters.
  const glyph = (unicode, width) => ({ unicode, width });
  const drawn = [glyph("x", 500), glyph("a", 444), glyph("r", 333), glyph("e", 444), glyph(" ", 250),
    glyph("r", 400), glyph("a", 520), glyph("i", 330), glyph("s", 450), glyph("e", 500), glyph(",", 250)];
  const along = offsetsAlong("are raise,", 3.921, drawn, 1);
  assert.equal(along.next, drawn.length);
  assert.equal(along.offsets.length, "are raise,".length + 1);
  assert.ok(Math.abs(along.offsets[4] - 1.471) < 0.01, "raise starts after the small capitals' neighbours");
  assert.ok(Math.abs(along.offsets[9] - 3.671) < 0.01, "and ends by their own widths");
  // A space pdf.js inserted for a gap has no glyph; a ligature's characters share one.
  const ligature = offsetsAlong("a fi", 1.5, [glyph("a", 500), glyph("fi", 600)], 0);
  assert.deepEqual(ligature.offsets.map((o) => Math.round(o * 1000) / 1000), [0, 0.556, 0.833, 1.167, 1.5]);
  // Glyphs that do not spell the run place nothing.
  assert.equal(offsetsAlong("raise", 10, drawn, 0), undefined);
});

test("a ligature's glyph spells the letters its name joins (Verified Lock-Free Session Channels, page 23)", () => {
  // Libertine's small-capital "qu" is one glyph, q.sc_u.sc, that the text
  // layer reads as "q": UNIQUE came out "uniqe".
  assert.equal(ligatureSpelling("q.sc_u.sc"), "qu");
  assert.equal(ligatureSpelling("f_f_i"), "ffi");
  assert.equal(ligatureSpelling("uni0071_uni0075"), "qu");
  assert.equal(ligatureSpelling("q.sc"), undefined);
  assert.equal(ligatureSpelling("fi"), undefined);
  assert.equal(ligatureSpelling("a_germandbls"), undefined);
  const glyph = (unicode, width, spelled) => ({ unicode, width, ...(spelled ? { spelled } : {}) });
  const drawn = [glyph("u", 576), glyph("n", 602), glyph("i", 311), glyph("q", 1101, "qu"), glyph("e", 477)];
  const along = offsetsAlong("uniqe", 30.67, drawn, 0);
  assert.equal(along.text, "unique");
  assert.equal(along.offsets.length, "unique".length + 1);
  assert.ok(Math.abs(along.offsets[4] - along.offsets[3] - (along.offsets[5] - along.offsets[4])) < 1e-9, "the glyph's width is shared by its letters");
  assert.equal(along.offsets[6], 30.67);
  // Where the text layer already spells the ligature, it is kept as it is.
  assert.equal(offsetsAlong("unique", 30.67, [...drawn.slice(0, 4), glyph("u", 1), glyph("e", 477)], 0).text, "unique");
});

test("glyphs keep their widths at the size drawn and the blanks take the slack (Concurrent Incorrectness Separation Logic, page 15)", () => {
  // "; // RD-Lock" measured 44.6pt at 8.9664pt: stretching every glyph
  // put the R a point right of where it is printed, at 108.1 for 107.0.
  const glyph = (unicode, width) => ({ unicode, width });
  // Libertine's widths; the blanks are gaps pdf.js put a space for.
  const drawn = [";", "/", "/", "R", "D", "-", "L", "o", "c", "k"].map((c) => glyph(c, { ";": 234, "/": 323, R: 591, D: 691, "-": 346, L: 524, o: 569, c: 491, k: 546 }[c]));
  const along = offsetsAlong("; // RD-Lock", 44.6, drawn, 0, 8.9664);
  assert.ok(Math.abs(96.1 + along.offsets[5] - 106.96) < 0.3, `R at ${96.1 + along.offsets[5]}`);
  assert.equal(along.offsets[12], 44.6);
  // Without the size, or with a blank squeezed under half its width (the
  // glyphs not all at one size), the whole is stretched evenly.
  assert.ok(offsetsAlong("; // RD-Lock", 44.6, drawn, 0).offsets[5] > along.offsets[5] + 0.8, "stretched evenly, the R is a point right");
  assert.deepEqual(offsetsAlong("S EMPTY", 20, [glyph("S", 556), glyph("E", 611), glyph("M", 889), glyph("P", 556), glyph("T", 611), glyph("Y", 722)], 0, 10).offsets.map((o) => Math.round(o * 100) / 100),
    offsetsAlong("S EMPTY", 20, [glyph("S", 556), glyph("E", 611), glyph("M", 889), glyph("P", 556), glyph("T", 611), glyph("Y", 722)], 0).offsets.map((o) => Math.round(o * 100) / 100));
});

test("a glyph named a small capital marks its letter (Iris-WasmFX, page 10)", () => {
  const drawn = [{ unicode: "W", width: 889 }, { unicode: "h", width: 540, small: true }, { unicode: "i", width: 270, small: true }];
  assert.deepEqual(offsetsAlong("Whi", 10, drawn, 0).small, [false, true, true]);
});

test("a font whose glyphs were not read leaves the run evenly spaced", () => {
  assert.equal(offsetsOf("Figure 3", 40, undefined), undefined);
  assert.equal(offsetsOf("Figure 3", 40, new Map()), undefined);
});

test("a figure mention late in a line is boxed where it is printed (2b73920556, page 4)", () => {
  // "shearing and rigid cells. Figure 3 already…" at 10pt: evenly spaced,
  // the narrow letters before "Figure" put its box eight points right of
  // the word, and the viewer's highlight sat half off it.
  const text = "shearing and rigid cells. Figure 3 already demonstrated how";
  const width = [...text].reduce((w, c) => w + times.get(c), 0) / 100;
  const run = { text, x: 318, baseline: 657.5, width, size: 10, font: "LinLibertineT", bold: false, italic: false };
  const start = text.indexOf("Figure");
  const printedAt = 318 + [...text.slice(0, start)].reduce((w, c) => w + times.get(c), 0) / 100;
  const page = () => [612, 792];

  const end = start + "Figure 3".length;
  const printedTo = printedAt + [..."Figure 3"].reduce((w, c) => w + times.get(c), 0) / 100;
  const [even] = boxesOf(flowOf(run), start, end, page);
  assert.ok(Math.abs(even.x * 612 - printedAt) > 4, "evenly spaced, the box is well off the word");

  const [placed] = boxesOf(flowOf({ ...run, offsets: offsetsOf(text, width, times) }), start, end, page);
  assert.ok(Math.abs(placed.x * 612 - printedAt) < 0.01);
  assert.ok(Math.abs((placed.x + placed.w) * 612 - printedTo) < 0.01);
});

test("an equation's number at a column's right edge is no list label of the column beside it", () => {
  // Nature Physics' two columns, 12 points apart: "(7)" closes the left
  // column's formula, flush with that column's edge, on the baseline of a
  // line of the right column. Taken for a list's label, it joined that line
  // across the gutter, the page read as one column, and a heading lower in
  // the left column ("The physical nature of information") had the right
  // column's line beside it, so was no heading.
  const run = (text, x, baseline, width, bold = false) => ({ text, x, baseline, width, size: 9.3, font: bold ? "MinionPro-Bold" : "MinionPro-Regular", bold, italic: false });
  const runs = [];
  for (let i = 0; i < 40; i += 1) {
    const baseline = 80 + 10.4 * i;
    if (i === 10) runs.push(run("(7)", 277.2, baseline, 10.8));
    else if (i === 25) runs.push(run("The physical nature of information", 40, baseline, 145, true));
    else runs.push(run("the left column's text, set justified to its edge", 40, baseline, 248));
    runs.push(run("the right column's text, set justified to its edge", 300, baseline + 0.1, 248));
  }
  const page = { number: 1, width: 595, height: 782, runs, drawn: [], text: "" };
  const laid = layout({ pages: [page], info: { title: "", author: "" } });
  const lines = laid.pages[0].lines;
  assert.ok(lines.some((l) => l.text.trim() === "(7)"), "the number stays a line of its own");
  const heading = lines.find((l) => l.text.startsWith("The physical"));
  const right = lines.find((l) => l.text.startsWith("the right") && Math.abs(l.baseline - heading.baseline) < 1);
  assert.notEqual(heading.column, right.column, "the two columns are read apart");
});
