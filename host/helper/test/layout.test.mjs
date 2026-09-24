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
  stdin: { contents: 'export { boxesOf } from "./layout"; export { offsetsOf } from "./pdf";', resolveDir: path.join(here, "../src/rules"), loader: "ts" },
  outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
const { boxesOf, offsetsOf } = await import(pathToFileURL(out).href);

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
