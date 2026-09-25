// The two things the helper does with a PDF, apart from how they are
// reached: the whole document read into references, markers and links,
// and the title block read into the upload form's fields. The TEI
// reading is the Worker's own, imported, so the host and the Worker can
// never disagree about what GROBID said.

import { parseHeader, parseTei, type Analysis, type HeaderMetadata } from "../../../cloudflare/src/papers/tei";
import { GrobidError, type Grobid } from "./grobid";
import { analyzeWithRules } from "./rules/analyze";
import { headerWithRules } from "./rules/header";

export type { Analysis, HeaderMetadata };

// What a request is answered with when it cannot be served: the status
// and one sentence, which becomes `{ detail }`.
export class Refusal extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

// A PDF announces itself in its first line; the specification allows a
// little junk before it. Anything else is not for GROBID.
export function isPdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

async function through<T>(bytes: Uint8Array, call: (pdf: Uint8Array) => Promise<string>, read: (tei: string) => T): Promise<T> {
  if (!isPdf(bytes)) throw new Refusal(400, "The body is not a PDF");
  let tei: string;
  try {
    tei = await call(bytes);
  } catch (error) {
    if (error instanceof GrobidError) throw new Refusal(502, error.message);
    throw error;
  }
  try {
    return read(tei);
  } catch (error) {
    throw new Refusal(502, `GROBID's answer could not be read: ${(error as Error).message}`);
  }
}

export function analyze(grobid: Grobid, bytes: Uint8Array): Promise<Analysis> {
  return through(bytes, grobid.fulltext, parseTei);
}

// The same answer read by rules, without GROBID (src/rules/). Nothing it
// finds on the page is taken from a model.
export async function analyzeByRules(bytes: Uint8Array): Promise<Analysis> {
  if (!isPdf(bytes)) throw new Refusal(400, "The body is not a PDF");
  try {
    return (await analyzeWithRules(bytes)).analysis;
  } catch (error) {
    throw new Refusal(422, `The PDF could not be read: ${(error as Error).message}`);
  }
}

// The title block read by rules, without GROBID (src/rules/header.ts):
// what the page prints, with no Crossref lookup behind it.
export async function headerByRules(bytes: Uint8Array): Promise<HeaderMetadata> {
  if (!isPdf(bytes)) throw new Refusal(400, "The body is not a PDF");
  try {
    return (await headerWithRules(bytes)).header;
  } catch (error) {
    throw new Refusal(422, `The PDF could not be read: ${(error as Error).message}`);
  }
}

export function header(grobid: Grobid, bytes: Uint8Array): Promise<HeaderMetadata> {
  return through(bytes, grobid.header, parseHeader);
}
