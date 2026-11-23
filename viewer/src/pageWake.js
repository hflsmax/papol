// A drawn page is a bitmap the browser may take back while nobody is
// looking. Closing a MacBook's lid for the night is the usual way: the GPU
// process is reset on waking and every canvas it held comes back cleared,
// black or blank, with nothing in the document to say so — the page still
// believes it is drawn at this scale, and is never drawn again. Chrome says
// so with `contextlost` on each canvas; WebKit, which the Mac app runs in,
// may say nothing. So the viewer is told, too, when it returns after long
// enough away that its bitmaps cannot be trusted, and when the network
// comes back (a page whose drawing failed for a font or character map the
// worker could not fetch is worth another try then).
//
// listener(reason) is called with 'wake' or 'online'.

// A glance at another tab is not a night away: redrawing every page on
// screen for it would cost a visible flicker of work for nothing.
export const AWAY_LONG_MS = 60_000;

export function createWakeWatch({
  doc = globalThis.document,
  win = globalThis.window,
  now = () => Date.now(),
  awayLong = AWAY_LONG_MS,
} = {}) {
  const listeners = new Set();
  let hiddenAt = doc?.visibilityState === 'hidden' ? now() : null;
  const tell = (reason) => {
    for (const listener of [...listeners]) listener(reason);
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      hiddenAt ??= now();
      return;
    }
    const away = hiddenAt == null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    if (away >= awayLong) tell('wake');
  };
  // A page restored from the back/forward cache kept its canvases in memory
  // the browser may since have reclaimed.
  const onPageShow = (event) => {
    if (event?.persisted) tell('wake');
  };
  const onOnline = () => tell('online');
  doc?.addEventListener?.('visibilitychange', onVisibility);
  win?.addEventListener?.('pageshow', onPageShow);
  win?.addEventListener?.('online', onOnline);
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      win?.removeEventListener?.('pageshow', onPageShow);
      win?.removeEventListener?.('online', onOnline);
      listeners.clear();
    },
  };
}

let shared = null;

// The one watch every page of the open document shares.
export function pageWake() {
  shared ??= createWakeWatch();
  return shared;
}

// How long a page whose drawing failed waits before trying again: a
// second, then longer, then it waits for a wake or the network instead.
export const REDRAW_BACKOFF_MS = [1_000, 4_000, 15_000];
