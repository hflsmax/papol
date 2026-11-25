// A definition's box set by hand (TermBoxer.jsx): the arithmetic of drawing
// one on a page and of pulling it about, in fractions of the page from its
// top-left corner, as a defined term keeps its box.

// No box is smaller than this, across or down: a slip of the hand is not a
// definition.
export const BOX_MIN = 0.012;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** The box between two points of a page, kept on the page. */
export function boxBetween(a, b) {
  const x0 = clamp(Math.min(a.x, b.x), 0, 1), x1 = clamp(Math.max(a.x, b.x), 0, 1);
  const y0 = clamp(Math.min(a.y, b.y), 0, 1), y1 = clamp(Math.max(a.y, b.y), 0, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Whether a drawn box is one to keep. */
export const boxEnough = (box) => Boolean(box) && box.w >= BOX_MIN && box.h >= BOX_MIN;

/**
 * A box after its `grip` was pulled by (dx, dy): "move" carries it whole,
 * and a corner ("nw", "ne", "sw", "se") carries its two edges, neither
 * past the edge across from it nor off the page.
 */
export function boxPulled(box, grip, dx, dy) {
  if (grip === 'move') {
    return { ...box, x: clamp(box.x + dx, 0, 1 - box.w), y: clamp(box.y + dy, 0, 1 - box.h) };
  }
  let x0 = box.x, x1 = box.x + box.w, y0 = box.y, y1 = box.y + box.h;
  if (grip.includes('w')) x0 = clamp(x0 + dx, 0, x1 - BOX_MIN);
  if (grip.includes('e')) x1 = clamp(x1 + dx, x0 + BOX_MIN, 1);
  if (grip.includes('n')) y0 = clamp(y0 + dy, 0, y1 - BOX_MIN);
  if (grip.includes('s')) y1 = clamp(y1 + dy, y0 + BOX_MIN, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
