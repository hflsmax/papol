// A double-click with the arrow on bare paper drops an anchor there, as the
// anchor tool would. Everything else a double-click already means keeps
// meaning it, so "bare" is decided narrowly: the pointer is on the page's
// own drawing or the empty ground of its text layer, and on nothing laid
// over them.
//
// The ground of a page: the holder, the drawing (sharp or detailed), and
// the boxes the text layer is built from. A word is a span inside the text
// layer and is not here; nor is a pin, a stroke's grab, a cow, a clip, a
// search highlight or a margin card, each of which is something to press.
const GROUND = ['pdf-page', 'page-inner', 'page-canvas', 'page-detail', 'text-host', 'text-scale', 'textLayer', 'endOfContent'];

export function onBareGround(target, holder) {
  if (!target || !holder || !holder.contains(target)) return false;
  if (target.tagName === 'CANVAS' && target.closest?.('.page-canvas')) return true;
  return GROUND.some((name) => target.classList?.contains(name));
}

// Whether this double-click is one that should drop an anchor.
//  - Only with the arrow: every other tool has its own business with a
//    press, and the anchor tool already drops one on the first.
//  - Only a mouse, trackpad or pen. A double tap on a phone or tablet is
//    too easily a reach for zoom, and the anchor tool is there for touch.
//  - Not where the browser has just selected a word: a double-click that
//    found text is reading, even where the text layer's box was the target.
//    On bare ground Chrome selects the line break the text layer ends a
//    line with, which is no word: only text that reads as something counts.
//  - Not on a line of text, nor in the narrow gap between two lines: that
//    is a reader aiming at a word and landing a pixel off. The viewer takes
//    the browser's selection into its own highlight as the second press
//    lifts, so by the time the double-click arrives the selection may
//    already be gone; where the words are is the dependable test.
//  - Not on a citation or a link, which a click already opens.
export function doubleClickDropsAnchor({ tool, button, pointerType, bare, selectedText, nearText, overReference }) {
  return tool === 'arrow'
    && button === 0
    && pointerType !== 'touch'
    && bare
    && !(selectedText ?? '').trim()
    && !nearText
    && !overReference;
}

// Whether a point (client pixels) sits on a line of text or within reach of
// one: each line's box grown by half its own height above and below, and a
// few pixels to either side.
export function nearText(boxes, x, y) {
  return boxes.some((b) => {
    if (!b.width || !b.height) return false;
    const reach = Math.max(4, b.height / 2);
    return x >= b.left - 4 && x <= b.right + 4 && y >= b.top - reach && y <= b.bottom + reach;
  });
}
