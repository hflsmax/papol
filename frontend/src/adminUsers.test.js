import test from 'node:test';
import assert from 'node:assert/strict';

import { ago, readingTime, windowLabel } from './adminUsers.js';

const NOW = Date.parse('2026-11-23T12:00:00Z');

test('a time reads as how long ago it was', () => {
  assert.equal(ago(null, NOW), 'never');
  assert.equal(ago('2026-11-23T11:59:30Z', NOW), 'just now');
  assert.equal(ago('2026-11-23T11:48:00Z', NOW), '12 min ago');
  assert.equal(ago('2026-11-23T07:00:00Z', NOW), '5 h ago');
  assert.equal(ago('2026-11-22T10:00:00Z', NOW), 'yesterday');
  assert.equal(ago('2026-11-20T12:00:00Z', NOW), '3 days ago');
  assert.equal(ago('2026-08-23T12:00:00Z', NOW), '3 months ago');
  assert.equal(ago('2023-11-01T12:00:00Z', NOW), '3 years ago');
  // A clock a little ahead is not the future.
  assert.equal(ago('2026-11-23T12:00:30Z', NOW), 'just now');
});

test('reading time reads in the largest unit that fits', () => {
  assert.equal(readingTime(0), '—');
  assert.equal(readingTime(null), '—');
  assert.equal(readingTime(45), '45s');
  assert.equal(readingTime(12 * 60 + 5), '12m');
  assert.equal(readingTime(3 * 3600 + 5 * 60), '3h 05m');
  assert.equal(readingTime(128 * 3600 + 59 * 60), '128h');
});

test('a window is named in words', () => {
  assert.equal(windowLabel(1), 'last 24 hours');
  assert.equal(windowLabel(7), 'last 7 days');
  assert.equal(windowLabel(30), 'last 30 days');
  assert.equal(windowLabel(365), 'last year');
});
