// Where the reader left a paper, shared between the places they read it.
//
// Each viewer keeps the place in its own storage (App.jsx: the point at the
// middle of the view, as fractions of its page, and the zoom), and that is
// what a paper opens at on the same device, at once. The place is also sent
// to Papol, stamped with when the reader was there, so that the website and
// the Mac open a paper where the other left it. When a paper opens, the
// viewer asks for Papol's place, and moves there if it is newer than its
// own and the reader has not moved yet: a place that arrives after the
// reader has started reading never pulls them away.

// Close enough to be the same place to a reader. The zoom is not part of
// it: zooming, or a window of another size refitting the page, is not
// reading somewhere else.
export function samePlace(a, b) {
  if (!a || !b) return false;
  return a.page === b.page && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.x - b.x) < 0.05;
}

function readAt(place) {
  const at = Date.parse(place?.read_at ?? '');
  return Number.isFinite(at) ? at : null;
}

// Whether Papol's place should be taken over this viewer's own: it is a
// place, and it was read later than this one, or this one has no time
// (it was kept before places carried one, or the paper was only opened
// here, never read).
export function laterPlace(own, theirs) {
  if (!theirs || !Number.isInteger(theirs.page) || theirs.page < 1) return false;
  if (!Number.isFinite(theirs.x) || !Number.isFinite(theirs.y)) return false;
  const their = readAt(theirs);
  if (their == null) return false;
  const mine = readAt(own);
  return mine == null || their > mine;
}

// Papol's place as this viewer keeps it: its page and point, read when it
// was read, at this viewer's own zoom. A zoom chosen in a narrow browser
// tab is no zoom for a Mac window, so the page is fitted afresh when this
// viewer has none of its own.
export function adoptedPlace(own, theirs) {
  return {
    page: theirs.page,
    x: theirs.x,
    y: theirs.y,
    scale: Number.isFinite(own?.scale) ? own.scale : null,
    read_at: theirs.read_at,
  };
}

// The view as the viewer saw it now, against the one it kept: what to keep,
// and whether it is a move to send. The first view of a paper this viewer
// had no place for is only where it opened, not a place the reader chose,
// so it carries no time and is not sent.
export function nextPlace(kept, seen, now = () => new Date()) {
  if (!kept) return { place: { ...seen, read_at: null }, moved: false };
  if (samePlace(kept, seen)) {
    if (kept.scale === seen.scale) return { place: kept, moved: false };
    return { place: { ...kept, scale: seen.scale }, moved: false };
  }
  return { place: { ...seen, read_at: now().toISOString() }, moved: true };
}

// Sends the latest place once the reader has been still for `delay`, or at
// once on `flush` (the window going away). Only the latest is ever sent; a
// failure is let go, since the place is kept here either way and the next
// move sends again.
export function placeSender(send, { delay = 1500, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let waiting = null;
  let timer = null;
  const flush = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
    if (!waiting) return;
    const place = waiting;
    waiting = null;
    Promise.resolve().then(() => send(place)).catch(() => {});
  };
  return {
    schedule(place) {
      waiting = place;
      if (timer != null) clearTimer(timer);
      timer = setTimer(flush, delay);
    },
    flush,
  };
}
