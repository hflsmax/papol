// Papol for Safari's background: it sends PDFs to Papol's viewer, and it
// fetches them for the viewer, as the reader, when the viewer asks.
//
// 1. A top-level navigation to a PDF opens Papol's viewer instead, with the
//    PDF's address: /viewer/?from=<address>. A PDF is known by its address
//    (policy.js) before it loads, or by its content type once Safari has
//    begun showing it (detect.js says so).
// 2. The viewer cannot read another site's PDF itself, and often should
//    not try: the PDF may need the reader's cookies or their campus
//    network. So the extension's script on Papol's page (bridge.js) asks
//    here, and the bytes are fetched with the reader's credentials and
//    handed over in pieces. Only PDFs sent to Papol by step 1 may be asked
//    for, and only by the Papol origin the reader chose.
// 3. A PDF that was just shown in Papol's viewer in a tab is let through
//    in that tab, so "Original" and the Back button reach Safari's own
//    viewer instead of bouncing back into Papol.
importScripts('policy.js');

const api = globalThis.browser ?? globalThis.chrome;
const Policy = globalThis.PapolPolicy;
// Session storage outlives the background being unloaded between events,
// and not the browser; local storage stands in where it is missing.
const session = api.storage.session ?? api.storage.local;
const CHUNK_BYTES = 512 * 1024;
const MAX_PDF_BYTES = 250 * 1024 * 1024;

async function settings() {
  return api.storage.local.get({ enabled: true, origin: Policy.DEFAULT_ORIGIN });
}

async function state() {
  const kept = await session.get({ handoffs: {}, passThrough: {} });
  return { handoffs: Policy.freshHandoffs(kept.handoffs), passThrough: kept.passThrough || {} };
}

// The last handoff in each tab, so the two ways of noticing a PDF (its
// address, its content type) do not both send it.
const recent = new Map();

async function openInPapol(tabId, address, { isPdf = false, always = false } = {}) {
  const chosen = await settings();
  const { handoffs, passThrough } = await state();
  const go = always
    ? !Policy.isPapol(address, chosen.origin) && /^https?:/.test(address)
    : Policy.shouldOpenInPapol({ address, isPdf, settings: chosen, passThrough: passThrough[tabId] });
  if (!go) return false;
  const last = recent.get(tabId);
  if (last && Policy.sameDocument(last.address, address) && Date.now() - last.at < 5000) return true;
  recent.set(tabId, { address, at: Date.now() });
  handoffs[address] = Date.now();
  await session.set({ handoffs });
  await api.tabs.update(tabId, { url: Policy.viewerUrl(address, chosen.origin) });
  return true;
}

// A page on the Papol origin the reader chose: the only one the bridge
// answers.
async function fromPapol(sender) {
  const chosen = await settings();
  try {
    return new URL(sender.url).origin === new URL(chosen.origin).origin;
  } catch {
    return false;
  }
}

api.webNavigation.onBeforeNavigate.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0 || tabId < 0) return;
  const { passThrough } = await state();
  // Somewhere other than the PDF let through: the let-through is spent.
  const chosen = await settings();
  if (passThrough[tabId] && !Policy.sameDocument(passThrough[tabId], url) && !Policy.isPapol(url, chosen.origin)) {
    delete passThrough[tabId];
    await session.set({ passThrough });
  }
  await openInPapol(tabId, url);
});

api.tabs.onRemoved.addListener(async (tabId) => {
  recent.delete(tabId);
  const { passThrough } = await state();
  if (tabId in passThrough) {
    delete passThrough[tabId];
    await session.set({ passThrough });
  }
});

// Fetched PDFs waiting to be collected by the bridge, by token.
const fetched = new Map();

function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

async function fetchPdf(address, tabId, requestId) {
  const response = await fetch(address, { credentials: 'include', redirect: 'follow' });
  if (!response.ok) return { error: `The site answered with error ${response.status}.`, status: response.status };
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > MAX_PDF_BYTES) return { error: 'This PDF is too large for Papol.' };
  const reader = response.body.getReader();
  const parts = [];
  let loaded = 0;
  let told = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    if (loaded > MAX_PDF_BYTES) return { error: 'This PDF is too large for Papol.' };
    if (loaded - told > 256 * 1024) {
      told = loaded;
      api.tabs.sendMessage(tabId, { type: 'fetch-progress', requestId, loaded, total }, { frameId: 0 }).catch?.(() => {});
    }
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; }
  if (!Policy.isPdfBytes(bytes)) {
    return { error: 'The site did not answer with a PDF. It may want you to sign in: open the original.' };
  }
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fetched.set(token, bytes);
  // Collected at once, normally; never kept for long.
  setTimeout(() => fetched.delete(token), 5 * 60 * 1000);
  return { token, size: bytes.length, chunks: Math.ceil(bytes.length / CHUNK_BYTES) };
}

async function answer(message, sender) {
  const tabId = sender.tab?.id;
  switch (message?.type) {
    case 'pdf-document':
      // Safari is showing a PDF in a tab: the content type said so.
      if (sender.frameId === 0 && tabId != null) await openInPapol(tabId, sender.url, { isPdf: true });
      return null;
    case 'hello':
      return { papol: await fromPapol(sender) };
    case 'viewing': {
      // Papol's viewer is showing this PDF in this tab: going back to it
      // from here shows it as it is.
      if (!(await fromPapol(sender)) || tabId == null) return null;
      const { passThrough } = await state();
      passThrough[tabId] = String(message.from || '');
      await session.set({ passThrough });
      return null;
    }
    case 'fetch-pdf': {
      if (!(await fromPapol(sender))) return { error: 'Not a Papol page.' };
      const { handoffs } = await state();
      if (!Policy.mayFetch(message.url, handoffs)) {
        return { error: 'Papol for Safari only fetches PDFs it opened in Papol. Open the original and try again.' };
      }
      try {
        return await fetchPdf(message.url, tabId, message.requestId);
      } catch (failure) {
        return { error: `The PDF could not be fetched: ${failure?.message || failure}` };
      }
    }
    case 'chunk': {
      if (!(await fromPapol(sender))) return { error: 'Not a Papol page.' };
      const bytes = fetched.get(message.token);
      if (!bytes) return { error: 'The PDF is no longer held. Reload the page.' };
      const start = message.index * CHUNK_BYTES;
      const piece = bytes.subarray(start, start + CHUNK_BYTES);
      if (start + CHUNK_BYTES >= bytes.length) fetched.delete(message.token);
      return { data: base64(piece) };
    }
    case 'open-here': {
      // The toolbar's "Open this page in Papol", for a PDF the rules missed.
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) return { opened: false };
      return { opened: await openInPapol(tab.id, tab.url, { always: true }) };
    }
    default:
      return null;
  }
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  answer(message, sender).then(sendResponse, (failure) => sendResponse({ error: String(failure?.message || failure) }));
  return true;
});
