// Where the reader left a paper, shared between the places they read it.
//
// Each viewer keeps the place in its own storage (App.jsx: the point at the
// middle of the view, as fractions of its page, and the zoom), and that is
// what a paper opens at on the same device, at once. A move is also one of
// the small things the user's devices share (shared/userState.js): sent to
// Papol when it can be, and the change made last wins. When a paper opens,
// the viewer asks for Papol's place and moves there if the reader has not
// moved yet: a place that arrives after the reader has started reading
// never pulls them away.

// Close enough to be the same place to a reader. The zoom is not part of
// it: zooming, or a window of another size refitting the page, is not
// reading somewhere else.
export function samePlace(a, b) {
  if (!a || !b) return false;
  return a.page === b.page && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.x - b.x) < 0.05;
}

// Papol's place, as this viewer would keep it, when it is somewhere else
// than this viewer's own; otherwise null. It keeps this viewer's zoom: a
// zoom chosen in a narrow browser tab is no zoom for a Mac window, so the
// page is fitted afresh when this viewer has none of its own.
export function papolPlace(own, state) {
  const theirs = state?.value;
  if (!theirs || !Number.isInteger(theirs.page) || theirs.page < 1) return null;
  if (!Number.isFinite(theirs.x) || !Number.isFinite(theirs.y)) return null;
  if (samePlace(own, theirs)) return null;
  return { page: theirs.page, x: theirs.x, y: theirs.y, scale: Number.isFinite(own?.scale) ? own.scale : null };
}

// The view as the viewer saw it now, against the one it kept: what to keep,
// and whether it is a move to share. The first view of a paper this viewer
// had no place for is only where it opened, not a place the reader chose,
// so it is kept but not shared.
export function nextPlace(kept, seen) {
  if (!kept) return { place: seen, moved: false };
  if (samePlace(kept, seen)) {
    if (kept.scale === seen.scale) return { place: kept, moved: false };
    return { place: { ...kept, scale: seen.scale }, moved: false };
  }
  return { place: seen, moved: true };
}
