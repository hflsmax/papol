// The named rules found in every paper of a directory, one line each,
// against the results expected in test/rule-sweep.json: the count of
// rules and of mentions, and the rules' names. A paper not in the file is
// reported and not judged; `--write` records what was found as expected.
// The papers themselves are not in the repository (their authors' sites
// have them); the file keeps what the rules found on them, so a change to
// the rules shows what it costs on every paper before it lands.
//   node scripts/run-script.mjs rule-sweep <dir> [--write]
import fs from "node:fs";
import path from "node:path";
import { analyzeWithRules } from "../src/rules/analyze";

type Expected = { rules: number; mentions: number; names: string[] };

const args = process.argv.slice(2);
const write = args.includes("--write");
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) { console.error("usage: node scripts/run-script.mjs rule-sweep <dir> [--write]"); process.exit(2); }
// The script is bundled to a temporary file, so the analyzer directory
// (where run-script.mjs is run from) locates the expected results.
const expectedFile = path.resolve("test", "rule-sweep.json");
const expected: Record<string, Expected> = fs.existsSync(expectedFile) ? JSON.parse(fs.readFileSync(expectedFile, "utf8")) : {};
const found: Record<string, Expected> = {};

let differences = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort()) {
  const paper = file.slice(0, -4);
  const { analysis } = await analyzeWithRules(new Uint8Array(fs.readFileSync(path.join(dir, file))));
  const rules = analysis.floats.filter((f) => f.kind === "rule");
  const keys = new Set(rules.map((r) => r.key));
  const names = rules.map((r) => r.label).sort((a, b) => a.localeCompare(b));
  const result: Expected = { rules: rules.length, mentions: analysis.links.filter((l) => keys.has(l.float)).length, names };
  found[paper] = result;
  const want = expected[paper];
  let verdict = "new";
  if (want) {
    const lost = want.names.filter((n) => !names.includes(n));
    const gained = names.filter((n) => !want.names.includes(n));
    const same = lost.length === 0 && gained.length === 0 && want.mentions === result.mentions;
    verdict = same ? "same" : `expected ${want.rules} rules, ${want.mentions} mentions${lost.length ? `; lost ${lost.join(" ")}` : ""}${gained.length ? `; gained ${gained.join(" ")}` : ""}`;
    if (!same) differences += 1;
  }
  console.log(`${paper.slice(0, 28).padEnd(28)} ${String(result.rules).padStart(3)} rules ${String(result.mentions).padStart(3)} mentions  ${verdict}`);
}
if (write) {
  fs.writeFileSync(expectedFile, `${JSON.stringify(found, null, 2)}\n`);
  console.log(`wrote ${Object.keys(found).length} papers to ${path.relative(process.cwd(), expectedFile)}`);
} else if (differences) {
  console.log(`${differences} paper(s) differ from ${path.relative(process.cwd(), expectedFile)}; run with --write to accept`);
  process.exit(1);
}
