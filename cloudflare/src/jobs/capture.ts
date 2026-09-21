// A picture of a link, for a board card: a webpage or a YouTube thumbnail.
//
// The request checks the link, writes the card at once, and queues the
// capture. The card is a link without a preview until the job has
// rendered the page in Browser Rendering, or fetched the video's
// thumbnail and title, and put the image beside the card. A capture that
// fails leaves the card as the link it already was; the job says why.
//
// The browser is Cloudflare's, on Cloudflare's network, so no private
// address of ours is reachable from it; the check is on the URL itself: a browser scheme, a hostname that is not
// a loopback or private literal, no credentials.

import puppeteer from "@cloudflare/puppeteer";

import limits from "../../../config/app_limits.json";
import { one, statement, type Row } from "../db";
import { refuse } from "../http";
import { BOARD_FILES } from "../sync/blobs";
import { writeSynced } from "../sync/write";
import { JobError } from "./queue";

export const WEBPAGE = "capture_webpage";
export const YOUTUBE = "capture_youtube";

const BOARD_FILE_LIMIT = limits.files.board_file_mb * 1024 * 1024;

// ------------------------------------------------------------ what a URL is

export function youtubeId(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return null; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let candidate: string | null = null;
  if (host === "youtu.be") candidate = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname === "/watch") candidate = parsed.searchParams.get("v");
    else {
      const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
      if (parts.length === 2 && ["shorts", "embed", "live"].includes(parts[0])) candidate = parts[1];
    }
  }
  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|127\..*|10\..*|192\.168\..*|169\.254\..*|0\.0\.0\.0|\[::1\]|\[fc.*|\[fd.*|172\.(1[6-9]|2\d|3[01])\..*)$/i;

// Accept a browser URL: http or https, a public-looking host, no
// credentials. Refused with a sentence for the person who pasted it.
export function publicWebUrl(value: string): string {
  const url = value.trim();
  let parsed: URL;
  try { parsed = new URL(url); } catch { return refuse(422, "Paste a valid http or https URL"); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) refuse(422, "Paste a valid http or https URL");
  if (parsed.username || parsed.password) refuse(422, "URLs with embedded credentials are not supported");
  if (PRIVATE_HOST.test(parsed.hostname)) refuse(422, "Local and private network addresses cannot be captured");
  return url;
}

// ------------------------------------------------------------- the capturing

// Replaceable, so the suite can stand in for the browser and for YouTube.
export const capturers = {
  async webpage(env: Env, url: string): Promise<Uint8Array> {
    if (!env.BROWSER) throw new JobError("The website could not be rendered: no browser is configured");
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: "networkidle0", timeout: limits.timeouts_ms.media_capture });
      const image = await page.screenshot({ type: "png" });
      return new Uint8Array(image as Uint8Array);
    } finally {
      await browser.close();
    }
  },

  async youtubeThumbnail(url: string, videoId: string): Promise<{ image: Uint8Array; title: string }> {
    const endpoint = `https://www.youtube.com/oembed?${new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}`, format: "json" })}`;
    const answered = await fetch(endpoint, { headers: { "user-agent": "Papol/1.0" }, signal: AbortSignal.timeout(limits.timeouts_ms.youtube_metadata) });
    if (!answered.ok) throw new Error(`YouTube answered ${answered.status}`);
    const metadata = (await answered.json()) as { thumbnail_url?: string; title?: string };
    const thumbnail = String(metadata.thumbnail_url ?? "");
    const host = (() => { try { return new URL(thumbnail).hostname.toLowerCase(); } catch { return ""; } })();
    if (host !== "i.ytimg.com" && !host.endsWith(".ytimg.com")) throw new Error("YouTube returned an invalid thumbnail location");
    const picture = await fetch(thumbnail, { headers: { "user-agent": "Papol/1.0" }, signal: AbortSignal.timeout(limits.timeouts_ms.youtube_thumbnail) });
    if (!picture.ok) throw new Error(`The thumbnail answered ${picture.status}`);
    const image = new Uint8Array(await picture.arrayBuffer());
    return { image, title: String(metadata.title || url).slice(0, limits.text.board_content) };
  },
};

// ------------------------------------------------------ putting it on the card

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The picture onto the card, in the board's files; the card versioned and
// logged; the board's clock moved.
async function attach(env: Env, item: Row, image: Uint8Array, suffix: string, mime: string, original: string, title?: string): Promise<Row> {
  if (!image.length || image.length > BOARD_FILE_LIMIT) throw new JobError("The picture is empty or too large");
  const key = `${item.board_uuid}/${crypto.randomUUID().replace(/-/g, "")}${suffix}`;
  await env.FILES.put(`${BOARD_FILES}${key}`, image, { httpMetadata: { contentType: mime } });
  item.file_path = key;
  item.sha256 = await sha256Hex(image);
  item.original_filename = original;
  item.mime_type = mime;
  if (title !== undefined) item.content = title;
  const board = await one<{ user_uuid: string }>(env.DB, "SELECT user_uuid FROM boards WHERE uuid = ?", item.board_uuid);
  await env.DB.batch([
    ...await writeSynced(env.DB, "board_items", item, board!.user_uuid, false),
    statement(env.DB, "UPDATE boards SET updated_at = ? WHERE uuid = ?", new Date().toISOString(), item.board_uuid),
  ]);
  return { file_path: key, sha256: item.sha256 };
}

async function card(env: Env, payload: Row): Promise<Row> {
  const item = await one(env.DB, "SELECT * FROM board_items WHERE uuid = ? AND deleted_at IS NULL", payload.item_uuid);
  if (!item) throw new JobError("The card is gone");
  return item;
}

export async function captureWebpageJob(env: Env, payload: Row): Promise<Row> {
  const item = await card(env, payload);
  const url = String(payload.url);
  let image: Uint8Array;
  try {
    image = await capturers.webpage(env, url);
  } catch (error) {
    throw new JobError(`Could not capture the webpage: ${(error as Error).message}`);
  }
  const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  return attach(env, item, image, ".png", "image/png", `webpage-${hostname.slice(0, limits.text.display_name)}.png`);
}

export async function captureYoutubeJob(env: Env, payload: Row): Promise<Row> {
  const item = await card(env, payload);
  const url = String(payload.url), videoId = String(payload.video_id);
  let picture: { image: Uint8Array; title: string };
  try {
    picture = await capturers.youtubeThumbnail(url, videoId);
  } catch (error) {
    throw new JobError(`Could not fetch the video's thumbnail: ${(error as Error).message}`);
  }
  return attach(env, item, picture.image, ".jpg", "image/jpeg", `youtube-${videoId}.jpg`, picture.title);
}
