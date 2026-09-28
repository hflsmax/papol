// Every paper's venue asked of the indexes again, as a job a migration
// queues once (0019_venues.sql). Venues were read before Papol knew a
// PACMPL issue is the conference ("POPL", not "Proceedings of the ACM on
// Programming Languages"), and an arXiv copy's registry knows no venue
// at all. A paper with a publisher's DOI is asked about by its DOI; an
// arXiv copy, or a paper with no DOI, is matched by its title, authors
// and year the way a printed reference is (resolve.ts), so a preprint
// gets the venue it was published in, as the publisher registered it
// with the published paper's DOI. A paper nobody knows keeps what it
// has.
//
// A job takes a chunk of papers, in digest order, and queues the next
// chunk after itself: a Worker invocation has only so many requests out.

import { all, type Row } from "../db";
import { enqueue, wake } from "../jobs/queue";
import { writePaper } from "../sync/write";
import { ARXIV_DOI_PREFIX, byDoi, Throttled, Unavailable } from "./bibliography";
import { paperVenue } from "./extract";
import { resolve } from "./resolve";

export const VENUES = "refresh_venues";

const CHUNK = 20;

async function venueOf(env: Env, paper: Row): Promise<string | null> {
  const doi = paper.doi ? String(paper.doi) : null;
  if (doi && !doi.toLowerCase().startsWith(ARXIV_DOI_PREFIX)) return (await byDoi(env, doi))?.venue ?? null;
  let authors: string[] = [];
  try { authors = paper.authors ? JSON.parse(String(paper.authors)) : []; } catch { authors = []; }
  const title = String(paper.title);
  const raw = [authors.join(", "), title, paper.year].filter(Boolean).join(". ");
  const found = await resolve(env, { raw, title, year: paper.year as number | null, authors: paper.authors as string | null });
  // The match is merged with OpenAlex, whose venue is the long proceedings
  // title; the venue is what the publisher registered with the DOI.
  const doiFound = found.summary?.doi;
  return doiFound ? (await byDoi(env, doiFound))?.venue ?? found.summary!.venue : found.summary?.venue ?? null;
}

export async function refreshVenuesJob(env: Env, payload: Row): Promise<Row> {
  const after = String(payload.after ?? "");
  const papers = await all<Row>(env.DB, "SELECT * FROM papers WHERE deleted_at IS NULL AND sha256 > ? ORDER BY sha256 LIMIT ?", after, CHUNK);
  const changed: string[] = [];
  for (const paper of papers) {
    let venue: string | null;
    try {
      venue = paperVenue(await venueOf(env, paper));
    } catch (error) {
      if (!(error instanceof Unavailable || error instanceof Throttled)) throw error;
      console.warn(`Venue of ${paper.sha256} not asked: ${error.message}`);
      continue;
    }
    if (!venue || venue === paper.journal) continue;
    paper.journal = venue;
    await (await writePaper(env.DB, paper, false)).run();
    changed.push(String(paper.sha256));
  }
  if (papers.length === CHUNK) {
    const next = enqueue(env.DB, VENUES, { after: papers[papers.length - 1].sha256 });
    await next.statement.run();
    await wake(env, [next.uuid]);
  }
  return { asked: papers.length, changed };
}
