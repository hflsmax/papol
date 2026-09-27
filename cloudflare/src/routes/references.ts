// The viewer's reference protocol: a paper's bibliography, one reference
// opened, a citation read off the page, and what the paper itself is.
// What a paper cites is a property of the file, so it is read by whoever
// may read the file: anyone holding its digest, which is a lean link in
// itself, or a link someone shared. Only resolving a reference anew spends
// work, and that is for a user who keeps the paper.

import limits from "../../../config/app_limits.json";
import { currentUser } from "../auth";
import { one } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { resolve } from "../papers/resolve";
import { lookUpPrinted, openReference, paperReferences, previewReference, referenceOr404, type Reference } from "../papers/references";
import { keptPaper, openSharable, viewerPaper } from "../papers/sharables";
import * as validate from "../validate";

export function referenceRoutes(router: Router) {
  router.on("GET", "/api/viewer-references/:digest", async ({ env, params, url }) => {
    const paper = await viewerPaper(env.DB, params.digest, url.searchParams.get("share"));
    return json(await paperReferences(env, paper));
  });

  router.on("GET", "/api/viewer-references/item/:uuid", async ({ env, params, url }) => {
    const share = url.searchParams.get("share");
    const reference = await one<Reference>(env.DB, "SELECT * FROM paper_references WHERE uuid = ?", params.uuid);
    if (share) {
      // The link opens one file, and it is not a key to every other PDF.
      const sharable = await openSharable(env.DB, share);
      if (!sharable || !reference || reference.paper_sha256 !== sharable.paper_sha256) refuse(404, "Reference not found");
      return json(await openReference(env, reference));
    }
    return json(await openReference(env, referenceOr404(reference)));
  });

  router.on("POST", "/api/viewer-references/:digest/preview", async ({ request, env, params }) => {
    const paper = await keptPaper(env.DB, params.digest, await currentUser(request, env));
    const data = await readJson<{ key?: unknown; raw?: unknown }>(request);
    const check = validate.checking();
    const key = check.string("key", data.key, { min: 1, max: limits.text.reference_key })!;
    const raw = check.string("raw", data.raw, { min: 3, max: limits.text.reference_raw })!;
    check.done();
    return json(await previewReference(env, paper, key.trim(), raw.split(/\s+/).filter(Boolean).join(" ")));
  });

  // One reference the viewer read off the page itself. Anyone who may read
  // the paper may have what it cites looked up, as with the item above.
  router.on("POST", "/api/viewer-references/:digest/resolve", async ({ request, env, params, url }) => {
    const paper = await viewerPaper(env.DB, params.digest, url.searchParams.get("share"));
    const data = await readJson<Record<string, unknown>>(request);
    const check = validate.checking();
    const key = check.string("key", data.key, { min: 1, max: limits.text.reference_key })!;
    const index = check.integer("index", data.index, { min: 0, max: 100_000 })!;
    const raw = check.string("raw", data.raw, { min: 3, max: limits.text.reference_raw })!;
    const title = check.string("title", data.title, { optional: true, max: limits.text.reference_raw });
    const year = check.integer("year", data.year, { optional: true, min: 0, max: 3000 });
    const journal = check.string("journal", data.journal, { optional: true, max: limits.text.reference_raw });
    const doi = check.string("doi", data.doi, { optional: true, max: limits.text.paper_doi });
    const arxivId = check.string("arxiv_id", data.arxiv_id, { optional: true, max: limits.text.reference_key });
    const authors = data.authors ?? [];
    if (!Array.isArray(authors) || authors.length > 500 || authors.some((a) => typeof a !== "string" || a.length > limits.text.reference_key)) check.fail("authors must be a list of names");
    check.done();
    return json(await lookUpPrinted(env, paper, {
      key: key.trim(), index, raw: raw.split(/\s+/).filter(Boolean).join(" "), title, authors: authors as string[], year, journal, doi, arxiv_id: arxivId,
    }));
  });

  // Enriched bibliographic information for the paper being viewed. What
  // a paper is remains public either way.
  router.on("GET", "/api/viewer/:digest/info", async ({ env, params, url }) => {
    const paper = await viewerPaper(env.DB, params.digest, url.searchParams.get("share"));
    const raw = [paper.title, paper.journal, paper.year, paper.doi].filter((v) => v !== null && v !== undefined && v !== "").join(" ");
    const outcome = await resolve(env, { raw, title: paper.title, year: paper.year, doi: paper.doi, arxiv_id: null });
    if (outcome.status === "ok") {
      const { host, ...summary } = outcome.summary;
      return json({ ...summary, venue: summary.venue ?? host ?? null });
    }
    let authors: unknown[] = [];
    try { authors = paper.authors ? JSON.parse(paper.authors) : []; } catch { authors = paper.authors ? [paper.authors] : []; }
    return json({ title: paper.title, authors, year: paper.year, venue: paper.journal, abstract: null, citations: null, doi: paper.doi, url: paper.doi ? `https://doi.org/${paper.doi}` : null, pdf_url: null, source: null });
  });
}
