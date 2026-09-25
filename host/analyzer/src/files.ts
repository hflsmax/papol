// A paper's PDF, fetched by the analyzer itself from the bucket's public
// address, so the Worker sends a name and never the bytes.
//
// Only a paper's own address is fetched: an origin on the list (the
// production and dev bucket domains, set by module.nix), a path of the
// form /uploads/<sha256>.pdf, and bytes that hash to that name. So the
// analyzer cannot be pointed at any other URL, and whatever it reads is
// exactly the file the Worker named.

import { createHash } from "node:crypto";

import { Refusal } from "./service";

export const DEFAULT_FILE_ORIGINS = ["https://files.papol.io", "https://files-dev.papol.io"];
const PAPER_PATH = /^\/uploads\/([0-9a-f]{64})\.pdf$/;
// Downloading a long paper from the edge takes seconds; a stalled one is
// given up on well before the Worker's own five minutes.
const TIMEOUT_MS = 120_000;

export function fileOriginsFrom(value: string | undefined): string[] {
  const listed = (value ?? "").split(",").map((origin) => origin.trim().replace(/\/+$/, "")).filter(Boolean);
  return listed.length ? listed : DEFAULT_FILE_ORIGINS;
}

// The address as the Worker sent it, checked before anything is fetched.
export function paperAddress(value: unknown, origins: string[]): { url: URL; sha256: string } {
  if (typeof value !== "string") throw new Refusal(400, "Send { url } naming a paper's address");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Refusal(400, "The url is not an address");
  }
  if (!origins.includes(url.origin)) throw new Refusal(400, `The analyzer does not fetch from ${url.origin}`);
  const named = PAPER_PATH.exec(url.pathname);
  if (!named || url.search || url.hash) throw new Refusal(400, "The url is not a paper's address");
  return { url, sha256: named[1] };
}

export async function fetchPaper(address: { url: URL; sha256: string }, maxBytes: number, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  let response: Response;
  try {
    // The edge refuses some default agents; say who is asking.
    response = await fetchImpl(address.url, { headers: { "user-agent": "papol-analyzer" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Refusal(502, `The bucket could not be reached: ${(error as Error).message}`);
  }
  if (response.status === 404) throw new Refusal(404, "The bucket has no file at that address");
  if (response.status !== 200 || !response.body) throw new Refusal(502, `The bucket answered ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Refusal(413, `The file is over ${maxBytes} bytes`);
    }
    hash.update(value);
    chunks.push(value);
  }
  if (hash.digest("hex") !== address.sha256) throw new Refusal(422, "The file does not hash to its name");
  return new Uint8Array(Buffer.concat(chunks));
}
