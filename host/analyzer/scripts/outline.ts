// Section headings against the PDF's own outline (its bookmarks), where it
// has one: the numbered entries the outline lists are ground truth for the
// numbered sections the rules should find.
//   node scripts/run-script.mjs outline <pdf dir> [out.json]
// Prints, per paper with a numbered outline: found / expected, the numbers
// missed, and the numbers found that the outline does not list (at a depth
// the outline covers). With out.json, writes the details.
import fs from "node:fs";
import path from "node:path";
import { getDocumentProxy } from "unpdf";
import { analyzeWithRules } from "../src/rules/analyze";

const [dir, out] = process.argv.slice(2);
const NUMBERED = /^\s*((?:\d{1,2}|[A-Z])(?:\.\d{1,2}){0,3})\.?\s+\S/;

type Entry = { number: string; title: string; page: number | null };
async function outlineOf(bytes: Uint8Array): Promise<Entry[]> {
  const doc = await getDocumentProxy(bytes);
  const items = (await doc.getOutline()) ?? [];
  const entries: Entry[] = [];
  const walk = async (list: any[]) => {
    for (const item of list) {
      const m = NUMBERED.exec(item.title ?? "");
      let page: number | null = null;
      try {
        const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
        if (Array.isArray(dest) && dest[0]) page = (await doc.getPageIndex(dest[0])) + 1;
      } catch { /* no destination */ }
      if (m) entries.push({ number: m[1], title: item.title.trim(), page });
      if (item.items?.length) await walk(item.items);
    }
  };
  await walk(items);
  return entries;
}

const rows: any[] = [];
let expected = 0, found = 0, extra = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort()) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, file)));
  let outline: Entry[];
  try { outline = await outlineOf(bytes.slice()); } catch { continue; }
  if (outline.length < 2) continue;
  const { analysis } = await analyzeWithRules(bytes.slice());
  const sections = analysis.floats.filter((f) => f.kind === "section");
  const got = new Map(sections.map((s) => [s.label.toLowerCase(), s]));
  const want = new Map(outline.map((e) => [e.number.toLowerCase(), e]));
  const depth = Math.max(...outline.map((e) => e.number.split(".").length));
  const missed = outline.filter((e) => !got.has(e.number.toLowerCase()));
  const wrongPage = outline.filter((e) => got.has(e.number.toLowerCase()) && e.page && got.get(e.number.toLowerCase())!.page !== e.page);
  const unlisted = sections.filter((s) => !want.has(s.label.toLowerCase()) && s.label.split(".").length <= depth);
  expected += outline.length; found += outline.length - missed.length; extra += unlisted.length;
  rows.push({ sha: file.slice(0, 10), expected: outline.length, found: outline.length - missed.length,
    missed: missed.map((e) => `${e.number} "${e.title.slice(0, 40)}" p${e.page}`),
    wrongPage: wrongPage.map((e) => `${e.number} outline p${e.page} found p${got.get(e.number.toLowerCase())!.page}`),
    unlisted: unlisted.map((s) => `${s.label} p${s.page}`) });
  console.log(`${file.slice(0, 10)}  ${outline.length - missed.length}/${outline.length}  missed: ${missed.map((e) => e.number).join(" ") || "-"}  unlisted: ${unlisted.map((s) => s.label).join(" ") || "-"}${wrongPage.length ? `  wrong page: ${wrongPage.length}` : ""}`);
}
console.log(`\n${rows.length} papers with a numbered outline: found ${found}/${expected} (${(100 * found / Math.max(1, expected)).toFixed(1)}%), ${extra} found at a covered depth that the outline does not list`);
if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1));
