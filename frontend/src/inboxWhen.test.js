import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxWhen, inboxWhenFull } from './inboxWhen.js';

const now = new Date(2026, 8, 29, 14, 0);

test('a notification from today shows its time', () => {
  assert.equal(inboxWhen(new Date(2026, 8, 29, 9, 13).toISOString(), now), '9:13 AM');
});

test('one from earlier this year shows its day', () => {
  assert.equal(inboxWhen(new Date(2026, 8, 23, 12, 13).toISOString(), now), 'Sep 23');
});

test('one from another year shows its year too', () => {
  assert.equal(inboxWhen(new Date(2025, 11, 30, 8, 0).toISOString(), now), 'Dec 30, 2025');
});

test('the full date names the day, the year and the time', () => {
  assert.equal(inboxWhenFull(new Date(2026, 8, 23, 12, 13).toISOString()), 'Wed, Sep 23, 2026, 12:13 PM');
});
