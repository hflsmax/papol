// Papers through the API: the name a link carries, the upload and the
// job that reads it, saving, opening, editing, taking a copy and letting
// one go, and the PDF itself.
import { createExecutionContext, createMessageBatch, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import type { Wakeup } from "../src/jobs/run";
import { byDoi, summarizeCrossref, summarizeOpenalex } from "../src/papers/bibliography";
import { extractDoi, extractArxivId, titleFromFilename } from "../src/papers/extract";
import { call, count, defaultShelf, exec, ok, paperWithCopy, register, row, rows, sha256, uuid, type Account } from "./helpers";

const A_PAPER = "a1b2c3d4" + "0".repeat(24) + "f".repeat(32);
// Agrees with A_PAPER for the whole of its short name and differs after it.
const ITS_TWIN = A_PAPER.slice(0, 32) + "e".repeat(32);
const NAME = A_PAPER.slice(0, 32);

afterEach(() => vi.unstubAllGlobals());

async function woken(...uuids: string[]) {
  const batch = createMessageBatch<Wakeup>("papol-jobs", uuids.map((id) => ({ id: uuid(), timestamp: new Date(), body: { job: id }, attempts: 1 })));
  await worker.queue(batch, env, createExecutionContext());
}

async function aPaper(digest = A_PAPER, title = "A paper by its name") {
  const at = new Date().toISOString();
  await exec("INSERT INTO papers (sha256, title, file_path, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, 1)", digest, title, `${digest}.pdf`, at, at);
}

// An upload as the browser makes one: the bytes into the bucket under
// their digest by the address it was given (files.test.ts), then the word
// that they are in.
async function upload(account: Account, name: string, bytes: string) {
  const digest = await sha256(bytes);
  await env.FILES.put(`uploads/${digest}.pdf`, bytes, { httpMetadata: { contentType: "application/pdf" } });
  return call("POST", "/api/papers/uploaded", { headers: account.headers, json: { file_path: `${digest}.pdf`, uploaded_name: name } });
}

// The bibliographic APIs and the host's helper, stood in for by host.
function apis(answers: Record<string, (url: URL) => Response>) {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const answer = answers[url.hostname];
    return answer ? answer(url) : new Response("no such host", { status: 502 });
  });
}
// What the helper reads off the title block (grobid.test/helper/header).
type TitleBlock = { title: string | null; authors: string[]; journal: string | null; year: number | null; doi: string | null; arxiv_id: string | null };
const titleBlock = (read: Partial<TitleBlock> = {}) => Response.json({ title: null, authors: [], journal: null, year: null, doi: null, arxiv_id: null, ...read });
const crossrefWork = { message: { DOI: "10.1145/2984511.2984540", title: ["Metamaterial Mechanisms"], "container-title": ["Proceedings of UIST '16"],
  issued: { "date-parts": [[2016]] }, author: [{ given: "Alexandra", family: "Ion" }, { given: "Patrick", family: "Baudisch" }] } };

describe("the name a link carries", () => {
  it("opens a paper by the first half of its digest, whatever the case, and answers with the whole", async () => {
    const account = await register();
    await aPaper();
    for (const name of [NAME, NAME.toUpperCase()]) {
      const page = await ok("GET", `/api/papers/${name}`, { headers: account.headers });
      expect(page.sha256).toBe(A_PAPER);
      expect(page.title).toBe("A paper by its name");
    }
  });

  it("reads one shape of name and no other", async () => {
    const account = await register();
    await aPaper();
    for (const wrong of [A_PAPER, A_PAPER.slice(0, 31), A_PAPER.slice(0, 33), A_PAPER.slice(0, 48), "z".repeat(32), "-".repeat(32), "%".repeat(32), "_".repeat(32), `${A_PAPER.slice(0, 31)}!`, "c".repeat(32)]) {
      expect((await call("GET", `/api/papers/${wrong}`, { headers: account.headers })).status, wrong).toBe(404);
    }
  });

  it("refuses two papers sharing a name rather than guessing", async () => {
    const account = await register();
    await aPaper();
    await aPaper(ITS_TWIN, "A paper whose name collides");
    const response = await call("GET", `/api/papers/${NAME}`, { headers: account.headers });
    expect(response.status).toBe(409);
    expect((await response.json<any>()).detail).toContain("more than one");
  });

  it("still names a file by the whole digest", async () => {
    const account = await register();
    const response = await call("POST", "/api/files/upload-address", { headers: account.headers, json: { kind: "paper", sha256: NAME, size: 1, name: "short.pdf" } });
    expect(response.status).toBe(422);
    expect((await response.json<any>()).detail).toContain("sha256");
  });
});

