// The rule-based analyzer against a folder of PDFs, with GROBID's answers
// beside it where they are known. Writes one JSON per paper (the analysis
// and its trace, for the overlay) and prints a table.
//
//   node scripts/run-corpus.mjs <pdf dir> <out dir> [grobid dir]
//
// The grobid dir holds grobid_paper_references.json, grobid_paper_citations.json
// and grobid_paper_links.json: rows as the database keeps them.

import fs from "node:fs";
import path from "node:path";

import { analyzeWithRules } from "../src/rules/analyze";

type Row = Record<string, unknown>;

const [pdfDir, outDir, grobidDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const load = (name: string): Row[] => (grobidDir && fs.existsSync(path.join(grobidDir, name)) ? JSON.parse(fs.readFileSync(path.join(grobidDir, name), "utf8")) : []);
const count = (rows: Row[]) => {
  const map = new Map<string, number>();
  for (const r of rows) map.set(String(r.paper_sha256), (map.get(String(r.paper_sha256)) ?? 0) + 1);
  return map;
};
const grobid = {
  refs: count(load("grobid_paper_references.json")),
  cites: count(load("grobid_paper_citations.json")),
  links: count(load("grobid_paper_links.json")),
};

const only = process.env.ONLY;
const files = fs.readdirSync(pdfDir).filter((f) => f.endsWith(".pdf") && (!only || f.startsWith(only))).sort();
const summary: Row[] = [];
console.log("paper       numbering pages |  refs (grobid) | cites (grobid) cited% | links (grobid) | ms");
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
    row = { sha, ...stats, refs: analysis.references.length, cites: analysis.citations.length, cited, links: analysis.links.length, ms,
      grobidRefs: grobid.refs.get(sha) ?? 0, grobidCites: grobid.cites.get(sha) ?? 0, grobidLinks: grobid.links.get(sha) ?? 0 };
    console.log(`${sha.slice(0, 10)}  ${String(stats.numbering).padEnd(8)} ${String(stats.pages).padStart(5)} | ${String(row.refs).padStart(5)} (${String(row.grobidRefs).padStart(4)}) | ${String(row.cites).padStart(5)} (${String(row.grobidCites).padStart(4)}) ${String(cited).padStart(4)}% | ${String(row.links).padStart(5)} (${String(row.grobidLinks).padStart(4)}) | ${ms}`);
  } catch (error) {
    row = { sha, error: String((error as Error).stack ?? error) };
    console.log(`${sha.slice(0, 10)}  FAILED ${(error as Error).message}`);
  }
  summary.push(row);
}
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 1));
