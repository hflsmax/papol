// GROBID: the analyzer that turns a PDF into a reference list. A trained
// model that says "[12]" on page 3 is a citation and which line of the
// bibliography it points at. It runs as its own service on the NixOS
// host, reached through a Cloudflare tunnel with nginx in front asking
// for one credential (module.nix, `grobid.expose`), which the Worker
// presents with each request.

import { parseHeader, parseTei, type Analysis, type HeaderMetadata } from "./tei";

// GROBID reads the whole document with a CRF cascade; ten to sixty
// seconds for a long paper is normal. This is a job, so it can wait.
const ANALYZE_TIMEOUT_MS = 300_000;

export function configured(env: Env): boolean {
  return Boolean(env.GROBID_URL);
}

async function post(env: Env, path: string, bytes: Uint8Array, fields: [string, string][]): Promise<string> {
  if (!env.GROBID_URL) throw new Error("No GROBID service configured");
  const form = new FormData();
  form.set("input", new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" }), "paper.pdf");
  for (const [name, value] of fields) form.append(name, value);
  const headers: Record<string, string> = {};
  if (env.GROBID_AUTH) headers.authorization = `Basic ${btoa(env.GROBID_AUTH)}`;
  const response = await fetch(`${env.GROBID_URL.replace(/\/+$/, "")}${path}`, { method: "POST", body: form, headers, signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS) });
  if (response.status === 204) throw new Error("GROBID could not read this PDF (no text extracted)");
  if (response.status !== 200) throw new Error(`GROBID returned ${response.status}`);
  return response.text();
}

// Read a PDF through GROBID: its references and markers. Throws on
// anything that went wrong, so the caller can record why a paper has no
// references rather than silently showing none.
export async function analyze(env: Env, bytes: Uint8Array): Promise<Analysis> {
  return parseTei(await post(env, "/api/processFulltextDocument", bytes, [
    // Repeated once per element boxes are wanted for; without it GROBID
    // returns the structure but not the geometry.
    ["teiCoordinates", "ref"], ["teiCoordinates", "biblStruct"], ["teiCoordinates", "figure"],
    ["includeRawCitations", "1"],
    // Consolidation would have GROBID call CrossRef itself, one reference
    // at a time, inside this request. Papol looks up later and lazily.
    ["consolidateCitations", "0"], ["consolidateHeader", "0"],
  ]));
}

// The title block alone, for a paper that prints no identifier.
export async function extractHeader(env: Env, bytes: Uint8Array): Promise<HeaderMetadata> {
  return parseHeader(await post(env, "/api/processHeaderDocument", bytes, [["consolidateHeader", "0"]]));
}
