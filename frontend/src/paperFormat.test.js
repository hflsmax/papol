import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAuthors, newestFirst } from './paperFormat.js';

test('names up to two authors and abbreviates longer lists', () => {
  assert.equal(formatAuthors('["Gordon D. Plotkin"]'), 'Gordon D. Plotkin');
  assert.equal(formatAuthors('["Whitfield Diffie","Martin E. Hellman"]'), 'Whitfield Diffie, Martin E. Hellman');
  assert.equal(formatAuthors('["Ashish Vaswani","Noam Shazeer","Niki Parmar"]'), 'Ashish Vaswani et al.');
});

test('shows nothing for no authors', () => {
  assert.equal(formatAuthors(null), '');
  assert.equal(formatAuthors(''), '');
});

test('orders the most recently added paper first', () => {
  const papers = [
    { title: 'old', created_at: '2026-01-01T00:00:00Z' },
    { title: 'new', created_at: '2026-09-01T00:00:00Z' },
  ];
  assert.deepEqual([...papers].sort(newestFirst).map((paper) => paper.title), ['new', 'old']);
});
