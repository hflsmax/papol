// A paper's lines as the analyzer sees them: page, column, size, bold,
// flags, text. For finding out why a rule did or did not fire.
//   node scripts/run-script.mjs lines <pdf> [page|from-to] [grep]
import fs from "node:fs";
import { layout } from "../src/rules/layout";
import { readPdf } from "../src/rules/pdf";

const [file, pages = "", grep = ""] = process.argv.slice(2);
const doc = await readPdf(new Uint8Array(fs.readFileSync(file)));
const laid = layout(doc);
const [from, to] = pages ? pages.split("-").map(Number) : [1, laid.pages.length];
console.log(`body ${laid.bodySize}`);
for (const page of laid.pages) {
  if (page.number < from || page.number > (to ?? from)) continue;
  console.log(`=== page ${page.number} ${page.twoColumn ? "two-column" : "one-column"} ${Math.round(page.width)}x${Math.round(page.height)}`);
  for (const l of page.lines) {
    if (grep && !new RegExp(grep, "i").test(l.text)) continue;
    const sup = l.runs.filter((r) => r.sup).map((r) => r.text).join("|");
    console.log(`${String(Math.round(l.x0)).padStart(4)} ${String(Math.round(l.top)).padStart(4)} ${l.column.padEnd(9)} ${l.size.toFixed(1)}${l.bold ? "B" : " "}${l.furniture ? "F" : " "} ${l.text.slice(0, 110)}${sup ? `   ^[${sup}]` : ""}`);
  }
}
