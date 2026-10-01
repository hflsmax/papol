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
// A string instead of a line is drawing operators, put in as they are; a
// fifth item "italic" sets the line in Helvetica-Oblique.
function writtenPdf(lines) {
  const content = lines.map((line) => (typeof line === "string" ? line
    : `BT /${line[4] === "italic" ? "F2" : "F1"} ${line[3] ?? 10} Tf ${line[0]} ${line[1]} Td (${line[2].replace(/[()\\]/g, "\\$&")}) Tj ET`)).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>",
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

  it("ignores a large drop cap whose remaining letters are superscript", async () => {
    const page = writtenPdf([
      [250, 740, "RipTide", 24],
      [50, 708, "A programmable, energy-minimal dataflow compiler and architecture", 18],
      [50, 675, "Graham Gobieski, Souradip Ghosh and Marijn Heule", 10],
      [50, 640, "Abstract", 10],
      // TeX-style drop cap: only the R is on the baseline. The rest of the
      // word is raised and must not make this look like a 26-point title.
      "BT /F1 26 Tf 50 300 Td (R) Tj /F1 10 Tf 7 Ts (ECENT) Tj ET",
    ]);
    const { header } = await headerWithRules(page);
    assert.equal(header.title, "RipTide: A programmable, energy-minimal dataflow compiler and architecture");
    assert.deepEqual(header.authors, ["Graham Gobieski", "Souradip Ghosh", "Marijn Heule"]);
  });

});

// PACMPL's first page, as acmart sets it: the venue is only in the
// ACM reference paragraph and the page foot, and the issue is the
// conference.
const PACMPL_PAGE = writtenPdf([
  [60, 740, "Sparcl: A Language for Partially-Invertible Computation", 16],
  [60, 715, "KAZUTAKA MATSUDA, Tohoku University, Japan", 9],
  [60, 700, "MENG WANG, University of Bristol, UK", 9],
  [60, 670, "Invertibility is a fundamental concept in computer science, with various manifestations."],
  [60, 180, "ACM Reference Format:", 8],
  [60, 170, "Kazutaka Matsuda and Meng Wang. 2020. Sparcl: A Language for Partially-Invertible Computation. Proc. ACM", 8],
  [60, 160, "Program. Lang. 4, ICFP, Article 118 (August 2020), 31 pages. https://doi.org/10.1145/3408990", 8],
  [60, 60, "Proc. ACM Program. Lang., Vol. 4, No. ICFP, Article 118. Publication date: August 2020.", 7],
]);

