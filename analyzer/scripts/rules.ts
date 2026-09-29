// A paper's named rules and the mentions of them, for checking the rules
// that find them.
//   node scripts/run-script.mjs rules <pdf>
import fs from "node:fs";
import { analyzeWithRules } from "../src/rules/analyze";

const [file] = process.argv.slice(2);
const { analysis, trace } = await analyzeWithRules(new Uint8Array(fs.readFileSync(file)));
const rules = analysis.floats.filter((f) => f.kind === "rule");
const byKey = new Map(rules.map((r) => [r.key, r]));
const where = (b: { page: number; x: number; y: number; w: number; h: number }) => `p${b.page} ${(b.x * 100).toFixed(0)},${(b.y * 100).toFixed(0)} ${(b.w * 100).toFixed(0)}x${(b.h * 100).toFixed(0)}`;
for (const rule of rules) {
  const mentions = analysis.links.filter((l) => l.float === rule.key);
  const how = trace.items.find((t) => t.text === rule.label && t.rule.startsWith("rule.label"))?.rule ?? "?";
  console.log(`${rule.label.padEnd(16)} ${how.padEnd(18)} ${where(rule).padEnd(22)} ${mentions.length} mentions: ${mentions.slice(0, 6).map((m) => `${m.label}@p${m.page}`).join(" ")}`);
}
console.log(`${rules.size ?? rules.length} rules, ${analysis.links.filter((l) => byKey.has(l.float)).length} mentions`);
