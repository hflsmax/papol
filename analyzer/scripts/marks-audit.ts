// What the nav bar would mark on every paper of a directory, against every
// line that could be one: each line opening with a float's or a statement's
// word, in any face. Writes one Markdown sheet a paper, to read by eye:
// what was found, with its line, and the candidate lines that were not.
//   node scripts/run-script.mjs marks-audit <pdf dir> <out dir>
import fs from "node:fs";
import path from "node:path";
import { analyzeLayout } from "../src/rules/paper";
import { layout } from "../src/rules/layout";
import { readPdf } from "../src/rules/pdf";

const [dir, outDir] = process.argv.slice(2);
if (!dir || !outDir) { console.error("usage: node scripts/run-script.mjs marks-audit <pdf dir> <out dir>"); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const MARKED = ["figure", "box", "table", "algorithm", "listing", "theorem", "lemma", "definition", "proof"];
const WORD = /^\s*(?:[▶►▸]\s*)?(Figure|FIGURE|Fig\.?|FIG\.?|Table|TABLE|Algorithm|ALGORITHM|Listing|LISTING|Box|Theorem|THEOREM|T\s?HEOREM|Lemma|LEMMA|L\s?EMMA|Proposition|PROPOSITION|P\s?ROPOSITION|Corollary|COROLLARY|C\s?OROLLARY|Definition|DEFINITION|D\s?EFINITION|Proof|PROOF|P\s?ROOF)\b/;
const summary: string[] = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort()) {
  const laid = layout(await readPdf(new Uint8Array(fs.readFileSync(path.join(dir, file)))));
  const { analysis, trace } = analyzeLayout(laid);
  const found = analysis.floats.filter((f) => MARKED.includes(f.kind));
  const statementLines = new Set(trace.items.filter((t) => t.rule === "statement.lead").map((t) => `${t.page}|${t.boxes[0].y.toFixed(5)}`));
  const out: string[] = [`# ${file}`, "", "## Found", ""];
  for (const f of found.sort((a, b) => a.page - b.page || a.y - b.y)) {
    const page = laid.pages[f.page - 1];
    // The first line inside the found box, top first: a statement's own
    // line, or the top of a figure.
    const inside = (l: typeof page.lines[number]) => !l.furniture && l.top / page.height >= f.y - 0.002 && l.top / page.height <= f.y + f.h
      && l.x1 / page.width > f.x && l.x0 / page.width < f.x + f.w;
    const line = page.lines.filter(inside).sort((a, b) => a.top - b.top)[0];
    out.push(`- p${f.page} y${(f.y * 100).toFixed(1)} **${f.kind} ${f.label}** — ${line ? line.text.slice(0, 90) : "?"}`);
  }
  out.push("", "## Candidate lines not found", "");
  let missed = 0;
  for (const page of laid.pages) for (const line of page.lines) {
    if (line.furniture) continue;
    const m = WORD.exec(line.text);
    if (!m) continue;
    const y = line.top / page.height;
    if (statementLines.has(`${page.number}|${y.toFixed(5)}`)) continue;
    // A caption found for its float: the float's box is on this page and
    // its number is on this line.
    const number = /(\d+(?:\.\d+)?)/.exec(line.text.slice(m[0].length, m[0].length + 8))?.[1];
    if (number && found.some((f) => ["figure", "box", "table", "algorithm", "listing"].includes(f.kind) && f.label.toLowerCase() === number && Math.abs(f.page - page.number) <= 1)) continue;
    const r = line.runs[0];
    const lead = line.runs.find((x) => /\p{L}/u.test(x.text)) ?? r;
    out.push(`- p${page.number} y${(y * 100).toFixed(1)} [${lead.font}${lead.bold ? " b" : ""}${lead.italic ? " i" : ""}] ${line.text.slice(0, 100)}`);
    missed += 1;
  }
  const counts = MARKED.map((k) => `${k} ${found.filter((f) => f.kind === k).length}`).filter((s) => !s.endsWith(" 0")).join(", ");
  summary.push(`${file.slice(0, -4)}: ${counts || "nothing"}; ${missed} candidate lines not found`);
  fs.writeFileSync(path.join(outDir, `${file.slice(0, -4)}.md`), out.join("\n") + "\n");
}
console.log(summary.join("\n"));
