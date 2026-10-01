import assert from 'node:assert/strict';
import test from 'node:test';

import { pdfFetchCredentials } from './pdfFetch.js';

test('public cross-origin PDFs are fetched without session credentials', () => {
  assert.equal(pdfFetchCredentials('https://files.papol.io/uploads/paper.pdf', 'https://papol.io'), 'omit');
});

test('same-origin and relative PDF routes retain session credentials', () => {
  assert.equal(pdfFetchCredentials('https://papol.io/uploads/paper.pdf', 'https://papol.io'), 'include');
  assert.equal(pdfFetchCredentials('/uploads/paper.pdf', 'https://papol.io'), 'include');
});
