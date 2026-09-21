// The bibliography: GROBID's TEI read into references and markers, the
// lookup that turns a printed reference into a work, and the viewer's
// routes.
import { createExecutionContext, createMessageBatch, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import type { Wakeup } from "../src/jobs/run";
import { summarizeOpenalex, type Summary } from "../src/papers/bibliography";
import { bibliographyCard, paperReferences, type Reference } from "../src/papers/references";
import { candidates, merge, resolve, titleMatches } from "../src/papers/resolve";
import { normalizeTitle, parseHeader, parseTei } from "../src/papers/tei";
import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, uuid, type Account, type Json } from "./helpers";

const PDF = "c".repeat(64);
const OTHER = "d".repeat(64);
const TEI = (body: string) => `<TEI xmlns="http://www.tei-c.org/ns/1.0">${body}</TEI>`;

afterEach(() => vi.unstubAllGlobals());

async function woken(...uuids: string[]) {
  const batch = createMessageBatch<Wakeup>("papol-jobs", uuids.map((id) => ({ id: uuid(), timestamp: new Date(), body: { job: id }, attempts: 1 })));
  await worker.queue(batch, env, createExecutionContext());
}

// The services beyond Papol, stood in for by host.
function hosts(answers: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.hostname + url.pathname);
    const answer = answers[url.hostname];
    return answer ? answer(url, init) : new Response("no such host", { status: 502 });
  });
  return calls;
}
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// --------------------------------------------------------------- the TEI

