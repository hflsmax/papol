// The published version of a paper that prints no identifier of its own.
//
// An author's copy — the PDF on a home page or in a university's
// repository — is often the accepted manuscript, typeset in the
// venue's style but without the publisher's DOI, venue line or year:
// "Modeling Game Mechanics with Ceptre", posted in the IEEE Transactions
// style, prints a title, four names, an abstract and its index terms,
// and nothing else of where it appeared. What it prints is enough to
// find the published paper: its title and its authors, searched for the
// way a printed reference is (resolve.ts), give the DOI the publisher
// registered, and that DOI's record gives the venue and year.
//
// The test is stricter than a reference's. A reference prints more than
// its title, so a candidate's title need only be contained in it; here
// the title is all there is, and "Ceptre: A Language for Modeling
// Generative Interactive Systems" is contained in no other Ceptre
// paper's title only by luck. So the titles must agree both ways, and
// the names must too — the first author's surname, and most of the
// others' — before the paper is taken for the published one. A preprint
// server's record is not the published version, so a Crossref
// `posted-content` item is passed over.
//
// Crossref goes first, being free; OpenAlex, which is metered, only
// when Crossref has no convincing answer. Neither answering is no
// answer: the form keeps the title block as read.

import {
  ARXIV_DOI_PREFIX, byDoi, crossrefMatch, openalexByTitle, summarizeCrossref, summarizeOpenalex, Throttled, Unavailable, type Summary,
} from "./bibliography";
import { titleMatches } from "./resolve";
import type { HeaderMetadata } from "./reading";

// Crossref's kinds that are not a published version of a paper.
const NOT_PUBLISHED = new Set(["posted-content", "peer-review", "component", "dataset", "grant"]);

// A name's surname as a word to compare: its last word, without accents
// or case.
function surname(name: string): string | null {
  const words = name.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().match(/[a-z]+/g) ?? [];
  return words.filter((w) => w.length > 1).pop() ?? null;
}

function nameWords(names: string[]): Set<string> {
  return new Set(names.flatMap((n) => n.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().match(/[a-z]+/g) ?? []));
}

// The names the paper prints are the candidate's: the first author, and
// at least half of the rest.
export function authorsAgree(printed: string[], candidate: string[]): boolean {
  const surnames = printed.map(surname).filter((s): s is string => !!s);
  if (!surnames.length || !candidate.length) return false;
  const theirs = nameWords(candidate);
  if (!theirs.has(surnames[0])) return false;
  return surnames.filter((s) => theirs.has(s)).length * 2 >= surnames.length;
}

// The candidate is the paper: the same title read either way, by the
// same people, with a DOI of a publisher's. A year the paper prints
// must be near the candidate's — an author's copy is often posted a
// year before the issue it lands in, rarely more.
export function isPublishedVersion(header: HeaderMetadata, summary: Summary): boolean {
  if (!header.title || !summary.title || !summary.doi) return false;
  if (summary.doi.toLowerCase().startsWith(ARXIV_DOI_PREFIX)) return false;
  if (!titleMatches(summary.title, "", header.title) || !titleMatches(header.title, "", summary.title)) return false;
  if (header.year && summary.year && Math.abs(header.year - summary.year) > 2) return false;
  return authorsAgree(header.authors, summary.authors);
}

// The published version's record, as the registry that holds its DOI
// knows it; null when no index has one that is convincingly this paper,
// or none could answer.
export async function publishedVersion(env: Env, header: HeaderMetadata | null | undefined): Promise<Summary | null> {
  if (!header?.title || !header.authors.length) return null;
  const raw = `${header.authors.join(", ")}. ${header.title}`;
  try {
    const items = await crossrefMatch(env, raw);
    const found = items.filter((item) => !NOT_PUBLISHED.has(String(item.type ?? ""))).map(summarizeCrossref)
      .find((summary) => isPublishedVersion(header, summary));
    if (found) return found;
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    console.warn(`CrossRef search for a published version unavailable: ${error.message}`);
  }
  let found: Summary | undefined;
  try {
    found = (await openalexByTitle(env, header.title)).map(summarizeOpenalex).find((summary) => isPublishedVersion(header, summary));
  } catch (error) {
    if (!(error instanceof Unavailable || error instanceof Throttled)) throw error;
    console.warn(`OpenAlex search for a published version unavailable: ${error.message}`);
    return null;
  }
  if (!found) return null;
  // OpenAlex's venue is often the long proceedings title, and its record
  // is not the registry's: the venue is what the publisher registered
  // with the DOI, when the registry can be asked.
  try {
    const registered = await byDoi(env, found.doi!);
    if (registered && isPublishedVersion(header, registered)) return registered;
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
  }
  return found;
}