describe("what a PDF says about itself", () => {
  it("finds the complete DOI, skipping a split one, and an arXiv id in either spelling", () => {
    expect(extractDoi("supporting info at 10.1073/pnas. and then doi: 10.1073/pnas.2423301122.")).toBe("10.1073/pnas.2423301122");
    expect(extractDoi("see https://doi.org/10.1145/2984511.2984540, cited")).toBe("10.1145/2984511.2984540");
    expect(extractDoi("nothing here")).toBeNull();
    expect(extractArxivId("arXiv:1607.06450v2 [cs.LG]")).toBe("1607.06450v2");
    expect(extractArxivId("at arxiv.org/abs/hep-th/9901001")).toBe("hep-th/9901001");
    expect(titleFromFilename("2016UIST-Metamaterial_AuthorsCopy.pdf")).toBe("2016uist Metamaterial Authorscopy");
  });

  it("reads an upload, stored once under its digest, by a job the uploader polls", async () => {
    const account = await register();
    const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF";
    const digest = await sha256(pdf);
    const first = await upload(account, "Some-Paper.pdf", pdf);
    expect(first.status, await first.clone().text()).toBe(202);
    const ticket = await first.json<any>();
    expect(ticket).toMatchObject({ file_path: `${digest}.pdf`, sha256: digest });
    expect((await upload(account, "Some-Paper.pdf", pdf)).status).toBe(202);
    expect((await env.FILES.list({ prefix: "uploads/" })).objects.map((o) => o.key)).toEqual([`uploads/${digest}.pdf`]);
    expect((await ok("GET", `/api/jobs/${ticket.job}`, { headers: account.headers })).status).toBe("queued");

    apis({ "grobid.test": () => titleBlock({ title: "METAMATERIAL MECHANISMS", doi: "10.1145/2984511.2984540" }), "api.crossref.org": () => Response.json(crossrefWork) });
    await woken(ticket.job);
    const done = await ok("GET", `/api/jobs/${ticket.job}`, { headers: account.headers });
    expect(done.status).toBe("done");
    expect(done.result).toEqual({ doi: "10.1145/2984511.2984540", title: "Metamaterial Mechanisms", authors: JSON.stringify(["Alexandra Ion", "Patrick Baudisch"]),
      journal: "Proceedings of UIST '16", year: 2016, file_path: `${digest}.pdf` });
  });

  it("takes the title block when no index answers, the filename when the helper is down, and fails with a sentence when the indexes do not answer", async () => {
    const account = await register();
    const ticket = await (await upload(account, "Some-Paper.pdf", "%PDF-1.4 unresolved")).json<any>();
    apis({ "grobid.test": () => new Response("Bad Gateway", { status: 502 }) });
    await woken(ticket.job);
    expect((await ok("GET", `/api/jobs/${ticket.job}`, { headers: account.headers })).result.title).toBe("Some Paper");

    // No identifier on the page: what the paper says of itself, as read.
    const untitled = await (await upload(account, "scan.pdf", "%PDF-1.4 no identifier")).json<any>();
    apis({ "grobid.test": () => titleBlock({ title: "What the Paper Says", authors: ["A. Author"], journal: "A Venue", year: 2021 }) });
    await woken(untitled.job);
    expect((await ok("GET", `/api/jobs/${untitled.job}`, { headers: account.headers })).result)
      .toMatchObject({ doi: null, title: "What the Paper Says", authors: JSON.stringify(["A. Author"]), journal: "A Venue", year: 2021 });

    const second = await (await upload(account, "other.pdf", "%PDF-1.4 unreachable")).json<any>();
    apis({ "grobid.test": () => titleBlock({ doi: "10.1234/unreachable" }), "api.crossref.org": () => new Response("down", { status: 503 }), "api.openalex.org": () => new Response("down", { status: 500 }) });
    await woken(second.job);
    expect(await ok("GET", `/api/jobs/${second.job}`, { headers: account.headers })).toMatchObject({ status: "failed", detail: "Metadata lookup failed" });
  });

  it("asks the registry that holds a DOI, and OpenAlex only when CrossRef itself cannot answer", async () => {
    // Who was asked, in order, for one lookup.
    const route = (answers: Record<string, () => Response>) => {
      const asked: string[] = [];
      apis(Object.fromEntries(Object.entries(answers).map(([host, answer]) => [host, () => { asked.push(host.split(".")[1]); return answer(); }])));
      return asked;
    };
    const datacite = (title: string) => () => Response.json({ data: { attributes: { doi: "10.1/x", titles: [{ title }], creators: [{ givenName: "Ada", familyName: "Lovelace" }], publicationYear: 2020, publisher: "Zenodo" } } });
    const missing = () => new Response("", { status: 404 });
    const down = () => new Response("", { status: 503 });

    // CrossRef knows it: nobody else is asked.
    let asked = route({ "api.crossref.org": () => Response.json({ message: { title: ["Publisher title"] } }), "api.openalex.org": missing, "api.datacite.org": missing });
    expect((await byDoi(env, "10.1/x"))?.title).toBe("Publisher title");
    expect(asked).toEqual(["crossref"]);

    // CrossRef has never heard of it: DataCite, never OpenAlex.
    asked = route({ "api.crossref.org": missing, "api.openalex.org": () => Response.json({ display_name: "Indexed title" }), "api.datacite.org": datacite("Registered title") });
    expect(await byDoi(env, "10.1/x")).toMatchObject({ title: "Registered title", authors: ["Ada Lovelace"], year: 2020, venue: null, host: "Zenodo", source: "datacite" });
    expect(asked).toEqual(["crossref", "datacite"]);
    asked = route({ "api.crossref.org": missing, "api.openalex.org": () => Response.json({ display_name: "Indexed title" }), "api.datacite.org": missing });
    expect(await byDoi(env, "10.1/x")).toBeNull();
    expect(asked).toEqual(["crossref", "datacite"]);
    // ... and DataCite down then is nobody knowing it, not an outage.
    route({ "api.crossref.org": missing, "api.datacite.org": down });
    expect(await byDoi(env, "10.1/x")).toBeNull();

    // CrossRef down: OpenAlex stands in, and DataCite after it.
    asked = route({ "api.crossref.org": down, "api.openalex.org": () => Response.json({ display_name: "Indexed title" }), "api.datacite.org": missing });
    expect((await byDoi(env, "10.1/x"))?.title).toBe("Indexed title");
    expect(asked).toEqual(["crossref", "openalex"]);
    asked = route({ "api.crossref.org": down, "api.openalex.org": missing, "api.datacite.org": datacite("Registered title") });
    expect((await byDoi(env, "10.1/x"))?.title).toBe("Registered title");
    expect(asked).toEqual(["crossref", "openalex", "datacite"]);
    route({ "api.crossref.org": down, "api.openalex.org": () => new Response("", { status: 429 }), "api.datacite.org": down });
    await expect(byDoi(env, "10.1/x")).rejects.toThrow("CrossRef, OpenAlex and DataCite are unavailable");

    // An arXiv DOI is DataCite's alone: found, unknown, or down, neither
    // CrossRef nor OpenAlex is asked.
    for (const [answer, found] of [[datacite("Attention Is All You Need"), "Attention Is All You Need"], [missing, null], [down, null]] as const) {
      asked = route({ "api.crossref.org": () => Response.json({ message: { title: ["CrossRef"] } }), "api.openalex.org": () => Response.json({ display_name: "A wrong title" }), "api.datacite.org": answer });
      expect((await byDoi(env, "10.48550/arXiv.1706.03762"))?.title ?? null).toBe(found);
      expect(asked).toEqual(["datacite"]);
    }
  });

  it("summarizes each API the way the viewer's card wants", () => {
    const crossref = summarizeCrossref({ ...crossrefWork.message, subtitle: ["A Subtitle"], abstract: "<jats:p>Some  text</jats:p>", "is-referenced-by-count": 12,
      link: [{ URL: "https://x/paper.pdf", "content-type": "application/pdf" }] });
    expect(crossref).toMatchObject({ title: "Metamaterial Mechanisms: A Subtitle", venue: "Proceedings of UIST '16", year: 2016, abstract: "Some text", citations: 12,
      url: "https://doi.org/10.1145/2984511.2984540", pdf_url: "https://x/paper.pdf", source: "crossref" });
    const openalex = summarizeOpenalex({ display_name: "Layer Normalization", publication_year: 2016, doi: "https://doi.org/10.48550/arXiv.1607.06450",
      authorships: [{ author: { display_name: "Jimmy Lei Ba" } }], cited_by_count: 9000,
      primary_location: { source: { display_name: "arXiv (Cornell University)", type: "repository" }, landing_page_url: "https://arxiv.org/abs/1607.06450" },
      abstract_inverted_index: { Training: [0], deep: [1], nets: [2] } });
    expect(openalex).toMatchObject({ title: "Layer Normalization", venue: null, host: "arXiv (Cornell University)", abstract: "Training deep nets", doi: "10.48550/arXiv.1607.06450", source: "openalex" });
  });

  it("re-reads a paper's PDF for the edit form, preferring what the file prints over a stale DOI", async () => {
    const account = await register();
    const digest = "4".repeat(64);
    await paperWithCopy(account, digest, "Incorrect imported title", { filePath: "countersnapping.pdf" });
    await exec("UPDATE papers SET doi = '10.0000/stale-doi' WHERE sha256 = ?", digest);
    await env.FILES.put("uploads/countersnapping.pdf", "%PDF-1.4\n%%EOF");
    const asked: string[] = [];
    apis({ "grobid.test": () => titleBlock({ doi: "10.1073/pnas.2423301122" }), "api.crossref.org": (url) => { asked.push(url.pathname); return Response.json({ message: { DOI: "10.1073/pnas.2423301122", title: ["Exotic mechanical properties"],
      author: [{ given: "Paul", family: "Ducarme" }], "container-title": ["PNAS"], issued: { "date-parts": [[2025]] } } }); } });
    const found = await ok("POST", `/api/papers/${digest.slice(0, 32)}/extract-metadata`, { headers: account.headers });
    expect(asked).toEqual([`/works/${encodeURIComponent("10.1073/pnas.2423301122")}`]);
    expect(found).toEqual({ doi: "10.1073/pnas.2423301122", title: "Exotic mechanical properties", authors: JSON.stringify(["Paul Ducarme"]), journal: "PNAS", year: 2025 });
  });
});