describe("GROBID's TEI", () => {
  it("reads the header, undoing all-caps styling", () => {
    const header = parseHeader(TEI(`<teiHeader><fileDesc><sourceDesc><biblStruct><analytic>
      <title level="a" type="main">THE MEANING OF MEMORY SAFETY</title>
      <author><persName><forename>Arthur</forename><surname>Amorim</surname></persName></author>
      <author><persName><forename>Benjamin C.</forename><surname>Pierce</surname></persName></author>
      </analytic><monogr><title level="j">LNCS</title><imprint><date type="published" when="2018-04-06"/></imprint></monogr>
      </biblStruct></sourceDesc></fileDesc></teiHeader>`));
    expect(header).toEqual({ title: "The Meaning of Memory Safety", authors: ["Arthur Amorim", "Benjamin C. Pierce"], journal: "LNCS", year: 2018, doi: null, arxiv_id: null });
    // A consolidated header carries the identifiers CrossRef gave GROBID, bare.
    const identified = parseHeader(TEI(`<teiHeader><fileDesc><sourceDesc><biblStruct><analytic><title level="a" type="main">Attention Is All You Need</title>
      <idno type="DOI">https://doi.org/10.5555/3295222.3295349</idno><idno type="arXiv">arXiv:1706.03762v7</idno><idno type="MD5">abc</idno></analytic></biblStruct></sourceDesc></fileDesc></teiHeader>`));
    expect(identified).toMatchObject({ title: "Attention Is All You Need", doi: "10.5555/3295222.3295349", arxiv_id: "1706.03762v7" });
    expect(normalizeTitle("XGRAMMAR: FLEXIBLE AND EFFICIENT STRUCTURED GENERATION FOR LLMS")).toBe("XGrammar: Flexible and Efficient Structured Generation for LLMS");
    expect(normalizeTitle("Attention Is All You Need")).toBe("Attention Is All You Need");
  });

  it("reads a reference's title, venue, authors, year and identifiers from where GROBID puts them", () => {
    const { references } = parseTei(TEI(`<text><back><listBibl>
      <biblStruct xml:id="b7"><analytic><author><persName><forename>M.</forename><surname>Schenk</surname></persName></author></analytic>
        <monogr><title level="j">Proceedings of the National Academy of Sciences</title><imprint><date when="2013"/></imprint></monogr>
        <note type="raw_reference">M. Schenk, Proceedings of the National Academy of Sciences 110, 3276 (2013).</note></biblStruct>
      <biblStruct xml:id="b3"><analytic><title level="a" type="main">Metamaterial Mechanisms</title>
        <author><persName><forename>Alexandra</forename><surname>Ion</surname></persName></author></analytic>
        <monogr><title level="m">Proceedings of the 29th Annual Symposium on User Interface Software and Technology</title>
        <meeting><address><addrLine>Tokyo, Japan</addrLine></address></meeting><imprint><date when="2016"/></imprint></monogr>
        <idno type="DOI">https://doi.org/10.1145/2984511.2984540</idno>
        <note type="raw_reference">Ion A. Metamaterial Mechanisms. In: Proc. UIST 2016.</note></biblStruct>
      <biblStruct xml:id="b4"><analytic><title level="a" type="main">Sim2Real transfer</title></analytic>
        <monogr><meeting>CoRL 2020<address><addrLine>Cambridge, MA</addrLine></address></meeting><imprint><date when="0190">2016. 190</date></imprint></monogr>
        <note type="raw_reference">Sim2Real transfer. CoRL 2020. arXiv:2010.00001v2</note></biblStruct>
      </listBibl></back></text>`));
    // A journal-only entry: no title, since a venue is not the cited work's title.
    expect(references[0]).toMatchObject({ key: "b7", index: 0, title: null, journal: "Proceedings of the National Academy of Sciences", authors: ["M. Schenk"], year: 2013 });
    // A conference paper: its own title, the proceedings as the venue, the DOI bare.
    expect(references[1]).toMatchObject({ key: "b3", index: 1, title: "Metamaterial Mechanisms", journal: "Proceedings of the 29th Annual Symposium on User Interface Software and Technology", doi: "10.1145/2984511.2984540", year: 2016 });
    // The meeting's own words, not its address; the date's text over a
    // misread @when; the arXiv id from the raw string.
    expect(references[2]).toMatchObject({ key: "b4", journal: "CoRL 2020", year: 2016, arxiv_id: "2010.00001v2" });
  });

  it("places markers as fractions of the page, infers unresolved numbered ones, and tells equation numbers from citations", () => {
    const bracketed = parseTei(TEI(`<facsimile><surface n="4" lrx="600" lry="800"/></facsimile><text><body>
      <p>Inspired by prior work <ref type="bibr" coords="4,100,100,12,10" target="#b0">[1]</ref>
      and by linkages <ref type="bibr" coords="4,200,100,12,10" target="#b6">[7]</ref>
      and by others <ref type="bibr" coords="4,300,100,12,10">[2]</ref>.</p>
      <p>A out-plane = (b 0 , b 1 ) <ref type="bibr" coords="4,552,308,11,8" target="#b6">(7)</ref> where</p>
      </body><back><listBibl>
      <biblStruct xml:id="b0" coords="4,60,700,200,10"><note type="raw_reference">Yao L. Pneui.</note></biblStruct>
      <biblStruct xml:id="b1" coords="4,60,706,200,10"><note type="raw_reference">Second.</note></biblStruct>
      <biblStruct xml:id="b6" coords="4,60,712,200,10"><note type="raw_reference">Iwafune M. Coded skeleton.</note></biblStruct>
      </listBibl></back></text>`));
    expect(bracketed.citations.map((c) => [c.key, c.label, c.inferred])).toEqual([["b0", "[1]", false], ["b6", "[7]", false], ["b1", "[2]", true]]);
    expect(bracketed.citations[0]).toMatchObject({ page: 4, x: 100 / 600, y: 100 / 800, w: 12 / 600, h: 10 / 800 });
    expect(bracketed.references[0]).toMatchObject({ page: 4, y: 700 / 800 });

    // Science and the journals that follow it really do cite as "(7)".
    const parenthesized = parseTei(TEI(`<facsimile><surface n="1" lrx="600" lry="800"/></facsimile><text><body>
      <p>As reported <ref type="bibr" coords="1,100,100,12,10" target="#b0">(1)</ref> and later <ref type="bibr" coords="1,200,100,12,10" target="#b6">(7)</ref>.</p>
      </body><back><listBibl>
      <biblStruct xml:id="b0"><note type="raw_reference">Yao L. Pneui.</note></biblStruct>
      <biblStruct xml:id="b6"><note type="raw_reference">Iwafune M. Coded skeleton.</note></biblStruct>
      </listBibl></back></text>`));
    expect(parenthesized.citations.map((c) => c.label)).toEqual(["(1)", "(7)"]);
  });

  it("links a figure reference to where the figure is, and a Box to the box rather than the figure of the same number", () => {
    const figure = parseTei(TEI(`<facsimile><surface n="2" lrx="600" lry="800"/></facsimile>
      <text><body><p>See Figure <ref type="figure" target="#fig_0" coords="2,120,160,12,10">2</ref>.</p></body>
      <back><figure xml:id="fig_0" coords="2,100,400,300,20"><head>Figure 2:</head><label>2</label></figure></back></text>`));
    expect(figure.links).toHaveLength(1);
    expect(figure.links[0]).toMatchObject({ kind: "figure", label: "2", page: 2, target_page: 2, target_y: 400 / 800 });
    // Extended left over the "Figure " prefix.
    expect(figure.links[0].x).toBeLessThan(120 / 600);
    expect(figure.links[0].x + figure.links[0].w).toBeCloseTo(132 / 600);

    const box = parseTei(TEI(`<facsimile><surface n="1" lrx="600" lry="800"/><surface n="2" lrx="600" lry="800"/></facsimile>
      <text><body><p>See <hi>BOX </hi><ref type="figure" target="#fig_1" coords="1,300,160,12,10">1</ref>.</p>
      <figure xml:id="fig_1" coords="1,100,400,300,20"><head>Figure 1</head><label>1</label></figure>
      <figure xml:id="box_1" coords="2,100,240,300,20"><head>Box 1 | Methods</head><label>1</label></figure></body></text>`));
    expect(box.links.map((l) => [l.kind, l.target_page])).toEqual([["box", 2]]);
  });
});

