import test from 'node:test';
import assert from 'node:assert/strict';
import { findTextMatches, indexTextItems } from './pdfSearch.js';

test('finds repeated text and maps it to rendered items', () => {
  const page = indexTextItems([{ str: 'Alpha beta' }, { str: 'alpha' }]);
  assert.deepEqual(findTextMatches(page, 'alpha'), [
    { parts: [{ spanIndex: 0, start: 0, end: 5 }] },
    { parts: [{ spanIndex: 1, start: 0, end: 5 }] },
  ]);
});

test('finds a phrase across adjacent PDF text items', () => {
  const page = indexTextItems([{ str: 'search' }, { str: 'works' }]);
  assert.deepEqual(findTextMatches(page, 'search works'), [
    { parts: [
      { spanIndex: 0, start: 0, end: 6 },
      { spanIndex: 1, start: 0, end: 5 },
    ] },
  ]);
});

test('empty PDF layout items do not shift rendered span indexes', () => {
  const page = indexTextItems([
    { str: 'Title' },
    { str: '', hasEOL: true },
    { str: 'Author' },
  ]);
  assert.deepEqual(findTextMatches(page, 'Author'), [
    { parts: [{ spanIndex: 1, start: 0, end: 6 }] },
  ]);
});
