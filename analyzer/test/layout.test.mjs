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
  stdin: { contents: 'export { boxesOf } from "./layout"; export { offsetsOf, offsetsAlong, ligatureSpelling } from "./page";', resolveDir: path.join(here, "../src/rules"), loader: "ts" },
  outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
const { boxesOf, offsetsOf, offsetsAlong, ligatureSpelling } = await import(pathToFileURL(out).href);

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
