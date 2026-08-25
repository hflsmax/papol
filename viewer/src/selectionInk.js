import { STRIP_RATIO } from './ink';

// Turn a browser text selection into one band per visual line fragment.
// Client rectangles are intentionally kept separate across lines and pages;
// only neighbouring pieces on the same line are joined.
export function selectionStrokes(clientRects, pageBoxes) {
  const fragments = clientRects
    .filter((rect) => rect.width > 0.5 && rect.height > 1)
    .map((rect) => {
      const cy = rect.top + rect.height / 2;
      const page = pageBoxes.find(
        ({ box }) =>
          cy >= box.top && cy <= box.bottom &&
          rect.right > box.left && rect.left < box.right
      );
      if (!page) return null;
      return {
        page: page.page,
        pageBox: page.box,
        left: Math.max(rect.left, page.box.left),
        right: Math.min(rect.right, page.box.right),
        top: Math.max(rect.top, page.box.top),
        bottom: Math.min(rect.bottom, page.box.bottom),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.page - b.page || a.top - b.top || a.left - b.left);

  const lines = [];
  for (const fragment of fragments) {
    const previous = lines[lines.length - 1];
    const height = fragment.bottom - fragment.top;
    const sameLine =
      previous &&
      previous.page === fragment.page &&
      Math.abs(previous.top - fragment.top) <= Math.max(2, height * 0.25) &&
      fragment.left - previous.right <= Math.max(3, height * 0.4);
    if (sameLine) {
      previous.right = Math.max(previous.right, fragment.right);
      previous.top = Math.min(previous.top, fragment.top);
      previous.bottom = Math.max(previous.bottom, fragment.bottom);
    } else {
      lines.push({ ...fragment });
    }
  }

  return lines.map(({ page, pageBox, left, right, top, bottom }) => {
    const width = Math.min(0.1, Math.max(0.001, (bottom - top) / pageBox.width));
    const nibInset = width / (2 * STRIP_RATIO);
    const x1 = (left - pageBox.left) / pageBox.width;
    const x2 = (right - pageBox.left) / pageBox.width;
    const center = (x1 + x2) / 2;
    const y = 1 - ((top + bottom) / 2 - pageBox.top) / pageBox.height;
    return {
      page,
      width,
      points: [
        { x: Math.max(0, Math.min(center, x1 + nibInset)), y },
        { x: Math.min(1, Math.max(center, x2 - nibInset)), y },
      ],
    };
  });
}
