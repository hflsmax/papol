// The bibliography: the lookup that turns a printed reference into a
// work, what the host's analyzer is sent and answers, and the viewer's
// routes.
import { createExecutionContext, createMessageBatch, env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import type { Wakeup } from "../src/jobs/run";
import { summarizeOpenalex, type Summary } from "../src/papers/bibliography";
import { bibliographyCard, paperReferences, type Reference } from "../src/papers/references";
import * as analyzer from "../src/papers/analyzer";
import { candidates, merge, resolve, titleMatches } from "../src/papers/resolve";
import { normalizeTitle, type Analysis } from "../src/papers/reading";
import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, uuid, type Account, type Json } from "./helpers";

const PDF = "c".repeat(64);
const OTHER = "d".repeat(64);

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

// ------------------------------------------------------------ the title

describe("a title block's title", () => {
  it("loses display-only all-caps styling and keeps an acronym and an X-name", () => {
    expect(normalizeTitle("THE MEANING OF MEMORY SAFETY")).toBe("The Meaning of Memory Safety");
    expect(normalizeTitle("XGRAMMAR: FLEXIBLE AND EFFICIENT STRUCTURED GENERATION FOR LLMS")).toBe("XGrammar: Flexible and Efficient Structured Generation for LLMS");
    expect(normalizeTitle("Attention Is All You Need")).toBe("Attention Is All You Need");
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
  it("takes an identifier over any search, whether the analyzer read it or it sits in the raw string as an arXiv URL", async () => {
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

// What the host's analyzer answers for the paper: two entries, the first
// cited once on page 1.
const ANALYSIS: Analysis = {
  references: [
    { key: "b0", index: 0, raw: "Vaswani et al. Attention Is All You Need. 2017.", title: "Attention Is All You Need", authors: [], year: 2017, journal: null, doi: null, arxiv_id: null, page: 1, y: 700 / 800 },
    { key: "b1", index: 1, raw: "Knuth D. The art of computer programming.", title: null, authors: [], year: null, journal: null, doi: null, arxiv_id: null, page: 1, y: 712 / 800 },
  ],
  citations: [{ keys: ["b0"], label: "[1]", inferred: false, boxes: [{ page: 1, x: 100 / 600, y: 100 / 800, w: 12 / 600, h: 10 / 800 }] }],
  floats: [],
  links: [],
};

async function kept(user: Account, digest = PDF, title = "KinetiX") {
  await paperWithCopy(user, digest, title, { shelfUuid: await defaultShelf(user) });
  await env.FILES.put(`uploads/${digest}.pdf`, new TextEncoder().encode("%PDF-1.4"));
}

describe("what the analyzer is sent", () => {
  it("is the paper's address on the bucket domain, never the bytes, when the bucket has one", async () => {
    // Nothing in this Worker's bucket: with a domain, the Worker reads no
    // bytes at all, and the analyzer fetches the file itself.
    const hosted = { ...env, FILES_URL: "https://files.test/" as string } as Env;
    const sent: Array<[string, string, string]> = [];
    hosts({ "analyzer.test": (url, init) => {
      sent.push([url.pathname, (init?.headers as Record<string, string>)["content-type"], String(init?.body)]);
      return jsonResponse(url.pathname.endsWith("/analyze") ? ANALYSIS : { title: "T", authors: [], journal: null, year: null, doi: null, arxiv_id: null });
    } });
    await analyzer.analyze(hosted, `${OTHER}.pdf`);
    await analyzer.header(hosted, `${OTHER}.pdf`);
    const address = JSON.stringify({ url: `https://files.test/uploads/${OTHER}.pdf` });
    expect(sent).toEqual([
      ["/analyze", "application/json", address],
      ["/header", "application/json", address],
    ]);
  });

  it("is the bytes where the Worker serves its files itself, and a missing PDF is said to be missing", async () => {
    hosts({ "analyzer.test": () => jsonResponse(ANALYSIS) });
    await expect(analyzer.analyze(env, `${OTHER}.pdf`)).rejects.toThrow("The PDF for this paper is missing");
  });
});

describe("the viewer's references", () => {
  it("are read once by a job the first open queues, then served to whoever may read the paper", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    await kept(ada);
    const calls = hosts({ "analyzer.test": (_url, init) => {
      // The bytes, as a PDF, and nothing read here.
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/pdf");
      expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe("%PDF-1.4");
      return jsonResponse(ANALYSIS);
    } });
    const query = `?paper_sha256=${PDF}`;

    const first = await ok("GET", `/api/viewer-references/${PDF}${query}`, { headers: ada.headers });
    expect(first).toMatchObject({ paper_sha256: PDF, status: "pending", references: [] });
    // The digest is a lean link: whoever holds it reads what the file
    // cites, kept or not, signed in or not.
    expect((await ok("GET", `/api/viewer-references/${PDF}${query}`)).paper_sha256).toBe(PDF);
    expect((await ok("GET", `/api/viewer-references/${PDF}${query}`, { headers: grace.headers })).paper_sha256).toBe(PDF);
    expect((await call("GET", `/api/viewer-references/${"9".repeat(64)}`)).status).toBe(404);
    // Asked twice at once, one pass.
    await ok("GET", `/api/viewer-references/${PDF}${query}`, { headers: ada.headers });
    const jobs = (await row("SELECT uuid, status FROM jobs WHERE kind = 'analyze_paper'"))!;
    expect(await count("jobs", "kind = 'analyze_paper'")).toBe(1);

    await woken(jobs.uuid as string);
    expect(calls).toEqual(["analyzer.test/analyze"]);
    expect((await row("SELECT references_status, references_error FROM papers WHERE sha256 = ?", PDF))).toEqual({ references_status: "ready", references_error: null });
    const ready = await ok("GET", `/api/viewer-references/${PDF}${query}`, { headers: ada.headers });
    expect(ready.status).toBe("ready");
    expect(ready.references.map((r: Json) => [r.key, r.index, r.title, r.page])).toEqual([["b0", 0, "Attention Is All You Need", 1], ["b1", 1, null, 1]]);
    expect(ready.citations).toEqual([
      { reference_uuids: [ready.references[0].uuid], label: "[1]", inferred: false, boxes: [{ page: 1, x: 100 / 600, y: 100 / 800, w: 12 / 600, h: 10 / 800 }] },
    ]);
    // A paper Papol holds under the cited title is named, so the user can open it.
    await paperWithCopy(grace, OTHER, "Attention Is All You Need");
    expect((await ok("GET", `/api/viewer-references/${PDF}${query}`, { headers: ada.headers })).references[0].papol_paper_sha256).toBe(OTHER);
  });

  it("keep a paper's floats, and each link names the float it goes to", async () => {
    const ada = await register();
    await kept(ada);
    const analysis = {
      references: [], citations: [],
      floats: [{ key: "f0", kind: "figure", label: "2", page: 3, x: 0.1, y: 0.2, w: 0.4, h: 0.3 }],
      links: [{ float: "f0", label: "2a", page: 1, x: 0.5, y: 0.6, w: 0.05, h: 0.01 }],
    };
    hosts({ "analyzer.test": () => jsonResponse(analysis) });
    await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
    await woken((await row("SELECT uuid FROM jobs WHERE kind = 'analyze_paper'"))!.uuid as string);
    const ready = await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
    expect(ready.floats).toEqual([{ uuid: expect.any(String), kind: "figure", label: "2", page: 3, x: 0.1, y: 0.2, w: 0.4, h: 0.3 }]);
    expect(ready.links).toEqual([{ float_uuid: ready.floats[0].uuid, label: "2a", page: 1, x: 0.5, y: 0.6, w: 0.05, h: 0.01 }]);
  });

  it("keep a marker whole: the works it names in the order printed, a box for each line it is printed on", async () => {
    const ada = await register();
    await kept(ada);
    const line = (x: number, y: number, w: number) => ({ page: 2, x, y, w, h: 0.0141 });
    hosts({ "analyzer.test": () => jsonResponse({
      ...ANALYSIS,
      citations: [
        // "Matsuda et al. | 2007", broken over a line.
        { keys: ["b0"], label: "Matsuda et al. 2007", inferred: false, boxes: [line(0.7914, 0.137, 0.1175), line(0.0943, 0.1536, 0.0381)] },
        // "[2, 1, 9]": b9 is in no list the analysis gave, and is left out.
        { keys: ["b1", "b0", "b9"], label: "[2, 1, 9]", inferred: false, boxes: [line(0.5, 0.3, 0.05)] },
        // A marker that names nothing in the list leads nowhere.
        { keys: ["b9"], label: "[9]", inferred: false, boxes: [line(0.6, 0.3, 0.02)] },
      ],
    }) });
    const read = async () => {
      await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
      await woken((await row("SELECT uuid FROM jobs WHERE kind = 'analyze_paper' AND status <> 'done'"))!.uuid as string);
      return ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
    };

    const ready = await read();
    const [b0, b1] = ready.references.map((r: Json) => r.uuid);
    expect(ready.citations).toEqual([
      { reference_uuids: [b0], label: "Matsuda et al. 2007", inferred: false, boxes: [line(0.7914, 0.137, 0.1175), line(0.0943, 0.1536, 0.0381)] },
      { reference_uuids: [b1, b0], label: "[2, 1, 9]", inferred: false, boxes: [line(0.5, 0.3, 0.05)] },
    ]);
    expect(await count("paper_citations")).toBe(2);
    expect(await count("paper_citation_works")).toBe(3);

    // A fresh reading replaces the markers and the works under them.
    await exec("UPDATE papers SET references_status = NULL WHERE sha256 = ?", PDF);
    const again = await read();
    expect(again.citations.map((c: Json) => [c.label, c.reference_uuids.length, c.boxes.length])).toEqual([["Matsuda et al. 2007", 1, 2], ["[2, 1, 9]", 2, 1]]);
    expect(await count("paper_citations")).toBe(2);
    expect(await count("paper_citation_works")).toBe(3);
  });

  it("fail a reading whose links name a float it does not have", async () => {
    const ada = await register();
    await kept(ada);
    hosts({ "analyzer.test": () => jsonResponse({ references: [], citations: [], floats: [], links: [{ float: "f9", label: "1", page: 1, x: 0, y: 0, w: 0.1, h: 0.1 }] }) });
    await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
    await woken((await row("SELECT uuid FROM jobs WHERE kind = 'analyze_paper'"))!.uuid as string);
    expect(await count("paper_links")).toBe(0);
    expect((await row("SELECT status FROM jobs WHERE kind = 'analyze_paper'"))!.status).toBe("failed");
  });

  it("record a PDF the analyzer cannot read on the paper rather than asking forever, and say so when there is no analyzer", async () => {
    const ada = await register();
    await kept(ada);
    // The analyzer's 422 carries its reason, which is what the paper records.
    hosts({ "analyzer.test": () => jsonResponse({ detail: "The PDF could not be read: Invalid PDF structure." }, 422) });
    await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
    await woken((await row("SELECT uuid FROM jobs WHERE kind = 'analyze_paper'"))!.uuid as string);
    const failed = await ok("GET", `/api/viewer-references/${PDF}?paper_sha256=${PDF}`, { headers: ada.headers });
    expect(failed).toMatchObject({ status: "failed", detail: "The PDF could not be read: Invalid PDF structure." });
    expect(await count("jobs", "kind = 'analyze_paper'")).toBe(1);

    const paper = (await row("SELECT * FROM papers WHERE sha256 = ?", OTHER + ""))!;
    await paperWithCopy(ada, OTHER, "Unread");
    const unread = (await row("SELECT * FROM papers WHERE sha256 = ?", OTHER))!;
    expect(paper).toBeNull();
    expect((await paperReferences({ ...env, ANALYZER_URL: "" } as Env, unread as any)).status).toBe("unavailable");
  });

  it("open one reference lazily, keeping what was found, and a link authorizes only the file it opens", async () => {
    const ada = await register();
    await kept(ada);
    await kept(ada, OTHER, "Another");
    hosts({
      "analyzer.test": () => jsonResponse(ANALYSIS),
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
    expect((await ok("GET", `/api/viewer-references/item/${references[0].uuid}`)).uuid).toBe(references[0].uuid);
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
    // The analyzer's own reading: entry 27 is printed as "[27]" and named "b26".
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
    // What a paper is is public, as the paper itself is to whoever holds
    // its digest. Resolving a citation anew spends work, and is the keeper's.
    expect((await ok("GET", `/api/viewer/${PDF}/info`)).title).toBe("KinetiX");
    expect((await call("POST", `/api/viewer-references/${PDF}/preview`, { json: { key: "1", raw: "Some reference." } })).status).toBe(401);
    expect((await call("POST", `/api/viewer-references/${PDF}/preview`, { headers: (await register("grace@example.test")).headers, json: { key: "1", raw: "Some reference." } })).status).toBe(403);
  });
});
