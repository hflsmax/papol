// A PDF that lives somewhere else on the web, opened in the viewer by its
// address: /viewer/?from=<url>. This is what the Safari extension
// (safari/) sends a reader to when they open a PDF anywhere, and it works
// for any link that names a PDF the same way.
//
// The bytes come from one of two places. With the extension installed it
// fetches them itself, as the reader, with their cookies and from their
// network, so a paper behind a publisher sign-in or a campus proxy opens
// as it would have in Safari. The page talks to it over window.postMessage
// (safari/extension/bridge.js). Without it, the viewer asks the address
// directly, which works only where the host allows it (CORS).
//
// Nothing is sent to Papol by opening. The bytes stay in this page until
// the reader adds the paper to their nook, and then they go up exactly as
// an upload does.

import { downloadPdf } from './pdfDownload.js';

const BRIDGE_ATTRIBUTE = 'data-papol-extension';
const FROM_PAGE = 'papol-viewer';
const FROM_EXTENSION = 'papol-extension';
// How long a bridge that said it is starting gets to say it is ready.
const BRIDGE_START_MS = 1500;

// The address in ?from=, when it is one the viewer can open: http or https
// only, so a link cannot point the viewer at a file:, data: or javascript:
// address.
export function fromParam(search = window.location.search) {
  const raw = new URLSearchParams(search).get('from');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// What to call the paper until it is read: the file's name in its address,
// or the host's when the address names no file.
export function pdfNameFromUrl(address) {
  try {
    const url = new URL(address);
    const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    if (last) return /\.pdf$/i.test(last) ? last : `${last}.pdf`;
    return `${url.hostname}.pdf`;
  } catch {
    return 'paper.pdf';
  }
}

// Whether these bytes are a PDF: "%PDF-" in the first kilobyte, where the
// format allows some junk before it. A sign-in page or an error page served
// in a PDF's place is caught here rather than in pdf.js.
export function isPdfBytes(bytes) {
  if (!bytes?.length) return false;
  const head = bytes.subarray(0, Math.min(bytes.length, 1024));
  for (let i = 0; i + 4 < head.length; i += 1) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44
      && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
  }
  return false;
}

// 'ready', 'pending' (the extension is on this page and still asking its
// background whether this is Papol), or null (no extension).
export function bridgeState(doc = globalThis.document) {
  return doc?.documentElement?.getAttribute(BRIDGE_ATTRIBUTE) || null;
}

function waitForBridge(win, doc, timeoutMs) {
  const now = bridgeState(doc);
  if (now !== 'pending') return Promise.resolve(now === 'ready');
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const state = bridgeState(doc);
      if (state !== 'pending') resolve(state === 'ready');
      else if (Date.now() - started > timeoutMs) resolve(false);
      else win.setTimeout(tick, 50);
    };
    tick();
  });
}

let nextRequest = 1;

// Ask the extension for the bytes at `url`. It answers with progress, then
// either the bytes (transferred) or why it could not.
function fetchThroughBridge(url, { onProgress, win = window } = {}) {
  const id = `fetch-${Date.now()}-${nextRequest++}`;
  return new Promise((resolve, reject) => {
    const listen = (event) => {
      // From this page's own origin: the extension's script on this page
      // posts here, and nothing else on Papol's origin speaks this way.
      if (event.origin !== win.location.origin) return;
      const message = event.data;
      if (message?.source !== FROM_EXTENSION || message.id !== id) return;
      if (message.type === 'progress') {
        onProgress?.({ loaded: message.loaded || 0, total: message.total || 0 });
        return;
      }
      win.removeEventListener('message', listen);
      if (message.type === 'pdf') resolve(new Uint8Array(message.bytes));
      else {
        const failure = new Error(message.error || 'The extension could not fetch this PDF.');
        failure.status = message.status;
        reject(failure);
      }
    };
    win.addEventListener('message', listen);
    win.postMessage({ source: FROM_PAGE, type: 'fetch-pdf', id, url }, win.location.origin);
  });
}

// The PDF at `url`, as bytes: through the extension when it is here, else
// straight from the host. Throws a reader-facing error when it is not a PDF
// or could not be had.
export async function fetchPdfFrom(url, {
  onProgress, win = globalThis.window, doc = globalThis.document, fetchImpl,
  bridgeStartMs = BRIDGE_START_MS,
} = {}) {
  let bytes;
  if (win && await waitForBridge(win, doc, bridgeStartMs)) {
    bytes = await fetchThroughBridge(url, { onProgress, win });
  } else {
    try {
      bytes = await downloadPdf(url, { onProgress, ...(fetchImpl ? { fetchImpl } : {}) });
    } catch (failure) {
      // A host that does not allow the request fails as a network error
      // with nothing to say; this is the one thing worth saying about it.
      if (failure instanceof TypeError) {
        throw new Error('This site does not let Papol fetch its PDFs. Open the original, or install Papol for Safari.');
      }
      throw failure;
    }
  }
  if (!isPdfBytes(bytes)) throw new Error('The address did not answer with a PDF. The site may want you to sign in first: open the original.');
  return bytes;
}

// The bytes fetched for a digest, for pdf.js and for the upload. pdf.js
// takes ownership of what it is handed, so it is given a copy.
const fetched = new Map();

export function rememberFetchedPdf(sha256, bytes) {
  fetched.set(sha256, bytes);
}

export function fetchedPdfBytes(sha256) {
  const bytes = fetched.get(sha256);
  if (!bytes) throw new Error('This PDF is no longer open. Reload the page to fetch it again.');
  return bytes.slice();
}
