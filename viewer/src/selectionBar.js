// Where the selected-text bar stands: at the end of the selection the
// pointer let go of — the last line's end for a drag down, the first
// line's start for a drag up — just above that line, or just below it
// where the window has no room above. The bar's own stylesheet keeps the
// small gap (ItemActions' --space-1); this answers only the anchor point
// and which way the bar opens from it.
export function selectionBarPlace(rects, { backward = false, bounds, height = 40, gap = 4, inset = 22 }) {
  const line = backward ? rects[0] : rects[rects.length - 1];
  const side = backward ? 'start' : 'end';
  const x = backward ? line.left : line.right;
  const left = Math.max(bounds.left + inset, Math.min(bounds.right - inset, x));
  if (line.top - gap - height >= bounds.top) {
    return { left, top: line.top, placement: `above-${side}` };
  }
  return { left, top: line.bottom, placement: `below-${side}` };
}
