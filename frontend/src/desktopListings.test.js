import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBrowsing, matchesSearch, paperCreatedNavigation, papersInListing,
  resolveListing, listingPath,
} from './desktopListings.js';

const user = { uuid: 1 };

test('writes each listing as the address the sidebar links to', () => {
  assert.equal(listingPath('all'), '/');
  assert.equal(listingPath('library'), '/library');
  assert.equal(listingPath('shelf:3'), '/?listing=shelf:3');
  assert.equal(listingPath('boards'), '/?listing=boards');
});

test('a paper imported from the library opens in the all-papers nook', () => {
  assert.deepEqual(paperCreatedNavigation('library', 'new-paper'), {
    listing: 'all',
    path: '/paper/new-paper',
  });
  assert.deepEqual(paperCreatedNavigation('shelf:reading', 'new-paper'), {
    listing: 'shelf:reading',
    path: '/paper/new-paper',
  });
});

test('reads the listing back from the address', () => {
  assert.equal(resolveListing({ page: 'home' }, user, { search: '?listing=tag:7' }), 'tag:7');
  assert.equal(resolveListing({ page: 'home' }, user), 'all');
  assert.equal(resolveListing({ page: 'papers' }, user), 'library');
  assert.equal(resolveListing({ page: 'nook', uuid: 1, section: 'boards' }, user), 'boards');
});

test('a paper keeps the list it was picked from', () => {
  assert.equal(resolveListing({ page: 'paper', uuid: '10.1/x' }, user, { lastShown: 'shelf:2' }), 'shelf:2');
  assert.equal(resolveListing({ page: 'paper', uuid: '10.1/x' }, user), 'all');
});

test('the browser stands in for the nook, the library and papers, for signed-in users only', () => {
  assert.equal(isBrowsing({ page: 'home' }, user), true);
  assert.equal(isBrowsing({ page: 'paper' }, user), true);
  assert.equal(isBrowsing({ page: 'papers' }, user), true);
  assert.equal(isBrowsing({ page: 'nook', uuid: 1 }, user), true);
  assert.equal(isBrowsing({ page: 'nook', uuid: 2 }, user), false);
  assert.equal(isBrowsing({ page: 'inbox' }, user), false);
  assert.equal(isBrowsing({ page: 'paper' }, null), false);
});

const nook = {
  shelves: [{ uuid: 1, name: 'Display' }, { uuid: 2, name: 'Personal' }],
  tags: [{ uuid: 9, name: 'reread' }],
  papers: [
    { sha256: 'a', shelf_uuid: 1, tags: [{ uuid: 9 }], created_at: '2026-01-01T00:00:00Z' },
    { sha256: 'b', shelf_uuid: 2, tags: [], created_at: '2026-03-01T00:00:00Z' },
    { sha256: 'c', shelf_uuid: 1, tags: [], created_at: '2026-02-01T00:00:00Z' },
  ],
};
const ids = (papers) => papers.map((paper) => paper.sha256);

test('lists the nook newest first, narrowed by shelf or tag', () => {
  assert.deepEqual(ids(papersInListing('all', { nook })), ['b', 'c', 'a']);
  assert.deepEqual(ids(papersInListing('shelf:1', { nook })), ['c', 'a']);
  assert.deepEqual(ids(papersInListing('tag:9', { nook })), ['a']);
  assert.deepEqual(ids(papersInListing('boards', { nook })), []);
});

test('a shelf that no longer exists lists the whole nook', () => {
  assert.deepEqual(ids(papersInListing('shelf:42', { nook })), ['b', 'c', 'a']);
});

test('lists the library with live seminars first', () => {
  const library = [
    { sha256: 'quiet', created_at: '2026-05-01T00:00:00Z' },
    { sha256: 'scheduled', room_status: 'scheduled', created_at: '2026-01-01T00:00:00Z' },
    { sha256: 'called', room_status: 'open', created_at: '2025-01-01T00:00:00Z' },
  ];
  assert.deepEqual(ids(papersInListing('library', { library })), ['called', 'scheduled', 'quiet']);
  assert.deepEqual(ids(papersInListing('library', { library: null })), []);
});

test('search matches any field, ignoring case and surrounding spaces', () => {
  assert.equal(matchesSearch('  attention ', ['Attention Is All You Need', null]), true);
  assert.equal(matchesSearch('shannon', ['Communication', 'Claude E. Shannon']), true);
  assert.equal(matchesSearch('zzz', ['Communication']), false);
  assert.equal(matchesSearch('', []), true);
});
