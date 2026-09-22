// A YouTube video's title and thumbnail, fetched by the app itself.
//
// YouTube's oEmbed endpoint and its thumbnail host both answer a page on
// any origin — papol.io, the desktop's tauri://localhost alike — so the
// board makes a video card with its picture at once, without a job and
// without the server. This is the page's own fetch, not runtimeFetch:
// the desktop's HTTP plugin reaches only Papol's hosts, and needs not
// reach YouTube's. A video that cannot be fetched stays a link.

import appLimits from './appLimits.js';

const { youtube_metadata: METADATA_TIMEOUT_MS, youtube_thumbnail: THUMBNAIL_TIMEOUT_MS } = appLimits.timeouts_ms;

// The video a YouTube URL names, as the Worker's check reads it
// (cloudflare/src/jobs/capture.ts): an 11-character id, or null.
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

// `{ title, image }` for a video: its title as YouTube gives it, and its
// thumbnail as a JPEG blob. Throws with a sentence when either could not
// be had.
export async function youtubePreview(videoId, { fetch = globalThis.fetch } = {}) {
  const watch = `https://www.youtube.com/watch?v=${videoId}`;
  const endpoint = `https://www.youtube.com/oembed?${new URLSearchParams({ url: watch, format: 'json' })}`;
  const answered = await fetch(endpoint, { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) });
  if (!answered.ok) throw new Error(`YouTube answered ${answered.status} for this video`);
  const metadata = await answered.json();
  const thumbnail = String(metadata.thumbnail_url ?? '');
  const host = (() => { try { return new URL(thumbnail).hostname.toLowerCase(); } catch { return ''; } })();
  if (host !== 'i.ytimg.com' && !host.endsWith('.ytimg.com')) throw new Error('YouTube gave no thumbnail for this video');
  const picture = await fetch(thumbnail, { signal: AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS) });
  if (!picture.ok) throw new Error(`The video's thumbnail answered ${picture.status}`);
  const bytes = await picture.arrayBuffer();
  if (!bytes.byteLength) throw new Error("The video's thumbnail was empty");
  const title = String(metadata.title || '').trim().slice(0, appLimits.text.board_content) || null;
  return { title, image: new Blob([bytes], { type: 'image/jpeg' }) };
}
