// The float rules' geometry, on built drawings rather than papers.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(os.tmpdir(), `papol-rules-floats-${process.pid}.mjs`);
await esbuild.build({ entryPoints: [path.join(here, "../src/rules/floats.ts")], outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error" });
const { piecesOf } = await import(pathToFileURL(out).href);

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
