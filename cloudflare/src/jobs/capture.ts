// A picture of a web page, for a board card made on the web.
//
// The request checks the link, writes the card at once, and queues the
// capture. The card is a link without a preview until the job has
// rendered the page in Browser Rendering and put the image beside the
// card. A capture that fails leaves the card as the link it already was;
// the job says why. The Mac takes a page's picture itself
// (desktop/src-tauri/src/capture.rs) and pushes the card with it, so
// nothing here runs for a card that came by sync. Nor is a video card
// captured here: its title and picture are read from its page
// (linkPreview.ts, shared/videos.js).
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
import { JobError } from "./queue";

export const WEBPAGE = "capture_webpage";

const BOARD_FILE_LIMIT = limits.files.board_file_mb * 1024 * 1024;

// ------------------------------------------------------------ what a URL is

// Whether a URL's host is a machine's own network rather than the web:
// a loopback, private, link-local, shared (CGNAT), unspecified or
// broadcast IPv4 address — the URL parser has already turned `127.1`,
// `2130706433` and `0x7f.1` into dotted form — any IPv6 literal, which
// public sites are not visited by, or a name only a local network answers
// to. The Mac's capture window holds to the same list
// (desktop/src-tauri/src/capture.rs).
export function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[")) return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  if (octets) {
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a === 255 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return ["localhost", "local", "internal", "home.arpa", "lan"].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

// Accept a browser URL: http or https, a public-looking host, no
// credentials. Refused with a sentence for the person who pasted it.
export function publicWebUrl(value: string): string {
  const url = value.trim();
  let parsed: URL;
  try { parsed = new URL(url); } catch { return refuse(422, "Paste a valid http or https URL"); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) refuse(422, "Paste a valid http or https URL");
  if (parsed.username || parsed.password) refuse(422, "URLs with embedded credentials are not supported");
  if (privateHost(parsed.hostname)) refuse(422, "Local and private network addresses cannot be captured");
  return url;
}

// ------------------------------------------------------------- the capturing

// A page's picture, and what the page calls itself.
export type Capture = { image: Uint8Array; title: string | null };

// Replaceable, so the suite can stand in for the browser.
export const capturers = {
  async webpage(env: Env, url: string): Promise<Capture> {
    if (!env.BROWSER) throw new JobError("The website could not be rendered: no browser is configured");
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: "networkidle0", timeout: limits.timeouts_ms.media_capture });
      const image = await page.screenshot({ type: "png" });
      // The title it gives to sharing, else the one on its tab, as the
      // Mac reads it (desktop/src-tauri/scripts/capture-page.js).
      const title = await page.evaluate(
        `document.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.content || document.title`,
      ).then((read) => (typeof read === "string" ? read : null), () => null);
      return { image: new Uint8Array(image as Uint8Array), title };
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

async function card(env: Env, payload: Row): Promise<Row> {
  const item = await one(env.DB, "SELECT * FROM board_items WHERE uuid = ? AND deleted_at IS NULL", payload.item_uuid);
  if (!item) throw new JobError("The card is gone");
  return item;
}

// The page's title as a card's text: one line, no longer than a card holds.
export function pageTitle(title: string | null | undefined): string | null {
  return (title ?? "").replace(/\s+/g, " ").trim().slice(0, limits.text.board_content) || null;
}

export async function captureWebpageJob(env: Env, payload: Row): Promise<Row> {
  const item = await card(env, payload);
  const url = String(payload.url);
  let captured: Capture;
  try {
    captured = await capturers.webpage(env, url);
  } catch (error) {
    throw new JobError(`Could not capture the webpage: ${(error as Error).message}`);
  }
  const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  // The title in place of the hostname the card was made with; text
  // written on the card since stands.
  const title = pageTitle(captured.title);
  if (title && (!item.content || item.content === hostname)) item.content = title;
  return attach(env, item, captured.image, "image/png", `webpage-${hostname.slice(0, limits.text.display_name)}.png`);
}

