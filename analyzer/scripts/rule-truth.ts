// The named rules found in a paper against its inventory in test/rule-truth:
// every named rule a reader of the paper listed, with its page and the box
// round the whole rule in points. For each paper, the names found and
// missed, the rules found that are none (a step of a worked derivation
// that cites a rule, listed as cited, is none too: it is no rule's
// definition), the pairs of boxes
// that overlap, and the boxes far from the rule (overlapping it less than
// 0.6 of their union). Boxes in an inventory were drawn by eye, so a box a
// little off is reported, not judged; a missed name, a false one or an
// overlap fails.
//   node scripts/run-script.mjs rule-truth <dir>... [-v] [--only=paper,paper] [--jobs=N]
// The papers are scored on every core (--jobs, default all): one child
// process per core, each given every N-th paper, their reports printed
// in paper order.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { analyzeWithRules } from "../src/rules/analyze";
import { readPdf } from "../src/rules/pdf";

type Box = [number, number, number, number];
type Inventory = { rules: { page: number; name: string; box: Box }[]; cited?: { page: number; name: string }[] };

const args = process.argv.slice(2);
const verbose = args.includes("-v");
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const dirs = args.filter((a) => !a.startsWith("-"));
if (!dirs.length) { console.error("usage: node scripts/run-script.mjs rule-truth <dir>... [-v]"); process.exit(2); }
const truthDir = path.resolve("test", "rule-truth");

// Names compare as a reader reads them: case, math letters (𝑆 is S), brackets, a trailing mark and
// the joiner (space, underscore, hyphen) aside.
const norm = (s: string) => s.normalize("NFKC").replace(/^[[(\s]+|[\])\s•]+$/g, "").toLowerCase().replace(/\s+/g, "").replace(/[_‐‑–-]+/g, "-");
const inter = (a: Box, b: Box) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const area = (a: Box) => Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);

const papers = fs.readdirSync(truthDir).filter((f) => f.endsWith(".json") && (!only || only.includes(f.slice(0, -5)))).sort();
const jobs = Math.min(Number(args.find((a) => a.startsWith("--jobs="))?.slice(7) ?? os.availableParallelism()), papers.length);
if (!args.includes("--child") && jobs > 1) {
  const runner = path.resolve("scripts", "run-script.mjs");
  const shares = Array.from({ length: jobs }, (_, i) => papers.filter((p, k) => k % jobs === i).map((f) => f.slice(0, -5)));
  const outputs = await Promise.all(shares.map((share) => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [runner, "rule-truth", ...dirs, "--child", "--jobs=1", `--only=${share.join(",")}`, ...(verbose ? ["-v"] : [])], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", reject);
    child.on("close", () => resolve(out));
  })));
  // Each report is a paper's line and the indented lines under it.
  const reports = new Map<string, string>();
  for (const out of outputs) for (const block of out.split(/^(?=\S)/m)) {
    const name = block.slice(0, block.indexOf(":"));
    if (block.startsWith(`${name}: `)) reports.set(name, block);
  }
  let failed = 0;
  for (const file of papers) {
    const report = reports.get(file.slice(0, -5)) ?? `${file.slice(0, -5)}: no report\n`;
    process.stdout.write(report);
    if (/^\S.*: (?:no report|no PDF)|^   (?:missed|false|overlap):/m.test(report)) failed += 1;
  }
  if (failed) { console.log(`${failed} paper(s) miss a rule, find a false one or overlap two`); process.exit(1); }
  process.exit(0);
}
let failed = 0;
for (const file of papers) {
  const paper = file.slice(0, -5);
  const pdf = dirs.map((d) => path.join(d, `${paper}.pdf`)).find((f) => fs.existsSync(f));
  if (!pdf) { console.log(`${paper}: no PDF in ${dirs.join(", ")}`); continue; }
  const truth: Inventory = JSON.parse(fs.readFileSync(path.join(truthDir, file), "utf8"));
  const bytes = new Uint8Array(fs.readFileSync(pdf));
  const doc = await readPdf(bytes.slice());
  const { analysis } = await analyzeWithRules(bytes);
  const got = analysis.floats.filter((f) => f.kind === "rule").map((r) => {
    const page = doc.pages[r.page - 1];
    return { page: r.page, name: r.label ?? "", box: [r.x * page.width, r.y * page.height, (r.x + r.w) * page.width, (r.y + r.h) * page.height] as Box };
  });
  const used = new Set<number>();
  const missed: string[] = [];
  const off: string[] = [];
  for (const want of truth.rules) {
    const matches = got.map((g, i) => i).filter((i) => !used.has(i) && got[i].page === want.page && norm(got[i].name) === norm(want.name));
    if (!matches.length) { missed.push(`${want.name}@${want.page}`); continue; }
    const i = matches.reduce((a, b) => (inter(got[b].box, want.box) > inter(got[a].box, want.box) ? b : a));
    used.add(i);
    const both = inter(got[i].box, want.box);
    const iou = both / Math.max(area(got[i].box) + area(want.box) - both, 1e-9);
    if (iou < 0.6) off.push(`${want.name}@${want.page}(${iou.toFixed(2)})`);
  }
  const cited = [...(truth.cited ?? [])];
  const extra = got.filter((g, i) => !used.has(i)).map((g) => {
    const at = cited.findIndex((c) => c.page === g.page && norm(c.name) === norm(g.name));
    if (at >= 0) cited.splice(at, 1);
    return `${g.name}@${g.page}${at >= 0 ? " (a cited step)" : ""}`;
  });
  const overlaps: string[] = [];
  for (let i = 0; i < got.length; i += 1) for (let j = i + 1; j < got.length; j += 1) {
    const [a, b] = [got[i], got[j]];
    if (a.page === b.page && inter(a.box, b.box) > 0.02 * Math.min(area(a.box), area(b.box))) overlaps.push(`${a.name}/${b.name}@${a.page}`);
  }
  if (missed.length || extra.length || overlaps.length) failed += 1;
  console.log(`${paper}: ${truth.rules.length - missed.length}/${truth.rules.length} found, ${extra.length} false, ${overlaps.length} overlapping, ${off.length} boxes off`);
  if (missed.length) console.log(`   missed:  ${missed.join(" ")}`);
  if (extra.length) console.log(`   false:   ${extra.join(" ")}`);
  if (overlaps.length) console.log(`   overlap: ${overlaps.join(" ")}`);
  if (verbose && off.length) console.log(`   off:     ${off.join(" ")}`);
}
if (failed) { console.log(`${failed} paper(s) miss a rule, find a false one or overlap two`); process.exit(1); }
