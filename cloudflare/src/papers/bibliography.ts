// Exact bibliographic metadata for an uploaded paper, from the registry
// that holds its DOI — CrossRef for publishers, DataCite for arXiv and
// the other repositories — with OpenAlex behind CrossRef (see byDoi).
//
// CrossRef knows what a reference *is* — it is the registry publishers
// write to. OpenAlex knows what happened to it since: citations, a free
// copy, an abstract. Looking a work up by its DOI is cheap on both; a
// contact address in the User-Agent puts the requests in each service's
// polite pool, and an OpenAlex key raises its daily allowance.

import limits from "../../../config/app_limits.json";

const TIMEOUT_MS = limits.timeouts_ms.bibliography_http;

export class Unavailable extends Error {
  constructor(message: string) { super(message); this.name = "Unavailable"; }
}

export class Throttled extends Error {
  constructor(message: string) { super(message); this.name = "Throttled"; }
}

export interface Summary {
  title: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  citations: number | null;
  doi: string | null;
  url: string | null;
  pdf_url: string | null;
  source: "crossref" | "openalex" | "datacite";
  host?: string | null;
}

function userAgent(env: Env): string {
  const contact = env.PAPOL_CONTACT_EMAIL ? `; mailto:${env.PAPOL_CONTACT_EMAIL}` : "";
  return `Papol/1.0 (Spontaneous Seminar Paper Reading App${contact})`;
}

function bare(doi: string): string {
  return doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
}

const unescapeHtml = (text: string) => text
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// -------------------------------------------------------------- CrossRef

export async function crossrefByDoi(env: Env, doi: string): Promise<Record<string, any> | null> {
  let response: Response;
  try {
    response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(bare(doi))}`, {
      headers: { "user-agent": userAgent(env) }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Unavailable(String((error as Error).message ?? error));
  }
  if (response.status === 404) return null;
  if (response.status !== 200) throw new Unavailable(`CrossRef returned ${response.status}`);
  try {
    return ((await response.json()) as { message?: Record<string, any> }).message ?? null;
  } catch (error) {
    throw new Unavailable(String((error as Error).message ?? error));
  }
}

// A CrossRef item as the viewer's popup wants it. Thinner than
// OpenAlex's: CrossRef often has no abstract.
export function summarizeCrossref(item: Record<string, any>): Summary {
  let title: string | null = item.title?.[0] ?? null;
  const subtitle: string | null = item.subtitle?.[0] ?? null;
  if (title && subtitle) title = `${title.trimEnd().replace(/:+$/, "")}: ${subtitle}`;
  else if (subtitle) title = subtitle;
  if (title) title = unescapeHtml(title);
  let container: string | null = item["container-title"]?.[0] ?? null;
  if (container) container = unescapeHtml(container).split(/\s+/).join(" ").replace(/[\s-]+$/, "") || null;
  const issued = item.issued?.["date-parts"]?.[0];
  const year: number | null = issued?.[0] ?? null;
  let abstract: string | null = item.abstract ?? null;
  if (abstract) abstract = abstract.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).join(" ") || null;
  const doi: string | null = item.DOI ?? null;
  return {
    title, authors: (item.author ?? []).map((a: any) => unescapeHtml([a.given, a.family].filter(Boolean).join(" "))),
    year, venue: container, abstract, citations: item["is-referenced-by-count"] ?? null,
    doi, url: doi ? `https://doi.org/${doi}` : null,
    pdf_url: (item.link ?? []).find((l: any) => String(l["content-type"] ?? "").endsWith("pdf"))?.URL ?? null,
    source: "crossref",
  };
}

