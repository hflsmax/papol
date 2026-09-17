import assert from 'node:assert/strict';
import test from 'node:test';

import { barScale, evened, lineAtPosition, positionAtLine, shareOut } from './navigatorScale.js';

// Three sheets of different heights with a gap between each.
const pages = [
  { top: 24, height: 1000 },
  { top: 1040, height: 500 },
  { top: 1556, height: 1000 },
];

test('a line on a page is that far into the document', () => {
  assert.equal(positionAtLine(pages, 24), 0);
  assert.equal(positionAtLine(pages, 524), 0.5);
  assert.equal(positionAtLine(pages, 1290), 1.5);
  assert.equal(positionAtLine(pages, 2556), 3);
});

test('a line above the first page or below the last stays on the scale', () => {
  assert.equal(positionAtLine(pages, 0), 0);
  assert.equal(positionAtLine(pages, 9000), 3);
});

test('a line in the gap between two pages has finished the one above', () => {
  assert.equal(positionAtLine(pages, 1030), 1);
  assert.equal(positionAtLine(pages, 1550), 2);
});

test('a place comes back as the line it was read from', () => {
  for (const line of [24, 300, 1040, 1290, 1556, 2000, 2556]) {
    assert.equal(lineAtPosition(pages, positionAtLine(pages, line)), line);
  }
});

test('a place past either end of the paper is held to it', () => {
  assert.equal(lineAtPosition(pages, -1), 24);
  assert.equal(lineAtPosition(pages, 7), 2556);
  assert.equal(lineAtPosition([], 2), 0);
});

test('a page not yet laid out takes no room on the scale', () => {
  const unlaid = [{ top: 24, height: 0 }, { top: 24, height: 800 }];
  assert.equal(positionAtLine(unlaid, 424), 1.5);
  assert.equal(lineAtPosition(unlaid, 0.5), 24);
});

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('with no floor every section gets its share of the paper', () => {
  assert.deepEqual(shareOut([5, 3, 2], 0), [0.5, 0.3, 0.2]);
  assert.deepEqual(shareOut([], 0.1), []);
});

test('a short section is held to the floor and the rest keep their ratios', () => {
  const shares = shareOut([60, 30, 1, 0], 0.05);
  assert.ok(near(shares[2], 0.05) && near(shares[3], 0.05));
  // What is left, two to one, as the sections themselves are.
  assert.ok(near(shares[0], 0.6) && near(shares[1], 0.3));
  assert.ok(near(shares.reduce((sum, share) => sum + share, 0), 1));
});

test('holding some back can push another under the floor, and it is held too', () => {
  // Alone, 12 of 100 is over a tenth. Once the two slivers are given a
  // tenth each, it is 12/98 of the 0.8 left — under a tenth.
  const shares = shareOut([86, 12, 1, 1], 0.1);
  assert.ok(near(shares[1], 0.1) && near(shares[2], 0.1) && near(shares[3], 0.1));
  assert.ok(near(shares[0], 0.7));
});

test('more sections than floors to go round share the bar equally', () => {
  assert.deepEqual(shareOut([9, 1, 1, 1], 0.4), [0.25, 0.25, 0.25, 0.25]);
});

test('the scale changes pace between sections and is even within one', () => {
  // Ten pages: a long section, a sliver, another long one.
  const edges = [0, 4.9, 5, 10];
  const scale = barScale(edges, shareOut([4.9, 0.1, 5], 0.1));
  // The sliver holds the whole of the share it was given.
  assert.ok(near(scale.toBar(5) - scale.toBar(4.9), 0.1));
  // Halfway through it is halfway across that share.
  assert.ok(near(scale.toBar(4.95), scale.toBar(4.9) + 0.05));
  // And back again, anywhere.
  for (const at of [0, 1.3, 4.9, 4.95, 5, 7.7, 10]) assert.ok(near(scale.toDoc(scale.toBar(at)), at));
  assert.equal(scale.toBar(-3), 0);
  assert.ok(near(scale.toBar(99), 1));
});

test('a section of no length still has a share, and a press on it goes to its one place', () => {
  const scale = barScale([0, 6, 6, 10], shareOut([6, 0, 4], 0.1));
  assert.ok(near(scale.toBar(6) - scale.toBar(6 - 1e-9), 0.1));
  assert.equal(scale.toDoc(scale.toBar(6) - 0.05), 6);
});

test('one number evens the sections out, from to-scale to all alike', () => {
  assert.deepEqual(evened([16, 4, 1, 0], 0), [16, 4, 1, 0]);
  // At a half, four times as long is twice as wide.
  assert.deepEqual(evened([16, 4, 1, 0], 0.5), [4, 2, 1, 0]);
  assert.deepEqual(evened([16, 4, 1, 0], 1), [1, 1, 1, 1]);
  // Longer is still wider, whatever the number short of one.
  const some = evened([9, 5, 2, 0.3], 0.7);
  assert.ok(some[0] > some[1] && some[1] > some[2] && some[2] > some[3]);
});

test('evened lengths are shared out with the floor still under them', () => {
  const shares = shareOut(evened([100, 4, 0], 0.5), 0.05);
  assert.ok(near(shares[2], 0.05));
  // Ten to two of what is left, where to scale it was a hundred to four.
  assert.ok(near(shares[0] / shares[1], 5));
});

test('a section given its width outright takes it first, and the rest share what is left', () => {
  // A bibliography a third of the paper long, told to take a twentieth.
  const shares = shareOut([4, 2, 3], 0, [null, null, 0.05]);
  assert.ok(near(shares[2], 0.05));
  assert.ok(near(shares[0] / shares[1], 2));
  assert.ok(near(shares.reduce((sum, share) => sum + share, 0), 1));
  // The floor is still the same slice of the whole bar for the others.
  const floored = shareOut([100, 0, 5], 0.1, [null, null, 0.2]);
  assert.ok(near(floored[0], 0.7) && near(floored[1], 0.1) && near(floored[2], 0.2));
  // Fixed widths never take more than half the bar between them.
  const greedy = shareOut([1, 1, 1], 0, [0.6, 0.6, null]);
  assert.ok(near(greedy[0] + greedy[1], 0.5) && near(greedy[2], 0.5));
});
