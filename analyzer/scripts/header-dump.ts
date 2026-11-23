// Each PDF's title block as the rules read it, as JSON keyed by path: run it
// before and after a change to header.ts and diff the two.
//   node scripts/run-script.mjs header-dump <pdf>...
import fs from "node:fs";
import { headerWithRules } from "../src/rules/analyze";
const out: Record<string, unknown> = {};
for (const file of process.argv.slice(2)) {
  try { out[file] = (await headerWithRules(new Uint8Array(fs.readFileSync(file)))).header; }
  catch (e) { out[file] = { error: (e as Error).message }; }
}
console.log(JSON.stringify(out, null, 1));
