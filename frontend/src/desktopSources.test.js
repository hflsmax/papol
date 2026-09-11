import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBrowsing, matchesSearch, papersInSource, resolveSource, sourcePath,
} from './desktopSources.js';

const reader = { id: 1 };

test('writes each source as the address the sidebar links to', () => {
  assert.equal(sourcePath('all'), '/');
  assert.equal(sourcePath('library'), '/library');
  assert.equal(sourcePath('shelf:3'), '/?source=shelf:3');
  assert.equal(sourcePath('boards'), '/?source=boards');
});

test('reads the source back from the address', () => {
  assert.equal(resolveSource({ page: 'home' }, reader, { search: '?source=tag:7' }), 'tag:7');
  assert.equal(resolveSource({ page: 'home' }, reader), 'all');
  assert.equal(resolveSource({ page: 'papers' }, reader), 'library');
  assert.equal(resolveSource({ page: 'space', id: 1, section: 'boards' }, reader), 'boards');
});

test('a paper keeps the list it was picked from', () => {
  assert.equal(resolveSource({ page: 'paper', id: '10.1/x' }, reader, { lastShown: 'shelf:2' }), 'shelf:2');
  assert.equal(resolveSource({ page: 'paper', id: '10.1/x' }, reader), 'all');
});

test('the browser stands in for the nook, the library and papers, for signed-in readers only', () => {
  assert.equal(isBrowsing({ page: 'home' }, reader), true);
  assert.equal(isBrowsing({ page: 'paper' }, reader), true);
  assert.equal(isBrowsing({ page: 'papers' }, reader), true);
  assert.equal(isBrowsing({ page: 'space', id: 1 }, reader), true);
  assert.equal(isBrowsing({ page: 'space', id: 2 }, reader), false);
  assert.equal(isBrowsing({ page: 'inbox' }, reader), false);
  assert.equal(isBrowsing({ page: 'paper' }, null), false);
});

const space = {
  shelves: [{ id: 1, name: 'Display' }, { id: 2, name: 'Personal' }],
  tags: [{ id: 9, name: 'reread' }],
  papers: [
    { id: 'a', shelf_id: 1, tags: [{ id: 9 }], created_at: '2026-01-01T00:00:00Z' },
    { id: 'b', shelf_id: 2, tags: [], created_at: '2026-03-01T00:00:00Z' },
    { id: 'c', shelf_id: 1, tags: [], created_at: '2026-02-01T00:00:00Z' },
  ],
};
const ids = (papers) => papers.map((paper) => paper.id);

test('lists the nook newest first, narrowed by shelf or tag', () => {
  assert.deepEqual(ids(papersInSource('all', { space })), ['b', 'c', 'a']);
  assert.deepEqual(ids(papersInSource('shelf:1', { space })), ['c', 'a']);
  assert.deepEqual(ids(papersInSource('tag:9', { space })), ['a']);
  assert.deepEqual(ids(papersInSource('boards', { space })), []);
});

test('a shelf that no longer exists lists the whole nook', () => {
  assert.deepEqual(ids(papersInSource('shelf:42', { space })), ['b', 'c', 'a']);
});

test('lists the library with live seminars first', () => {
  const library = [
    { id: 'quiet', created_at: '2026-05-01T00:00:00Z' },
    { id: 'scheduled', room_status: 'scheduled', created_at: '2026-01-01T00:00:00Z' },
    { id: 'called', room_status: 'open', created_at: '2025-01-01T00:00:00Z' },
  ];
  assert.deepEqual(ids(papersInSource('library', { library })), ['called', 'scheduled', 'quiet']);
  assert.deepEqual(ids(papersInSource('library', { library: null })), []);
});

test('search matches any field, ignoring case and surrounding spaces', () => {
  assert.equal(matchesSearch('  attention ', ['Attention Is All You Need', null]), true);
  assert.equal(matchesSearch('shannon', ['Communication', 'Claude E. Shannon']), true);
  assert.equal(matchesSearch('zzz', ['Communication']), false);
  assert.equal(matchesSearch('', []), true);
});
