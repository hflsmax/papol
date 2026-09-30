// The theorems, lemmas, definitions and proofs found in every paper of a
// directory: a count of each kind, and the lines they were found on with
// VERBOSE=1. The lines that open with one of the words and were turned
// down are listed with MISSED=1, to read against what was found.
//   node scripts/run-script.mjs statements <dir>
import fs from "node:fs";
import path from "node:path";
import { analyzeWithRules } from "../src/rules/analyze";
import { readPdf } from "../src/rules/pdf";
import { layout } from "../src/rules/layout";

const dir = process.argv[2];
if (!dir) { console.error("usage: node scripts/run-script.mjs statements <dir>"); process.exit(2); }
const KINDS = ["theorem", "lemma", "definition", "proof"];
const WORD = /^\s*(?:[▶►▸]\s*)?(?:Theorem|Lemma|Proposition|Corollary|Definition|Proof|T\s?HEOREM|L\s?EMMA|P\s?ROPOSITION|C\s?OROLLARY|D\s?EFINITION|P\s?ROOF)\b/;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort()) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, file)));
  const { analysis, trace } = await analyzeWithRules(bytes);
  const found = analysis.floats.filter((f) => KINDS.includes(f.kind));
  console.log(`${file.slice(0, -4).padEnd(56)} ${KINDS.map((k) => `${k} ${found.filter((f) => f.kind === k).length}`).join("  ")}`);
  const traced = trace.items.filter((t) => t.rule === "statement.lead");
  if (process.env.VERBOSE) for (const t of traced) console.log(`    p${t.page} ${t.text}`);
  if (process.env.MISSED) {
    const seen = new Set(traced.map((t) => `${t.page}\n${t.text}`));
    const doc = layout(await readPdf(bytes));
    for (const page of doc.pages) for (const line of page.lines) {
      if (WORD.test(line.text) && !seen.has(`${page.number}\n${line.text.slice(0, 80)}`)) console.log(`    missed p${page.number} ${JSON.stringify(line.runs.slice(0,3).map((r)=>[r.text.slice(0,12),r.font,r.size.toFixed(1)]))} [${line.runs[0].font} ${line.runs[0].bold ? "b" : ""}${line.runs[0].italic ? "i" : ""}] ${line.text.slice(0, 70)}`);
    }
  }
}
