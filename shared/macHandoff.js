// Handing the document in front of the user over to Papol for Mac
// (USER_STORIES.md §7d). Every decision here is a pure function of the
// address, the browser and what the user has already said, so the whole
// policy can be tested without a DOM. Only `attemptHandoff` touches a
// window, and it takes the one it should touch.

// The private address Papol for Mac answers to. It mirrors the web address
// exactly — `https://host/papol/viewer/?pdf=…` becomes
// `papol://host/papol/viewer/?pdf=…` — so the app can turn it back into the
// address the user was already at without a second vocabulary to keep in
// step (US-7.32).
// Vite's development server must hand off to the separately registered dev
// desktop app. Packaged web assets keep the production scheme.
export const HANDOFF_SCHEME = import.meta.env?.DEV ? 'papol-dev' : 'papol';

// A deep link arrives from whatever page cared to send one, so only the keys
// that identify a document and a place in it survive the crossing. Anything
// else a page might hope to smuggle into the app's own URL is dropped.
const HANDOFF_QUERY_KEYS = Object.freeze([
  'pdf', 'board', 'share', 'page', 'note', 'y', 'mark', 'box',
]);

export const RETIRED_KEY = 'papol.handoff.retired';
const DEFERRED_KEY = 'papol.handoff.deferred';

export const DOWNLOAD_URL = 'https://github.com/hflsmax/papol/releases';

// Long enough that a cold application launch still counts as an answer,
// short enough that a user who has no Papol is not left watching a bar
// think about it.
export const DETECTION_MS = 1500;

// Losing focus is the weakest of the three signals, because a browser that
// cannot open the address may say so in a panel attached to this window —
// which takes focus away exactly as the application would. So a blur alone
// buys a longer look, in the hope of seeing focus come back: a user who
// dismisses a panel is here again within a second or two, and a user whose
// Papol just opened is not.
export const BLUR_GRACE_MS = 3000;

function parse(href) {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

// Whether this is a computer a handoff could land on. iPadOS asks for the
// desktop site by default and answers to every Mac test a browser can run —
// same platform string, same user agent — so the one thing that still tells
// them apart is that nobody has ten fingers on a trackpad. An iPad offered
// Papol for Mac is offered something it cannot install (US-7.24).
export function handoffCapableMac(nav) {
  if (!nav) return false;
  if (!/Mac/.test(nav.platform || nav.userAgent || '')) return false;
  return !(nav.maxTouchPoints > 1);
}

// What the user is looking at, named the way the offer will name it
// (US-7.23).
export function handoffDocument(href) {
  const url = parse(href);
  if (!url) return null;
  if (!/^https?:$/.test(url.protocol)) return null;
  const path = url.pathname;
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
    const list = raw ? JSON.parse(raw) : [];
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
    return raw ? JSON.parse(raw).includes(identity) : false;
  } catch {
    return false;
  }
}

// Whether to say anything at all. The offer is made wherever it can be
// honoured and nowhere else (US-7.24), and it is never withheld because the
// user has not taken it up before: Papol cannot see what is installed and
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
  };
}

// Asking the system to open the address, and listening for the only evidence
// a browser will ever give: this tab losing the user. There is no API that
// answers "is it installed", so this is a guess with a clock on it, and the
// caller is told which of the two it got rather than being told a verdict
// about the user's computer (US-7.34).
//
// The three signals are not equally good, and treating them as if they were
// is how this goes wrong. Going hidden, or being unloaded, means the page is
// no longer in front of anyone — only the application arriving does that.
// Losing focus does not: a browser asked for a scheme it does not know may
// answer with a panel of its own, attached to this very window, which blurs
// the page while leaving it perfectly visible. Believing that blur is how a
// user with no Papol gets an error they did not ask for *and* loses the
// download offer that was the whole point of asking. So a blur only extends
// the wait, and focus returning inside it settles the question the other way.
//
// What remains is a user who leaves such a panel standing for longer than
// BLUR_GRACE_MS: that still reads as 'opened'. It is the residue of a
// question no browser will answer, and it errs toward silence rather than
// toward telling someone their computer is missing something it may have.
//
// Assigning `location.href` a scheme the system does not handle does not
// unload the document in any current browser, which is what lets the reading
// stay exactly where it was behind the offer (US-7.26).
export function attemptHandoff(address, { win, timeoutMs = DETECTION_MS, blurMs = BLUR_GRACE_MS } = {}) {
  const view = win || (typeof window === 'undefined' ? null : window);
  if (!view) return Promise.resolve('unknown');
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let blurred = false;
    const finish = (verdict) => {
      if (settled) return;
      settled = true;
      if (timer !== null) view.clearTimeout(timer);
      view.removeEventListener('blur', left);
      view.removeEventListener('focus', back);
      view.removeEventListener('pagehide', gone);
      view.document?.removeEventListener('visibilitychange', hidden);
      resolve(verdict);
    };
    function gone() {
      finish('opened');
    }
    function hidden() {
      if (view.document?.visibilityState === 'hidden') finish('opened');
    }
    // Noted, not believed. The wait is extended instead, so that focus coming
    // back has somewhere to land.
    function left() {
      if (blurred || settled) return;
      blurred = true;
      if (timer !== null) view.clearTimeout(timer);
      timer = view.setTimeout(decide, blurMs);
    }
    // Whatever took the focus gave it back, so it was something this user
    // could dismiss, and dismissing it is not a handoff.
    function back() {
      if (blurred) finish('unknown');
    }
    function decide() {
      // A page that lost the user and has not got them back is behind
      // something. `hasFocus` is what says so where a browser offers it; a
      // browser that does not is taken at its blur.
      const focused = view.document?.hasFocus?.();
      finish(blurred && focused !== true ? 'opened' : 'unknown');
    }
    view.addEventListener('blur', left);
    view.addEventListener('focus', back);
    view.addEventListener('pagehide', gone);
    view.document?.addEventListener('visibilitychange', hidden);
    timer = view.setTimeout(decide, timeoutMs);
    try {
      view.location.href = address;
    } catch {
      finish('unknown');
    }
  });
}
