// Where a link to a figure, table or box takes the reader: the zoom at which
// the whole float fills the window, and the scroll that puts it in the
// middle. Pure, so the arithmetic is tested apart from the DOM (App.jsx,
// `followLink`, does the measuring and the scrolling).

// How much of the window the float may take: the rest is margin, so its
// edges are seen as edges and the text around it hints where it sits.
export const FLOAT_ROOM = { width: 0.92, height: 0.85 };

// A footnote is a line or two: filling the window with it would be absurd,
// so a link to one keeps the zoom and only scrolls. Anything else a link
// can name with a box — figure, table, box, algorithm, listing — is fitted.
export const fitsFloat = (kind) => kind !== 'footnote';

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
  const clamp = (value, most) => Math.max(0, Math.min(Math.max(0, most), value));
  return {
    left: clamp(middleX - view.width / 2, content.width - view.width),
    top: clamp(middleY - view.height / 2, content.height - view.height),
  };
}