// The matcher. Given a reference exactly as printed — authors, title,
// venue, pages, year, run together in whatever style the bibliography
// used — CrossRef's `query.bibliographic` finds the work it names.
// Several candidates, not one: CrossRef ranks by text similarity alone,
// and its top hit is sometimes a later journal version of a conference
// paper. The caller decides which is really the work.
export async function crossrefMatch(env: Env, raw: string): Promise<Record<string, any>[]> {
  const query = crossrefQuery(raw);
  if (!query) return [];
  const params = new URLSearchParams({
    "query.bibliographic": query, rows: String(limits.counts.bibliography_results),
    select: "DOI,title,author,issued,container-title,is-referenced-by-count,abstract,link,score",
  });
  let response: Response;
  try {
    response = await fetch(`https://api.crossref.org/works?${params}`, { headers: { "user-agent": userAgent(env) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Unavailable(String((error as Error).message ?? error));
  }
  if (response.status !== 200) throw new Unavailable(`CrossRef returned ${response.status}`);
  try {
    return ((await response.json()) as any).message?.items ?? [];
  } catch (error) {
    throw new Unavailable(String((error as Error).message ?? error));
  }
}

// The reference, tidied into a query. A trailing "arXiv preprint
// arXiv:1607.06450" is not in CrossRef at all and, left in, dominates
// the match; bare URLs do the same for less reason.
export function crossrefQuery(raw: string): string {
  return raw.replace(/arXiv\s*preprint\s*arXiv:\s*[\d.]+(v\d+)?/gi, " ").replace(/https?:\/\/\S+/g, " ")
    .split(/\s+/).filter(Boolean).join(" ").slice(0, limits.text.crossref_query);
}

// -------------------------------------------------------------- OpenAlex

async function openalexGet(env: Env, path: string, extra: Record<string, string> = {}): Promise<Record<string, any> | null> {
  const params = new URLSearchParams(extra);
  if (env.PAPOL_CONTACT_EMAIL) params.set("mailto", env.PAPOL_CONTACT_EMAIL);
  if (env.PAPOL_OPENALEX_KEY) params.set("api_key", env.PAPOL_OPENALEX_KEY);
  const query = params.toString();
  let response: Response;
  try {
    response = await fetch(`https://api.openalex.org${path}${query ? `?${query}` : ""}`, {
      headers: { "user-agent": userAgent(env) }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Unavailable(String((error as Error).message ?? error));
  }
  if (response.status === 429) {
    let message = "rate limited";
    try { message = String(((await response.json()) as any).message ?? "").trim() || message; } catch { /* the status says enough */ }
    throw new Throttled(message);
  }
  if (response.status === 404) return null;
  if (response.status !== 200) throw new Unavailable(`OpenAlex returned ${response.status}`);
  try {
    return (await response.json()) as Record<string, any>;
  } catch (error) {
    throw new Unavailable(String((error as Error).message ?? error));
  }
}

export function openalexByDoi(env: Env, doi: string): Promise<Record<string, any> | null> {
  return openalexGet(env, `/works/doi:${encodeURIComponent(bare(doi).toLowerCase())}`);
}

// arXiv preprints carry a DataCite DOI of a fixed shape, so an arXiv
// number is a DOI lookup in disguise.
export function openalexByArxiv(env: Env, arxivId: string): Promise<Record<string, any> | null> {
  const number = arxivId.trim().replace("arXiv:", "").replace(/v\d+$/i, "");
  return openalexByDoi(env, `10.48550/arXiv.${number}`);
}

// Candidates matching a title, best first. A title and not a whole
// reference string: OpenAlex's `search` is a relevance search over
// title and abstract, and a raw reference pulls it badly off course.
// Metered, so asked only when nothing cheaper has answered.
export async function openalexByTitle(env: Env, title: string): Promise<Record<string, any>[]> {
  const wanted = title.split(/\s+/).filter(Boolean).join(" ");
  if (wanted.length < limits.matching.title_search_length_min) return [];
  const data = await openalexGet(env, "/works", { "per-page": String(limits.counts.bibliography_results), search: wanted });
  return data?.results ?? [];
}

// OpenAlex stores abstracts as an inverted index — word to the positions
// it occupies. Reading it back out is just a sort.
function abstractOf(work: Record<string, any>): string | null {
  const inverted = work.abstract_inverted_index as Record<string, number[]> | null;
  if (!inverted) return null;
  const positions: [number, string][] = [];
  for (const [word, spots] of Object.entries(inverted)) for (const i of spots) positions.push([i, word]);
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, word]) => word).join(" ") || null;
}

const HOSTS = new Set(["repository", "ebook platform"]);

// Where the work was published, and where a copy lives. Only the
// publisher's location is the venue; a repository is a host.
function venueOf(work: Record<string, any>): { venue: string | null; host: string | null } {
  let venue: string | null = null, host: string | null = null;
  for (const location of [work.primary_location, ...(work.locations ?? []), work.best_oa_location]) {
    const source = location?.source;
    if (!source?.display_name) continue;
    if (HOSTS.has(source.type)) host = host ?? source.display_name;
    else venue = venue ?? source.display_name;
  }
  return { venue, host };
}

export function summarizeOpenalex(work: Record<string, any>): Summary {
  const { venue, host } = venueOf(work);
  return {
    title: work.display_name ?? null,
    authors: (work.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
    year: work.publication_year ?? null, venue, host, abstract: abstractOf(work),
    citations: work.cited_by_count ?? null,
    doi: String(work.doi ?? "").replace("https://doi.org/", "") || null,
    url: work.doi ?? work.primary_location?.landing_page_url ?? null,
    pdf_url: work.best_oa_location?.pdf_url ?? null,
    source: "openalex",
  };
}

// -------------------------------------------------------------- DataCite

// arXiv registers its DOIs (10.48550/arXiv.<id>) with DataCite, not
// CrossRef, and OpenAlex does not index a work by them: both answer 404,
// and an arXiv paper used to be read off its title block by the host
// instead. DataCite is the registry that knows them.
export const ARXIV_DOI_PREFIX = "10.48550/";

export async function dataciteByDoi(env: Env, doi: string): Promise<Record<string, any> | null> {
  let response: Response;
  try {
    response = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(bare(doi).toLowerCase())}`, {
      headers: { "user-agent": userAgent(env), accept: "application/vnd.api+json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Unavailable(String((error as Error).message ?? error));
  }
  if (response.status === 404) return null;
  if (response.status !== 200) throw new Unavailable(`DataCite returned ${response.status}`);
  try {
    return ((await response.json()) as { data?: { attributes?: Record<string, any> } }).data?.attributes ?? null;
  } catch (error) {
    throw new Unavailable(String((error as Error).message ?? error));
  }
}

// A DataCite record as the form wants it. arXiv is where the preprint is
// held, not a venue it appeared in, so it is the host, as OpenAlex has it.
export function summarizeDatacite(record: Record<string, any>): Summary {
  const title: string | null = record.titles?.find((t: any) => !t.titleType)?.title ?? record.titles?.[0]?.title ?? null;
  const authors = (record.creators ?? [])
    .map((c: any) => (c.givenName || c.familyName ? [c.givenName, c.familyName].filter(Boolean).join(" ") : String(c.name ?? "")).trim())
    .filter(Boolean);
  const abstract: string | null = record.descriptions?.find((d: any) => d.descriptionType === "Abstract")?.description ?? null;
  const doi: string | null = record.doi ?? null;
  return {
    title, authors, year: Number(record.publicationYear) || null, venue: null, host: record.publisher ?? null,
    abstract: abstract ? abstract.split(/\s+/).join(" ") : null, citations: record.citationCount ?? null,
    doi, url: doi ? `https://doi.org/${doi}` : null, pdf_url: null, source: "datacite",
  };
}

// ---------------------------------------------------------------- lookup

// Resolve a DOI by asking the registry that holds it. Null when nobody
// knows it, and the caller reads the paper's title block instead;
// Unavailable when no source could answer at all.
//
// Measured 2026-09-22 on Papol's 30 DOIs and ten well-known arXiv papers,
// each asked three times (docs/cloud-migration.md, phase 5, step 11): the
// two registries each hold all of their own DOIs and none of the other's,
// and never failed; OpenAlex knew every publisher DOI CrossRef did, but
// missed 4 of 12 arXiv DOIs and gave 2 more the wrong title. So:
//
// - An arXiv DOI (10.48550/arXiv.…) is DataCite's, and DataCite alone is
//   asked: failing it, the title block, never OpenAlex's guess.
// - Any other DOI is asked of CrossRef. One CrossRef has never heard of
//   (404) is asked of DataCite, which registers the rest (LIPIcs,
//   Zenodo, …). OpenAlex stands in only when CrossRef itself could not
//   answer — down, slow, throttled — and DataCite after it, since the
//   DOI may be DataCite's.
export async function byDoi(env: Env, doi: string): Promise<Summary | null> {
  if (bare(doi).toLowerCase().startsWith(ARXIV_DOI_PREFIX)) {
    try {
      const record = await dataciteByDoi(env, doi);
      return record ? summarizeDatacite(record) : null;
    } catch (error) {
      if (!(error instanceof Unavailable)) throw error;
      console.warn(`DataCite could not answer for ${doi}: ${error.message}`);
      return null;
    }
  }
  let crossrefDown = false;
  try {
    const item = await crossrefByDoi(env, doi);
    if (item) return summarizeCrossref(item);
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    crossrefDown = true;
  }
  let openalexDown = false;
  if (crossrefDown) {
    try {
      const work = await openalexByDoi(env, doi);
      if (work) return summarizeOpenalex(work);
    } catch (error) {
      if (!(error instanceof Unavailable || error instanceof Throttled)) throw error;
      openalexDown = true;
    }
  }
  try {
    const record = await dataciteByDoi(env, doi);
    if (record) return summarizeDatacite(record);
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    // CrossRef had never heard of it and DataCite could not say: nobody
    // knows it, as far as can be told. With CrossRef and OpenAlex down
    // too, nobody could answer.
    if (crossrefDown && openalexDown) throw new Unavailable("CrossRef, OpenAlex and DataCite are unavailable");
  }
  return null;
}
