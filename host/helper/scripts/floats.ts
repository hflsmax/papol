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
laid.pages = laid.pages.filter((p) => p.number === Number(page));
let on = !only;
explainFloats((m) => {
  if (m.startsWith("page ")) on = !only || m.endsWith(only);
  if (on) console.log(m);
});
findFloats(laid, new Trace());