// ----------------------------------------------------------- the lookup

const printed = (overrides: Partial<Reference> = {}): Reference => ({
  uuid: "reference-1", paper_sha256: PDF, key: "b0", index: 0, raw: "Vaswani et al. Attention Is All You Need. 2017.", title: "Attention Is All You Need", year: 2017,
  authors: null, journal: null, doi: null, arxiv_id: null, page: null, y: null, resolved_status: null, resolved_at: null, resolution: null, ...overrides,
});
const openalexWork = (title: string, year: number, extra: Record<string, unknown> = {}) => ({ display_name: title, publication_year: year, authorships: [], ...extra });
const crossrefItems = (...items: Record<string, unknown>[]) => jsonResponse({ message: { items } });

describe("resolving a reference", () => {
  it("takes an identifier over any search, whether GROBID read it or it sits in the raw string as an arXiv URL", async () => {
    const calls = hosts({ "api.openalex.org": (url) => {
      const doi = decodeURIComponent(url.pathname.split("doi:")[1]);
      return jsonResponse(doi.includes("arxiv") ? openalexWork("Mistral 7B", 2023, { doi: `https://doi.org/${doi}` }) : openalexWork("Attention Is All You Need", 2017, { doi: `https://doi.org/${doi}` }));
    } });
    const byDoi = await resolve(env, printed({ doi: "10.example/paper" }));
    expect(byDoi.status).toBe("ok");
    expect(byDoi.summary?.title).toBe("Attention Is All You Need");
    const byArxiv = await resolve(env, printed({ raw: "Jiang et al. Mistral 7B. URL https: //arxiv.org/abs/2310.06825.", title: "Mistral", year: 2023 }));
    expect(byArxiv.status).toBe("ok");
    expect(calls).toEqual(["api.openalex.org/works/doi:10.example%2Fpaper", "api.openalex.org/works/doi:10.48550%2Farxiv.2310.06825"]);
  });

  it("takes an exact-year CrossRef match without a metered search, enriched from OpenAlex without losing its identity", async () => {
    const calls = hosts({
      "api.crossref.org": () => crossrefItems({ DOI: "10.1/attention", title: ["Attention Is All You Need"], issued: { "date-parts": [[2017]] }, "container-title": ["NeurIPS"] }),
      "api.openalex.org": () => jsonResponse(openalexWork("Attention Is All You Need", 2017, { doi: "https://doi.org/10.1/attention", cited_by_count: 90000, abstract_inverted_index: { The: [0], dominant: [1] } })),
    });
    const outcome = await resolve(env, printed());
    // The richer record leads, but CrossRef's venue survives where OpenAlex has none.
    expect(outcome.summary).toMatchObject({ doi: "10.1/attention", venue: "NeurIPS", citations: 90000, abstract: "The dominant", source: "openalex" });
    expect(calls).toEqual(["api.crossref.org/works", "api.openalex.org/works/doi:10.1%2Fattention"]);
  });

  it("lets an OpenAlex search beat a wrong-year CrossRef result, and reports an error rather than a miss when an index was down", async () => {
    hosts({
      "api.crossref.org": () => crossrefItems({ DOI: "10.1/cacm", title: ["Attention Is All You Need"], issued: { "date-parts": [[2021]] } }),
      "api.openalex.org": (url) => url.pathname === "/works" ? jsonResponse({ results: [openalexWork("Attention is all you need", 2017)] }) : jsonResponse({}, 404),
    });
    const outcome = await resolve(env, printed());
    expect(outcome.status).toBe("ok");
    expect(outcome.summary).toMatchObject({ year: 2017, source: "openalex" });

    hosts({ "api.crossref.org": () => new Response("down", { status: 503 }), "api.openalex.org": () => jsonResponse({ message: "spent" }, 429) });
    expect((await resolve(env, printed())).status).toBe("error");
    hosts({ "api.crossref.org": () => crossrefItems(), "api.openalex.org": () => jsonResponse({ results: [] }) });
    expect((await resolve(env, printed())).status).toBe("miss");
  });

  it("matches titles by containment, strictly when short, and keeps the more informative title when merging", () => {
    const raw = "Y. Zhang, Structured attention networks, ICLR 2017.";
    expect(titleMatches("Graph Attention Networks", raw, "Structured attention networks")).toBe(false);
    expect(titleMatches("Structured attention networks", raw, null)).toBe(true);
    expect(titleMatches("A general-purpose language model for code", "A generalpurpose language model for code, 2023", null)).toBe(true);
    expect(titleMatches("MLC", "MLC team. WebLLM, 2023. https://github.com/mlc-ai/web-llm", null)).toBe(false);
    expect(titleMatches("WebLLM", "MLC team. WebLLM, 2023.", "WebLLM")).toBe(true);
    const merged = merge(
      { title: "Emscripten", authors: [], year: 2011, venue: null, abstract: null, citations: 12, doi: null, url: null, pdf_url: null, source: "openalex" },
      { title: "Emscripten: an LLVM-to-JavaScript compiler", authors: ["Alon Zakai"], year: 2011, venue: "OOPSLA", abstract: null, citations: null, doi: "10.1/e", url: null, pdf_url: null, source: "crossref" },
      2011,
    );
    expect(merged).toMatchObject({ title: "Emscripten: an LLVM-to-JavaScript compiler", authors: ["Alon Zakai"], venue: "OOPSLA", citations: 12, doi: "10.1/e" });
  });

  it("accepts an untitled reference on exact CrossRef metadata and rejects a weak one", () => {
    const context = { raw: "M. Schenk and S. D. Guest, PNAS 110, 3276 (2013).", title: null, year: 2013, authors: ["M Schenk", "S D Guest"], journal: "Proceedings of the National Academy of Sciences" };
    const summary = (title: string, authors: string[]): Summary => ({ title, authors, year: 2013, venue: "Proceedings of the National Academy of Sciences", abstract: null, citations: null, doi: null, url: null, pdf_url: null, source: "crossref" });
    expect(candidates([summary("Geometry of Miura-folded metamaterials", ["Mark Schenk", "Simon D. Guest"])], "crossref", context)).toHaveLength(1);
    expect(candidates([summary("A different paper", ["Rita Guest", "Another Author"])], "crossref", context)).toHaveLength(0);
  });

  it("gives an unindexed web reference an honest card, inferring the repository and the year", () => {
    expect(bibliographyCard(printed({ raw: "MLC team. WebLLM, 2023b. URL https://github. com/mlc-ai/web-llm.", title: null, year: 2023 })))
      .toMatchObject({ title: "mlc-ai/web-llm", year: 2023, url: "https://github.com/mlc-ai/web-llm", source: "bibliography" });
    expect(bibliographyCard(printed({ raw: "Chaudhary, S. Code alpaca. https://github.com/ sahil280114/codealpaca , 2023.", title: null, year: null })))
      .toMatchObject({ title: "sahil280114/codealpaca", year: 2023, url: "https://github.com/sahil280114/codealpaca" });
    expect(bibliographyCard(printed({ raw: "Li et al. StarCoder. arXiv:2305.06161, 2023.", title: null, year: null })))
      .toMatchObject({ url: "https://arxiv.org/abs/2305.06161", year: 2023 });
  });
});

