import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionBarPlace } from './selectionBar.js';

const bounds = { top: 60, bottom: 900, left: 0, right: 1440 };
const lines = [
  { left: 400, right: 1000, top: 300, bottom: 318 },
  { left: 400, right: 1000, top: 320, bottom: 338 },
  { left: 400, right: 720, top: 340, bottom: 358 },
];

test('a drag down puts the bar right above the last line, ending where the pointer let go', () => {
  assert.deepEqual(selectionBarPlace(lines, { bounds }), { left: 720, top: 340, placement: 'above-end' });
});

test('a drag up puts the bar right above the first line, starting where the pointer let go', () => {
  const up = [{ left: 610, right: 1000, top: 300, bottom: 318 }, ...lines.slice(1)];
  assert.deepEqual(selectionBarPlace(up, { backward: true, bounds }), { left: 610, top: 300, placement: 'above-start' });
});

test('with no room above the line the bar opens below it', () => {
  const high = [{ left: 400, right: 720, top: 90, bottom: 108 }];
  assert.deepEqual(selectionBarPlace(high, { bounds }), { left: 720, top: 108, placement: 'below-end' });
});

test('the bar stays inside the window across', () => {
  const wide = [{ left: 0, right: 1439, top: 300, bottom: 318 }];
  assert.equal(selectionBarPlace(wide, { bounds }).left, 1418);
  assert.equal(selectionBarPlace(wide, { backward: true, bounds }).left, 22);
});
