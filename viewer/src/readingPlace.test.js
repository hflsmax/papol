import assert from 'node:assert/strict';
import test from 'node:test';

import { nextPlace, papolPlace, samePlace } from './readingPlace.js';

test('a place is the same to a reader within a sliver of the page, whatever the zoom', () => {
  const here = { page: 4, x: 0.5, y: 0.5, scale: 1.2 };
  assert.ok(samePlace(here, { ...here, y: 0.505, scale: 2 }));
  assert.ok(!samePlace(here, { ...here, y: 0.52 }));
  assert.ok(!samePlace(here, { ...here, page: 5 }));
  assert.ok(!samePlace(here, null));
});

test("Papol's place is taken when it is somewhere else, at this viewer's own zoom or none", () => {
  const state = { key: 'f'.repeat(64), value: { page: 9, x: 0.5, y: 0.3, scale: 2.5 }, at: '2026-11-22T20:00:00.000Z' };
  assert.deepEqual(papolPlace({ page: 1, x: 0.5, y: 0.5, scale: 1.1 }, state), { page: 9, x: 0.5, y: 0.3, scale: 1.1 });
  assert.deepEqual(papolPlace(null, state), { page: 9, x: 0.5, y: 0.3, scale: null });
  // Already there.
  assert.equal(papolPlace({ page: 9, x: 0.5, y: 0.302, scale: 1 }, state), null);
  assert.equal(papolPlace(null, null), null);
  assert.equal(papolPlace(null, { ...state, value: { page: 0, x: 0.5, y: 0.5 } }), null);
});

test('where a paper opens is kept but not shared, and only a move is', () => {
  const opened = nextPlace(null, { page: 1, x: 0.5, y: 0.4, scale: 1 });
  assert.deepEqual(opened, { place: { page: 1, x: 0.5, y: 0.4, scale: 1 }, moved: false });
  // Still there: nothing to keep.
  assert.equal(nextPlace(opened.place, { page: 1, x: 0.5, y: 0.402, scale: 1 }).place, opened.place);
  // Zoomed in place: kept, not shared.
  assert.deepEqual(nextPlace(opened.place, { page: 1, x: 0.5, y: 0.4, scale: 2 }),
    { place: { page: 1, x: 0.5, y: 0.4, scale: 2 }, moved: false });
  // Read on: kept and shared.
  assert.deepEqual(nextPlace(opened.place, { page: 3, x: 0.5, y: 0.6, scale: 2 }),
    { place: { page: 3, x: 0.5, y: 0.6, scale: 2 }, moved: true });
});