describe("the venue", () => {
  it("reads a PACMPL paper's issue as its conference, as Crossref keeps it", async () => {
    const { header } = await headerWithRules(PACMPL_PAGE);
    assert.equal(header.journal, "Proceedings of the ACM on Programming Languages (ICFP)");
    assert.equal(header.year, 2020);
    assert.equal(header.doi, "10.1145/3408990");
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
      // Its caption's words after the number, for the nav bar to name it by.
      assert.equal(body.floats[0].title, "A door latch made of cells");
      assert.deepEqual(body.links.map((l) => [l.float, l.label, l.page]), [["f0", "1", 1]]);
    }
  });

  it("reads titleless physics references as authors, venue and year", async () => {
    const pdf = writtenPdf([
      [60, 740, "The mechanism follows earlier work [1]."],
      [60, 300, "References", 12],
      [60, 280, "[1] D. Mamaluy and X. Gao, Appl. Phys. Lett. 106, 193503 (2015)."],
      [60, 265, "[2] K. Proesmans, J. Ehrich, and J. Bechhoefer, Phys. Rev. E 102, 032105 (2020)."],
      [60, 250, "[3] J. Hernandez, E. Kay, and D. R. Leigh, Science 306, 1532 (2004)."],
    ]);
    const references = (await analyzeWithRules(pdf)).analysis.references;
    assert.deepEqual(references.map((r) => ({ title: r.title, authors: r.authors, journal: r.journal, year: r.year })), [
      { title: null, authors: ["D. Mamaluy", "X. Gao"], journal: "Appl. Phys. Lett", year: 2015 },
      { title: null, authors: ["K. Proesmans", "J. Ehrich", "J. Bechhoefer"], journal: "Phys. Rev. E", year: 2020 },
      { title: null, authors: ["J. Hernandez", "E. Kay", "D. R. Leigh"], journal: "Science", year: 2004 },
    ]);
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

  it("links a rule's name in the text to the rule its label stands beside", async () => {
    // Two typing rules, each a bar with premises over it and the conclusion
    // under it, named at the bar's right: "T-App" in faked small capitals
    // ("T-A" at 8pt, "PP" at 6.4pt on one baseline), "(T-Var)" in brackets.
    // A law named at its right, an em from its text: "(RUNIT)". A rule
    // "T-Lam" set left of T-App on the same row, its label a hair from
    // T-App's bar, is not in T-App's box.
    const pdf = writtenPdf([
      [60, 740, "Application is typed by T-App, as [T-Abs] and (T-Var) are, and the"],
      [60, 725, "law (RUNIT) holds. By T-App the argument is checked; see also T-Sub."],
      [22, 600, "x |- e : u"],
      "0 0 0 RG 0.4 w 20 596 m 72 596 l S",
      [22, 585, "G |- x.e"],
      [75, 592, "T-Lam", 8],
      [100, 600, "G |- e1 : t1 -> t2"],
      [220, 600, "G |- e2 : t1"],
      "0 0 0 RG 0.4 w 100 596 m 320 596 l S",
      [150, 585, "G |- e1 e2 : t2"],
      [330, 592, "T-A", 8],
      [342.9, 592, "PP", 6.4],
      [100, 560, "x : t in G"],
      "0 0 0 RG 0.4 w 100 556 m 200 556 l S",
      [110, 545, "G |- x : t"],
      [210, 552, "(T-Var)", 8],
      [100, 500, "m >>= return = m"],
      [189, 500, "(RUNIT)"],
    ]);
    {
      const body = (await analyzeWithRules(pdf)).analysis;
      const rules = body.floats.filter((f) => f.kind === "rule").sort((a, b) => a.label.localeCompare(b.label));
      assert.deepEqual(rules.map((f) => [f.label, f.page]), [["RUNIT", 1], ["T-APP", 1], ["T-Lam", 1], ["T-Var", 1]]);
      const [law, app, lam, variable] = rules;
      // T-App is its bar's width and its label, from its premises at 800 −
      // 608 down to its conclusion at 800 − 575, not the rule under it,
      // nor T-Lam's label three points left of its bar.
      assert.ok(app.x < 100 / 600 && app.x > 96 / 600 && app.x + app.w > 350 / 600 && app.x + app.w < 400 / 600, `T-App is as wide as its bar and label: ${JSON.stringify(app)}`);
      assert.ok(lam.x < 20 / 600 && lam.x + lam.w > 96 / 600 && lam.x + lam.w < 101 / 600, `T-Lam ends at its label: ${JSON.stringify(lam)}`);
      assert.ok(app.y < 192 / 800 && app.y + app.h > 215 / 800 && app.y + app.h < 235 / 800, `T-App is its premises and conclusion: ${JSON.stringify(app)}`);
      assert.ok(variable.y >= 229 / 800 && variable.y + variable.h < 262 / 800, `T-Var is under T-App, apart from it: ${JSON.stringify(variable)}`);
      assert.ok(law.x < 100 / 600 && law.x + law.w > 220 / 600 && law.h < 20 / 800, `the law is its one line: ${JSON.stringify(law)}`);
      // "T-App" twice and "(T-Var)" once, from the text; "[T-Abs]" and
      // "T-Sub" name no rule, and the labels are not mentions of themselves.
      const mentions = body.links.filter((l) => rules.some((r) => r.key === l.float)).map((l) => [l.float, l.label, Math.round(l.y * 800)]);
      assert.deepEqual(mentions, [[app.key, "T-App", 52], [variable.key, "(T-Var)", 52], [law.key, "(RUNIT)", 67], [app.key, "T-App", 67]]);
    }
  });

  it("links a name in the case its label is set in, not the same word in the text's lowercase", async () => {
    // A law named "(DUAL)" in capitals: "the rule DUAL" cites it, and so
    // does "(dual)" set off in italic, but "the rule is exactly the dual
    // of" is the English word, however near "rule" it stands; "the dual
    // rule", with "rule" hard by, is the rule again.
    const pdf = writtenPdf([
      [60, 740, "By the rule DUAL the relation flips; the rule is exactly the dual of"],
      [60, 725, "the one before, as"],
      [150, 725, "(dual)", 10, "italic"],
      [190, 725, "shows."],
      [60, 710, "Finally the dual rule is sound."],
      [100, 500, "m <= n = n >= m"],
      [189, 500, "(DUAL)"],
    ]);
    const body = (await analyzeWithRules(pdf)).analysis;
    const [law] = body.floats.filter((f) => f.kind === "rule");
    assert.equal(law?.label, "DUAL");
    const mentions = body.links.filter((l) => l.float === law.key).map((l) => [l.label, Math.round(l.y * 800)]);
    assert.deepEqual(mentions, [["DUAL", 52], ["(dual)", 67], ["dual", 82]]);
  });

  it("links a bracketed word in capitals listed with a hyphenated name's citation", async () => {
    // "(STORE, LOAD-G)": LOAD-G is cited by its shape, and STORE, set off
    // from it by a comma, with it, though no "rule" stands near.
    const pdf = writtenPdf([
      [60, 740, "Values move to and from main memory (STORE, LOAD-G) as the thread runs."],
      [100, 600, "x : t in G"],
      "0 0 0 RG 0.4 w 100 596 m 200 596 l S",
      [110, 585, "G |- x := v"],
      [210, 592, "(STORE)", 8],
      [100, 540, "x : t in G"],
      "0 0 0 RG 0.4 w 100 536 m 200 536 l S",
      [110, 525, "G |- v := x"],
      [210, 532, "(LOAD-G)", 8],
      [300, 600, "b is empty"],
      "0 0 0 RG 0.4 w 300 596 m 380 596 l S",
      [310, 585, "G |- fence"],
      [390, 592, "(FENCE)", 8],
    ]);
    const body = (await analyzeWithRules(pdf)).analysis;
    const rules = body.floats.filter((f) => f.kind === "rule");
    assert.deepEqual(rules.map((r) => r.label).sort(), ["FENCE", "LOAD-G", "STORE"]);
    const named = (key) => rules.find((r) => r.key === key).label;
    assert.deepEqual(body.links.filter((l) => rules.some((r) => r.key === l.float)).map((l) => [named(l.float), l.label]), [["STORE", "STORE"], ["LOAD-G", "LOAD-G"]]);
  });

  it("names a rule in lowercase or by a bare word beside its bar, and takes no heading or production comment for one", async () => {
    // Small capitals from a text font reach the text layer in lowercase
    // ("s-refl"); Sequent Core names its rules with a bare word beside
    // the bar ("Cut"). "(Kinding)" at the text's right margin, level with
    // the judgement's form, heads the rules, "(value)" comments a grammar
    // production, "sql-01" is a benchmark, and "Max" is a cell over a
    // table's rule: none is a rule.
    const pdf = writtenPdf([
      [60, 740, "By s-refl every type is its own subtype. The Cut rule is admissible, and"],
      [60, 725, "the cut of two proofs, as (value) shows, is cheap; sql-01 runs in a second."],
      [60, 690, "G |- t : k", 10],
      [346, 690, "(Kinding)", 10, "italic"],
      [60, 670, "e ::= v"],
      [160, 670, "(value)"],
      [75, 672, "| e e"],
      [100, 630, "t <: t"],
      [160, 630, "s-refl", 8],
      [100, 590, "G |- e : t"],
      [180, 590, "G, x : t |- f : u"],
      "0 0 0 RG 0.4 w 100 586 m 300 586 l S",
      [150, 575, "G |- f[e/x] : u"],
      [304, 584, "Cut", 8],
      [60, 540, "sql-01"],
      [200, 540, "12.3"],
      [60, 500, "Max"],
      "0 0 0 RG 0.4 w 60 496 m 340 496 l S",
      [60, 485, "42"],
    ]);
    {
      const body = (await analyzeWithRules(pdf)).analysis;
      const rules = body.floats.filter((f) => f.kind === "rule").sort((a, b) => a.label.localeCompare(b.label));
      assert.deepEqual(rules.map((f) => f.label), ["Cut", "s-refl"]);
      const [cut, refl] = rules;
      assert.ok(cut.x < 100 / 600 && cut.x + cut.w > 315 / 600 && cut.y < 210 / 800 && cut.y + cut.h > 225 / 800, `Cut is its premises, bar, conclusion and name: ${JSON.stringify(cut)}`);
      assert.ok(refl.h < 20 / 800, `s-refl is its one line: ${JSON.stringify(refl)}`);
      // "s-refl" and "Cut" beside "rule" from the text; "cut" in prose,
      // "(value)" and "sql-01" name no rule.
      const mentions = body.links.filter((l) => rules.some((r) => r.key === l.float)).map((l) => [l.float, l.label, Math.round(l.y * 800)]);
      assert.deepEqual(mentions, [[refl.key, "s-refl", 52], [cut.key, "Cut", 52]]);
    }
  });

  it("finds a label under a boxed form, over a stack of premises, beside a bracketed word's bar, and takes no heading, listing or grammar word for one", async () => {
    // Kind Inference boxes each judgement form, and the box's bottom edge
    // lies right over "k-var", set mathpar-style over an axiom's bar with
    // nothing else over it. "a-dt-decl" stands over three lines of
    // premises, its bar as wide as the text, the conclusion centred under
    // it. "[sapp]" is a bracketed word beside its bar, cited bare as "the
    // sapp rule"; "[fvar]" is beside its bar with the next rule's bar a
    // few points off, not a group heading. "1 INTRODUCTION" has only a
    // number on its row, "m-bind" is a listing's line in a framed box over
    // a rule it overhangs, and "Syntax" ends a grammar's row: none names
    // a rule.
    const pdf = writtenPdf([
      [60, 740, "The sapp rule splits the environment, and k-var and a-dt-decl are standard"],
      [60, 725, "rules of the declarative system, as the appendix shows at length here."],
      [60, 700, "1 INTRODUCTION"],
      [64, 663, "G |- t : k"],
      "0 0 0 RG 0.4 w 60 672 m 130 672 l S", "0 0 0 RG 0.4 w 60 672 m 60 651 l S", "0 0 0 RG 0.4 w 130 672 m 130 651 l S", "0 0 0 RG 0.4 w 60 651 m 130 651 l S",
      [62, 646, "k-var", 8],
      "0 0 0 RG 0.4 w 62 636 m 100 636 l S",
      [64, 626, "G |- x : k"],
      [205, 600, "a-dt-decl", 8],
      [120, 588, "D, a |- k ~ (a -> *) -| T"],
      [300, 588, "T |- D : t -| T2"],
      [120, 576, "T2, a : k |- e : t"],
      "0 0 0 RG 0.4 w 60 570 m 400 570 l S",
      [176, 558, "D |- data T a = D : t -| T2"],
      "0 0 0 RG 0.4 w 60 520 m 340 520 l S", "0 0 0 RG 0.4 w 60 520 m 60 470 l S", "0 0 0 RG 0.4 w 340 520 m 340 470 l S", "0 0 0 RG 0.4 w 60 470 m 340 470 l S",
      [70, 508, "[m-result identity"],
      [76, 496, "m-bind"],
      [130, 496, "(fn m-result-id [mv f] (f mv)) ; bind"],
      [140, 484, "(fn m-zero [] nil)"],
      "0 0 0 RG 0.4 w 76 462 m 200 462 l S",
      [80, 452, "x = 1"],
      [100, 420, "G1 |- e1 : t1"],
      [200, 420, "G2 |- e2 : t2"],
      "0 0 0 RG 0.4 w 100 416 m 300 416 l S",
      [130, 405, "G1 + G2 |- e1 e2 : t"],
      [306, 413, "[sapp]", 8],
      [100, 380, "x : s in G"],
      "0 0 0 RG 0.4 w 100 376 m 160 376 l S",
      [102, 365, "G |- x : s"],
      [164, 373, "[fvar]", 8],
      [190, 388, "G |- v : s"],
      "0 0 0 RG 0.4 w 186 376 m 260 376 l S",
      [188, 365, "G |- /\\a. v : s"],
      [60, 340, "Syntax"],
      [200, 340, "e ::= x | e e"],
    ]);
    {
      const body = (await analyzeWithRules(pdf)).analysis;
      const rules = body.floats.filter((f) => f.kind === "rule").sort((a, b) => a.label.localeCompare(b.label));
      assert.deepEqual(rules.map((f) => f.label), ["a-dt-decl", "fvar", "k-var", "sapp"]);
      const [decl, , variable] = rules;
      // k-var is its bar, name and conclusion under the box, not the box.
      assert.ok(variable.y > 140 / 800 && variable.y + variable.h < 180 / 800, `k-var is under the boxed form: ${JSON.stringify(variable)}`);
      // a-dt-decl reaches from its name at 800 − 606 over the premises to
      // the conclusion at 800 − 550, across the wide bar.
      assert.ok(decl.y < 196 / 800 && decl.y + decl.h > 240 / 800 && decl.x < 70 / 600 && decl.x + decl.w > 390 / 600, `a-dt-decl is its name, premises, bar and conclusion: ${JSON.stringify(decl)}`);
      const mentions = body.links.filter((l) => rules.some((r) => r.key === l.float)).map((l) => [l.label, Math.round(l.y * 800)]);
      assert.deepEqual(mentions, [["sapp", 52], ["k-var", 52], ["a-dt-decl", 52]]);
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

describe("statements", () => {
  it("marks where theorems, lemmas, definitions and proofs open, and not a sentence that names one", async () => {
    const pdf = writtenPdf([
      [60, 700, "Definition 1 (Typing). A term is typed when it is.", 10, "italic"],
      [60, 680, "Theorem 2. Every typed term halts.", 10, "italic"],
      [60, 660, "Proof. By induction on the typing derivation."],
      [60, 640, "Proposition 3. It is decidable.", 10, "italic"],
      [60, 620, "Lemma 4 (Weakening): Extra variables do no harm.", 10, "italic"],
      [60, 600, "Theorem 2 shows that typed terms halt, which the text goes on to use."],
      [60, 580, "Lemma 4. Said in the text's own face, with the text's upright words after it."],
    ]);
    const { analysis } = await analyzeWithRules(pdf);
    const found = analysis.floats.filter((f) => ["theorem", "lemma", "definition", "proof"].includes(f.kind)).map((f) => [f.kind, f.label]);
    assert.deepEqual(found, [["definition", "Definition 1"], ["theorem", "Theorem 2"], ["proof", "Proof"], ["theorem", "Proposition 3"], ["lemma", "Lemma 4"]]);
    // What each is about, for the nav bar to name it by: the name in
    // brackets, else the words it opens with; a proof by its head alone.
    const titles = analysis.floats.filter((f) => ["theorem", "lemma", "definition", "proof"].includes(f.kind)).map((f) => f.title);
    assert.deepEqual(titles, ["Typing", "Every typed term halts", undefined, "It is decidable", "Weakening"]);
  });
});
