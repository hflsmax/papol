import test from 'node:test';
import assert from 'node:assert/strict';

import { fitsFloat, floatScroll, floatZoom } from './floatView.js';

const LETTER = { width: 612, height: 792 };
const LIMITS = { min: 0.25, max: 5 };

test('a small figure is zoomed in until it fills the window, a wide one until its width does', () => {
  const room = { width: 1000, height: 800 };
  // A quarter-page figure, 306 × 198 at zoom 1: height binds.
  const small = floatZoom({ x: 0.25, y: 0.1, w: 0.5, h: 0.25 }, LETTER, room, LIMITS);
  assert.equal(small, Math.min((1000 * 0.92) / 306, (800 * 0.85) / 198));
  assert.ok(small > 3);
  // A full-width table, 551 × 158: width binds.
  const wide = floatZoom({ x: 0.05, y: 0.4, w: 0.9, h: 0.2 }, LETTER, room, LIMITS);
  assert.equal(wide, (1000 * 0.92) / (0.9 * 612));
});

test('a float taller than the window is zoomed out to fit, within the limits', () => {
  const room = { width: 1000, height: 500 };
  const tall = floatZoom({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, LETTER, room, LIMITS);
  assert.equal(tall, (500 * 0.85) / (0.9 * 792));
  assert.ok(tall < 1);
  // A speck is held to the most the viewer zooms, a page-sized float on a
  // tiny window to the least.
  assert.equal(floatZoom({ x: 0.5, y: 0.5, w: 0.01, h: 0.01 }, LETTER, room, LIMITS), 5);
  assert.equal(floatZoom({ x: 0, y: 0, w: 1, h: 1 }, LETTER, { width: 50, height: 50 }, LIMITS), 0.25);
});

test('nothing to measure is no zoom', () => {
  assert.equal(floatZoom({ x: 0, y: 0, w: 0, h: 0.2 }, LETTER, { width: 1000, height: 800 }, LIMITS), null);
  assert.equal(floatZoom({ x: 0, y: 0, w: 0.5, h: 0.2 }, LETTER, { width: 0, height: 800 }, LIMITS), null);
});

test("the float's middle lands in the window's middle, across as well as down", () => {
  const pageAt = { left: 24, top: 3000, width: 2000, height: 2600 };
  const box = { x: 0.6, y: 0.5, w: 0.3, h: 0.2 };
  const at = floatScroll(box, pageAt, { width: 1000, height: 800 }, { width: 2048, height: 30000 });
  // Middle at 24 + 0.75 × 2000 = 1524 across, 3000 + 0.6 × 2600 = 4560 down.
  assert.deepEqual(at, { left: 1524 - 500, top: 4560 - 400 });
});

test('the scroll stays inside the document', () => {
  const pageAt = { left: 24, top: 24, width: 2000, height: 2600 };
  const corner = floatScroll({ x: 0, y: 0, w: 0.1, h: 0.1 }, pageAt, { width: 1000, height: 800 }, { width: 2048, height: 2648 });
  assert.deepEqual(corner, { left: 0, top: 0 });
  const far = floatScroll({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, pageAt, { width: 1000, height: 800 }, { width: 2048, height: 2648 });
  assert.deepEqual(far, { left: 2048 - 1000, top: 2648 - 800 });
  // A page narrower than the window cannot scroll across at all.
  const narrow = floatScroll({ x: 0.9, y: 0.5, w: 0.1, h: 0.1 }, { left: 200, top: 24, width: 600, height: 800 }, { width: 1000, height: 800 }, { width: 1000, height: 5000 });
  assert.equal(narrow.left, 0);
});

test('a footnote keeps the zoom; everything else a link names is fitted', () => {
  assert.equal(fitsFloat('footnote'), false);
  for (const kind of ['figure', 'table', 'box', 'algorithm', 'listing']) assert.equal(fitsFloat(kind), true);
});
