// A paper's bibliography as the analyzer read it: the trace of the
// bibliography and entry rules, then each entry's fields.
//   node scripts/run-script.mjs bib <pdf> [how many entries]
import fs from "node:fs";
import { findBibliography } from "../src/rules/bibliography";
import { layout } from "../src/rules/layout";
import { readPdf } from "../src/rules/pdf";
import { Trace } from "../src/rules/trace";

const [file, many = "8"] = process.argv.slice(2);
const laid = layout(await readPdf(new Uint8Array(fs.readFileSync(file))));
const trace = new Trace();
const bib = findBibliography(laid, trace);
for (const item of trace.items.filter((i) => i.rule.startsWith("bibliography."))) console.log(`${item.rule} p${item.page}: ${item.text}`);
console.log(`numbering ${bib.numbering}, ${bib.entries.length} entries`);
for (const e of bib.entries.slice(0, Number(many))) {
  console.log(`#${e.number ?? e.label ?? e.index} p${e.page} y${e.y.toFixed(3)} | ${e.year}${e.yearSuffix} | ${e.surnames.slice(0, 3).join(",")} | ${e.title}\n     ${e.raw.slice(0, 150)}`);
}
