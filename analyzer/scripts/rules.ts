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
// A label reads math letters and newtx's triangles as printed (see printedName).
const printed = (s: string) => s.normalize("NFKC").replace(/⊲/g, "▷").replace(/⊳/g, "◁");
for (const rule of rules) {
  const mentions = analysis.links.filter((l) => l.float === rule.key);
  const how = trace.items.find((t) => printed(t.text) === printed(rule.label) && t.rule.startsWith("rule.name"))?.rule ?? "?";
  console.log(`${rule.label.padEnd(16)} ${how.padEnd(18)} ${where(rule).padEnd(22)} ${mentions.length} mentions: ${mentions.slice(0, 6).map((m) => `${m.label}@p${m.page}`).join(" ")}`);
}
console.log(`${rules.size ?? rules.length} rules, ${analysis.links.filter((l) => byKey.has(l.float)).length} mentions`);
for (const t of trace.items.filter((t) => ["rule.heading", "rule.cell", "rule.clause"].includes(t.rule) || (t.rule === "rule.convention" && t.text.endsWith(" alone")))) console.log(`${t.rule.slice(5).padEnd(10)} p${t.page} ${t.text}`);
if (process.env.ALL) {
  const named = new Set(trace.items.filter((t) => t.rule.startsWith("rule.name")).map((t) => `${t.page} ${t.text}`));
  const set = new Set(trace.items.filter((t) => t.rule === "rule.setting").map((t) => `${t.page} ${t.text.split(" ")[0]}`));
  for (const t of trace.items.filter((t) => t.rule === "rule.candidate" && !set.has(`${t.page} ${t.text}`))) console.log(`none       p${t.page} ${t.text}`);
  for (const t of trace.items.filter((t) => t.rule === "rule.setting" && !named.has(`${t.page} ${t.text.split(" ")[0]}`))) console.log(`unnamed    p${t.page} ${t.text}`);
}
