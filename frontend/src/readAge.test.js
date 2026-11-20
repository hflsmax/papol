import test from 'node:test';
import assert from 'node:assert/strict';
import { readAge, readAgeLabel, READ_AGE_NEVER } from './readAge.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const read = (days) => ({ seconds: 60, last_at: new Date(NOW - days * 86400e3).toISOString() });

test('a paper read lately is light, and darker the longer since', () => {
  assert.equal(readAge(read(0.1), NOW), 0);
  assert.equal(readAge(read(0.99), NOW), 0);
  assert.equal(readAge(read(1), NOW), 1);
  assert.equal(readAge(read(6.9), NOW), 1);
  assert.equal(readAge(read(7), NOW), 2);
  assert.equal(readAge(read(29), NOW), 2);
  assert.equal(readAge(read(30), NOW), 3);
  assert.equal(readAge(read(89), NOW), 3);
  assert.equal(readAge(read(90), NOW), 4);
  assert.equal(readAge(read(800), NOW), 4);
});

test('a paper never read is darkest; one whose reading is unknown is not shaded', () => {
  assert.equal(readAge(null, NOW), READ_AGE_NEVER);
  assert.equal(readAge({ seconds: 0, last_at: null }, NOW), READ_AGE_NEVER);
  assert.equal(readAge(undefined, NOW), null);
});

test('a reading a clock ahead put in the future counts as just now', () => {
  assert.equal(readAge(read(-0.01), NOW), 0);
});

test('the row says how long ago', () => {
  assert.equal(readAgeLabel(read(0.2), NOW), 'Read today');
  assert.equal(readAgeLabel(read(1.2), NOW), 'Last read yesterday');
  assert.equal(readAgeLabel(read(5), NOW), 'Last read 5 days ago');
  assert.equal(readAgeLabel(read(18), NOW), 'Last read 2 weeks ago');
  assert.equal(readAgeLabel(read(120), NOW), 'Last read 4 months ago');
  assert.equal(readAgeLabel(null, NOW), 'Not read yet');
  assert.equal(readAgeLabel(undefined, NOW), undefined);
});
