// A picture of a web page, for a board card.
//
// The request checks the link, writes the card at once, and queues the
// capture. The card is a link without a preview until the job has
// rendered the page in Browser Rendering and put the image beside the
// card. A capture that fails leaves the card as the link it already was;
// the job says why. A YouTube card is not captured here: the app fetches
// the video's title and thumbnail itself (shared/youtube.js) and makes
// the card with them.
//
// The browser is Cloudflare's, on Cloudflare's network, so no private
// address of ours is reachable from it; the check is on the URL itself: a browser scheme, a hostname that is not
// a loopback or private literal, no credentials.

import puppeteer from "@cloudflare/puppeteer";

import limits from "../../../config/app_limits.json";
import { one, statement, type Row } from "../db";
import { refuse } from "../http";
import { blobKey, boardFileKey, sha256Hex, stored } from "../files";
import { writeSynced } from "../sync/write";
import { enqueue, JobError, type Enqueued } from "./queue";

export const WEBPAGE = "capture_webpage";

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

// Replaceable, so the suite can stand in for the browser.
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
};

// ------------------------------------------------------ putting it on the card

// The picture onto the card, under its digest as every board file is; the
// card versioned and logged; the board's clock moved.
async function attach(env: Env, item: Row, image: Uint8Array, mime: string, original: string): Promise<Row> {
  if (!image.length || image.length > BOARD_FILE_LIMIT) throw new JobError("The picture is empty or too large");
  const digest = await sha256Hex(image);
  const key = blobKey(digest);
  if (!(await stored(env, boardFileKey(key)))) await env.FILES.put(boardFileKey(key), image, { httpMetadata: { contentType: mime } });
  item.file_path = key;
  item.sha256 = digest;
  item.original_filename = original;
  item.mime_type = mime;
  const board = await one<{ user_uuid: string }>(env.DB, "SELECT user_uuid FROM boards WHERE uuid = ?", item.board_uuid);
  await env.DB.batch([
    ...await writeSynced(env.DB, "board_items", item, board!.user_uuid, false),
    statement(env.DB, "UPDATE boards SET updated_at = ? WHERE uuid = ?", new Date().toISOString(), item.board_uuid),
  ]);
  return { file_path: key, sha256: item.sha256 };
}

// ------------------------------------------------ a card that came by sync

// The capture a new page card needs when it came without its picture:
// made on a replica, which cannot render a page, and pushed
// (sync/push.ts). The same job the board's own route queues, keyed by the
// card so a card is captured once. Null for any other card, and for a
// link the route would have refused: it stays the link it is.
export function captureFor(db: D1Database, item: Row, userUuid: string): Enqueued | null {
  if (item.kind !== "webpage" || item.deleted_at || item.file_path || typeof item.source_url !== "string") return null;
  try {
    return enqueue(db, WEBPAGE, { item_uuid: item.uuid, url: publicWebUrl(item.source_url) }, { key: `capture:${item.uuid}`, userUuid });
  } catch {
    return null;
  }
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
  return attach(env, item, image, "image/png", `webpage-${hostname.slice(0, limits.text.display_name)}.png`);
}

