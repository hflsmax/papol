// How wide a stroke is drawn, in one place.
//
// The brush's cursor, and the weights offered in its sheet, both have to be
// the size of the mark they stand for — and "the same size" is only true if
// it is the same arithmetic. It lives here so that neither can drift from
// the other, or from the stroke itself.

// A stroke's width is a fraction of the page, so its size in pixels comes
// from the page rather than from the screen: constant at any zoom and any
// window, and true of the ink at 100%. The floor keeps the finest weight
// visible; the ceiling keeps a cursor image inside the size a browser will
// still honour.
export const strokePx = (width, pageWidth) =>
  Math.max(1.5, Math.min(40, width * pageWidth));

// A strip is three times as long as it is thick, at every weight, so that
// what changes between weights is a size and not a shape.
export const STRIP_RATIO = 3;

// A page to fall back on before a real one has been measured — the width of
// a US Letter page in PDF units, which is what most papers are.
export const PAGE_WIDTH_GUESS = 612;
