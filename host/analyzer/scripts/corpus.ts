// The rule-based analyzer against a folder of PDFs. Writes one JSON per
// paper (the analysis and its trace, for the overlay) and prints a table.
//
//   node scripts/run-corpus.mjs <pdf dir> <out dir>

import fs from "node:fs";
import path from "node:path";

import { analyzeWithRules } from "../src/rules/analyze";

type Row = Record<string, unknown>;

const [pdfDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const only = process.env.ONLY;
const files = fs.readdirSync(pdfDir).filter((f) => f.endsWith(".pdf") && (!only || f.startsWith(only))).sort();
const summary: Row[] = [];
console.log("paper       numbering pages |  refs | cites cited% | links | ms");
for (const file of files) {
  const sha = file.replace(/\.pdf$/, "");
  const started = Date.now();
  let row: Row;
  try {
    const result = await analyzeWithRules(new Uint8Array(fs.readFileSync(path.join(pdfDir, file))));
    const ms = Date.now() - started;
    const { analysis, trace, stats } = result;
    fs.writeFileSync(path.join(outDir, `${sha}.json`), JSON.stringify({ sha, stats, analysis, trace: trace.items, counts: trace.counts() }));
    const citedKeys = new Set(analysis.citations.map((c) => c.key));
    const cited = analysis.references.length ? Math.round((100 * citedKeys.size) / analysis.references.length) : 0;
    row = { sha, ...stats, refs: analysis.references.length, cites: analysis.citations.length, cited, links: analysis.links.length, ms };
    console.log(`${sha.slice(0, 10)}  ${String(stats.numbering).padEnd(8)} ${String(stats.pages).padStart(5)} | ${String(row.refs).padStart(5)} | ${String(row.cites).padStart(5)} ${String(cited).padStart(4)}% | ${String(row.links).padStart(5)} | ${ms}`);
  } catch (error) {
    row = { sha, error: String((error as Error).stack ?? error) };
    console.log(`${sha.slice(0, 10)}  FAILED ${(error as Error).message}`);
  }
  summary.push(row);
}
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 1));
