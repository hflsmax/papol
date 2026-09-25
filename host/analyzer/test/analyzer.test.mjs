// The analyzer's two handlers over HTTP, against the built bundle (what
// the host runs), on PDFs written here for the rules to read.
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { createServer, MAX_BODY } from "../dist/analyzer.js";

// An analyzer on a port of its own, every request logged where the test can
// read it.
async function serving(run, options = {}) {
  const lines = [];
  const server = createServer((line) => lines.push(line), options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(async (path, body, init = {}) => {
      const response = await fetch(base + path, { method: "POST", body, headers: { "content-type": "application/pdf" }, ...init });
      return { status: response.status, body: await response.json() };
    }, lines);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

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

// What cloudflare/scripts/smoke.sh uploads: a PDF by its first line, with
// no page in it.
const UNREADABLE = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");

describe("POST /header", () => {
  it("reads the title block: the largest line, the names under it, the printed DOI and date", async () => {
    await serving(async (post, lines) => {
      const { status, body } = await post("/header", TITLE_PAGE);
      assert.equal(status, 200);
      assert.deepEqual(body, {
        title: "Metamaterial Mechanisms", authors: ["Alexandra Ion", "Johannes Frohnhofen", "Patrick Baudisch"],
        journal: null, year: 2016, doi: "10.1145/2984511.2984540", arxiv_id: null,
      });
      assert.match(lines[0], /^\S+ POST \/header 200 \d+B \d+ms$/);
    });
  });

  it("refuses a body that is not a PDF, and one over the limit", async () => {
    await serving(async (post) => {
      const { status, body } = await post("/header", "just some text");
      assert.equal(status, 400);
      assert.deepEqual(body, { detail: "The body is not a PDF" });
      assert.equal(MAX_BODY, 100 * 1024 * 1024);
    });
  });
});

describe("POST /analyze", () => {
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
    await serving(async (post, lines) => {
      const { status, body } = await post("/analyze", pdf);
      assert.equal(status, 200);
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
      assert.match(lines[0], /^\S+ POST \/analyze 200 \d+B \d+ms$/);
    });
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
    await serving(async (post) => {
      const { body } = await post("/analyze", WRAPPED);
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
    });
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
    await serving(async (post) => {
      const { status, body } = await post("/analyze", pdf);
      assert.equal(status, 200);
      const notes = body.floats.filter((f) => f.kind === "footnote");
      assert.deepEqual(notes.map((f) => [f.label, f.page]), [["1", 1]]);
      assert.deepEqual(body.links.filter((l) => l.float === notes[0].key).map((l) => [l.label, l.page]), [["1", 1]]);
    });
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
    await serving(async (post) => {
      const { body } = await post("/analyze", pdf);
      const figure = body.floats.find((f) => f.kind === "figure" && f.label === "2");
      assert.ok(figure, "Fig. 2 is found");
      // Its caption is at 800 − 380 = 420 from the top, and its drawing over it.
      assert.ok(figure.y > 0.25 && figure.y + figure.h > 0.52, `Fig. 2 is the drawing and its caption, not the paragraph: ${JSON.stringify(figure)}`);
    });
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
    await serving(async (post) => {
      const { body } = await post("/analyze", pdf);
      const figure = body.floats.find((f) => f.kind === "figure" && f.label === "1");
      // The caption's second line sits at 800 − 408 = 392 from the top.
      assert.ok(figure && figure.y + figure.h >= 395 / 800, `Figure 1 keeps its second caption line: ${JSON.stringify(figure)}`);
    });
  });

  it("refuses a body that is not a PDF, and answers 422 with the reason for one it cannot read", async () => {
    await serving(async (post, lines) => {
      assert.deepEqual(await post("/analyze", "just some text"), { status: 400, body: { detail: "The body is not a PDF" } });
      // The sentence the Worker records on the paper, and the log line carrying it.
      const { status, body } = await post("/analyze", UNREADABLE);
      assert.equal(status, 422);
      assert.match(body.detail, /^The PDF could not be read: /);
      assert.match(lines[1], /^\S+ POST \/analyze 422 \d+B \d+ms The PDF could not be read: /);
    });
  });
});

