// Every host Papol's own pages ask for, and how they ask.
//
// The macOS application is not a browser tab: a page in it may connect
// only where its content security policy says (desktop/src-tauri/
// tauri.conf.json), and the HTTP plugin may reach only where its scope
// says (desktop/src-tauri/capabilities/*.json). A host missing from
// either is refused inside the app, and the page is told no more than
// "Load failed" — which is how a video card lost its title and a PDF
// its upload. So the hosts live here, once, and a test holds the two
// lists to this one (frontend/src/desktopReach.test.js).
//
// `page` hosts are asked by the page itself: fetch, XMLHttpRequest, the
// bytes of a picture. They belong in `connect-src`.
// `plugin` hosts are asked through the HTTP plugin (shared/connectivity.js
// `runtimeFetch`), which goes out through the application, not the page;
// they belong in the capabilities' `http:default` scope.

// The Cloudflare account the bucket lives in: part of R2's S3 hostname,
// which an upload PUTs to by a signed address (cloudflare/src/files.ts).
export const R2_ACCOUNT = '9315a859bb8887b2a0ca2cc576f57ae2';

export const EXTERNAL_HOSTS = [
  {
    host: `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`,
    by: 'page',
    why: 'a paper or a board file, PUT to the bucket by the signed address (shared/api/files.js)',
  },
  {
    host: 'https://files.papol.io',
    by: 'page',
    why: "a paper's PDF and a board's pictures, read from the bucket's own domain",
  },
  {
    host: 'https://*.hdslb.com',
    by: 'page',
    why: "a Bilibili video's cover, from the host its page names (shared/videos.js)",
  },
  {
    host: 'https://papol.io',
    by: 'plugin',
    why: 'Papol itself: every request the application makes of the service',
  },
  {
    host: 'https://files.papol.io',
    by: 'plugin',
    why: 'a PDF downloaded into the nook, and a file the sync asks for',
  },
];

export const pageHosts = () => EXTERNAL_HOSTS.filter((entry) => entry.by === 'page').map((entry) => entry.host);
export const pluginHosts = () => EXTERNAL_HOSTS.filter((entry) => entry.by === 'plugin').map((entry) => entry.host);
