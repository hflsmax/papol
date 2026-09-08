import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorSpotAtPage } from './anchorDrag.js';

const pages = [
  { page: 1, rect: { left: 100, top: 20, right: 500, bottom: 620, width: 400, height: 600 } },
  { page: 2, rect: { left: 100, top: 640, right: 500, bottom: 1240, width: 400, height: 600 } },
];

test('resolves an anchor against the page beneath the pointer', () => {
  assert.deepEqual(anchorSpotAtPage(pages, 300, 940), {
    page: 2,
    anchor: { type: 'point', x: 0.5, y: 0.5 },
  });
});

test('preserves the pointer grab offset on a destination page', () => {
  assert.deepEqual(anchorSpotAtPage(pages, 310, 950, { x: 10, y: 10 }), {
    page: 2,
    anchor: { type: 'point', x: 0.5, y: 0.5 },
  });
});

test('does not choose a page while the pointer is in the gutter', () => {
  assert.equal(anchorSpotAtPage(pages, 300, 630), null);
});
