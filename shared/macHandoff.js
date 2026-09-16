// Handing the document in front of the reader over to Papol for Mac
// (USER_STORIES.md §7d). Every decision here is a pure function of the
// address, the browser and what the reader has already said, so the whole
// policy can be tested without a DOM. Only `attemptHandoff` touches a
// window, and it takes the one it should touch.

// The private address Papol for Mac answers to. It mirrors the web address
// exactly — `https://host/papol/viewer/?pdf=…` becomes
// `papol://host/papol/viewer/?pdf=…` — so the app can turn it back into the
// address the reader was already at without a second vocabulary to keep in
// step (US-7.32).
export const HANDOFF_SCHEME = 'papol';

// A deep link arrives from whatever page cared to send one, so only the keys
// that identify a document and a place in it survive the crossing. Anything
// else a page might hope to smuggle into the app's own URL is dropped.
export const HANDOFF_QUERY_KEYS = Object.freeze([
  'pdf', 'board', 'share', 'demo', 'page', 'note', 'y', 'mark', 'box',
]);

export const RETIRED_KEY = 'papol.handoff.retired';
export const ALWAYS_KEY = 'papol.handoff.always';
export const DEFERRED_KEY = 'papol.handoff.deferred';

export const DOWNLOAD_URL = 'https://github.com/hflsmax/papol/releases';

// Long enough that a cold application launch still counts as an answer,
// short enough that a reader who has no Papol is not left watching a bar
// think about it.
export const DETECTION_MS = 1500;

function parse(href) {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

// What the reader is looking at, named the way the offer will name it
// (US-7.23). The demo is nobody's reading, so it is not a document to hand
// over (US-7.31).
export function handoffDocument(href) {
  const url = parse(href);
  if (!url) return null;
  if (!/^https?:$/.test(url.protocol)) return null;
  const path = url.pathname;
  if (/\/demo\//.test(path)) return null;
  if (/\/viewer(\/|$)/.test(path)) {
    if (!url.searchParams.get('pdf') && !url.searchParams.get('share')) return null;
    return { kind: 'paper', noun: 'this paper' };
  }
  const board = path.match(/\/boards\/([^/]+)/);
  if (board && board[1] && board[1] !== 'index.html') {
    return { kind: 'board', noun: 'this board' };
  }
  if (/\/boards(\/|$)/.test(path) && url.searchParams.get('board')) {
    return { kind: 'board', noun: 'this board' };
  }
  return null;
}

// The same address, addressed to the application. Note that the path is kept
// whole: the app is the one that knows which bundled page serves it.
export function handoffAddress(href) {
  const url = parse(href);
  if (!url || !handoffDocument(href)) return null;
  const kept = new URLSearchParams();
  for (const key of HANDOFF_QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null) kept.set(key, value);
  }
  const query = kept.toString();
  return `${HANDOFF_SCHEME}://${url.host}${url.pathname}${query ? `?${query}` : ''}`;
}

// One document, named so that "Not now" forgets this paper rather than every
// paper (US-7.27).
export function handoffIdentity(href) {
  const url = parse(href);
  if (!url) return null;
  const pdf = url.searchParams.get('pdf') || url.searchParams.get('share');
  if (pdf) return `pdf:${pdf}`;
  const board = url.pathname.match(/\/boards\/([^/]+)/);
  if (board) return `board:${board[1]}`;
  const named = url.searchParams.get('board');
  return named ? `board:${named}` : null;
}

function readFlag(store, key) {
  try {
    return store?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(store, key, value) {
  try {
    if (value) store?.setItem(key, '1');
    else store?.removeItem(key);
  } catch {
    // A browser that refuses storage still gets to dismiss the bar for this
    // visit; it simply cannot be told to remember.
  }
}

export function deferDocument(store, identity) {
  if (!identity) return;
  try {
    const raw = store?.getItem(DEFERRED_KEY);
    const deferred = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(deferred) ? deferred : [];
    if (list.includes(identity)) return;
    store?.setItem(DEFERRED_KEY, JSON.stringify([...list, identity].slice(-64)));
  } catch {
    // As above: the offer is gone for this visit either way.
  }
}

export function documentIsDeferred(store, identity) {
  if (!identity) return false;
  try {
    const raw = store?.getItem(DEFERRED_KEY);
    const deferred = raw ? JSON.parse(raw) : [];
    return Array.isArray(deferred) && deferred.includes(identity);
  } catch {
    return false;
  }
}

// Whether to say anything at all. The offer is made wherever it can be
// honoured and nowhere else (US-7.24), and it is never withheld because the
// reader has not taken it up before: Papol cannot see what is installed and
// does not guess from what happened last time (US-7.30).
export function handoffOffer({
  href, desktop = false, mac = false, session = null, local = null,
}) {
  if (desktop) return null;
  if (!mac) return null;
  const document_ = handoffDocument(href);
  if (!document_) return null;
  const address = handoffAddress(href);
  if (!address) return null;
  if (readFlag(local, RETIRED_KEY)) return null;
  const identity = handoffIdentity(href);
  if (documentIsDeferred(session, identity)) return null;
  return {
    ...document_,
    address,
    identity,
    label: `Open ${document_.noun} in Papol`,
    always: readFlag(local, ALWAYS_KEY),
  };
}

// Asking the system to open the address, and listening for the only evidence
// a browser will ever give: this tab losing attention. There is no API that
// answers "is it installed", so this is a guess with a clock on it, and the
// caller is told which of the two it got rather than being told a verdict
// about the reader's computer (US-7.34).
//
// Assigning `location.href` a scheme the system does not handle does not
// unload the document in any current browser, which is what lets the reading
// stay exactly where it was behind the offer (US-7.26).
export function attemptHandoff(address, { win, timeoutMs = DETECTION_MS } = {}) {
  const view = win || (typeof window === 'undefined' ? null : window);
  if (!view) return Promise.resolve('unknown');
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (verdict) => {
      if (settled) return;
      settled = true;
      if (timer !== null) view.clearTimeout(timer);
      view.removeEventListener('blur', left);
      view.removeEventListener('pagehide', left);
      view.document?.removeEventListener('visibilitychange', hidden);
      resolve(verdict);
    };
    function left() {
      finish('opened');
    }
    function hidden() {
      if (view.document?.visibilityState === 'hidden') finish('opened');
    }
    view.addEventListener('blur', left);
    view.addEventListener('pagehide', left);
    view.document?.addEventListener('visibilitychange', hidden);
    timer = view.setTimeout(() => finish('unknown'), timeoutMs);
    try {
      view.location.href = address;
    } catch {
      finish('unknown');
    }
  });
}
