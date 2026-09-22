import test from 'node:test';
import assert from 'node:assert/strict';
import { boardFacts } from './boardFacts.js';
import { boardSourcePapers, sourcePaperSha256 } from '../../shared/boardPapers.js';

const A = 'a'.repeat(64);
const B = 'B'.repeat(64);
const viewer = (sha, page) => `https://papol.io/viewer/?pdf=${sha}&page=${page}&mark=xyz`;
const OWNER = { uuid: '11111111-1111-4111-8111-111111111111', display_name: 'Ada' };

const board = (overrides = {}) => ({
  can_edit: true,
  owner: OWNER,
  item_count: 0,
  items: [],
  groups: [],
  created_at: '2026-09-02T10:00:00',
  updated_at: '2026-09-21T10:00:00',
  ...overrides,
});

const keys = (facts) => facts.map((fact) => fact.key);
const text = (facts, key) => facts.find((fact) => fact.key === key)?.text;

test('a card names its paper by the digest in its viewer backlink', () => {
  assert.equal(sourcePaperSha256({ source_url: viewer(A, 3) }), A);
  assert.equal(sourcePaperSha256({ source_url: viewer(B, 1) }), B.toLowerCase(), 'one paper, however its digest is cased');
  assert.equal(sourcePaperSha256({ source_url: 'https://www.youtube.com/watch?v=x' }), null);
  assert.equal(sourcePaperSha256({ source_url: 'https://example.com/viewer/?pdf=not-a-digest' }), null);
  assert.equal(sourcePaperSha256({ source_url: 'https://papol.io/viewer/?share=abc' }), null);
  assert.equal(sourcePaperSha256({ kind: 'comment', content: 'A thought' }), null);
  assert.equal(sourcePaperSha256({ source_url: 'not a url' }), null);
});

test('the papers on a board are distinct, in the order their first card came, and known where the board says', () => {
  const papers = boardSourcePapers(board({
    items: [
      { kind: 'excerpt', source_url: viewer(B, 2), source_label: 'Second Paper, page 2' },
      { kind: 'image', source_url: viewer(A, 3), source_label: 'Attention Is All You Need, page 3' },
      { kind: 'excerpt', source_url: viewer(A, 9), source_label: 'Attention Is All You Need, page 9' },
      { kind: 'webpage', source_url: 'https://example.com/post' },
      { kind: 'comment', content: 'mine' },
    ],
    papers: [{ sha256: A, title: 'Attention Is All You Need', authors: '["Vaswani","Shazeer"]', year: 2017 }],
  }));
  assert.deepEqual(papers, [
    { sha256: B.toLowerCase(), title: 'Second Paper', authors: null, year: null },
    { sha256: A, title: 'Attention Is All You Need', authors: '["Vaswani","Shazeer"]', year: 2017 },
  ]);
});

test('an empty board of your own says only how many cards and when', () => {
  const facts = boardFacts(board());
  assert.deepEqual(keys(facts), ['cards', 'created', 'edited']);
  assert.equal(text(facts, 'cards'), '0 cards');
  assert.match(text(facts, 'created'), /^Created Sep 2/);
  assert.match(text(facts, 'edited'), /^Edited Sep 21/);
});

test('groups and source papers are counted only when there are any', () => {
  const facts = boardFacts(board({
    item_count: 4,
    groups: [{ uuid: 'g1' }, { uuid: 'g2' }, { uuid: 'g3' }],
    items: [
      { source_url: viewer(A, 1) },
      { source_url: viewer(A, 2) },
      { source_url: viewer(B, 1) },
      { content: 'A thought' },
    ],
  }));
  assert.deepEqual(keys(facts), ['cards', 'groups', 'papers', 'created', 'edited']);
  assert.equal(text(facts, 'cards'), '4 cards');
  assert.equal(text(facts, 'groups'), '3 groups');
  assert.equal(text(facts, 'papers'), 'from 2 papers');

  const single = boardFacts(board({ item_count: 1, groups: [{ uuid: 'g' }], items: [{ source_url: viewer(A, 1) }] }));
  assert.equal(text(single, 'cards'), '1 card');
  assert.equal(text(single, 'groups'), '1 group');
  assert.equal(text(single, 'papers'), 'from 1 paper');
});

test('someone else\'s board names its owner first; your own does not', () => {
  const theirs = boardFacts(board({ can_edit: false }));
  assert.equal(theirs[0].key, 'owner');
  assert.equal(theirs[0].owner, OWNER);
  assert.ok(!keys(boardFacts(board())).includes('owner'));
  assert.ok(!keys(boardFacts(board({ can_edit: false, owner: null }))).includes('owner'), 'no owner is known on the Mac');
});
