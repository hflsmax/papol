// The bibliography: the lookup that turns a printed reference into a
// work, and the viewer's routes.
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { summarizeOpenalex, type Summary } from "../src/papers/bibliography";
import { bibliographyCard, type Reference } from "../src/papers/references";
import { candidates, merge, resolve, titleMatches } from "../src/papers/resolve";
import { normalizeTitle } from "../src/papers/reading";
import { call, count, defaultShelf, exec, ok, paperWithCopy, register, type Account, type Json } from "./helpers";

const PDF = "c".repeat(64);
const OTHER = "d".repeat(64);

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
  authors: null, journal: null, doi: null, arxiv_id: null, resolved_status: null, resolved_at: null, resolution: null, ...overrides,
});
const openalexWork = (title: string, year: number, extra: Record<string, unknown> = {}) => ({ display_name: title, publication_year: year, authorships: [], ...extra });
const crossrefItems = (...items: Record<string, unknown>[]) => jsonResponse({ message: { items } });

describe("resolving a reference", () => {
  it("takes an identifier over any search, whether the rules read it or it sits in the raw string as an arXiv URL", async () => {
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

async function kept(user: Account, digest = PDF, title = "KinetiX") {
  await paperWithCopy(user, digest, title, { shelfUuid: await defaultShelf(user) });
  await env.FILES.put(`uploads/${digest}.pdf`, new TextEncoder().encode("%PDF-1.4"));
}

describe("the viewer's references", () => {
  it("look up a reference the viewer read itself, keeping what was found by what is printed", async () => {
    const ada = await register();
    await kept(ada);
    await kept(ada, OTHER, "Another");
    let asked = 0;
    hosts({
      "api.crossref.org": () => { asked += 1; return crossrefItems({ DOI: "10.1/attention", title: ["Attention Is All You Need"], issued: { "date-parts": [[2017]] }, "container-title": ["NeurIPS"] }); },
      "api.openalex.org": () => jsonResponse({}, 404),
    });
    const attention = { key: "b0", index: 0, raw: "Vaswani  et al. Attention Is All You Need.\n2017.", title: "Attention Is All You Need", authors: ["A. Vaswani"], year: 2017 };
    // Whoever may read the paper may have what it cites looked up.
    const opened = await ok("POST", `/api/viewer-references/${PDF}/resolve`, { json: attention });
    expect(opened).toMatchObject({ key: "b0", raw: "Vaswani et al. Attention Is All You Need. 2017.", resolved_status: "ok", resolution: { title: "Attention Is All You Need", venue: "NeurIPS" } });
    expect(await count("paper_references", "paper_sha256 = ?", PDF)).toBe(1);
    // The same printed words, however the rules number them now, are the
    // same reference, and are not looked up again.
    expect(await ok("POST", `/api/viewer-references/${PDF}/resolve`, { headers: ada.headers, json: { ...attention, key: "b3", index: 3 } })).toMatchObject({ uuid: opened.uuid, resolved_status: "ok" });
    expect(asked).toBe(1);
    expect(await count("paper_references", "paper_sha256 = ?", PDF)).toBe(1);
    // A reference the indexes do not know keeps its printed words.
    expect(await ok("POST", `/api/viewer-references/${PDF}/resolve`, { json: { key: "b1", index: 1, raw: "Knuth D. The art of computer programming." } }))
      .toMatchObject({ resolved_status: "bibliography", resolution: { source: "bibliography" } });

    // A link opens one file, and it is not a key to every other PDF.
    const link = await ok("POST", `/api/papers/${PDF.slice(0, 32)}/sharable`, { headers: ada.headers, json: { include_annotations: true } });
    expect((await ok("POST", `/api/viewer-references/${PDF}/resolve?share=${link.uuid}`, { json: attention })).uuid).toBe(opened.uuid);
    expect((await call("POST", `/api/viewer-references/${OTHER}/resolve?share=${link.uuid}`, { json: attention })).status).toBe(404);
    expect((await call("POST", `/api/viewer-references/${"9".repeat(64)}/resolve`, { json: attention })).status).toBe(404);
    expect((await call("POST", `/api/viewer-references/${PDF}/resolve`, { json: { ...attention, raw: "x" } })).status).toBe(422);
    expect((await call("POST", `/api/viewer-references/${PDF}/resolve`, { json: { ...attention, authors: "A. Vaswani" } })).status).toBe(422);
  });

  it("describe the paper being viewed from the indexes, or from what the paper says of itself", async () => {
    const ada = await register();
    await kept(ada);
    await exec("UPDATE papers SET doi = '10.1/kinetix', year = 2024, authors = '[\"A. Author\"]', journal = 'SIGGRAPH' WHERE sha256 = ?", PDF);
    hosts({ "api.openalex.org": () => jsonResponse(openalexWork("KinetiX", 2024, { doi: "https://doi.org/10.1/kinetix", cited_by_count: 3 })) });
    expect(await ok("GET", `/api/viewer/${PDF}/info`, { headers: ada.headers })).toMatchObject({ title: "KinetiX", year: 2024, citations: 3, doi: "10.1/kinetix" });
    hosts({ "api.openalex.org": () => jsonResponse({}, 404), "api.crossref.org": () => crossrefItems() });
    expect(await ok("GET", `/api/viewer/${PDF}/info`, { headers: ada.headers })).toMatchObject({ title: "KinetiX", authors: ["A. Author"], venue: "SIGGRAPH", url: "https://doi.org/10.1/kinetix" });
    // The paper's own venue over the index's; a PACMPL issue is the conference.
    await exec("UPDATE papers SET journal = NULL WHERE sha256 = ?", PDF);
    const pacmpl = { source: { display_name: "Proceedings of the ACM on Programming Languages", type: "journal" } };
    hosts({ "api.openalex.org": () => jsonResponse(openalexWork("KinetiX", 2024, { doi: "https://doi.org/10.1/kinetix", primary_location: pacmpl, locations: [pacmpl], biblio: { issue: "ICFP" } })) });
    expect((await ok("GET", `/api/viewer/${PDF}/info`, { headers: ada.headers })).venue).toBe("ICFP");
    // What a paper is is public, as the paper itself is to whoever holds
    // its digest.
    expect((await ok("GET", `/api/viewer/${PDF}/info`)).title).toBe("KinetiX");
  });
});
