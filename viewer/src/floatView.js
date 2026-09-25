// Where a link to a figure, table or box takes the reader: the zoom at which
// the whole float fills the window, and the scroll that puts it in the
// middle. Pure, so the arithmetic is tested apart from the DOM (App.jsx,
// `followLink`, does the measuring and the scrolling).

// How much of the window the float may take: the rest is margin, so its
// edges are seen as edges and the text around it hints where it sits.
export const FLOAT_ROOM = { width: 0.92, height: 0.85 };

// A footnote is a line or two: filling the window with it would be absurd,
// so a link to one keeps the zoom and only scrolls. A section is read from
// its heading (sectionZoom, below). Anything else a link can name with a
// box — figure, table, box, algorithm, listing — is fitted.
export const fitsFloat = (kind) => kind !== 'footnote' && kind !== 'section';

/**
 * The zoom at which a float fills the room it is given.
 * box: the float, as fractions of its page. page: the page's size at zoom 1.
 * room: the window's usable width and height, in pixels.
 */
export function floatZoom(box, page, room, { min, max }) {
  const width = box.w * page.width;
  const height = box.h * page.height;
  if (!(width > 0) || !(height > 0) || !(room.width > 0) || !(room.height > 0)) return null;
  const fit = Math.min((room.width * FLOAT_ROOM.width) / width, (room.height * FLOAT_ROOM.height) / height);
  return Math.min(max, Math.max(min, fit));
}

/**
 * The scroll that puts a float's middle in the window's middle, as far as
 * the document lets it. pageAt: the page's top-left in the scroller's
 * content, in pixels, and its size as laid out. view: the window's size;
 * content: how far the scroller can go.
 */
export function floatScroll(box, pageAt, view, content) {
  const middleX = pageAt.left + (box.x + box.w / 2) * pageAt.width;
  const middleY = pageAt.top + (box.y + box.h / 2) * pageAt.height;
  return {
    left: clamp(middleX - view.width / 2, content.width - view.width),
    top: clamp(middleY - view.height / 2, content.height - view.height),
  };
}

const clamp = (value, most) => Math.max(0, Math.min(Math.max(0, most), value));

// A section is read from where it begins: its heading near the top of the
// window, the column it is set in across the window's width. How much of
// the width the column takes, how far below the window's top the heading
// sits, and how much of the page's height at least stays in view — a
// narrow column filling a wide window would be text too large to read on.
export const SECTION_VIEW = { width: 0.94, above: 0.06, pageHeight: 0.4 };

/**
 * The zoom a section is read at: its column across the window, no closer
 * than leaves SECTION_VIEW.pageHeight of the page in view.
 * box: the heading across its column, as fractions of the page.
 */
export function sectionZoom(box, page, room, { min, max }) {
  const width = box.w * page.width;
  if (!(width > 0) || !(page.height > 0) || !(room.width > 0) || !(room.height > 0)) return null;
  const across = (room.width * SECTION_VIEW.width) / width;
  const down = room.height / (SECTION_VIEW.pageHeight * page.height);
  return Math.min(max, Math.max(min, Math.min(across, down)));
}

/** The scroll that puts a section's heading near the window's top, its column in the middle across. */
export function sectionScroll(box, pageAt, view, content) {
  const middleX = pageAt.left + (box.x + box.w / 2) * pageAt.width;
  const top = pageAt.top + box.y * pageAt.height - SECTION_VIEW.above * view.height;
  return {
    left: clamp(middleX - view.width / 2, content.width - view.width),
    top: clamp(top, content.height - view.height),
  };
}
