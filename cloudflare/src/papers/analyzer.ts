// The host's analyzer: the service on the NixOS host (host/analyzer/) that
// reads a stored paper by rules and answers what the Worker wants
// stored — the references, markers and links, or the title block. It is
// sent the paper's public address and fetches the PDF from the bucket
// itself, so no PDF passes through a Worker on its way to be read; only a
// Worker with no bucket domain (local development) still sends the bytes.
// A Worker invocation has too little CPU to read a document; the reading
// runs where the CPU is.
//
// Reached through the tunnel and nginx front door of `analyzer.expose`
// (module.nix): `${ANALYZER_URL}/analyze` and `/header`, with one basic-auth
// credential.

import { fileUrl, UPLOADS } from "../files";
import type { Analysis, HeaderMetadata } from "./reading";

// Fetching and reading a long paper can take a while; this is a job, so
// it can wait. nginx and the analyzer allow the same.
const TIMEOUT_MS = 300_000;

export function configured(env: Env): boolean {
  return Boolean(env.ANALYZER_URL);
}

// A stored paper as the analyzer is sent it: its address on the bucket's
// domain, which the analyzer fetches and checks against the name, or, where
// the bucket has no domain, the bytes themselves.
async function sent(env: Env, filePath: string): Promise<{ body: BodyInit; type: string }> {
  const key = `${UPLOADS}${filePath}`;
  const url = fileUrl(env, key);
  if (url) return { body: JSON.stringify({ url }), type: "application/json" };
  const object = await env.FILES.get(key);
  if (!object) throw new Error("The PDF for this paper is missing");
  return { body: new Uint8Array(await object.arrayBuffer()) as unknown as BodyInit, type: "application/pdf" };
}

async function post<T>(env: Env, path: string, filePath: string): Promise<T> {
  if (!env.ANALYZER_URL) throw new Error("No analyzer service configured");
  const { body, type } = await sent(env, filePath);
  const headers: Record<string, string> = { "content-type": type };
  if (env.ANALYZER_AUTH) headers.authorization = `Basic ${btoa(env.ANALYZER_AUTH)}`;
  const response = await fetch(`${env.ANALYZER_URL.replace(/\/+$/, "")}${path}`, {
    method: "POST", body, headers, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status !== 200) {
    // The analyzer says why in one sentence; nginx, in front of an analyzer
    // that is down, says nothing useful.
    let detail: string | null = null;
    try { detail = String(((await response.json()) as { detail?: unknown }).detail ?? "") || null; } catch { detail = null; }
    throw new Error(detail ?? `The analyzer returned ${response.status}`);
  }
  return (await response.json()) as T;
}

// A paper's references, the markers that point at them, and its links to
// figures and tables. Throws on anything that went wrong, so the caller
// can record why a paper has no references rather than silently showing
// none.
export function analyze(env: Env, filePath: string): Promise<Analysis> {
  return post<Analysis>(env, "/analyze", filePath);
}

// The title block, with the identifiers printed on the first pages.
export function header(env: Env, filePath: string): Promise<HeaderMetadata> {
  return post<HeaderMetadata>(env, "/header", filePath);
}
