import assert from 'node:assert/strict';
import test from 'node:test';

import { adoptedPlace, laterPlace, nextPlace, placeSender, samePlace } from './readingPlace.js';

const at = (iso) => () => new Date(iso);

test('a place is the same to a reader within a sliver of the page, whatever the zoom', () => {
  const here = { page: 4, x: 0.5, y: 0.5, scale: 1.2 };
  assert.ok(samePlace(here, { ...here, y: 0.505, scale: 2 }));
  assert.ok(!samePlace(here, { ...here, y: 0.52 }));
  assert.ok(!samePlace(here, { ...here, page: 5 }));
  assert.ok(!samePlace(here, null));
});

test("Papol's place is taken when it was read later, or this viewer's has no time", () => {
  const theirs = { page: 9, x: 0.5, y: 0.3, scale: 1.5, read_at: '2026-11-22T20:00:00.000Z' };
  assert.ok(laterPlace(null, theirs));
  assert.ok(laterPlace({ page: 2, x: 0.5, y: 0.5, scale: 1 }, theirs));
  assert.ok(laterPlace({ page: 2, x: 0.5, y: 0.5, scale: 1, read_at: '2026-11-22T19:00:00.000Z' }, theirs));
  assert.ok(!laterPlace({ page: 2, x: 0.5, y: 0.5, scale: 1, read_at: '2026-11-22T21:00:00.000Z' }, theirs));
  assert.ok(!laterPlace({ page: 9, x: 0.5, y: 0.3, scale: 1, read_at: theirs.read_at }, theirs));
  assert.ok(!laterPlace(null, null));
  assert.ok(!laterPlace(null, { ...theirs, page: 0 }));
  assert.ok(!laterPlace(null, { ...theirs, read_at: 'whenever' }));
});

test("Papol's place keeps this viewer's own zoom, or none", () => {
  const theirs = { page: 9, x: 0.5, y: 0.3, scale: 2.5, read_at: '2026-11-22T20:00:00.000Z' };
  assert.deepEqual(adoptedPlace({ page: 1, x: 0.5, y: 0.5, scale: 1.1 }, theirs),
    { page: 9, x: 0.5, y: 0.3, scale: 1.1, read_at: theirs.read_at });
  assert.equal(adoptedPlace(null, theirs).scale, null);
});

test('where a paper opens is kept without a time, and only a move is sent', () => {
  const now = at('2026-11-22T20:00:00.000Z');
  const opened = nextPlace(null, { page: 1, x: 0.5, y: 0.4, scale: 1 }, now);
  assert.deepEqual(opened, { place: { page: 1, x: 0.5, y: 0.4, scale: 1, read_at: null }, moved: false });
  // Still there: nothing to keep.
  assert.equal(nextPlace(opened.place, { page: 1, x: 0.5, y: 0.402, scale: 1 }, now).place, opened.place);
  // Zoomed in place: kept, not sent, its time unchanged.
  const zoomed = nextPlace(opened.place, { page: 1, x: 0.5, y: 0.4, scale: 2 }, now);
  assert.deepEqual(zoomed, { place: { ...opened.place, scale: 2 }, moved: false });
  // Read on: kept and sent, with when.
  assert.deepEqual(nextPlace(zoomed.place, { page: 3, x: 0.5, y: 0.6, scale: 2 }, now),
    { place: { page: 3, x: 0.5, y: 0.6, scale: 2, read_at: '2026-11-22T20:00:00.000Z' }, moved: true });
});

test('the sender sends only the latest place, after a pause or at once when the window goes', async () => {
  const sent = [];
  const timers = [];
  const sender = placeSender((place) => { sent.push(place); }, {
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: (id) => { timers[id - 1] = null; },
  });
  sender.schedule({ page: 1 });
  sender.schedule({ page: 2 });
  timers.filter(Boolean).forEach((fn) => fn());
  await Promise.resolve();
  assert.deepEqual(sent, [{ page: 2 }]);
  sender.schedule({ page: 3 });
  sender.flush();
  sender.flush();
  await Promise.resolve();
  assert.deepEqual(sent, [{ page: 2 }, { page: 3 }]);
});

test('a place that cannot be sent is let go', async () => {
  const sender = placeSender(() => Promise.reject(new Error('offline')), { delay: 0 });
  sender.schedule({ page: 1 });
  sender.flush();
  await new Promise((resolve) => setTimeout(resolve, 5));
});
