// The host's helper: the service beside GROBID on the NixOS host
// (host/helper/) that takes a PDF's bytes and answers what the Worker
// wants stored — the references, markers and links, or the title
// block — having run GROBID and read its TEI there. The Worker on the
// Free plan has about ten milliseconds of CPU per invocation, which is
// enough to forward bytes and write rows and not enough to read a
// document; the reading runs where the CPU is.
//
// Reached through the tunnel and nginx front door of `grobid.expose`
// (module.nix): `${GROBID_URL}/helper/…`, with the same basic-auth
// credential GROBID itself is behind.

import type { Analysis, HeaderMetadata } from "./tei";

// A GROBID pass over a long paper takes a minute; this is a job, so it
// can wait. nginx and the helper allow the same.
const TIMEOUT_MS = 300_000;

export function configured(env: Env): boolean {
  return Boolean(env.GROBID_URL);
}

async function post<T>(env: Env, path: string, bytes: Uint8Array): Promise<T> {
  if (!env.GROBID_URL) throw new Error("No helper service configured");
  const headers: Record<string, string> = { "content-type": "application/pdf" };
  if (env.GROBID_AUTH) headers.authorization = `Basic ${btoa(env.GROBID_AUTH)}`;
  const response = await fetch(`${env.GROBID_URL.replace(/\/+$/, "")}/helper${path}`, {
    method: "POST", body: bytes as unknown as BodyInit, headers, signal: AbortSignal.timeout(TIMEOUT_MS),
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
export function analyze(env: Env, bytes: Uint8Array): Promise<Analysis> {
  return post<Analysis>(env, "/analyze", bytes);
}

// The title block, with the identifiers GROBID found or CrossRef gave it.
export function header(env: Env, bytes: Uint8Array): Promise<HeaderMetadata> {
  return post<HeaderMetadata>(env, "/header", bytes);
}
