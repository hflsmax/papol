// A video link on a board, and the title and thumbnail the app fetches
// for it itself: YouTube on the web and the desktop, Bilibili on the
// desktop only.
//
// YouTube's oEmbed endpoint and its thumbnail host answer a page on any
// origin, so this is the page's own fetch there — and the hosts it asks
// are in shared/externalHosts.js, which the application's content
// security policy is held to: a host missing from it is refused inside
// the app as "Load failed".
//
// Bilibili's API refuses other origins and bans clients that are not a
// browser (412); what does answer is its mobile video page, asked with a
// phone's User-Agent, whose og:title and og:image name the video. No page
// can ask that way — a browser will not send a User-Agent it is given,
// and the HTTP plugin builds its headers with the browser's own Headers,
// which drops it silently — so the application fetches that page itself
// (desktop/src-tauri/src/videos.rs). The web makes the card as its link,
// and the Mac fills it in when it next opens the board. Both covers come
// from hosts that let any origin read them; Bilibili's refuses a foreign
// Referer, so none is sent.

import appLimits from './appLimits.js';
import { IS_DESKTOP } from './appEnvironment.js';
import { nativeVideoPage } from './nativeData.js';

const { youtube_metadata: METADATA_TIMEOUT_MS, youtube_thumbnail: THUMBNAIL_TIMEOUT_MS } = appLimits.timeouts_ms;

// ---------------------------------------------------------------- the link

// The video a YouTube URL names, as the Worker's check reads it
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

// The video a Bilibili URL names: its BV id or av number, as the Worker
// reads it. A b23.tv short link names one too, but only once followed:
// `{ short: true }` then, and the id comes with the preview.
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

// `{ id, title, image }` for a video link: its id (a followed short link's
// too), its title, and its thumbnail as a JPEG blob. Throws with a
// sentence when either could not be had. `fetch` is the page's own;
// `videoPage` is the application fetching a video page as a phone.
export async function videoPreview(url, { fetch = globalThis.fetch, videoPage = nativeVideoPage } = {}) {
  const link = videoLink(url);
  if (!link) throw new Error('This is not a video link Papol knows');
  if (link.kind === 'youtube') return youtubePreview(link.id, { fetch });
  if (!IS_DESKTOP) throw new Error("Only the Mac app can fetch a Bilibili video's details");
  return bilibiliPreview(url, link.id, { fetch, videoPage });
}

async function youtubePreview(videoId, { fetch }) {
  const watch = `https://www.youtube.com/watch?v=${videoId}`;
  const endpoint = `https://www.youtube.com/oembed?${new URLSearchParams({ url: watch, format: 'json' })}`;
  const answered = await fetch(endpoint, { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) });
  if (!answered.ok) throw new Error(`YouTube answered ${answered.status} for this video`);
  const metadata = await answered.json();
  const image = await cover(String(metadata.thumbnail_url ?? ''), /(^|\.)ytimg\.com$/, { fetch });
  return { id: videoId, title: titleOf(metadata.title), image };
}

async function bilibiliPreview(url, id, { fetch, videoPage }) {
  // The mobile page, which a b23.tv link lands on when a phone asks, and
  // only the application can ask that way (shared/nativeData.js).
  const page = id ? `https://m.bilibili.com/video/${id}` : String(url).trim();
  const { url: landedAt, html } = await videoPage(page);
  const landed = bilibiliVideo(landedAt || page);
  const title = metaContent(html, 'og:title')?.replace(/_哔哩哔哩_bilibili$/, '');
  const picture = metaContent(html, 'og:image');
  if (!title && !picture) throw new Error('Bilibili gave no details for this video');
  if (!picture || /\/transparent\.png(@|$)/.test(picture)) throw new Error('This Bilibili video has no cover');
  // `…/cover.jpg@1200w_630h` is a resized copy; the cover itself is the part before the @.
  const image = await cover(picture.split('@')[0].replace(/^\/\//, 'https://'), /(^|\.)hdslb\.com$/, { fetch });
  return { id: landed?.id ?? id, title: titleOf(title), image };
}

// A cover, from the host it must come from, without a Referer.
async function cover(location, host, { fetch }) {
  let parsed = null;
  try { parsed = new URL(location); } catch { /* checked below */ }
  if (!parsed || parsed.protocol !== 'https:' || !host.test(parsed.hostname.toLowerCase())) {
    throw new Error('The video has no thumbnail Papol can show');
  }
  const picture = await fetch(parsed.href, { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS) });
  if (!picture.ok) throw new Error(`The video's thumbnail answered ${picture.status}`);
  const bytes = await picture.arrayBuffer();
  if (!bytes.byteLength) throw new Error("The video's thumbnail was empty");
  return new Blob([bytes], { type: 'image/jpeg' });
}

function titleOf(value) {
  return String(value || '').trim().slice(0, appLimits.text.board_content) || null;
}

// A <meta property="…" content="…"> value, decoded.
// The value runs to the quote it opened with, so "Don't Stop" is whole.
export function metaContent(html, property) {
  const tag = new RegExp(`<meta[^>]+property=["']${property}["'][^>]*>`, 'i').exec(html)?.[0];
  const value = tag && /\scontent=(["'])(.*?)\1/is.exec(tag)?.[2];
  if (!value) return null;
  return decodeEntities(value);
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
