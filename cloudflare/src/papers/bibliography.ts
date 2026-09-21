// Exact bibliographic metadata for an uploaded paper: CrossRef first,
// OpenAlex behind it.
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
  source: "crossref" | "openalex";
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

// -------------------------------------------------------------- OpenAlex

export async function openalexByDoi(env: Env, doi: string): Promise<Record<string, any> | null> {
  const params = new URLSearchParams();
  if (env.PAPOL_CONTACT_EMAIL) params.set("mailto", env.PAPOL_CONTACT_EMAIL);
  if (env.PAPOL_OPENALEX_KEY) params.set("api_key", env.PAPOL_OPENALEX_KEY);
  const query = params.toString();
  let response: Response;
  try {
    response = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(bare(doi).toLowerCase())}${query ? `?${query}` : ""}`, {
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

// ---------------------------------------------------------------- lookup

// Resolve a DOI through CrossRef, falling back to OpenAlex. Null when
// neither knows it; Unavailable when neither could answer.
export async function byDoi(env: Env, doi: string): Promise<Summary | null> {
  const failures: Error[] = [];
  try {
    const item = await crossrefByDoi(env, doi);
    if (item) return summarizeCrossref(item);
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    failures.push(error);
  }
  try {
    const work = await openalexByDoi(env, doi);
    if (work) return summarizeOpenalex(work);
  } catch (error) {
    if (!(error instanceof Unavailable || error instanceof Throttled)) throw error;
    failures.push(error);
  }
  if (failures.length === 2) throw new Unavailable("CrossRef and OpenAlex are unavailable");
  return null;
}
