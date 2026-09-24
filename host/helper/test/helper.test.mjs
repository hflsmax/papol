// The helper's two handlers over HTTP, against the built bundle (what
// the host runs), with GROBID stood in for by a stub that answers the
// TEI shapes cloudflare/test/references.test.ts reads.
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { createServer, grobidAt, MAX_BODY } from "../dist/helper.js";

const TEI = (body) => `<TEI xmlns="http://www.tei-c.org/ns/1.0">${body}</TEI>`;
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");

const FULLTEXT = TEI(`<facsimile><surface n="1" lrx="600" lry="800"/></facsimile><text><body>
  <p>Prior work <ref type="bibr" coords="1,100,100,12,10" target="#b0">[1]</ref>. See Figure <ref type="figure" target="#fig_0" coords="1,120,160,12,10">2</ref>.</p>
  <figure xml:id="fig_0" coords="1,100,400,300,20"><head>Figure 2:</head><label>2</label></figure></body><back><listBibl>
  <biblStruct xml:id="b0" coords="1,60,700,200,10"><analytic><title level="a" type="main">Attention Is All You Need</title>
    <author><persName><forename>Ashish</forename><surname>Vaswani</surname></persName></author></analytic>
    <monogr><imprint><date when="2017"/></imprint></monogr><idno type="DOI">https://doi.org/10.1/attention</idno>
    <note type="raw_reference">Vaswani et al. Attention Is All You Need. 2017.</note></biblStruct>
  <biblStruct xml:id="b1" coords="1,60,712,200,10"><note type="raw_reference">Knuth D. The art of computer programming.</note></biblStruct>
  </listBibl></back></text>`);

const HEADER = TEI(`<teiHeader><fileDesc><sourceDesc><biblStruct><analytic>
  <title level="a" type="main">THE MEANING OF MEMORY SAFETY</title>
  <author><persName><forename>Arthur</forename><surname>Amorim</surname></persName></author>
  <author><persName><forename>Benjamin C.</forename><surname>Pierce</surname></persName></author>
  <idno type="DOI">10.1007/978-3-319-89722-6_4</idno><idno type="arXiv">arXiv:1705.07354v3</idno>
  </analytic><monogr><title level="j">LNCS</title><imprint><date type="published" when="2018-04-06"/></imprint></monogr>
  </biblStruct></sourceDesc></fileDesc></teiHeader>`);

