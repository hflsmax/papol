// Why a numbered section was not found: for each number the PDF's outline
// lists and the rules missed, the lines that start with it (or are it, a
// number set apart from its title), with their type and neighbours, and
// which of findSections' tests turned each one down.
//   node scripts/run-script.mjs headings <pdf> <number>...
import fs from "node:fs";
import { layout as layOut, type Line } from "../src/rules/layout";
import { readPdf } from "../src/rules/pdf";
import { SECTION_HEADING } from "../src/rules/registry";

const [file, ...numbers] = process.argv.slice(2);
const doc = await readPdf(new Uint8Array(fs.readFileSync(file)));
const laid = layOut(doc);
const letters = (runs: Line["runs"]) => runs.reduce((n, r) => n + r.text.replace(/\s/g, "").length, 0);
const share = (l: Line, pick: (r: Line["runs"][number]) => boolean) => letters(l.runs.filter(pick)) / Math.max(1, letters(l.runs));
const show = (l: Line) => `size ${l.size.toFixed(1)} (body ${laid.bodySize}) bold ${share(l, (r) => r.bold).toFixed(2)} italic ${share(l, (r) => r.italic).toFixed(2)} x0 ${l.x0.toFixed(0)} x1 ${l.x1.toFixed(0)} y ${l.top.toFixed(0)} fonts ${[...new Set(l.runs.map((r) => r.font))].join(",")}${l.furniture ? " FURNITURE" : ""}`;
for (const number of numbers) {
  const esc = number.replace(/\./g, "\\.");
  const re = new RegExp(`^\\s*(${esc})(\\.|\\s|$)`);
  console.log(`\n=== ${number}`);
  let shown = 0;
  for (const page of laid.pages) {
    page.lines.forEach((line, i) => {
      if (!re.test(line.text) || shown >= 3) return;
      shown += 1;
      const m = SECTION_HEADING.pattern!.exec(line.text);
      const reasons = [
        line.furniture ? "furniture" : "",
        !m ? "SECTION_HEADING pattern does not match" : "",
        m && !(share(line, (r) => r.bold) > 0.5 || line.size > laid.bodySize + 0.5) ? "not mostly bold, not larger than the text" : "",
      ].filter(Boolean);
      console.log(`p${page.number} ${JSON.stringify(line.text.slice(0, 90))}`);
      console.log(`   ${show(line)}`);
      console.log(`   rejected by: ${reasons.join("; ") || "(passes these tests: contents/inside-a-float/duplicate?)"}`);
      const around = page.lines.filter((o) => o !== line && Math.abs(o.baseline - line.baseline) < 3 * laid.bodySize).slice(0, 4);
      for (const o of around) console.log(`   near: ${JSON.stringify(o.text.slice(0, 70))} ${show(o)}`);
    });
  }
  if (!shown) console.log("   no line starts with this number");
}
