// Every registered rule against its own examples: what it must match and
// what it must not. A rule changed to fix one paper keeps every example
// passing; a mistake found on a page becomes a `rejects` example first.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(os.tmpdir(), `papol-rules-registry-${process.pid}.mjs`);
await esbuild.build({ entryPoints: [path.join(here, "../src/rules/registry.ts")], outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error" });
const { allRules } = await import(pathToFileURL(out).href);

for (const rule of allRules()) {
  if (!rule.pattern) continue;
  test(`${rule.id} matches what it is for`, () => {
    for (const text of rule.matches ?? []) assert.ok(new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")).test(text), `${rule.id} should match ${JSON.stringify(text)}`);
  });
  test(`${rule.id} rejects what it is not`, () => {
    for (const text of rule.rejects ?? []) assert.ok(!new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")).test(text), `${rule.id} should not match ${JSON.stringify(text)}`);
  });
}

test("every rule is named for its stage, once, and says why it exists", () => {
  const ids = allRules().map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const rule of allRules()) {
    assert.ok(rule.id.startsWith(`${rule.stage}.`), rule.id);
    assert.ok(rule.summary.length > 20 && rule.why.length > 20, `${rule.id} needs a summary and a reason`);
    if (rule.pattern) assert.ok((rule.matches ?? []).length >= 1 && (rule.rejects ?? []).length >= 1, `${rule.id} needs examples both ways`);
  }
});
