// A video link on a board, and its title and picture: YouTube's on the
// web and the desktop, Bilibili's on the desktop only. Both are read from
// the video's page by linkpeek, which knows a page's Open Graph, Twitter
// card and JSON-LD tags, but the pages are asked for in different places.
//
// YouTube's is read by the Cloudflare Worker
// (cloudflare/src/linkPreview.ts), which puts the picture in the bucket
// and answers its digest.
//
// Bilibili answers Cloudflare's network 412, and a page on any origin
// with a CORS refusal. What does answer is its mobile video page, asked
// from the Mac with a phone's User-Agent. No page can ask that way — a
// browser will not send a User-Agent it is given, and the HTTP plugin
// builds its headers with the browser's own Headers, which drops it
// silently — so the application fetches that page itself
// (desktop/src-tauri/src/videos.rs) and linkpeek reads it here. The web
// makes the card as its link, and the Mac fills it in when it next opens
// the board. The cover's host lets any origin read it but refuses a
// foreign Referer, so none is sent; it is in shared/externalHosts.js,
// which the application's content security policy is held to.

import appLimits from './appLimits.js';
import { IS_DESKTOP } from './appEnvironment.js';
import { jsonRequest } from './httpClient.js';
import { nativeVideoPage } from './nativeData.js';

const COVER_TIMEOUT_MS = appLimits.timeouts_ms.link_preview_image;

// ---------------------------------------------------------------- the link

// The video a YouTube URL names, as the Cloudflare Worker's check reads it
// (cloudflare/src/videos.ts): an 11-character id, or null.
export function youtubeId(url) {
  let parsed;
  try { parsed = new URL(String(url).trim()); } catch { return null; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let candidate = null;
  if (host === 'youtu.be') candidate = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname === '/watch') candidate = parsed.searchParams.get('v');
    else {
      const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
      if (parts.length === 2 && ['shorts', 'embed', 'live'].includes(parts[0])) candidate = parts[1];
    }
  }
  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

// The video a Bilibili URL names: its BV id or av number, as the
// Cloudflare Worker reads it. A b23.tv short link names one too, but only
// once followed: `{ short: true }` then, and the id comes with the
// preview.
export function bilibiliVideo(url) {
  let parsed;
  try { parsed = new URL(String(url).trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  if (host === 'b23.tv') return /^\/[A-Za-z0-9]+\/?$/.test(parsed.pathname) ? { id: null, short: true } : null;
  if (host !== 'bilibili.com' && host !== 'www.bilibili.com' && host !== 'm.bilibili.com') return null;
  const match = /^\/video\/(BV[0-9A-Za-z]{10}|av\d{1,12})\/?$/i.exec(parsed.pathname);
  if (!match) return null;
  const id = match[1];
  return { id: /^av/i.test(id) ? id.toLowerCase() : `BV${id.slice(2)}`, short: false };
}

// What a pasted link is as a video card: `{ kind, id }`, kind 'youtube'
// or 'bilibili' (id null for a short link not yet followed), or null.
export function videoLink(url) {
  const youtube = youtubeId(url);
  if (youtube) return { kind: 'youtube', id: youtube };
  const bilibili = bilibiliVideo(url);
  return bilibili ? { kind: 'bilibili', id: bilibili.id } : null;
}

// Whether this surface can fetch a video's title and thumbnail at all.
export function canPreview(link) {
  return link?.kind === 'youtube' || (link?.kind === 'bilibili' && IS_DESKTOP);
}

// ------------------------------------------------------------- the preview

// A video link's title and picture. Throws with a sentence when they could
// not be had. The picture is where its card will name it from:
//   YouTube:  `{ id, title, sha256 }`, the picture in the bucket already,
//             put there by the Cloudflare Worker (POST /api/video-preview);
//   Bilibili: `{ id, title, image }`, the cover as a JPEG blob, and the id
//             a followed short link landed on.
// `ask` is the Cloudflare Worker; `fetch` is the page's own; `videoPage`
// is the application fetching a video page as a phone.
export async function videoPreview(url, { ask = askCloudflareWorker, fetch = globalThis.fetch, videoPage = nativeVideoPage } = {}) {
  const link = videoLink(url);
  if (!link) throw new Error('This is not a video link Papol knows');
  if (link.kind === 'youtube') return ask(url);
  if (!IS_DESKTOP) throw new Error("Only the Mac app can fetch a Bilibili video's details");
  return bilibiliPreview(url, link.id, { fetch, videoPage });
}

const askCloudflareWorker = (url) => jsonRequest('/video-preview', 'POST', { url });

async function bilibiliPreview(url, id, { fetch, videoPage }) {
  // The mobile page, which a b23.tv link lands on when a phone asks, and
  // only the application can ask that way (shared/nativeData.js).
  const page = id ? `https://m.bilibili.com/video/${id}` : String(url).trim();
  const { url: landedAt, html } = await videoPage(page);
  // linkpeek is only for this, and only on the Mac: loaded when asked.
  const { parseHTML } = await import('linkpeek');
  const read = parseHTML(html, landedAt || page);
  const landed = bilibiliVideo(landedAt || page);
  if (!read.image || /\/transparent\.png(@|$)/.test(read.image)) throw new Error('This Bilibili video has no cover');
  // `…/cover.jpg@1200w_630h` is a resized copy; the cover itself is the part before the @.
  const image = await cover(read.image.split('@')[0]);
  return { id: landed?.id ?? id, title: titleOf(read.title?.replace(/_哔哩哔哩_bilibili$/, '')), image };

  // The cover, from Bilibili's picture host, without a Referer.
  async function cover(location) {
    let parsed = null;
    try { parsed = new URL(location); } catch { /* checked below */ }
    if (!parsed || parsed.protocol !== 'https:' || !/(^|\.)hdslb\.com$/.test(parsed.hostname.toLowerCase())) {
      throw new Error('The video has no cover Papol can show');
    }
    const picture = await fetch(parsed.href, { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
    if (!picture.ok) throw new Error(`The video's cover answered ${picture.status}`);
    const bytes = await picture.arrayBuffer();
    if (!bytes.byteLength) throw new Error("The video's cover was empty");
    return new Blob([bytes], { type: 'image/jpeg' });
  }
}

function titleOf(value) {
  return String(value || '').trim().slice(0, appLimits.text.board_content) || null;
}
