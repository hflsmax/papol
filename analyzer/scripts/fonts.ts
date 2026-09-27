// Every font name in a folder of PDFs, with how it is read: bold, italic.
//   node scripts/run-script.mjs fonts <pdf dir>
import fs from "node:fs";
import path from "node:path";
import { readPdf } from "../src/rules/pdf";

const [dir] = process.argv.slice(2);
const seen = new Map<string, { bold: boolean; italic: boolean; chars: number; papers: Set<string> }>();
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".pdf"))) {
  const doc = await readPdf(new Uint8Array(fs.readFileSync(path.join(dir, file))));
  for (const page of doc.pages) for (const r of page.runs) {
    const s = seen.get(r.font) ?? { bold: r.bold, italic: r.italic, chars: 0, papers: new Set<string>() };
    s.chars += r.text.length; s.papers.add(file.slice(0, 10));
    seen.set(r.font, s);
  }
}
for (const [font, s] of [...seen].sort((a, b) => b[1].chars - a[1].chars)) {
  console.log(`${font}\t${s.bold ? "bold" : "-"}\t${s.italic ? "italic" : "-"}\t${s.chars}\t${[...s.papers].slice(0, 3).join(",")}`);
}
