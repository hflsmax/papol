// How wide a stroke is drawn, in one place.
//
// The brush's cursor, and the weights offered in its sheet, both have to be
// the size of the mark they stand for — and "the same size" is only true if
// it is the same arithmetic. It lives here so that neither can drift from
// the other, or from the stroke itself.


// A cursor may be as big as the browser will still draw — past about 128px
// it drops the image altogether — so the strip can keep up with the ink
// almost as far as the ink goes. A button in a small sheet may not: a
// zoomed page would put a strip taller than the sheet inside it. So the two
// take different ceilings, and only disagree past this one, where the
// choice being made is which of four weights rather than how tall the mark
// is on screen right now.
export const STRIP_MAX = 40;
export const CURSOR_MAX = 90;

// How thick a stroke is on screen: a fraction of the page, times the page,
// times the zoom. The floor keeps the finest weight visible; the ceiling
// keeps a cursor image inside the size a browser will still honour.
//
// The zoom belongs in here. It was taken out once, because the strip
// changed shape as the window was resized — but that was the length being
// fixed while the thickness moved, and the length is a multiple of the
// thickness now. With the ratio held, the zoom changes the strip's size and
// not its shape, which is what was wanted, and lets the strip be exactly as
// tall as the band it paints.
export const strokePx = (width, pageWidth, scale = 1, ceiling = STRIP_MAX) =>
  Math.max(1.5, Math.min(ceiling, width * pageWidth * scale));

// A strip is three times as long as it is thick, at every weight, so that
// what changes between weights is a size and not a shape.
export const STRIP_RATIO = 3;

// The strip the brush is: upright, and exactly as tall as the band it will
// paint. A flat brush held on end paints a band the height of its edge, so
// the height is the stroke's own width — that is the measurement the ink
// has to agree with, and the one the eye checks. The width of the strip is
// only how thin the thing in your hand is, and has a floor so that the
// finest weight is still something rather than a hairline of nothing.
export const stripSize = (width, pageWidth, scale = 1, ceiling = STRIP_MAX) => {
  const tall = strokePx(width, pageWidth, scale, ceiling);
  return { tall, wide: Math.max(1, tall / STRIP_RATIO) };
};

// A page to fall back on before a real one has been measured — the width of
// a US Letter page in PDF units, which is what most papers are.
export const PAGE_WIDTH_GUESS = 612;
