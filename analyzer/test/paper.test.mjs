// The rules on PDFs written here: a title block, and a page's references,
// markers, figures and footnotes, as the viewer reads them (paper.ts) and
// the scripts measure them (analyze.ts).
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(os.tmpdir(), `papol-rules-paper-${process.pid}.mjs`);
await esbuild.build({
  stdin: { contents: 'export { analyzeWithRules, headerWithRules } from "./analyze";', resolveDir: path.join(here, "../src/rules"), loader: "ts" },
  outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
const { analyzeWithRules, headerWithRules } = await import(pathToFileURL(out).href);

// A one-page PDF written here, line by line in Helvetica at 10pt: enough
// for the rules to find a caption, a mention of it, citations and a
// bibliography of three entries (fewer is not taken for a bibliography).
// A string instead of a line is drawing operators, put in as they are.
function writtenPdf(lines) {
  const content = lines.map((line) => (typeof line === "string" ? line
    : `BT /F1 ${line[3] ?? 10} Tf ${line[0]} ${line[1]} Td (${line[2].replace(/[()\\]/g, "\\$&")}) Tj ET`)).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const TITLE_PAGE = writtenPdf([
  [60, 740, "Metamaterial Mechanisms", 20],
  [60, 712, "Alexandra Ion, Johannes Frohnhofen and Patrick Baudisch", 11],
  [60, 698, "Hasso Plattner Institute, Potsdam, Germany", 9],
  [60, 660, "Abstract", 11],
  [60, 645, "Metamaterials are designed to exhibit unusual behavior, which we turn into mechanisms."],
  [60, 120, "Published online: 16 October 2016. https://doi.org/10.1145/2984511.2984540", 8],
]);

describe("the title block", () => {
  it("reads the title block: the largest line, the names under it, the printed DOI and date", async () => {
    {
      const body = (await headerWithRules(TITLE_PAGE)).header;
      assert.deepEqual(body, {
        title: "Metamaterial Mechanisms", authors: ["Alexandra Ion", "Johannes Frohnhofen", "Patrick Baudisch"],
        journal: null, year: 2016, doi: "10.1145/2984511.2984540", arxiv_id: null,
      });
    }
  });

});

describe("the paper", () => {
  it("reads the references, citations and figure links", async () => {
    const pdf = writtenPdf([
      [60, 740, "Mechanisms were studied before [1], and again [2]."],
      [60, 725, "The latch is shown in Figure 1 below, as in [1, 2]."],
      [60, 500, "Figure 1: A door latch made of cells."],
      [60, 300, "References", 12],
      [60, 280, "[1] Alexandra Ion. 2016. Metamaterial Mechanisms. In Proc. UIST."],
      [60, 265, "[2] Ludwig Wall. 2017. Digital Mechanical Metamaterials. In Proc. CHI."],
      [60, 250, "[3] Robert Kovacs. 2018. Trussformer. In Proc. CHI."],
    ]);
    {
      const body = (await analyzeWithRules(pdf)).analysis;
      assert.deepEqual(Object.keys(body), ["references", "citations", "floats", "links"]);
      assert.deepEqual(body.references.map((r) => [r.key, r.year, r.title]), [
        ["b0", 2016, "Metamaterial Mechanisms"], ["b1", 2017, "Digital Mechanical Metamaterials"], ["b2", 2018, "Trussformer"],
      ]);
      // One citation a marker: "[1, 2]" names two works and is one thing.
      assert.deepEqual(body.citations.map((c) => [c.keys, c.label, c.boxes.length]), [
        [["b0"], "[1]", 1], [["b1"], "[2]", 1], [["b0", "b1"], "[1, 2]", 1],
      ]);
      assert.deepEqual(body.floats.map((f) => [f.key, f.kind, f.label, f.page]), [["f0", "figure", "1", 1]]);
      assert.deepEqual(body.links.map((l) => [l.float, l.label, l.page]), [["f0", "1", 1]]);
    }
  });

  // "Matsuda et al. | 2007", "[1, | 2]": a marker the line breaks inside.
  const WRAPPED = writtenPdf([
    [60, 740, "Mechanisms were studied before [1], and again [2]."],
    [60, 725, "The latch is shown in Figure 1 below, as in [1,"],
    [60, 712, "2], and as the survey [3] says."],
    [60, 500, "Figure 1: A door latch made of cells."],
    [60, 300, "References", 12],
    [60, 280, "[1] Alexandra Ion. 2016. Metamaterial Mechanisms. In Proc. UIST."],
    [60, 265, "[2] Ludwig Wall. 2017. Digital Mechanical Metamaterials. In Proc. CHI."],
    [60, 250, "[3] Robert Kovacs. 2018. Trussformer. In Proc. CHI."],
  ]);

  it("answers a marker broken over a line as one citation, a box for each line", async () => {
    {
      const body = (await analyzeWithRules(WRAPPED)).analysis;
      const wrapped = body.citations.filter((c) => c.label === "[1, 2]");
      assert.equal(wrapped.length, 1);
      assert.deepEqual(wrapped[0].keys, ["b0", "b1"]);
      const [end, start] = wrapped[0].boxes;
      assert.equal(wrapped[0].boxes.length, 2);
      // "[1," ends the first line; "2]" starts the second, below and to the left.
      assert.ok(start.y > end.y && start.x < end.x);
      assert.ok([end, start].every((box) => box.page === 1));
      // And "[3]", after it on the second line, is a citation of its own.
      assert.deepEqual(body.citations.filter((c) => c.label === "[3]").map((c) => [c.keys, c.boxes.length]), [[["b2"], 1]]);
    }
  });

  it("links a footnote mark to its note at the foot of the page", async () => {
    const pdf = writtenPdf([
      [60, 500, "Iteration is possible by compiling programs to linear neurons"],
      [326.5, 504, "1", 7],
      [60, 485, "and this lets us express differentiable algorithms with structure."],
      [60, 470, "The rest of the paragraph carries on at the size of the text here."],
      [60, 120, "1", 6],
      [65, 117, "Linear neurons are essentially linear maps.", 8],
    ]);
    {
      const body = (await analyzeWithRules(pdf)).analysis;
      const notes = body.floats.filter((f) => f.kind === "footnote");
      assert.deepEqual(notes.map((f) => [f.label, f.page]), [["1", 1]]);
      assert.deepEqual(body.links.filter((l) => l.float === notes[0].key).map((l) => [l.label, l.page]), [["1", 1]]);
    }
  });

  it("does not take a mention wrapped onto a line's start for a caption (caption.not-wrapped)", async () => {
    // "…as shown in / Fig. 2. Most passes…": the paragraph runs on into the
    // line. Fig. 2 is the real caption further down, under its drawing.
    const pdf = writtenPdf([
      [60, 740, "The lemmas that preserve the stack across the passes are shown in"],
      [60, 728, "Fig. 2. Most passes keep the stack structure at every point of the run."],
      [60, 716, "For these passes the injection is a list of ones."],
      "0 0 0 RG 1 w 100 400 m 300 560 l S 100 560 m 300 400 l S",
      [60, 380, "Fig. 2: The stack injections of the passes."],
    ]);
    {
      const body = (await analyzeWithRules(pdf)).analysis;
      const figure = body.floats.find((f) => f.kind === "figure" && f.label === "2");
      assert.ok(figure, "Fig. 2 is found");
      // Its caption is at 800 − 380 = 420 from the top, and its drawing over it.
      assert.ok(figure.y > 0.25 && figure.y + figure.h > 0.52, `Fig. 2 is the drawing and its caption, not the paragraph: ${JSON.stringify(figure)}`);
    }
  });

  it("keeps a caption whole past a legend's swatch drawn in its text", async () => {
    // A short line drawn between the caption's lines ("(red line)") is a
    // swatch, not the rule under an algorithm's caption.
    const pdf = writtenPdf([
      "0 0 0 RG 1 w 150 460 m 250 540 l S",
      [60, 420, "Figure 1: The pattern with the standard fold (red line) and the"],
      "1 0 0 RG 1 w 200 414 m 220 414 l S",
      [60, 408, "variant (blue line) as particular cases of the family."],
      [60, 300, "Figure 1 shows the pattern. Its folds are set by one parameter only."],
    ]);
    {
      const body = (await analyzeWithRules(pdf)).analysis;
      const figure = body.floats.find((f) => f.kind === "figure" && f.label === "1");
      // The caption's second line sits at 800 − 408 = 392 from the top.
      assert.ok(figure && figure.y + figure.h >= 395 / 800, `Figure 1 keeps its second caption line: ${JSON.stringify(figure)}`);
    }
  });
});
