// A nook's own order: the papers its user pinned lead it, on the website's
// desk and in Papol macOS's list alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedFirst } from './paperFormat.js';
import { papersInListing } from './desktopListings.js';

const papers = [
  { sha256: 'old', created_at: '2026-01-01T00:00:00Z', shelf_uuid: 1, tags: [], pinned: false },
  { sha256: 'mid', created_at: '2026-02-01T00:00:00Z', shelf_uuid: 2, tags: [], pinned: true },
  { sha256: 'new', created_at: '2026-03-01T00:00:00Z', shelf_uuid: 1, tags: [] },
  { sha256: 'older', created_at: '2025-12-01T00:00:00Z', shelf_uuid: 1, tags: [], pinned: true },
];
const ids = (list) => list.map((paper) => paper.sha256);

test('pinned papers lead a list, newest first among them and among the rest', () => {
  assert.deepEqual(ids([...papers].sort(pinnedFirst)), ['mid', 'older', 'new', 'old']);
  assert.deepEqual(ids(papers.map((paper) => ({ ...paper, pinned: false })).sort(pinnedFirst)), ['new', 'mid', 'old', 'older']);
});

test('a shelf’s listing leads with the pinned papers on that shelf', () => {
  const nook = { papers, shelves: [{ uuid: 1 }, { uuid: 2 }], tags: [] };
  assert.deepEqual(ids(papersInListing('all', { nook })), ['mid', 'older', 'new', 'old']);
  assert.deepEqual(ids(papersInListing('shelf:1', { nook })), ['older', 'new', 'old']);
});