// A helper on a port of its own, GROBID answering as told, every request
// logged where the test can read it.
async function serving(grobid, run, options = {}) {
  const lines = [];
  const server = createServer(grobid, (line) => lines.push(line), options);
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

const seen = (calls) => ({
  fulltext: async (pdf) => { calls.push(["fulltext", pdf.length]); return FULLTEXT; },
  header: async (pdf) => { calls.push(["header", pdf.length]); return HEADER; },
});

describe("POST /analyze", () => {
  it("runs the PDF through GROBID and answers the references, markers and links as the Worker's parser reads them", async () => {
    const calls = [];
    await serving(seen(calls), async (post, lines) => {
      const { status, body } = await post("/analyze", PDF);
      assert.equal(status, 200);
      assert.deepEqual(calls, [["fulltext", PDF.length]]);
      assert.deepEqual(Object.keys(body), ["references", "citations", "floats", "links"]);
      assert.equal(body.references.length, 2);
      assert.deepEqual({ ...body.references[0], authors: undefined }, {
        key: "b0", index: 0, raw: "Vaswani et al. Attention Is All You Need. 2017.", title: "Attention Is All You Need", year: 2017,
        journal: null, doi: "10.1/attention", arxiv_id: null, page: 1, y: 700 / 800, authors: undefined,
      });
      assert.deepEqual(body.references[0].authors, ["Ashish Vaswani"]);
      assert.deepEqual(body.citations, [{ key: "b0", label: "[1]", inferred: false, page: 1, x: 100 / 600, y: 100 / 800, w: 12 / 600, h: 10 / 800 }]);
      assert.equal(body.links.length, 1);
      const float = body.floats.find((f) => f.key === body.links[0].float);
      assert.equal(float.kind, "figure");
      assert.equal(float.y, 400 / 800);
      assert.equal(lines.length, 1);
      assert.match(lines[0], /^\S+ POST \/analyze 200 \d+B \d+ms$/);
    });
  });

  it("refuses a body that is not a PDF before asking GROBID, and one over the limit", async () => {
    const calls = [];
    await serving(seen(calls), async (post) => {
      const { status, body } = await post("/analyze", "just some text");
      assert.equal(status, 400);
      assert.deepEqual(body, { detail: "The body is not a PDF" });
      assert.deepEqual(calls, []);
      assert.equal(MAX_BODY, 100 * 1024 * 1024);
    });
  });

  it("answers 502 with GROBID's reason when it says nothing, fails, or is down", async () => {
    // Through the real GROBID client. A client pointed at nothing: the
    // connection is refused, which is "down", and must be a 502 with a
    // reason rather than a crash.
    await serving(grobidAt("http://127.0.0.1:1"), async (post) => {
      const { status, body } = await post("/analyze", PDF);
      assert.equal(status, 502);
      assert.match(body.detail, /^GROBID unreachable: /);
    });
    // GROBID answering 204 (no text) and 500: the sentence the Worker
    // records on the paper, and the log line carrying it.
    for (const [statusCode, detail] of [[204, "GROBID could not read this PDF (no text extracted)"], [500, "GROBID returned 500"]]) {
      const fake = http.createServer((_request, response) => { response.writeHead(statusCode); response.end(); });
      await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
      try {
        await serving(grobidAt(`http://127.0.0.1:${fake.address().port}`), async (post, lines) => {
          const { status, body } = await post("/header", PDF);
          assert.equal(status, 502);
          assert.deepEqual(body, { detail });
          assert.match(lines[0], new RegExp(`POST /header 502 \\d+B \\d+ms ${detail.replace(/[()]/g, "\\$&")}$`));
        });
      } finally {
        await new Promise((resolve) => fake.close(resolve));
      }
    }
  });
});

// A one-page PDF written here, line by line in Helvetica at 10pt: enough
// for the rules to find a caption, a mention of it, citations and a
// bibliography of three entries (fewer is not taken for a bibliography).
function writtenPdf(lines) {
  const content = lines.map(([x, y, text, size = 10]) => `BT /F1 ${size} Tf ${x} ${y} Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
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

describe("POST /analyze-rules", () => {
  it("reads the references, citations and figure links by rules, without GROBID", async () => {
    const calls = [];
    const pdf = writtenPdf([
      [60, 740, "Mechanisms were studied before [1], and again [2]."],
      [60, 725, "The latch is shown in Figure 1 below, as in [1, 2]."],
      [60, 500, "Figure 1: A door latch made of cells."],
      [60, 300, "References", 12],
      [60, 280, "[1] Alexandra Ion. 2016. Metamaterial Mechanisms. In Proc. UIST."],
      [60, 265, "[2] Ludwig Wall. 2017. Digital Mechanical Metamaterials. In Proc. CHI."],
      [60, 250, "[3] Robert Kovacs. 2018. Trussformer. In Proc. CHI."],
    ]);
    await serving(seen(calls), async (post, lines) => {
      const { status, body } = await post("/analyze-rules", pdf);
      assert.equal(status, 200);
      assert.deepEqual(calls, [], "GROBID is never asked");
      assert.deepEqual(Object.keys(body), ["references", "citations", "floats", "links"]);
      assert.deepEqual(body.references.map((r) => [r.key, r.year, r.title]), [
        ["b0", 2016, "Metamaterial Mechanisms"], ["b1", 2017, "Digital Mechanical Metamaterials"], ["b2", 2018, "Trussformer"],
      ]);
      assert.deepEqual(body.citations.map((c) => [c.key, c.label]), [["b0", "[1]"], ["b1", "[2]"], ["b0", "[1, 2]"], ["b1", "[1, 2]"]]);
      assert.deepEqual(body.floats.map((f) => [f.key, f.kind, f.label, f.page]), [["f0", "figure", "1", 1]]);
      assert.deepEqual(body.links.map((l) => [l.float, l.label, l.page]), [["f0", "1", 1]]);
      assert.match(lines[0], /^\S+ POST \/analyze-rules 200 \d+B \d+ms$/);
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
    await serving(seen([]), async (post) => {
      const { status, body } = await post("/analyze-rules", pdf);
      assert.equal(status, 200);
      const notes = body.floats.filter((f) => f.kind === "footnote");
      assert.deepEqual(notes.map((f) => [f.label, f.page]), [["1", 1]]);
      assert.deepEqual(body.links.filter((l) => l.float === notes[0].key).map((l) => [l.label, l.page]), [["1", 1]]);
    });
  });

  it("refuses a body that is not a PDF", async () => {
    await serving(seen([]), async (post) => {
      const { status, body } = await post("/analyze-rules", "just some text");
      assert.equal(status, 400);
      assert.deepEqual(body, { detail: "The body is not a PDF" });
    });
  });
});

describe("POST /header", () => {
  it("reads the title block with its identifiers, undoing all-caps styling", async () => {
    const calls = [];
    await serving(seen(calls), async (post) => {
      const { status, body } = await post("/header", PDF);
      assert.equal(status, 200);
      assert.deepEqual(calls, [["header", PDF.length]]);
      assert.deepEqual(body, {
        title: "The Meaning of Memory Safety", authors: ["Arthur Amorim", "Benjamin C. Pierce"], journal: "LNCS", year: 2018,
        doi: "10.1007/978-3-319-89722-6_4", arxiv_id: "1705.07354v3",
      });
    });
  });

  it("sends GROBID the consolidated-header form and the full-text form the Worker used to send", async () => {
    const forms = [];
    const fake = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("latin1");
      const fields = [...body.matchAll(/name="([^"]+)"(?:; filename="[^"]*")?\r\n(?:[^\r\n]*\r\n)?\r\n([^\r]*)/g)].map((m) => [m[1], m[1] === "input" ? "<pdf>" : m[2]]);
      forms.push([request.url, fields]);
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(request.url.includes("Header") ? HEADER : FULLTEXT);
    });
    await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
    try {
      await serving(grobidAt(`http://127.0.0.1:${fake.address().port}/`), async (post) => {
        assert.equal((await post("/header", PDF)).status, 200);
        assert.equal((await post("/analyze", PDF)).status, 200);
      });
    } finally {
      await new Promise((resolve) => fake.close(resolve));
    }
    assert.deepEqual(forms, [
      ["/api/processHeaderDocument", [["input", "<pdf>"], ["consolidateHeader", "1"]]],
      ["/api/processFulltextDocument", [["input", "<pdf>"], ["teiCoordinates", "ref"], ["teiCoordinates", "biblStruct"], ["teiCoordinates", "figure"],
        ["includeRawCitations", "1"], ["consolidateCitations", "0"], ["consolidateHeader", "0"]]],
    ]);
  });
});

