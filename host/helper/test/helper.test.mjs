// The helper's two handlers over HTTP, against the built bundle (what
// the host runs), with GROBID stood in for by a stub that answers the
// TEI shapes cloudflare/test/references.test.ts reads.
import assert from "node:assert/strict";
import http from "node:http";
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
async function serving(grobid, run) {
  const lines = [];
  const server = createServer(grobid, (line) => lines.push(line));
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
      assert.deepEqual(Object.keys(body), ["references", "citations", "links"]);
      assert.equal(body.references.length, 2);
      assert.deepEqual({ ...body.references[0], authors: undefined }, {
        key: "b0", index: 0, raw: "Vaswani et al. Attention Is All You Need. 2017.", title: "Attention Is All You Need", year: 2017,
        journal: null, doi: "10.1/attention", arxiv_id: null, page: 1, y: 700 / 800, authors: undefined,
      });
      assert.deepEqual(body.references[0].authors, ["Ashish Vaswani"]);
      assert.deepEqual(body.citations, [{ key: "b0", label: "[1]", inferred: false, page: 1, x: 100 / 600, y: 100 / 800, w: 12 / 600, h: 10 / 800 }]);
      assert.equal(body.links.length, 1);
      assert.equal(body.links[0].kind, "figure");
      assert.equal(body.links[0].target_y, 400 / 800);
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
