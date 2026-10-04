// The rules read a paper in the reader's browser, so a page they are slow
// on keeps the paper unread: whatever a page draws, its reading ends in a
// few seconds. The pages here are written to be the slow kinds the corpora
// turned up: a plot drawn as hundreds of thousands of strokes beside
// rules (2024-OOPSLA2-281's scatter took the rules over ten minutes), and
// a grammar's long stack of alternatives (poplmark's, twenty seconds).
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(os.tmpdir(), `papol-rules-speed-${process.pid}.mjs`);
await esbuild.build({ entryPoints: [path.join(here, "../src/rules/paper.ts")], outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error" });
const { analyzePages } = await import(pathToFileURL(out).href);

// Generous for a CI runner: the pages below read in well under a second
// on a workstation, and in minutes before strokes were found by place.
const BUDGET_MS = 8000;

const run = (text, x, baseline, size = 10, font = "Times-Roman") => ({ text, x, baseline, width: 0.5 * size * text.length, size, font, bold: false, italic: false });
const page = (number, runs, drawn = []) => ({ number, width: 612, height: 792, runs, drawn, text: runs.map((r) => r.text).join(" ") });
const prose = (from, to) => Array.from({ length: Math.floor((to - from) / 12) }, (_, i) => run("The rules of the calculus are set out in the figure below, one by one, with their names.", 72, from + 12 * i));
const bar = (x, y, w) => ({ x, y, w, h: 0.4, image: false });

// Rules over a plot: bracketed labels beside their bars, and under them a
// scatter of 150,000 marks with a grid of 1,000 dashes as wide as a bar.
function plotted() {
  const runs = [...prose(72, 200)], drawn = [];
  for (let k = 0; k < 6; k += 1) {
    const y = 230 + 40 * k;
    runs.push(run("Γ ⊢ e₁ : τ₁ → τ₂    Γ ⊢ e₂ : τ₁", 150, y - 4), run(`(T-App${k})`, 330, y + 3, 9), run("Γ ⊢ e₁ e₂ : τ₂", 180, y + 14));
    drawn.push(bar(140, y, 180));
  }
  for (let i = 0; i < 1000; i += 1) drawn.push(bar(72 + (i % 40) * 11.7, 500 + Math.floor(i / 40) * 9.2, 40));
  for (let i = 0; i < 150000; i += 1) drawn.push({ x: 72 + ((i * 7919) % 468000) / 1000, y: 500 + ((i * 104729) % 230000) / 1000, w: 1.2, h: 0.8, image: false });
  runs.push(run("(T-Plot)", 500, 520, 9), run("iterations", 280, 745, 8), run("Figure 1. Time per iteration.", 72, 760));
  return page(2, runs, drawn);
}

// A grammar of forty alternatives, each "|" under the last.
function grammar() {
  const runs = [...prose(72, 300), run("e ::= x", 120, 320)];
  for (let i = 0; i < 40; i += 1) runs.push(run(`| e${i} e`, 132, 332 + 11 * i));
  return page(3, runs);
}

it("reads a page of rules over a plot of many strokes, and a long grammar, in a few seconds", () => {
  const started = performance.now();
  const { analysis } = analyzePages([page(1, prose(72, 720)), plotted(), grammar()]);
  const ms = performance.now() - started;
  assert.ok(analysis.floats.some((f) => f.kind === "rule"), "the rules are found");
  assert.ok(ms < BUDGET_MS, `read in ${Math.round(ms)} ms, over ${BUDGET_MS}`);
});
