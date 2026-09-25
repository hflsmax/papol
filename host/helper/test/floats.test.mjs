// The float rules' geometry, on built drawings rather than papers, and
// the mentions that link to them.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(os.tmpdir(), `papol-rules-floats-${process.pid}.mjs`);
await esbuild.build({
  stdin: { contents: 'export { findMentions, piecesOf } from "./floats"; export { Trace } from "./trace";', resolveDir: path.join(here, "../src/rules"), loader: "ts" },
  outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
const { findMentions, piecesOf, Trace } = await import(pathToFileURL(out).href);

test("touching strokes are one piece, however long the chain (float.piece)", () => {
  // Each stroke touches only the next: joined in that order, the chain of
  // parents is as long as the drawing — 100,000 deep overflowed the stack
  // when finding a root recursed (dbfb7aabec in the corpus).
  const strokes = Array.from({ length: 100000 }, (_, i) => ({ x0: i * 0.6, y0: 10, x1: i * 0.6 + 0.6, y1: 12, image: false }));
  const pieces = piecesOf(strokes, []);
  assert.equal(pieces.length, 1);
  assert.deepEqual([pieces[0].x0, pieces[0].x1], [0, 99999 * 0.6 + 0.6]);
});

test("strokes further apart than touching are pieces of their own, and one crossing a bound joins nothing", () => {
  const a = { x0: 0, y0: 0, x1: 10, y1: 10, image: false };
  const b = { x0: 20, y0: 0, x1: 30, y1: 10, image: false };
  const crossing = { x0: 9, y0: 0, x1: 21, y1: 1, image: false };
  const bound = { x0: 15, y0: 0, x1: 16, y1: 5 };
  assert.equal(piecesOf([a, b], []).length, 2);
  assert.equal(piecesOf([a, b, crossing], []).length, 1);
  assert.equal(piecesOf([a, b, crossing], [bound]).length, 3);
});

test("each figure in \"Fig. 1, Fig. 4\" is its own link, to its own figure (mention.float, 7c348adb9d page 8)", () => {
  // GROBID missed Fig. 1 in this paper, whose caption reads "Fig. 1 | …",
  // and linked only Fig. 4. Box 1 shares the number and must not take it.
  const text = "generate an appropriate computational substrate layer (Fig. 1, Fig. 4). In the";
  const run = { text, x: 40, baseline: 250, width: text.length * 4.5, size: 9, font: "Harding", bold: false, italic: false };
  const line = { page: 8, runs: [run], chars: Array.from(text, (_, at) => ({ run: 0, at })) };
  const flow = { text, at: Array.from(text, (_, char) => ({ line, char })) };
  const layout = { pages: Array.from({ length: 8 }, () => ({ width: 595, height: 791 })) };
  const float = (key, kind, label, page) => ({ key, kind, label, page, x: 0.07, y: 0.06, w: 0.86, h: 0.3, caption: {} });
  const floats = new Map([
    ["figure\n1", float("f0", "figure", "1", 2)],
    ["box\n1", float("f1", "box", "1", 3)],
    ["figure\n4", float("f4", "figure", "4", 6)],
  ]);
  const links = findMentions(flow, floats, layout, new Trace());
  assert.deepEqual(links.map((l) => [l.label, l.float, l.page]), [["1", "f0", 8], ["4", "f4", 8]]);
  // Side by side on the line, and apart: two things to press, not one.
  const [one, four] = links;
  assert.ok(one.x + one.w <= four.x, "Fig. 1 ends before Fig. 4 begins");
  const at = (s) => 40 + text.indexOf(s) * 4.5;
  assert.ok(Math.abs(one.x * 595 - at("Fig. 1")) < 0.5 && Math.abs(four.x * 595 - at("Fig. 4")) < 0.5, "each covers its own \"Fig.\"");
});
