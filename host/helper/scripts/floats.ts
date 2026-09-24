// How each float on a page was sized: what it grew into, what stopped it.
//   node scripts/run-script.mjs floats <pdf> <page> [kind number]
import fs from "node:fs";
import { explainFloats, findFloats } from "../src/rules/floats";
import { layout } from "../src/rules/layout";
import { readPdf } from "../src/rules/pdf";
import { Trace } from "../src/rules/trace";

const [file, page, only = ""] = process.argv.slice(2);
const doc = await readPdf(new Uint8Array(fs.readFileSync(file)));
const laid = layout(doc);
// The paper's type is measured over every page; only this page is told.
let on = true;
explainFloats((m) => {
  if (m.startsWith("page ")) on = m.startsWith(`page ${page} `) && (!only || m.endsWith(only));
  if (on) console.log(m);
});
findFloats(laid, new Trace());
// With DRAWN=y0-y1, what the page paints between those heights.
if (process.env.DRAWN) {
  const [y0, y1] = process.env.DRAWN.split("-").map(Number);
  const p = doc.pages[Number(page) - 1];
  for (const d of p.drawn) if (d.y + d.h >= y0 && d.y <= y1) console.log([d.x, d.y, d.w, d.h].map(Math.round).join(","), d.image ? "image" : "");
}
