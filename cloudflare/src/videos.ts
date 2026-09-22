// A video link on a board: which site's, and which video. The app reads
// links the same way (shared/videos.js), so a change to one is a change
// to the other. The Worker fetches nothing about a video: the app brings
// its title and thumbnail, or the card is the link alone.

export type VideoKind = "youtube" | "bilibili";

export interface VideoLink {
  kind: VideoKind;
  // A b23.tv short link names its video only once followed: null then.
  id: string | null;
}

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

export function bilibiliVideo(url: string): { id: string | null; short: boolean } | null {
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return null; }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "b23.tv") return /^\/[A-Za-z0-9]+\/?$/.test(parsed.pathname) ? { id: null, short: true } : null;
  if (host !== "bilibili.com" && host !== "www.bilibili.com" && host !== "m.bilibili.com") return null;
  const match = /^\/video\/(BV[0-9A-Za-z]{10}|av\d{1,12})\/?$/i.exec(parsed.pathname);
  if (!match) return null;
  const id = match[1];
  return { id: /^av/i.test(id) ? id.toLowerCase() : `BV${id.slice(2)}`, short: false };
}

export function videoLink(url: string): VideoLink | null {
  const youtube = youtubeId(url);
  if (youtube) return { kind: "youtube", id: youtube };
  const bilibili = bilibiliVideo(url);
  return bilibili ? { kind: "bilibili", id: bilibili.id } : null;
}
