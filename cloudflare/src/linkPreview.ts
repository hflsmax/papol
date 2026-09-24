// A YouTube video's title and picture, read from the video's page.
//
// linkpeek reads the page the way a link unfurler does: the head's Open
// Graph, Twitter card and JSON-LD tags, a few kilobytes of it, with
// private and credentialed targets refused and every redirect checked
// before it is followed. YouTube names the video there (og:title,
// og:image), and a youtu.be link lands on the video it names.
//
// The picture the page names is fetched here and put in the bucket under
// its digest, as every board file is; the answer is the digest, which the
// client names on the card: in the card's route on the web, in the nook on
// the Mac, which takes the bytes from the bucket's own address. No bytes
// pass through the Worker to a client (files.ts).
//
// Bilibili is not read here: it answers Cloudflare's network 412 whatever
// the User-Agent (checked 2026-09-24 from a Cloudflare Worker, as an unfurler, a
// phone and a desktop browser), so the Mac reads its page and linkpeek
// parses it there (shared/videos.js). A page card's picture is the page
// itself, rendered (jobs/capture.ts).

import { LinkpeekError, preview, validateUrl } from "linkpeek";

import limits from "../../config/app_limits.json";
import { refuse } from "./http";
import { blobKey, boardFileKey, sha256Hex, stored } from "./files";
import { videoLink } from "./videos";

const PICTURE_LIMIT = limits.files.board_file_mb * 1024 * 1024;

// What reaches YouTube. Tests answer in its place.
export const outbound = { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) };

export interface VideoPreview {
  id: string;
  title: string | null;
  // The picture, in the bucket as a board file.
  sha256: string;
}

// The preview of a YouTube link, or a refusal saying why there is none.
export async function videoPreview(env: Env, url: string): Promise<VideoPreview> {
  const link = videoLink(url) ?? refuse(422, "Paste a YouTube or Bilibili video link");
  if (link.kind !== "youtube" || !link.id) refuse(422, "Only the Papol Mac app can fetch a Bilibili video's details");
  let page: Awaited<ReturnType<typeof preview>>;
  try {
    page = await preview(url.trim(), { fetch: outbound.fetch, timeout: limits.timeouts_ms.link_preview });
  } catch (error) {
    if (error instanceof LinkpeekError && error.code === "TIMEOUT") refuse(502, "YouTube did not answer in time");
    refuse(502, `YouTube could not be reached: ${(error as Error).message}`);
  }
  if (page.statusCode >= 400) refuse(502, `YouTube answered ${page.statusCode} for this video`);
  if (!page.image) refuse(502, "YouTube gave no picture for this video");
  const picture = await fetchPicture(page.image);
  const sha256 = await sha256Hex(picture);
  const key = boardFileKey(blobKey(sha256));
  if (!(await stored(env, key))) await env.FILES.put(key, picture, { httpMetadata: { contentType: "image/jpeg" } });
  const title = String(page.title ?? "").trim().slice(0, limits.text.board_content) || null;
  return { id: link.id, title, sha256 };
}

// The picture the page names, as the card will keep it: a JPEG, as
// YouTube gives, and no larger than any board file.
async function fetchPicture(location: string): Promise<Uint8Array> {
  try { validateUrl(location); } catch { refuse(502, "YouTube named a picture Papol cannot fetch"); }
  let answered: Response;
  try {
    answered = await outbound.fetch(location, { signal: AbortSignal.timeout(limits.timeouts_ms.link_preview_image) });
  } catch (error) {
    refuse(502, `The video's picture could not be fetched: ${(error as Error).message}`);
  }
  if (!answered.ok) refuse(502, `The video's picture answered ${answered.status}`);
  const type = (answered.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "image/jpeg") refuse(502, "The video's picture is not a JPEG");
  const bytes = new Uint8Array(await answered.arrayBuffer());
  if (!bytes.length) refuse(502, "The video's picture was empty");
  if (bytes.length > PICTURE_LIMIT) refuse(502, "The video's picture is larger than a board file may be");
  return bytes;
}
