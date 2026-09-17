import assert from 'node:assert/strict';
import test from 'node:test';

import { originAfterMove, jacketBackTarget, placeOf } from './jacketOrigin.js';

const U = '11111111-2222-3333-4444-555555555555';
const PAPER = `/paper/${'a'.repeat(32)}`;

test('a nook, home and the library are the places a paper is kept', () => {
  assert.equal(placeOf('/'), '/');
  assert.equal(placeOf(`/u/${U}`), `/u/${U}`);
  assert.equal(placeOf(`/u/${U}/boards`), `/u/${U}`);
  assert.equal(placeOf('/library'), '/library');
  assert.equal(placeOf('/papers'), '/library');
  assert.equal(placeOf('/inbox'), null);
  assert.equal(placeOf(PAPER), null);
});

test('the demo keeps its places under their ordinary names', () => {
  assert.equal(placeOf('/demo/library'), '/library');
  assert.equal(placeOf(`/demo/u/${U}`), `/u/${U}`);
});

test('opening a paper remembers the place it was opened from', () => {
  assert.equal(originAfterMove(null, '/library', PAPER), '/library');
  assert.equal(originAfterMove('/library', `/u/${U}`, PAPER), `/u/${U}`);
  assert.equal(originAfterMove(null, '/', PAPER), '/');
});

test('a trail of papers keeps the place it started from', () => {
  const other = `/paper/${'b'.repeat(32)}`;
  assert.equal(originAfterMove('/library', PAPER, other), '/library');
});

test('a paper reached from anywhere else forgets the old place', () => {
  assert.equal(originAfterMove('/library', '/inbox', PAPER), null);
});

test('moves that do not end on a paper change nothing', () => {
  assert.equal(originAfterMove('/library', PAPER, '/inbox'), '/library');
  assert.equal(originAfterMove(null, '/library', '/inbox'), null);
});

test('back names where it goes', () => {
  assert.deepEqual(jacketBackTarget({ origin: '/library', userUuid: U }), { path: '/library', label: 'Library' });
  assert.deepEqual(jacketBackTarget({ origin: '/', userUuid: U }), { path: '/', label: 'My nook' });
  assert.deepEqual(jacketBackTarget({ origin: `/u/${U}`, userUuid: U }), { path: `/u/${U}`, label: 'My nook' });
  const other = '99999999-2222-3333-4444-555555555555';
  assert.deepEqual(jacketBackTarget({ origin: `/u/${other}`, userUuid: U }), { path: `/u/${other}`, label: 'Nook' });
});

test('with nothing remembered, a user goes home and a visitor to the library', () => {
  assert.deepEqual(jacketBackTarget({ userUuid: U }), { path: '/', label: 'My nook' });
  assert.deepEqual(jacketBackTarget({}), { path: '/library', label: 'Library' });
});