describe("an upload that went straight to the bucket", () => {
  const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF";

  it("queues the reading once the bytes are in, and not before", async () => {
    const account = await register();
    const digest = await sha256(pdf);
    const early = await call("POST", "/api/papers/uploaded", { headers: account.headers, json: { file_path: `${digest}.pdf`, uploaded_name: "Some-Paper.pdf" } });
    expect(early.status).toBe(404);
    await env.FILES.put(`uploads/${digest}.pdf`, pdf);
    const queued = await call("POST", "/api/papers/uploaded", { headers: account.headers, json: { file_path: `${digest}.pdf`, uploaded_name: "Some-Paper.pdf", identifier: { doi: "10.1145/2984511.2984540" } } });
    expect(queued.status, await queued.clone().text()).toBe(202);
    const ticket = await queued.json<any>();
    expect(ticket).toMatchObject({ file_path: `${digest}.pdf`, sha256: digest });
    expect(JSON.parse((await row<{ payload: string }>("SELECT payload FROM jobs WHERE uuid = ?", ticket.job))!.payload))
      .toEqual({ file_path: `${digest}.pdf`, uploaded_name: "Some-Paper.pdf", identifier: { doi: "10.1145/2984511.2984540" } });

    expect((await call("POST", "/api/papers/uploaded", { headers: account.headers, json: { file_path: "../secret.pdf" } })).status).toBe(422);
    expect((await call("POST", "/api/papers/uploaded", { headers: account.headers, json: { file_path: `${digest}.pdf`, uploaded_name: "notes.txt" } })).status).toBe(400);
    // A malformed identifier is a bad hint, not a bad upload: dropped, and the PDF is read without it.
    for (const identifier of [{ doi: "not a doi" }, { doi: `10.1234/${"x".repeat(400)}` }, { arxiv_id: 42 }, "10.1145/2984511.2984540"]) {
      const kept = await ok("POST", "/api/papers/uploaded", { headers: account.headers, json: { file_path: `${digest}.pdf`, uploaded_name: "Some-Paper.pdf", identifier } });
      expect(JSON.parse((await row<{ payload: string }>("SELECT payload FROM jobs WHERE uuid = ?", kept.job))!.payload), JSON.stringify(identifier))
        .toEqual({ file_path: `${digest}.pdf`, uploaded_name: "Some-Paper.pdf" });
    }
    expect((await call("POST", "/api/papers/uploaded", { headers: account.headers, json: { file_path: `${digest}.pdf`, identifier: { arxiv_id: "1706.03762v5" } } })).status).toBe(202);
  });

  it("asks the indexes about a given identifier and never fetches the PDF, and turns to the helper only when they do not know it", async () => {
    const account = await register();
    const digest = await sha256(pdf);
    await env.FILES.put(`uploads/${digest}.pdf`, pdf);
    const queue = (identifier: unknown) => ok("POST", "/api/papers/uploaded", { headers: account.headers, json: { file_path: `${digest}.pdf`, uploaded_name: "Some-Paper.pdf", identifier } });
    const asked: string[] = [];
    const answers = (known: boolean) => apis({
      "grobid.test": () => { asked.push("helper"); return titleBlock({ title: "As Printed", authors: ["P. Rinted"], journal: "The Page", year: 2020 }); },
      "api.crossref.org": (url) => { asked.push(url.pathname); return known ? Response.json(crossrefWork) : new Response("", { status: 404 }); },
      "api.openalex.org": () => { asked.push("openalex"); return new Response("", { status: 404 }); },
      "api.datacite.org": () => { asked.push("datacite"); return new Response("", { status: 404 }); },
    });

    answers(true);
    const known = await queue({ doi: "10.1145/2984511.2984540" });
    await woken(known.job);
    expect((await ok("GET", `/api/jobs/${known.job}`, { headers: account.headers })).result).toMatchObject({ doi: "10.1145/2984511.2984540", title: "Metamaterial Mechanisms", year: 2016 });
    expect(asked).toEqual([`/works/${encodeURIComponent("10.1145/2984511.2984540")}`]);

    // An arXiv id is asked about through its DataCite DOI, of DataCite,
    // which registers it: neither CrossRef nor the host is asked.
    asked.length = 0;
    apis({
      "api.datacite.org": (url) => { asked.push(url.pathname); return Response.json({ data: { attributes: {
        doi: "10.48550/arxiv.1706.03762", titles: [{ title: "Attention Is All You Need" }], publicationYear: 2017, publisher: "arXiv",
        creators: [{ name: "Vaswani, Ashish", givenName: "Ashish", familyName: "Vaswani" }, { name: "Shazeer, Noam", givenName: "Noam", familyName: "Shazeer" }],
      } } }); },
      "api.crossref.org": (url) => { asked.push(url.pathname); return new Response("", { status: 404 }); },
      "grobid.test": () => { asked.push("helper"); return titleBlock(); },
    });
    const arxiv = await queue({ arxiv_id: "1706.03762v5" });
    await woken(arxiv.job);
    expect((await ok("GET", `/api/jobs/${arxiv.job}`, { headers: account.headers })).result).toMatchObject({
      doi: "10.48550/arxiv.1706.03762", title: "Attention Is All You Need", authors: JSON.stringify(["Ashish Vaswani", "Noam Shazeer"]), journal: null, year: 2017,
    });
    expect(asked).toEqual([`/dois/${encodeURIComponent("10.48550/arxiv.1706.03762")}`]);
    // DataCite down: the host reads the title block; OpenAlex is not asked.
    asked.length = 0;
    apis({
      "api.datacite.org": () => { asked.push("datacite"); return new Response("", { status: 503 }); },
      "api.crossref.org": () => { asked.push("crossref"); return Response.json(crossrefWork); },
      "api.openalex.org": () => { asked.push("openalex"); return Response.json({ display_name: "A wrong title" }); },
      "grobid.test": () => { asked.push("helper"); return titleBlock({ title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2017 }); },
    });
    const fallback = await queue({ arxiv_id: "1706.03762v5" });
    await woken(fallback.job);
    expect((await ok("GET", `/api/jobs/${fallback.job}`, { headers: account.headers })).result)
      .toMatchObject({ doi: "10.48550/arXiv.1706.03762", title: "Attention Is All You Need", authors: JSON.stringify(["Ashish Vaswani"]), year: 2017 });
    expect(asked).toEqual(["datacite", "helper"]);

    // Unknown to the indexes: the helper reads the title block, and the
    // given identifier stays on the form.
    asked.length = 0;
    answers(false);
    const unknown = await queue({ doi: "10.9999/nobody-knows" });
    await woken(unknown.job);
    expect((await ok("GET", `/api/jobs/${unknown.job}`, { headers: account.headers })).result)
      .toMatchObject({ doi: "10.9999/nobody-knows", title: "As Printed", authors: JSON.stringify(["P. Rinted"]), journal: "The Page", year: 2020 });
    // CrossRef has never heard of it: DataCite is asked, not OpenAlex.
    expect(asked).toEqual([`/works/${encodeURIComponent("10.9999/nobody-knows")}`, "datacite", "helper"]);
  });

  it("names the version Papol already holds of the same work, by its DOI however it is spelt, and never the upload itself", async () => {
    const account = await register();
    // The version Papol holds, its DOI stored as somebody typed it.
    await aPaper(A_PAPER, "The Published Version");
    await exec("UPDATE papers SET doi = ' 10.1234/ABC.Def ' WHERE sha256 = ?", A_PAPER);
    await env.FILES.put(`uploads/${A_PAPER}.pdf`, pdf);
    const another = "%PDF-1.4 the preprint of the same work";
    const digest = await sha256(another);
    await env.FILES.put(`uploads/${digest}.pdf`, another);
    // Known to no index: the DOI stays as the browser read it, and is
    // compared without regard to case or the spaces around it.
    apis({ "grobid.test": () => titleBlock({ title: "As Printed" }), "api.crossref.org": () => new Response("", { status: 404 }), "api.openalex.org": () => new Response("", { status: 404 }) });
    const queue = (filePath: string) => ok("POST", "/api/papers/uploaded", { headers: account.headers, json: { file_path: filePath, uploaded_name: "preprint.pdf", identifier: { doi: "10.1234/abc.def" } } });
    const preprint = await queue(`${digest}.pdf`);
    await woken(preprint.job);
    const read = await ok("GET", `/api/jobs/${preprint.job}`, { headers: account.headers });
    expect(read.result).toMatchObject({ doi: "10.1234/abc.def", title: "As Printed", file_path: `${digest}.pdf`,
      existing: { sha256: A_PAPER, title: "The Published Version", file_path: `${A_PAPER}.pdf` } });

    // The same bytes again are that paper, not another version of it.
    const same = await queue(`${A_PAPER}.pdf`);
    await woken(same.job);
    expect((await ok("GET", `/api/jobs/${same.job}`, { headers: account.headers })).result.existing).toBeUndefined();

    // A paper let go of is no version to offer.
    await exec("UPDATE papers SET deleted_at = ? WHERE sha256 = ?", new Date().toISOString(), A_PAPER);
    const gone = await queue(`${digest}.pdf`);
    await woken(gone.job);
    expect((await ok("GET", `/api/jobs/${gone.job}`, { headers: account.headers })).result.existing).toBeUndefined();
  });
});

