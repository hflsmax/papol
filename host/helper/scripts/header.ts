// The title-block reader against the papers Papol already holds: each
// field the rules read, beside GROBID's header and scored against the
// paper's row in production — title, authors, year, journal, DOI as the
// uploader saved them, most looked up in Crossref.
//   node scripts/run-script.mjs header <dir> [sha-prefix]
// <dir> holds <sha256>.pdf, truth.json (the `papers` rows: sha256, title,
// authors as a list, journal, year, doi) and, to compare, grobid-header.tsv
// ("<sha256>\t<the helper's /header JSON>" per line). docs/rule-analyzer.md
// says how to fetch them. A field the row leaves empty is not scored.
import fs from "node:fs";
import path from "node:path";
import { headerWithRules } from "../src/rules/header";
import { normalizeName } from "../src/rules/bibliography";
import { arxivDoi } from "../../../cloudflare/src/papers/identifiers";
import type { HeaderMetadata } from "../../../cloudflare/src/papers/tei";

type Truth = { sha256: string; title: string | null; authors: string[]; journal: string | null; year: number | null; doi: string | null };

const [dir, only = ""] = process.argv.slice(2);
const truth: Truth[] = JSON.parse(fs.readFileSync(path.join(dir, "truth.json"), "utf8"));
const grobid = new Map<string, HeaderMetadata>();
const tsv = path.join(dir, "grobid-header.tsv");
if (fs.existsSync(tsv)) {
  for (const line of fs.readFileSync(tsv, "utf8").split("\n")) {
    const [sha, json] = line.split("\t");
    try { if (sha && json) grobid.set(sha, JSON.parse(json)); } catch { /* an error answer */ }
  }
}

const words = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const surname = (name: string) => normalizeName(name.trim().split(/\s+/).pop() ?? "");
function titleScore(got: string | null, want: string): number {
  if (!got) return 0;
  const a = new Set(words(got).split(" ")), b = new Set(words(want).split(" "));
  const common = [...a].filter((w) => b.has(w)).length;
  return (2 * common) / (a.size + b.size);
}
function authorScore(got: string[], want: string[]): { p: number; r: number } {
  const g = got.map(surname), w = want.map(surname);
  const hit = g.filter((s) => w.includes(s)).length;
  return { p: g.length ? hit / g.length : 0, r: w.length ? w.filter((s) => g.includes(s)).length / w.length : 1 };
}
const doiOf = (h: HeaderMetadata | undefined) => (h?.arxiv_id ? arxivDoi(h.arxiv_id) : h?.doi ?? null)?.toLowerCase() ?? null;
const journalOk = (got: string | null, want: string) => !!got && titleScore(got, want) >= 0.7;

type Tally = Record<string, { n: number; ok: number }>;
const tally = (): Tally => ({ title: { n: 0, ok: 0 }, authors: { n: 0, ok: 0 }, year: { n: 0, ok: 0 }, journal: { n: 0, ok: 0 }, doi: { n: 0, ok: 0 } });
const rules = tally(), theirs = tally();
function score(t: Tally, h: HeaderMetadata | undefined, want: Truth): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {};
  const add = (field: string, has: boolean, ok: boolean) => { if (!has) { out[field] = null; return; } t[field].n += 1; if (ok) t[field].ok += 1; out[field] = ok; };
  // A row may keep the title without its subtitle, as Crossref does.
  const main = (h?.title ?? "").split(/:\s/)[0];
  add("title", !!want.title, titleScore(h?.title ?? null, want.title ?? "") >= 0.9 || titleScore(main, want.title ?? "") >= 0.9);
  const a = authorScore(h?.authors ?? [], want.authors);
  add("authors", want.authors.length > 0, a.p === 1 && a.r === 1);
  add("year", want.year != null, h?.year === want.year);
  add("journal", !!want.journal, journalOk(h?.journal ?? null, want.journal ?? ""));
  // The header gives both; the Worker picks between them.
  add("doi", !!want.doi, [doiOf(h), h?.doi?.toLowerCase()].includes(want.doi?.toLowerCase() ?? null));
  return out;
}

const mark = (v: boolean | null) => (v === null ? "·" : v ? "✓" : "✗");
for (const want of truth) {
  if (!want.sha256.startsWith(only)) continue;
  const file = path.join(dir, `${want.sha256}.pdf`);
  if (!fs.existsSync(file)) continue;
  let got: HeaderMetadata | undefined;
  try { got = (await headerWithRules(new Uint8Array(fs.readFileSync(file)))).header; } catch (e) { console.log(want.sha256.slice(0, 8), "failed:", (e as Error).message); }
  const ours = score(rules, got, want), g = score(theirs, grobid.get(want.sha256), want);
  const row = ["title", "authors", "year", "journal", "doi"].map((f) => `${mark(ours[f])}${mark(g[f])}`).join(" ");
  console.log(`${want.sha256.slice(0, 8)} ${row}  ${(want.title ?? "").slice(0, 50)}`);
  if (only || process.env.VERBOSE) {
    console.log(`   rules : ${JSON.stringify(got)}`);
    console.log(`   grobid: ${JSON.stringify(grobid.get(want.sha256))}`);
    console.log(`   truth : ${JSON.stringify({ title: want.title, authors: want.authors, journal: want.journal, year: want.year, doi: want.doi })}`);
  }
}
console.log("\nfield     rules        grobid   (of papers whose row has the field)");
for (const f of Object.keys(rules)) {
  const pct = (t: { n: number; ok: number }) => `${t.ok}/${t.n}`.padEnd(8) + `${t.n ? Math.round((100 * t.ok) / t.n) : 0}%`.padStart(4);
  console.log(`${f.padEnd(9)} ${pct(rules[f])}   ${pct(theirs[f])}`);
}
