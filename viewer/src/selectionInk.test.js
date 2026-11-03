import test from 'node:test';
import assert from 'node:assert/strict';

import { selectionStrokes, withinSpan } from './selectionInk.js';

test('joins a raised citation to the selected body-text line around it', () => {
  const pageBoxes = [{
    page: 9,
    box: { left: 0, right: 600, top: 0, bottom: 800, width: 600, height: 800 },
  }];
  const rects = [
    { left: 40, right: 125, top: 400, bottom: 410, width: 85, height: 10 },
    { left: 125, right: 138, top: 396, bottom: 402, width: 13, height: 6 },
    { left: 138, right: 295, top: 400, bottom: 410, width: 157, height: 10 },
  ];

  const strokes = selectionStrokes(rects, pageBoxes);

  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].page, 9);
  assert.ok(strokes[0].points[0].x < 0.08);
  assert.ok(strokes[0].points[1].x > 0.48);
});

test('does not join text across a wide column gap', () => {
  const pageBoxes = [{
    page: 1,
    box: { left: 0, right: 600, top: 0, bottom: 800, width: 600, height: 800 },
  }];
  const rects = [
    { left: 40, right: 290, top: 100, bottom: 110, width: 250, height: 10 },
    { left: 330, right: 560, top: 100, bottom: 110, width: 230, height: 10 },
  ];

  assert.equal(selectionStrokes(rects, pageBoxes).length, 2);
});

test('stores selection geometry relative to the page so scrolling cannot move it', () => {
  const beforeScroll = selectionStrokes(
    [{ left: 120, right: 360, top: 340, bottom: 356, width: 240, height: 16 }],
    [{ page: 3, box: { left: 80, right: 680, top: 100, bottom: 900, width: 600, height: 800 } }],
  );
  const afterScroll = selectionStrokes(
    [{ left: 120, right: 360, top: -460, bottom: -444, width: 240, height: 16 }],
    [{ page: 3, box: { left: 80, right: 680, top: -700, bottom: 100, width: 600, height: 800 } }],
  );

  assert.deepEqual(afterScroll, beforeScroll);
});

test('keeps a math glyph’s box to the line its span is on', () => {
  // A selected "𝑀" in a math face: the browser's text box runs from two
  // lines above to two below, the span holding it is one line tall.
  const span = { left: 280, right: 315, top: 788, bottom: 811, width: 35, height: 23 };
  const glyph = { left: 280, right: 315, top: 736, bottom: 863, width: 35, height: 127 };
  assert.deepEqual(withinSpan(glyph, span), {
    left: 280, right: 315, top: 788, bottom: 811, width: 35, height: 23,
  });
  // Kept as it was where there is no span, or it lies outside it.
  assert.equal(withinSpan(glyph, null), glyph);
  assert.equal(withinSpan(glyph, { ...span, top: 900, bottom: 920 }), glyph);
});

test('a tall math glyph on a line does not make its band cover the paragraph', () => {
  const pageBoxes = [{ page: 9, box: { left: 0, right: 1000, top: 0, bottom: 1400, width: 1000, height: 1400 } }];
  const span = { left: 280, right: 315, top: 788, bottom: 811, width: 35, height: 23 };
  const glyph = { left: 280, right: 315, top: 736, bottom: 863, width: 35, height: 127 };
  const rects = [
    { left: 204, right: 275, top: 786, bottom: 809, width: 71, height: 23 },
    withinSpan(glyph, span),
    { left: 320, right: 1009, top: 786, bottom: 809, width: 689, height: 23 },
  ];
  const [stroke, ...rest] = selectionStrokes(rects, pageBoxes);
  assert.equal(rest.length, 0);
  assert.ok(stroke.width * 1000 <= 24);
});