describe("saving, opening and editing", () => {
  async function stored(bytes = "%PDF-1.4 a paper"): Promise<string> {
    const digest = await sha256(bytes);
    await env.FILES.put(`uploads/${digest}.pdf`, bytes, { httpMetadata: { contentType: "application/pdf" } });
    return digest;
  }

  it("saves a paper with its copy, tags and first note, and a second upload of the same bytes becomes a copy", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    const digest = await stored();
    const tag = await ok("POST", "/api/tags", { headers: ada.headers, json: { name: "methods" } });
    const saved = await ok("POST", "/api/papers", { headers: ada.headers, json: {
      title: "  Saved paper ", doi: "https://doi.org/10.1/saved", authors: '["Ada"]', year: 2020, file_path: `${digest}.pdf`,
      thought: "Worth it", summary: "Mine", rating_liking: 5, tag_uuids: [tag.uuid], initial_comment: " First thought ",
    } });
    expect(saved).toMatchObject({ sha256: digest, title: "Saved paper", doi: "10.1/saved", thought: "Worth it", summary: "Mine", rating_liking: 5, is_public: true,
      tags: [{ uuid: tag.uuid, name: "methods" }], shelf_uuid: await defaultShelf(ada), sharable_uuid: null });
    expect(saved.notes.map((n: any) => [n.kind, n.content, n.body])).toEqual([["note", "First thought", {}]]);
    expect(saved.also_read_by.map((u: any) => u.user.uuid)).toEqual([ada.uuid]);
    expect((await call("POST", "/api/papers", { headers: ada.headers, json: { title: "Again", file_path: `${digest}.pdf` } })).status).toBe(400);
    expect((await call("POST", "/api/papers", { headers: ada.headers, json: { title: "Nowhere", file_path: `${"0".repeat(64)}.pdf` } })).status).toBe(400);
    expect((await call("POST", "/api/papers", { headers: ada.headers, json: { title: "", file_path: `${digest}.pdf` } })).status).toBe(422);

    const theirs = await ok("POST", "/api/papers", { headers: grace.headers, json: { title: "Retitled by Grace", file_path: `${digest}.pdf` } });
    expect(theirs.title).toBe("Retitled by Grace");
    expect(theirs.also_read_by.map((u: any) => u.user.display_name)).toEqual(["Ada", "Grace"]);
    expect(await count("papers")).toBe(1);
    expect(await count("copies")).toBe(2);
    expect((await ok("GET", "/api/papers", { headers: ada.headers }))[0].title).toBe("Retitled by Grace");
  });

  it("offers the known version: taking it makes a copy of that paper and lets the upload go, keeping this one makes a paper of its own", async () => {
    const ada = await register("ada@example.test", "Ada"), grace = await register("grace@example.test", "Grace");
    const published = await stored("%PDF-1.4 the published version");
    await ok("POST", "/api/papers", { headers: ada.headers, json: { title: "The Published Version", doi: "10.1234/abc.def", file_path: `${published}.pdf` } });

    // Grace uploaded a preprint of the same work and took the version Papol
    // holds: her copy is of that paper, and her upload is let go of.
    const preprint = await stored("%PDF-1.4 the preprint");
    const took = await ok("POST", "/api/papers", { headers: grace.headers, json: {
      title: "The Published Version", doi: "10.1234/abc.def", file_path: `${published}.pdf`, discard_file_path: `${preprint}.pdf`,
    } });
    expect(took.sha256).toBe(published);
    expect(took.also_read_by.map((u: any) => u.user.display_name)).toEqual(["Ada", "Grace"]);
    expect(await count("papers")).toBe(1);
    expect(await env.FILES.head(`uploads/${preprint}.pdf`)).toBeNull();
    expect(await env.FILES.head(`uploads/${published}.pdf`)).not.toBeNull();

    // An upload still being read, or one that is some paper's file, is not let go of.
    const reading = await stored("%PDF-1.4 still being read");
    await exec("INSERT INTO jobs (uuid, kind, payload, status, user_uuid, attempts, run_at, created_at) VALUES (?, 'extract_metadata', ?, 'queued', ?, 0, ?, ?)",
      uuid(), JSON.stringify({ file_path: `${reading}.pdf` }), grace.uuid, new Date().toISOString(), new Date().toISOString());
    const reviewed = { title: "The Published Version", doi: "10.1234/abc.def", file_path: `${published}.pdf` };
    const third = await register("third@example.test", "Third");
    await ok("POST", "/api/papers", { headers: third.headers, json: { ...reviewed, discard_file_path: `${reading}.pdf` } });
    expect(await env.FILES.head(`uploads/${reading}.pdf`)).not.toBeNull();
    const fourth = await register("fourth@example.test", "Fourth");
    await ok("POST", "/api/papers", { headers: fourth.headers, json: { ...reviewed, discard_file_path: `${published}.pdf` } });
    expect(await env.FILES.head(`uploads/${published}.pdf`)).not.toBeNull();
    expect((await call("POST", "/api/papers", { headers: (await register()).headers, json: { title: "x", file_path: `${published}.pdf`, discard_file_path: "not-a-file" } })).status).toBe(422);

    // Keeping this version: a paper of its own under its own hash, the
    // same DOI and all — the PDF is the identity, and a DOI has versions.
    const kept = await stored("%PDF-1.4 the camera-ready");
    const own = await ok("POST", "/api/papers", { headers: grace.headers, json: { title: "The Camera-Ready", doi: "10.1234/abc.def", file_path: `${kept}.pdf` } });
    expect(own.sha256).toBe(kept);
    expect(await rows("SELECT sha256 FROM papers WHERE doi = '10.1234/abc.def' ORDER BY created_at")).toEqual([{ sha256: published }, { sha256: kept }]);
    expect(await env.FILES.head(`uploads/${kept}.pdf`)).not.toBeNull();
  });

  it("keeps the keeper's summary theirs and does not name them when they do not display it", async () => {
    const keeper = await register("keeper@example.test", "Ada"), other = await register("other@example.test", "Grace");
    const digest = "a".repeat(64);
    const privateShelf = (await row("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", keeper.uuid))!.uuid;
    const copy = await paperWithCopy(keeper, digest, "On a paper nobody owns", { shelfUuid: privateShelf });
    await exec("UPDATE copies SET summary = 'Mine alone' WHERE uuid = ?", copy);
    const page = await ok("GET", `/api/papers/${digest.slice(0, 32)}`, { headers: other.headers });
    expect(page.summary).toBeNull();
    expect(page.copy_uuid).toBeNull();
    expect(page.also_read_by).toEqual([]);
    expect((await call("GET", `/api/papers/${digest.slice(0, 32)}`)).status).toBe(401);
  });

  it("takes a copy, lets it go without taking the paper out of the Library, and revives it when taken again", async () => {
    const account = await register();
    await aPaper("b".repeat(64), "Held by nobody");
    const name = "b".repeat(32);
    const added = await ok("POST", `/api/papers/${name}/add-to-nook`, { headers: account.headers });
    expect(added.copy_uuid).not.toBeNull();
    expect((await call("POST", `/api/papers/${name}/add-to-nook`, { headers: account.headers })).status).toBe(400);
    await ok("POST", `/api/papers/${name}/annotations`, { headers: account.headers, json: {} }).catch(() => null); // not this PR's route
    expect((await ok("DELETE", `/api/papers/${name}`, { headers: account.headers })).message).toBe("Paper removed from your nook");
    expect((await ok("GET", "/api/papers", { headers: account.headers })).map((p: any) => p.sha256)).toEqual(["b".repeat(64)]);
    expect((await ok("GET", `/api/papers/${name}`, { headers: account.headers })).copy_uuid).toBeNull();
    const again = await ok("POST", `/api/papers/${name}/add-to-nook`, { headers: account.headers });
    expect(again.copy_uuid).toBe(added.copy_uuid);
    expect(await count("copies")).toBe(1);
    expect((await call("DELETE", `/api/papers/${name}`, { headers: (await register()).headers })).status).toBe(403);
  });

  it("edits the paper for everyone and the copy for its keeper, each held to the form's shape", async () => {
    const account = await register();
    const digest = "9".repeat(64);
    await paperWithCopy(account, digest, "Agreed paper", { shelfUuid: await defaultShelf(account) });
    const name = digest.slice(0, 32);
    for (const refused of [{ title: "t".repeat(501) }, { title: "" }, { year: 99999 }, { rating_liking: 6 }]) {
      expect((await call("PUT", `/api/papers/${name}`, { headers: account.headers, json: refused })).status, JSON.stringify(refused)).toBe(422);
    }
    expect((await row("SELECT title FROM papers WHERE sha256 = ?", digest))).toEqual({ title: "Agreed paper" });
    const tag = await ok("POST", "/api/tags", { headers: account.headers, json: { name: "seen" } });
    const edited = await ok("PUT", `/api/papers/${name}`, { headers: account.headers, json: {
      title: " Corrected ", year: 2021, thought: "Read on the train", is_public: false, tag_uuids: [tag.uuid],
    } });
    expect(edited).toMatchObject({ title: "Corrected", year: 2021, thought: "Read on the train", is_public: false, tags: [{ uuid: tag.uuid, name: "seen" }] });
    expect(edited.shelf_uuid).toBe((await row("SELECT uuid FROM shelves WHERE user_uuid = ? AND is_public = 0", account.uuid))!.uuid);
    const back = await ok("PUT", `/api/papers/${name}`, { headers: account.headers, json: { shelf_uuid: await defaultShelf(account), tag_uuids: [] } });
    expect(back).toMatchObject({ is_public: true, tags: [] });
    // Metadata is everyone's to edit; the copy is only its keeper's.
    const other = await register();
    expect((await ok("PUT", `/api/papers/${name}`, { headers: other.headers, json: { journal: "Nature" } })).journal).toBe("Nature");
    expect((await call("PUT", `/api/papers/${name}`, { headers: other.headers, json: { thought: "not mine" } })).status).toBe(403);
    // Every edit of the copy is a version a replica hears of.
    expect(await count("_server_change_log", "table_name = 'copies'")).toBe(2);
  });

  it("keeps a paper on display while a seminar about it is on", async () => {
    const account = await register();
    const digest = "7".repeat(64);
    await paperWithCopy(account, digest, "Discussed", { shelfUuid: await defaultShelf(account) });
    const at = new Date().toISOString(), room = uuid();
    await exec("INSERT INTO rooms (uuid, paper_sha256, created_by, status, created_at) VALUES (?, ?, ?, 'called', ?)", room, digest, account.uuid, at);
    await exec("INSERT INTO room_participants (uuid, room_uuid, user_uuid, created_at) VALUES (?, ?, ?, ?)", uuid(), room, account.uuid, at);
    expect((await call("PUT", `/api/papers/${digest.slice(0, 32)}`, { headers: account.headers, json: { is_public: false } })).status).toBe(400);
    const page = await ok("GET", `/api/papers/${digest.slice(0, 32)}`, { headers: account.headers });
    expect(page.rooms.map((r: any) => [r.status, r.creator.uuid, r.participants.length])).toEqual([["called", account.uuid, 1]]);
  });

  it("opens the viewer's paper only for a user who keeps it", async () => {
    const keeper = await register(), other = await register();
    const digest = "5".repeat(64);
    await paperWithCopy(keeper, digest, "Viewed");
    expect((await ok("GET", `/api/viewer/${digest}`, { headers: keeper.headers })).sha256).toBe(digest);
    expect((await call("GET", `/api/viewer/${digest}`, { headers: other.headers })).status).toBe(403);
    expect((await call("GET", `/api/viewer/${digest}`)).status).toBe(401);
    expect((await call("GET", `/api/viewer/${"6".repeat(64)}`, { headers: keeper.headers })).status).toBe(404);
  });

  it("serves a stored PDF by its key, immutable and rangeable", async () => {
    const digest = await stored("%PDF-1.4 served");
    const served = await call("GET", `/uploads/${digest}.pdf`);
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("%PDF-1.4 served");
    expect(served.headers.get("content-type")).toBe("application/pdf");
    expect(served.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(served.headers.get("accept-ranges")).toBe("bytes");
    expect((await call("HEAD", `/uploads/${digest}.pdf`)).status).toBe(200);
    expect((await call("GET", "/uploads/nowhere.pdf")).status).toBe(404);
    expect((await rows("SELECT 1 FROM papers")).length).toBe(0);
    // Where the file is fetched from is the Worker's own route, the bucket having no address of its own here.
    const keeper = await register();
    await paperWithCopy(keeper, digest, "Served");
    expect((await ok("GET", `/api/viewer/${digest}`, { headers: keeper.headers })).file_url).toBe(`/uploads/${digest}.pdf`);
  });

  it("sends the client to the bucket's own address for a file when the bucket has one", async () => {
    const digest = await stored("%PDF-1.4 elsewhere");
    const hosted = { ...env, FILES_URL: "https://files.test/" as string } as Env;
    const ask = (method: string, path: string, headers: Record<string, string> = {}) => worker.fetch(new Request(`https://papol.test${path}`, { method, headers }), hosted);
    const sent = await ask("GET", `/uploads/${digest}.pdf`);
    expect(sent.status).toBe(301);
    expect(sent.headers.get("location")).toBe(`https://files.test/uploads/${digest}.pdf`);
    expect(sent.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await sent.text()).toBe("");
    expect((await ask("HEAD", `/uploads/${digest}.pdf`)).status).toBe(301);
    expect((await ask("GET", "/uploads/avatars/me.png")).headers.get("location")).toBe("https://files.test/uploads/avatars/me.png");
    // The key is still held to its shape; whether the file exists is the bucket's to answer.
    expect((await ask("GET", "/uploads/not%20a%20key.pdf")).status).toBe(404);
    expect((await ask("GET", "/uploads/nowhere.pdf")).status).toBe(301);
    // What names the file says where it is fetched from, so the viewer
    // reads the bytes from the bucket and never through the Worker.
    const keeper = await register();
    await paperWithCopy(keeper, digest, "Hosted");
    const opened = await (await ask("GET", `/api/viewer/${digest}`, keeper.headers)).json() as any;
    expect(opened).toMatchObject({ file_path: `${digest}.pdf`, file_url: `https://files.test/uploads/${digest}.pdf` });
    const page = await (await ask("GET", `/api/papers/${digest.slice(0, 32)}`, keeper.headers)).json() as any;
    expect(page.file_url).toBe(`https://files.test/uploads/${digest}.pdf`);
  });
});
