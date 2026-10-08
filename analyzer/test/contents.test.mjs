// A paper's contents read off its printed headings (contents.ts), on PDFs
// written here: what the viewer's Navigator falls back on when a PDF has no
// outline. How it does on real papers is scripts/contents.ts's to measure.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";
import { getDocumentProxy, getResolvedPDFJS } from "unpdf";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(os.tmpdir(), `papol-rules-contents-${process.pid}.mjs`);
await esbuild.build({
  stdin: { contents: 'export { readContents } from "./contents";', resolveDir: path.join(here, "../src/rules"), loader: "ts" },
  outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
const { readContents } = await import(pathToFileURL(out).href);
const { OPS } = await getResolvedPDFJS();

const TEXT = "The quick brown fox jumps over the lazy dog while the committee reads its report aloud";

// Pages written here, each a list of lines from the top: a string is a line
// of text; [text, size, bold] a line in Helvetica, bold in Helvetica-Bold
// ([text, size, bold, true] set straight below the line before, as a
// heading's wrapped title is);
// { at: x, text } is set on the line before, further right.
function writtenPdf(pages) {
  const contents = pages.map((lines) => {
    let y = 760;
    const ops = [];
    for (const line of lines) {
      if (line && typeof line === "object" && !Array.isArray(line)) {
        ops.push(`BT /F1 10 Tf ${line.at} ${y + 14} Td (${line.text}) Tj ET`);
        continue;
      }
      const [text, size = 10, bold = false, wrapped = false] = typeof line === "string" ? [line] : line;
      if ((size > 10 || bold) && !wrapped) y -= 6;
      ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf 60 ${y} Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`);
      y -= size + 4;
    }
    return ops.join("\n");
  });
  const n = pages.length;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + 2 * i} 0 R`).join(" ")}] /Count ${n} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  contents.forEach((content, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents ${6 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const text = (count) => Array.from({ length: count }, () => TEXT);

async function contentsOf(pages, options) {
  const doc = await getDocumentProxy(writtenPdf(pages));
  try {
    return await readContents(doc, OPS, options);
  } finally {
    await doc.destroy?.();
  }
}
const named = (headings) => headings.map((h) => [h.number, h.title, h.level, h.page]);

test("a numbered paper: its sections and subsections in order, with the headings it leaves unnumbered", async () => {
  const headings = await contentsOf([
    [["A Study of Things", 18, true], ...text(3), ["Abstract", 10, true], ...text(5), ["1 Introduction", 12, true], ...text(12), ["2 Method", 12, true], ...text(8)],
    [["2.1 Setup", 10, true], ...text(8), ["3 Results", 12, true], ...text(10), ["4 Conclusion", 12, true], ...text(6), ["References", 12, true],
      "[1] A. Author. A title of a paper. Journal of Things, 2001.",
      "[2] B. Author. Another title of a paper. Journal of Things, 2003.",
      "[3] C. Author. A third title of a paper. Journal of Things, 2005."],
  ]);
  assert.deepEqual(named(headings), [
    ["", "Abstract", 0, 1],
    ["1", "Introduction", 0, 1],
    ["2", "Method", 0, 1],
    ["2.1", "Setup", 1, 2],
    ["3", "Results", 0, 2],
    ["4", "Conclusion", 0, 2],
    ["", "References", 0, 2],
  ]);
  // Where each is printed: its top, as a fraction of the page from the top.
  assert.ok(headings[1].top > headings[0].top && headings[1].top < 1);
});

test("a bold numbered line out of the paper's count is a list item, not a section (section.in-sequence)", async () => {
  const headings = await contentsOf([
    [["1 Introduction", 12, true], ...text(8), ["2 Method", 12, true], ...text(6), ["7 Things we noticed on the way", 10, true], ...text(3), ["3 Results", 12, true], ...text(6)],
  ]);
  assert.deepEqual(headings.map((h) => h.number), ["1", "2", "3"]);
});

test("a heading too long for its column carries its title onto the next line (section.title-wraps)", async () => {
  const headings = await contentsOf([
    [["1 Introduction", 12, true], ...text(8), ["2 Go", 12, true], ["Concurrency and Call Graph Enrichment", 12, true, true], ...text(6),
      ["3 Results.", 12, true], ["Not part of the title", 12, true, true], ...text(6)],
  ]);
  assert.deepEqual(headings.map((h) => h.title), ["Introduction", "Go Concurrency and Call Graph Enrichment", "Results."]);
});

test("one numbered line is no numbering: an affiliation is not a section", async () => {
  const headings = await contentsOf([
    [["1 University of Somewhere", 12, true], ...text(10), ["Summary", 12, true], ...text(10), ["Statement of need", 12, true], ...text(10)],
  ]);
  assert.deepEqual(named(headings), [["", "Summary", 0, 1], ["", "Statement of need", 0, 1]]);
});

test("a paper that numbers none: the named headings, and the lines set as they are (section.unnumbered-style)", async () => {
  const headings = await contentsOf([
    [["Keywords", 11, true], ...text(3), ["Introduction", 11, true], ...text(10), ["Graphene growth on copper", 11, true], ...text(10),
      ["This line is bold but it ends as a sentence does.", 11, true], ...text(4)],
    [["Discussion", 11, true], ...text(10), ["Methods", 11, true], ...text(10)],
  ]);
  assert.deepEqual(headings.map((h) => h.title), ["Introduction", "Graphene growth on copper", "Discussion", "Methods"]);
});

test("a magazine that names only its references: the lines set as that heading is, one nearly the measure wide (section.unnumbered-style)", async () => {
  const headings = await contentsOf([
    [...text(10), ["Maxwell and Szilard", 11, true], ...text(10), ["Dancing with the demon", 11, true], ...text(10)],
    [["From experiments to the applications of erasure in machines and cells", 11, true], ...text(10), ["References", 11, true], ...text(4)],
  ]);
  assert.deepEqual(headings.map((h) => h.title), ["Maxwell and Szilard", "Dancing with the demon", "From experiments to the applications of erasure in machines and cells", "References"]);
});

test("one named heading and one line in its style are not yet a style", async () => {
  const headings = await contentsOf([
    [...text(10), ["Maxwell and Szilard", 11, true], ...text(10), ["References", 11, true], ...text(4)],
  ]);
  assert.deepEqual(headings.map((h) => h.title), ["References"]);
});

test("a paper whose headings are not set apart from its text has none", async () => {
  const headings = await contentsOf([
    ["Introduction", ...text(10), "Some Further Words", ...text(10), "Discussion", ...text(10)],
  ]);
  assert.deepEqual(headings, []);
});

test("a contents on the title page lists the headings; the headings are where they are printed (section.contents-page)", async () => {
  const headings = await contentsOf([
    [["A Long Report", 18, true], ["1 Introduction", 10, true], { at: 520, text: "2" }, ["2 Method", 10, true], { at: 520, text: "2" },
      ["3 Results", 10, true], { at: 520, text: "3" }, ...text(10)],
    [...text(4), ["1 Introduction", 12, true], ...text(10), ["2 Method", 12, true], ...text(10)],
    [...text(4), ["3 Results", 12, true], ...text(10)],
  ]);
  assert.deepEqual(headings.map((h) => [h.number, h.page]), [["1", 2], ["2", 2], ["3", 3]]);
});

test("reading stops between pages once cancelled, and gives way before each", async () => {
  let pauses = 0;
  const pages = [[["1 Introduction", 12, true], ...text(10)], [["2 Method", 12, true], ...text(10)]];
  assert.equal(await contentsOf(pages, { cancelled: () => pauses >= 1, pause: async () => { pauses += 1; } }), null);
  assert.equal(pauses, 1);
});
