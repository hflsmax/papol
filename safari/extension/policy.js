// Papol for Safari: which navigations open in Papol, and where. Plain
// functions with no browser in them, so the rules are tested in Node
// (safari/policy.test.mjs) exactly as the background runs them.
//
// Loaded by the background with importScripts and by the popup with a
// <script> tag; both find it as globalThis.PapolPolicy.
(function attach(root) {
  const DEFAULT_ORIGIN = 'https://papol.io';
  // Where Papol runs. A development build of the viewer is reached on
  // 127.0.0.1:5173 (./deploy.sh dev).
  const ORIGINS = ['https://papol.io', 'https://dev.papol.io', 'http://127.0.0.1:5173', 'http://localhost:5173'];
  // How long a PDF handed to Papol may be fetched by the viewer: long
  // enough to sign in and come back, not forever.
  const HANDOFF_TTL_MS = 6 * 60 * 60 * 1000;

  // Addresses that serve a PDF without saying so in a ".pdf". The rest of
  // the web's PDFs are caught by their name, or by the page's content type
  // once Safari has started showing them (detect.js).
  const PDF_PATHS = [
    { host: /(^|\.)arxiv\.org$/, path: /^\/pdf\// },
    { host: /(^|\.)openreview\.net$/, path: /^\/pdf\/?$/ },
    { host: /(^|\.)dl\.acm\.org$/, path: /^\/doi\/pdf\// },
    { host: /(^|\.)link\.springer\.com$/, path: /^\/content\/pdf\// },
  ];

  function parse(address) {
    try {
      return new URL(address);
    } catch {
      return null;
    }
  }

  function isWeb(url) {
    return Boolean(url) && (url.protocol === 'https:' || url.protocol === 'http:');
  }

  function isPapol(address, origin = DEFAULT_ORIGIN) {
    const url = parse(address);
    if (!url) return false;
    return url.origin === parse(origin)?.origin || ORIGINS.includes(url.origin);
  }

  // Whether an address names a PDF by its look alone.
  function looksLikePdf(address) {
    const url = parse(address);
    if (!isWeb(url)) return false;
    for (const rule of PDF_PATHS) {
      if (rule.host.test(url.hostname) && rule.path.test(url.pathname)) return true;
    }
    return /\.pdf$/i.test(url.pathname);
  }

  // The Papol viewer for a PDF at `address`.
  function viewerUrl(address, origin = DEFAULT_ORIGIN) {
    const viewer = new URL('/viewer/', origin);
    viewer.searchParams.set('from', address);
    return viewer.href;
  }

  // The PDF a Papol viewer address opens, when it opens one by its address.
  function fromOfViewer(address, origin = DEFAULT_ORIGIN) {
    const url = parse(address);
    if (!url || !isPapol(address, origin) || !/\/viewer\/?$/.test(url.pathname)) return null;
    const from = url.searchParams.get('from');
    return from && isWeb(parse(from)) ? from : null;
  }

  // Two addresses for the same document: equal but for the fragment, which
  // names a place in it (#page=3) and is never sent to the host.
  function sameDocument(a, b) {
    const ua = parse(a);
    const ub = parse(b);
    if (!ua || !ub) return false;
    ua.hash = '';
    ub.hash = '';
    return ua.href === ub.href;
  }

  // Whether a top-level navigation in a tab should open in Papol instead.
  //   address      where the tab is going
  //   isPdf        known to be a PDF (the page said so), or only guessed
  //   settings     { enabled, origin }
  //   passThrough  the PDF this tab was last shown in Papol's viewer, which
  //                the reader may go back to as it is: by "Original", or
  //                by the Back button
  function shouldOpenInPapol({ address, isPdf = false, settings = {}, passThrough = null }) {
    const url = parse(address);
    if (!isWeb(url)) return false;
    if (settings.enabled === false) return false;
    if (isPapol(address, settings.origin || DEFAULT_ORIGIN)) return false;
    if (passThrough && sameDocument(passThrough, address)) return false;
    return isPdf || looksLikePdf(address);
  }

  // Forget handoffs past their time. `handoffs` is { address: when }.
  function freshHandoffs(handoffs = {}, now = Date.now()) {
    const fresh = {};
    for (const [address, at] of Object.entries(handoffs)) {
      if (now - at < HANDOFF_TTL_MS) fresh[address] = at;
    }
    return fresh;
  }

  // Whether the viewer may have the bytes at `address`: only a PDF this
  // extension sent the reader to Papol for, lately. So the bridge cannot be
  // used to read anything else the reader can reach, whatever a page on
  // Papol's origin asks it.
  function mayFetch(address, handoffs = {}, now = Date.now()) {
    const fresh = freshHandoffs(handoffs, now);
    return Object.keys(fresh).some((handed) => sameDocument(handed, address));
  }

  // Whether these bytes are a PDF: "%PDF-" in the first kilobyte.
  function isPdfBytes(bytes) {
    if (!bytes || !bytes.length) return false;
    const end = Math.min(bytes.length, 1024);
    for (let i = 0; i + 4 < end; i += 1) {
      if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44
        && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
    }
    return false;
  }

  root.PapolPolicy = {
    DEFAULT_ORIGIN, ORIGINS, HANDOFF_TTL_MS,
    isPapol, looksLikePdf, viewerUrl, fromOfViewer, sameDocument,
    shouldOpenInPapol, freshHandoffs, mayFetch, isPdfBytes,
  };
}(globalThis));