// ----------------------------------------------------------- the routes

// What the host's helper answers for the paper: GROBID's TEI as it reads
// it, which is this same parser, run there.
const ANALYSIS = parseTei(TEI(`<facsimile><surface n="1" lrx="600" lry="800"/></facsimile><text><body>
  <p>Prior work <ref type="bibr" coords="1,100,100,12,10" target="#b0">[1]</ref>.</p></body><back><listBibl>
  <biblStruct xml:id="b0" coords="1,60,700,200,10"><analytic><title level="a" type="main">Attention Is All You Need</title></analytic>
    <monogr><imprint><date when="2017"/></imprint></monogr><note type="raw_reference">Vaswani et al. Attention Is All You Need. 2017.</note></biblStruct>
  <biblStruct xml:id="b1" coords="1,60,712,200,10"><note type="raw_reference">Knuth D. The art of computer programming.</note></biblStruct>
  </listBibl></back></text>`));

async function kept(user: Account, digest = PDF, title = "KinetiX") {
  await paperWithCopy(user, digest, title, { shelfUuid: await defaultShelf(user) });
  await env.FILES.put(`uploads/${digest}.pdf`, new TextEncoder().encode("%PDF-1.4"));
}

describe("the viewer's references", () => {
  it("are read once by a job the first open queues, then served to whoever may read the paper", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await kept(ada);
    const calls = hosts({ "grobid.test": (_url, init) => {
      // The bytes, as a PDF, and nothing read here.
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/pdf");
      expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe("%PDF-1.4");
      return jsonResponse(ANALYSIS);
    } });
    const query = `?paper_sha256=${PDF}`;

    expect((await call("GET", `/api/viewer-references/${PDF}${query}`)).status).toBe(401);
    expect((await call("GET", `/api/viewer-references/${PDF}${query}`, { headers: grace.headers })).status).toBe(403);
    const first = await ok("GET", `/api/viewer-references/${PDF}${query}`, { headers: ada.headers });
    expect(first).toMatchObject({ paper_sha256: PDF, status: "pending", references: [] });
    // Asked twice at once, one pass.
    await ok("GET", `/api/viewer-references/${PDF}${query}`, { headers: ada.headers });
    const jobs = (await row("SELECT uuid, status FROM jobs WHERE kind = 'analyze_paper'"))!;
    expect(await count("jobs", "kind = 'analyze_paper'")).toBe(1);

    await woken(jobs.uuid as string);
    expect(calls).toEqual(["grobid.test/helper/analyze"]);
    expect((await row("SELECT references_status, references_error FROM papers WHERE sha256 = ?", PDF))).toEqual({ references_status: "ready", references_error: null });
    const ready = await ok("GET", `/api/viewer-references/${PDF}${query}`, { headers: ada.headers });
    expect(ready.status).toBe("ready");
    expect(ready.references.map((r: Json) => [r.key, r.index, r.title, r.page])).toEqual([["b0", 0, "Attention Is All You Need", 1], ["b1", 1, null, 1]]);
    expect(ready.citations).toEqual([expect.objectContaining({ reference_uuid: ready.references[0].uuid, label: "[1]", page: 1, inferred: false })]);
    // A paper Papol holds under the cited title is named, so the user can open it.
    await paperWithCopy(grace, OTHER, "Attention Is All You Need");
    expect((await ok("GET", `/api/viewer-references/${PDF}${query}`, { headers: ada.headers })).references[0].papol_paper_sha256).toBe(OTHER);
  });

  it("record a PDF GROBID cannot read on the paper rather than asking forever, and say so when there is no analyzer", async () => {
    const ada = await register();
    await kept(ada);
    // The helper's 502 carries GROBID's reason, which is what the paper records.
    hosts({ "grobid.test": () => jsonResponse({ detail: "GROBID could not read this PDF (no text extracted)" }, 502) });
    await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
    await woken((await row("SELECT uuid FROM jobs WHERE kind = 'analyze_paper'"))!.uuid as string);
    const failed = await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
    expect(failed).toMatchObject({ status: "failed", detail: expect.stringContaining("could not read") });
    expect(await count("jobs", "kind = 'analyze_paper'")).toBe(1);

    const paper = (await row("SELECT * FROM papers WHERE sha256 = ?", OTHER + ""))!;
    await paperWithCopy(ada, OTHER, "Unread");
    const unread = (await row("SELECT * FROM papers WHERE sha256 = ?", OTHER))!;
    expect(paper).toBeNull();
    expect((await paperReferences({ ...env, GROBID_URL: "" } as Env, unread as any)).status).toBe("unavailable");
  });

  it("open one reference lazily, keeping what was found, and a link authorizes only the file it opens", async () => {
    const ada = await register();
    await kept(ada);
    await kept(ada, OTHER, "Another");
    hosts({
      "grobid.test": () => jsonResponse(ANALYSIS),
      "api.crossref.org": () => crossrefItems({ DOI: "10.1/attention", title: ["Attention Is All You Need"], issued: { "date-parts": [[2017]] }, "container-title": ["NeurIPS"] }),
      "api.openalex.org": () => jsonResponse({}, 404),
    });
    await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
    await woken((await row("SELECT uuid FROM jobs WHERE kind = 'analyze_paper'"))!.uuid as string);
    const { references } = await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
    expect(references[0].resolved_status).toBeNull();

    const opened = await ok("GET", `/api/viewer-references/item/${references[0].uuid}`, { headers: ada.headers });
    expect(opened).toMatchObject({ resolved_status: "ok", resolution: { title: "Attention Is All You Need", venue: "NeurIPS", doi: "10.1/attention" } });
    expect((await row("SELECT resolved_status FROM paper_references WHERE uuid = ?", references[0].uuid))!.resolved_status).toBe("ok");
    // An entry the indexes do not know keeps its printed words.
    const card = await ok("GET", `/api/viewer-references/item/${references[1].uuid}`, { headers: ada.headers });
    expect(card).toMatchObject({ resolved_status: "bibliography", resolution: { title: "Knuth D. The art of computer programming", source: "bibliography" } });
    expect((await call("GET", `/api/viewer-references/item/${references[0].uuid}`)).status).toBe(401);
    expect((await call("GET", "/api/viewer-references/item/no-such-reference", { headers: ada.headers })).status).toBe(404);

    const link = await ok("POST", `/api/papers/${PDF.slice(0, 32)}/sharable`, { headers: ada.headers, json: { include_annotations: true } });
    const share = `share=${link.uuid}`;
    expect((await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}&${share}`)).paper_sha256).toBe(PDF);
    expect((await call("GET", `/api/viewer-references/${OTHER}?paper_sha256=${OTHER}&${share}`)).status).toBe(404);
    expect((await ok("GET", `/api/viewer-references/item/${references[0].uuid}?${share}`)).uuid).toBe(references[0].uuid);
    await ok("DELETE", `/api/sharables/${link.uuid}`, { headers: ada.headers });
    expect((await call("GET", `/api/viewer-references/item/${references[0].uuid}?${share}`)).status).toBe(404);
  });

  it("register a citation read off the page without giving the paper a second row for an entry it holds", async () => {
    const ada = await register();
    await kept(ada);
    await exec("UPDATE papers SET references_status = 'ready' WHERE sha256 = ?", PDF);
    // GROBID's own reading: entry 27 is printed as "[27]" and named "b26".
    for (let index = 0; index < 27; index++) {
      await exec(`INSERT INTO paper_references (uuid, paper_sha256, "key", "index", raw) VALUES (?, ?, ?, ?, ?)`, uuid(), PDF, `b${index}`, index, `Entry ${index + 1} as the analyzer read it.`);
    }
    hosts({ "api.crossref.org": () => crossrefItems(), "api.openalex.org": () => jsonResponse({ results: [] }) });
    const numbered = await ok("POST", `/api/viewer-references/${PDF}/preview`, { headers: ada.headers, json: { key: "27", raw: "Coumans E. Bullet physics simulation." } });
    expect(numbered).toMatchObject({ key: "b26", raw: "Entry 27 as the analyzer read it.", resolved_status: "bibliography" });
    expect(await count("paper_references", "paper_sha256 = ?", PDF)).toBe(27);
    const unnumbered = await ok("POST", `/api/viewer-references/${PDF}/preview`, { headers: ada.headers, json: { key: "knuth74", raw: "Knuth  D. The art of\ncomputer programming." } });
    expect(unnumbered).toMatchObject({ key: "knuth74", index: 27, raw: "Knuth D. The art of computer programming." });
    expect(await count("paper_references", "paper_sha256 = ?", PDF)).toBe(28);
    expect((await call("POST", `/api/viewer-references/${PDF}/preview`, { headers: ada.headers, json: { key: "", raw: "x" } })).status).toBe(422);
  });

  it("describe the paper being viewed from the indexes, or from what the paper says of itself", async () => {
    const ada = await register();
    await kept(ada);
    await exec("UPDATE papers SET doi = '10.1/kinetix', year = 2024, authors = '[\"A. Author\"]', journal = 'SIGGRAPH' WHERE sha256 = ?", PDF);
    hosts({ "api.openalex.org": () => jsonResponse(openalexWork("KinetiX", 2024, { doi: "https://doi.org/10.1/kinetix", cited_by_count: 3 })) });
    expect(await ok("GET", `/api/viewer/${PDF}/info`, { headers: ada.headers })).toMatchObject({ title: "KinetiX", year: 2024, citations: 3, doi: "10.1/kinetix" });
    hosts({ "api.openalex.org": () => jsonResponse({}, 404), "api.crossref.org": () => crossrefItems() });
    expect(await ok("GET", `/api/viewer/${PDF}/info`, { headers: ada.headers })).toMatchObject({ title: "KinetiX", authors: ["A. Author"], venue: "SIGGRAPH", url: "https://doi.org/10.1/kinetix" });
    expect((await call("GET", `/api/viewer/${PDF}/info`)).status).toBe(401);
  });
});
