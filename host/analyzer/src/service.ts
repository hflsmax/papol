// The two things the analyzer does with a PDF, apart from how they are
// reached: the whole document read into references, markers and links,
// and the title block read into the upload form's fields. Both are read
// by rules (src/rules/), from the PDF alone; the shapes are the Worker's
// own (cloudflare/src/papers/reading.ts), imported.

import type { Analysis, HeaderMetadata } from "../../../cloudflare/src/papers/reading";
import { analyzeWithRules } from "./rules/analyze";
import { headerWithRules } from "./rules/header";

export type { Analysis, HeaderMetadata };

// What a request is answered with when it cannot be served: the status
// and one sentence, which becomes `{ detail }`.
export class Refusal extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

// A PDF announces itself in its first line; the specification allows a
// little junk before it.
export function isPdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

async function reading<T>(bytes: Uint8Array, read: (pdf: Uint8Array) => Promise<T>): Promise<T> {
  if (!isPdf(bytes)) throw new Refusal(400, "The body is not a PDF");
  try {
    return await read(bytes);
  } catch (error) {
    throw new Refusal(422, `The PDF could not be read: ${(error as Error).message}`);
  }
}

// The references, the markers that point at them, and the links to
// figures, tables and boxes.
export function analyze(bytes: Uint8Array): Promise<Analysis> {
  return reading(bytes, async (pdf) => (await analyzeWithRules(pdf)).analysis);
}

// The title block: what the first pages print, with no lookup behind it.
export function header(bytes: Uint8Array): Promise<HeaderMetadata> {
  return reading(bytes, async (pdf) => (await headerWithRules(pdf)).header);
}
