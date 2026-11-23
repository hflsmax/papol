import { STRIP_RATIO } from './ink.js';

// A text box cut to the height of the span that holds it. pdf.js gives each
// span exactly the height of its font, but the box a browser reports for the
// text inside is as tall as the face's ascent and descent, and a math face
// (STIX Two Math, Latin Modern Math) declares room for its tallest operator:
// a selected "𝑀" measured five lines tall, and the band painted for its
// line covered the paragraph. The span says where its line is; its text
// only says how far along.
export function withinSpan(rect, spanRect) {
  if (!spanRect || !(spanRect.height > 0)) return rect;
  const top = Math.max(rect.top, spanRect.top);
  const bottom = Math.min(rect.bottom, spanRect.bottom);
  if (bottom <= top) return rect;
  return { left: rect.left, right: rect.right, top, bottom, width: rect.width, height: bottom - top };
}

// The boxes of a selection's text, each kept to the line it is on (see
// withinSpan). Only text is measured: the boxes of the spans themselves,
// which a Range also reports, say nothing that their text does not.
export function selectionRects(range) {
  let root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) root = root.parentNode;
  const rects = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const piece = document.createRange();
    piece.selectNodeContents(node);
    if (node === range.startContainer) piece.setStart(node, range.startOffset);
    if (node === range.endContainer) piece.setEnd(node, range.endOffset);
    if (piece.collapsed) continue;
    const span = node.parentElement;
    const spanRect = span?.closest('.textLayer') ? span.getBoundingClientRect() : null;
    for (const rect of piece.getClientRects()) rects.push(withinSpan(rect, spanRect));
    piece.detach();
  }
  return rects.length ? rects : [...range.getClientRects()];
}

// The top and bottom of a line's band, from the pieces of text on it. pdf.js
// places each span from its own font's ascent, and fonts disagree: a bullet
// or a bracket set in a math face sits a third of a line above or below the
// prose beside it. The band goes where most of the line's text is, measured
// by width, among the pieces as tall as the line's tallest, so neither a
// bullet that opens the line nor a raised citation narrower than the
// words around it can move it.
function lineBand(pieces) {
  const tallest = Math.max(...pieces.map((p) => p.bottom - p.top));
  const groups = [];
  for (const piece of pieces) {
    const height = piece.bottom - piece.top;
    if (height < tallest * 0.9) continue;
    const near = Math.max(1, height * 0.05);
    const group = groups.find((g) => Math.abs(g.top - piece.top) <= near && Math.abs(g.bottom - piece.bottom) <= near);
    if (group) group.width += piece.right - piece.left;
    else groups.push({ top: piece.top, bottom: piece.bottom, width: piece.right - piece.left });
  }
  const { top, bottom } = groups.reduce((best, g) => (g.width > best.width ? g : best));
  return { top, bottom };
}

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
    // getClientRects follows the range's document order. Preserve that
    // order within a page: a raised citation belongs between the body-text
    // fragments on either side even though its visual top is higher.
    .sort((a, b) => a.page - b.page);

  const lines = [];
  for (const fragment of fragments) {
    const previous = lines[lines.length - 1];
    const height = fragment.bottom - fragment.top;
    const previousHeight = previous ? previous.bottom - previous.top : 0;
    const center = (fragment.top + fragment.bottom) / 2;
    const previousCenter = previous ? (previous.top + previous.bottom) / 2 : 0;
    const sameLine =
      previous &&
      previous.page === fragment.page &&
      // Citations are commonly about 60% of the body-text height and raised
      // several pixels. Compare centres generously enough to join them, but
      // not enough to reach the next actual line.
      Math.abs(previousCenter - center) <=
        Math.max(2, Math.max(previousHeight, height) * 0.75) &&
      fragment.left - previous.right <= Math.max(3, Math.max(previousHeight, height) * 0.8);
    if (sameLine) {
      previous.right = Math.max(previous.right, fragment.right);
      previous.left = Math.min(previous.left, fragment.left);
      previous.pieces.push(fragment);
      // Later pieces on the line are compared with where its band is now.
      Object.assign(previous, lineBand(previous.pieces));
    } else {
      lines.push({ ...fragment, pieces: [fragment] });
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