describe("the rest", () => {
  it("answers health, and refuses unknown paths — the old -rules names included — and other methods", async () => {
    await serving(async (post) => {
      assert.deepEqual(await post("/health", undefined, { method: "GET" }), { status: 200, body: { ok: true } });
      assert.equal((await post("/elsewhere", TITLE_PAGE)).status, 404);
      assert.equal((await post("/header-rules", TITLE_PAGE)).status, 404);
      assert.equal((await post("/analyze", undefined, { method: "GET" })).status, 405);
    });
  });
});

// A bucket domain stood in for on a port of its own: each paper under its
// own name, and one file whose bytes are not what its name says.
const DIGEST = createHash("sha256").update(TITLE_PAGE).digest("hex");
const IMPOSTOR = "f".repeat(64);
async function bucket(run) {
  const asked = [];
  const server = http.createServer((request, response) => {
    asked.push([request.url, request.headers["user-agent"]]);
    if (request.url === `/uploads/${DIGEST}.pdf` || request.url === `/uploads/${IMPOSTOR}.pdf`) {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end(request.url.includes(IMPOSTOR) ? Buffer.from("%PDF-1.4 something else") : Buffer.from(TITLE_PAGE));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(origin, asked);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("a paper named by its address", () => {
  const json = { headers: { "content-type": "application/json" } };
  const named = (url) => JSON.stringify({ url });

  it("fetches the paper from the bucket and reads it, the Worker sending no bytes", async () => {
    await bucket(async (origin, asked) => {
      await serving(async (post) => {
        const analyzed = await post("/analyze", named(`${origin}/uploads/${DIGEST}.pdf`), json);
        assert.equal(analyzed.status, 200);
        assert.deepEqual(Object.keys(analyzed.body), ["references", "citations", "floats", "links"]);
        const header = await post("/header", named(`${origin}/uploads/${DIGEST}.pdf`), json);
        assert.equal(header.body.title, "Metamaterial Mechanisms");
      }, { fileOrigins: [origin] });
      assert.deepEqual(asked, [[`/uploads/${DIGEST}.pdf`, "papol-analyzer"], [`/uploads/${DIGEST}.pdf`, "papol-analyzer"]]);
    });
  });

  it("fetches only a paper's address on a bucket domain it was told of", async () => {
    await bucket(async (origin, asked) => {
      await serving(async (post) => {
        for (const [url, detail] of [
          [`http://127.0.0.1:1/uploads/${DIGEST}.pdf`, "The analyzer does not fetch from http://127.0.0.1:1"],
          [`${origin}/board_uploads/blobs/${DIGEST}`, "The url is not a paper's address"],
          [`${origin}/uploads/${DIGEST}.pdf?x=1`, "The url is not a paper's address"],
          [`${origin}/uploads/../${DIGEST}.pdf`, "The url is not a paper's address"],
          ["not a url", "The url is not an address"],
          [42, "Send { url } naming a paper's address"],
        ]) {
          const { status, body } = await post("/analyze", named(url), json);
          assert.equal(status, 400, String(url));
          assert.equal(body.detail, detail);
        }
        assert.equal((await post("/analyze", "{not json", json)).status, 400);
      }, { fileOrigins: [origin] });
      assert.deepEqual(asked, []);
    });
  });

  it("refuses a file that does not hash to its name, and says when the bucket has none", async () => {
    await bucket(async (origin) => {
      await serving(async (post) => {
        const impostor = await post("/analyze", named(`${origin}/uploads/${IMPOSTOR}.pdf`), json);
        assert.deepEqual(impostor, { status: 422, body: { detail: "The file does not hash to its name" } });
        const missing = await post("/analyze", named(`${origin}/uploads/${"0".repeat(64)}.pdf`), json);
        assert.deepEqual(missing, { status: 404, body: { detail: "The bucket has no file at that address" } });
      }, { fileOrigins: [origin] });
    });
  });

  it("knows the production and dev bucket domains unless told otherwise", async () => {
    const { fileOriginsFrom } = await import("../dist/analyzer.js");
    assert.deepEqual(fileOriginsFrom(undefined), ["https://files.papol.io", "https://files-dev.papol.io"]);
    assert.deepEqual(fileOriginsFrom(" https://a.test/ ,https://b.test"), ["https://a.test", "https://b.test"]);
  });
});
