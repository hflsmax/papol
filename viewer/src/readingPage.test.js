import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAtLine } from './readingPage.js';

const pages = [
  { page: 1, top: 0, bottom: 1000 },
  { page: 2, top: 1040, bottom: 2040 },
  { page: 3, top: 2080, bottom: 3080 },
];

test('names the page the reading line crosses', () => {
  assert.equal(pageAtLine(500, pages), 1);
  assert.equal(pageAtLine(1500, pages), 2);
  assert.equal(pageAtLine(3080, pages), 3);
});

test('in the gap between pages, names the nearer one', () => {
  assert.equal(pageAtLine(1010, pages), 1);
  assert.equal(pageAtLine(1030, pages), 2);
});

test('above the first page or below the last, names the page at that end', () => {
  assert.equal(pageAtLine(-200, pages), 1);
  assert.equal(pageAtLine(9000, pages), 3);
});

test('names no page when there are none', () => {
  assert.equal(pageAtLine(100, []), null);
});
