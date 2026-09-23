// The host's helper: the service beside GROBID on the NixOS host
// (host/helper/) that reads a stored paper and answers what the Worker
// wants stored — the references, markers and links, or the title
// block — having run GROBID and read its TEI there. It is sent the
// paper's public address and fetches the PDF from the bucket itself, so
// no PDF passes through a Worker on its way to be read; only a Worker
// with no bucket domain (local development) still sends the bytes. The Worker on the
// Free plan has about ten milliseconds of CPU per invocation, which is
// enough to forward bytes and write rows and not enough to read a
// document; the reading runs where the CPU is.
//
// Reached through the tunnel and nginx front door of `grobid.expose`
// (module.nix): `${GROBID_URL}/helper/…`, with the same basic-auth
// credential GROBID itself is behind.

import { fileUrl, UPLOADS } from "../files";
import type { Analysis, HeaderMetadata } from "./tei";

// A GROBID pass over a long paper takes a minute; this is a job, so it
// can wait. nginx and the helper allow the same.
const TIMEOUT_MS = 300_000;

export function configured(env: Env): boolean {
  return Boolean(env.GROBID_URL);
}

// A stored paper as the helper is sent it: its address on the bucket's
// domain, which the helper fetches and checks against the name, or, where
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
  if (!env.GROBID_URL) throw new Error("No helper service configured");
  const { body, type } = await sent(env, filePath);
  const headers: Record<string, string> = { "content-type": type };
  if (env.GROBID_AUTH) headers.authorization = `Basic ${btoa(env.GROBID_AUTH)}`;
  const response = await fetch(`${env.GROBID_URL.replace(/\/+$/, "")}/helper${path}`, {
    method: "POST", body, headers, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status !== 200) {
    // The helper says why in one sentence; nginx, in front of a helper
    // that is down, says nothing useful.
    let detail: string | null = null;
    try { detail = String(((await response.json()) as { detail?: unknown }).detail ?? "") || null; } catch { detail = null; }
    throw new Error(detail ?? `The helper returned ${response.status}`);
  }
  return (await response.json()) as T;
}

// Read a PDF through GROBID on the host: its references and markers.
// Throws on anything that went wrong, so the caller can record why a
// paper has no references rather than silently showing none.
// By rules instead (host/helper/src/rules/) where the environment asks for
// them: the same answer, with no model in it.
export function analyze(env: Env, filePath: string): Promise<Analysis> {
  return post<Analysis>(env, env.ANALYZER === "rules" ? "/analyze-rules" : "/analyze", filePath);
}

// The title block, with the identifiers GROBID found or CrossRef gave it.
export function header(env: Env, filePath: string): Promise<HeaderMetadata> {
  return post<HeaderMetadata>(env, "/header", filePath);
}
