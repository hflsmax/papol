// The Navigator's fallback against the Navigator itself: for every PDF in a
// folder that has an outline, the sections the viewer draws from it
// (viewer/src/sections.js, readSections) are the truth, and the sections
// read off the printed page with the outline set aside (contents.ts,
// printedSections) are scored against them.
//   node scripts/run-script.mjs contents <pdf dir> [out.json]
//
// Only the sections the bar draws are scored: the top level, without the
// journal's notices (withoutEndMatter). A read section is right when it is
// within a page of where the outline puts it and names the same heading —
// the same number on the same page, or the same title once case and
// spacing are set aside. The
// abstract is not scored (see bar).
// Prints per paper what was found, missed and invented, then precision and
// recall over every section (micro) and averaged over papers (macro). The
// PDFs with no outline are counted too: how many of those now get a bar.
import fs from "node:fs";
import path from "node:path";
import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { readContents } from "../src/rules/contents";
// @ts-expect-error — the viewer is JavaScript
import { isFrontMatter, printedSections, readSections, topLevel } from "../../viewer/src/sections.js";

type Section = { number: string; title: string; level: number; page: number; y: number; end?: boolean };

const [dir, out] = process.argv.slice(2);
const only = process.env.ONLY;
const { OPS } = await getResolvedPDFJS();

const compact = (text: string) => text.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const bar = (sections: Section[]) => {
  const top = topLevel(sections);
  // The abstract is left out on both sides: an outline rarely bookmarks it
  // (it is set before the first \\section), and where it is printed as a
  // heading the bar stands it in for Start, the same place.
  return sections.filter((s) => (s.level ?? 0) === top && !s.end && !isFrontMatter(s.title));
};
const same = (a: Section, b: Section) => {
  // A page either way: an outline's destination for a heading at the top of
  // a page is often the foot of the one before, and a chapter's is its
  // title page, a page ahead of the heading printed on the next.
  if (Math.abs(a.page - b.page) > 1) return false;
  if (a.page === b.page && a.number && b.number && a.number.toLowerCase() === b.number.toLowerCase()) return true;
  const like = (x: string, y: string) => Boolean(x && y) && (x === y || (Math.min(x.length, y.length) >= 6 && (x.startsWith(y) || y.startsWith(x))));
  // An appendix is "A Proofs" to the outline and A, "Proofs" to the page.
  return like(compact(a.title), compact(b.title)) || like(compact(a.number + a.title), compact(b.number + b.title));
};
// One to one, in order: each true section takes the first unclaimed read
// one that names it.
function score(truth: Section[], read: Section[]) {
  const claimed = new Set<number>();
  const found: Section[] = [], missed: Section[] = [];
  for (const t of truth) {
    const i = read.findIndex((r, index) => !claimed.has(index) && same(t, r));
    if (i >= 0) { claimed.add(i); found.push(t); } else missed.push(t);
  }
  const invented = read.filter((_, index) => !claimed.has(index));
  return { found, missed, invented };
}

const name = (s: Section) => `${s.number ? `${s.number} ` : ""}${s.title.slice(0, 40)} p${s.page}`;
const rows: Record<string, unknown>[] = [];
let tp = 0, fn = 0, fp = 0, papers = 0, precisionSum = 0, recallSum = 0, exact = 0, silent = 0;
let noOutline = 0, noOutlineWithBar = 0;
// By where the PDFs came from, the part of the name before the first "-":
// one template in bulk should not hide how the rest do.
const groups = new Map<string, { tp: number; fn: number; fp: number; papers: number }>();
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".pdf") && (!only || f.startsWith(only))).sort()) {
  let doc;
  try { doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(dir, file)))); } catch { continue; }
  try {
    const truth = bar(((await readSections(doc)) ?? { sections: [] }).sections);
    const started = Date.now();
    const headings = (await readContents(doc, OPS as unknown as Record<string, number>)) ?? [];
    const ms = Date.now() - started;
    const read = bar(printedSections(headings));
    // An outline whose every entry is on the first page names the paper
    // (its title, its authors), not its sections: nothing to score against,
    // and the viewer draws it all the same.
    if (truth.length >= 2 && truth.every((s) => s.page === 1)) {
      rows.push({ file, pages: doc.numPages, outline: "cover", read: read.map(name), ms });
      console.log(`${file.padEnd(14)} cover outline, not scored`);
      continue;
    }
    if (truth.length < 2) {
      noOutline += 1;
      if (read.length) noOutlineWithBar += 1;
      rows.push({ file, pages: doc.numPages, outline: false, read: read.map(name), ms });
      console.log(`${file.padEnd(14)} no outline   read ${read.length}: ${read.map((s) => s.number || s.title.slice(0, 18)).join(" | ")}`);
      continue;
    }
    const { found, missed, invented } = score(truth, read);
    papers += 1;
    tp += found.length; fn += missed.length; fp += invented.length;
    const group = groups.get(file.split("-")[0]) ?? { tp: 0, fn: 0, fp: 0, papers: 0 };
    group.tp += found.length; group.fn += missed.length; group.fp += invented.length; group.papers += 1;
    groups.set(file.split("-")[0], group);
    const precision = read.length ? found.length / read.length : 0;
    const recall = found.length / truth.length;
    precisionSum += read.length ? precision : 0;
    recallSum += recall;
    if (!missed.length && !invented.length) exact += 1;
    if (!read.length) silent += 1;
    rows.push({ file, pages: doc.numPages, outline: true, truth: truth.length, found: found.length, missed: missed.map(name), invented: invented.map(name), ms });
    console.log(`${file.padEnd(14)} ${String(found.length).padStart(3)}/${String(truth.length).padEnd(3)} read ${String(read.length).padStart(3)}  P ${precision.toFixed(2)} R ${recall.toFixed(2)}${missed.length ? `  missed: ${missed.map((s) => s.number || s.title.slice(0, 18)).join(" | ")}` : ""}${invented.length ? `  invented: ${invented.map((s) => s.number || s.title.slice(0, 18)).join(" | ")}` : ""}`);
  } finally {
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
}
const P = tp / Math.max(1, tp + fp), R = tp / Math.max(1, tp + fn);
console.log(`\n${papers} papers with an outline: ${tp + fn} sections on their bars, ${tp + fp} read off the page, ${tp} right`);
console.log(`micro  precision ${(100 * P).toFixed(1)}%  recall ${(100 * R).toFixed(1)}%  F1 ${(200 * P * R / Math.max(1e-9, P + R)).toFixed(1)}%`);
console.log(`macro  precision ${(100 * precisionSum / Math.max(1, papers - silent)).toFixed(1)}% (over ${papers - silent} papers given a bar)  recall ${(100 * recallSum / Math.max(1, papers)).toFixed(1)}%`);
for (const [name, g] of groups) console.log(`  ${name.padEnd(8)} ${String(g.papers).padStart(3)} papers  precision ${(100 * g.tp / Math.max(1, g.tp + g.fp)).toFixed(1)}%  recall ${(100 * g.tp / Math.max(1, g.tp + g.fn)).toFixed(1)}%`);
console.log(`exact bars ${exact}/${papers}, no bar ${silent}/${papers}`);
console.log(`${noOutline} papers without an outline: ${noOutlineWithBar} now get a bar`);
if (out) fs.writeFileSync(out, JSON.stringify({ precision: P, recall: R, papers, rows }, null, 1));