describe("the rest", () => {
  it("answers health, and refuses unknown paths and other methods", async () => {
    await serving(seen([]), async (post) => {
      assert.deepEqual(await post("/health", undefined, { method: "GET" }), { status: 200, body: { ok: true } });
      assert.equal((await post("/elsewhere", PDF)).status, 404);
      assert.equal((await post("/analyze", undefined, { method: "GET" })).status, 405);
    });
  });
});

// A bucket domain stood in for on a port of its own: each paper under its
// own name, and one file whose bytes are not what its name says.
const DIGEST = createHash("sha256").update(PDF).digest("hex");
const IMPOSTOR = "f".repeat(64);
async function bucket(run) {
  const asked = [];
  const server = http.createServer((request, response) => {
    asked.push([request.url, request.headers["user-agent"]]);
    if (request.url === `/uploads/${DIGEST}.pdf` || request.url === `/uploads/${IMPOSTOR}.pdf`) {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end(request.url.includes(IMPOSTOR) ? Buffer.from("%PDF-1.4 something else") : Buffer.from(PDF));
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
      const calls = [];
      await serving(seen(calls), async (post) => {
        const analyzed = await post("/analyze", named(`${origin}/uploads/${DIGEST}.pdf`), json);
        assert.equal(analyzed.status, 200);
        assert.equal(analyzed.body.references.length, 2);
        const header = await post("/header", named(`${origin}/uploads/${DIGEST}.pdf`), json);
        assert.equal(header.body.title, "The Meaning of Memory Safety");
        assert.deepEqual(calls, [["fulltext", PDF.length], ["header", PDF.length]]);
      }, { fileOrigins: [origin] });
      assert.deepEqual(asked, [[`/uploads/${DIGEST}.pdf`, "papol-helper"], [`/uploads/${DIGEST}.pdf`, "papol-helper"]]);
    });
  });

  it("fetches only a paper's address on a bucket domain it was told of", async () => {
    await bucket(async (origin, asked) => {
      await serving(seen([]), async (post) => {
        for (const [url, detail] of [
          [`http://127.0.0.1:1/uploads/${DIGEST}.pdf`, "The helper does not fetch from http://127.0.0.1:1"],
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
      const calls = [];
      await serving(seen(calls), async (post) => {
        const impostor = await post("/analyze", named(`${origin}/uploads/${IMPOSTOR}.pdf`), json);
        assert.deepEqual(impostor, { status: 422, body: { detail: "The file does not hash to its name" } });
        const missing = await post("/analyze", named(`${origin}/uploads/${"0".repeat(64)}.pdf`), json);
        assert.deepEqual(missing, { status: 404, body: { detail: "The bucket has no file at that address" } });
        assert.deepEqual(calls, []);
      }, { fileOrigins: [origin] });
    });
  });

  it("knows the production and dev bucket domains unless told otherwise", async () => {
    const { fileOriginsFrom } = await import("../dist/helper.js");
    assert.deepEqual(fileOriginsFrom(undefined), ["https://files.papol.io", "https://files-dev.papol.io"]);
    assert.deepEqual(fileOriginsFrom(" https://a.test/ ,https://b.test"), ["https://a.test", "https://b.test"]);
  });
});
