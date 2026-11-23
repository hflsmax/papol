// "rule" hard by a short name, or a list of names in between: what lets a
// lowercase word at the margin stand as a rule (rule.convention) and a
// short name's mention link to it.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(os.tmpdir(), `papol-rules-words-${process.pid}.mjs`);
await esbuild.build({
  stdin: { contents: 'export { RULE_JUST_BEFORE, RULE_JUST_AFTER } from "./inference";', resolveDir: path.join(here, "../src/rules"), loader: "ts" },
  outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
const { RULE_JUST_BEFORE, RULE_JUST_AFTER } = await import(pathToFileURL(out).href);

test("a list of names before the one cited, bare or bracketed, still has \"rules\" hard by it", () => {
  for (const before of ["the rule ", "rules ⊗, ⅋, 1 and ", "rules slam, sbind and ",
    // Semilenient choreographies (ICFP 25): "rules (com), (select), (app), (let), (if), (def), and (commute)".
    "rules (com), (select), ", "rules (com), (select), (app), (let), ", "rules [T-Var], and "]) {
    assert.ok(RULE_JUST_BEFORE.test(before), JSON.stringify(before));
  }
  for (const before of ["rules displayed in Figure ", "the rules of ", "rules (shown in Fig. 2) and "]) assert.ok(!RULE_JUST_BEFORE.test(before), JSON.stringify(before));
});

test("a list of names after the one cited, bare or bracketed, still ends in \"rules\"", () => {
  for (const after of [" rule moves", " and w rules", " and (def) rules are the same", ", (let) and (def) rules"]) {
    assert.ok(RULE_JUST_AFTER.test(after), JSON.stringify(after));
  }
  for (const after of [" reduces an application", " and (def) are the same rules", " (shown in Fig. 2) rules"]) assert.ok(!RULE_JUST_AFTER.test(after), JSON.stringify(after));
});
