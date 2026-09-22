import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestFreeSpot, resolveOverlaps, tidyFreeformCards } from './tidy.js';

const block = (id, x, y, width = 300, height = 120, movable = true) => ({ id, x, y, width, height, movable });
const apply = (blocks, moves) => blocks.map((b) => {
  const move = moves.find((m) => m.id === b.id);
  return move ? { ...b, x: move.x, y: move.y } : b;
});
const anyOverlap = (rects) => rects.some((a, i) => rects.some((b, j) => i < j
  && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height));

test('blocks that overlap nothing stay exactly where they are', () => {
  const blocks = [block('a', 13, 7), block('b', 500, 31), block('c', 13, 400)];
  assert.deepEqual(resolveOverlaps(blocks), []);
});

test('a pasted pile comes apart, and the first card of it stays put', () => {
  const blocks = [0, 1, 2, 3].map((i) => block(`p${i}`, 100 + i * 28, 100 + i * 28));
  const moves = resolveOverlaps(blocks);
  const after = apply(blocks, moves);
  assert.equal(anyOverlap(after), false);
  assert.equal(moves.some((m) => m.id === 'p0'), false);
  moves.forEach((m) => { assert.equal(m.x % 24, 0); assert.equal(m.y % 24, 0); });
});

test('tidying a tidy board changes nothing', () => {
  const blocks = [block('a', 0, 0, 400, 300), block('b', 50, 60), block('c', 380, 10), block('d', 20, 250, 300, 200)];
  const once = apply(blocks, resolveOverlaps(blocks));
  assert.equal(anyOverlap(once), false);
  assert.deepEqual(resolveOverlaps(once), []);
});

test('fixed blocks are obstacles and never move', () => {
  const blocks = [block('fixed', 0, 0, 400, 400, false), block('card', 100, 100)];
  const moves = resolveOverlaps(blocks);
  assert.deepEqual(moves.map((m) => m.id), ['card']);
  assert.equal(anyOverlap(apply(blocks, moves)), false);
});

test('a loose card makes way for a group, even one below it', () => {
  const blocks = [{ ...block('card', 100, 90), rank: 1 }, block('group', 0, 100, 600, 400)];
  const moves = resolveOverlaps(blocks);
  assert.deepEqual(moves.map((m) => m.id), ['card']);
});

test('a block moves the short way out', () => {
  // Overlapping the wide block by a little on its right: right is shorter than down.
  const blocks = [block('wide', 0, 0, 600, 600), block('edge', 560, 200)];
  const [move] = resolveOverlaps(blocks);
  assert.equal(move.dy >= 0 && move.dx > 0, true);
  assert.ok(move.x >= 624);
});

test('freeform cards are drawn in and pulled apart until settled', () => {
  const cards = [
    { uuid: 'a', x: 0, y: 0, width: 300, height: 100 },
    { uuid: 'b', x: 40, y: 30, width: 300, height: 100 },
    { uuid: 'c', x: 1500, y: 0, width: 300, height: 100 },
  ];
  const tidied = tidyFreeformCards(cards);
  assert.equal(anyOverlap(tidied), false);
  assert.ok(tidied.find((c) => c.uuid === 'c').x < 1500);
  assert.deepEqual(tidyFreeformCards(tidied), tidied);
});

test('a free spot is the spot asked for when nothing is there', () => {
  assert.deepEqual(nearestFreeSpot({ x: 10, y: 20, width: 300, height: 200 }, []), { x: 10, y: 20 });
});

test('a free spot clears every obstacle, near where it was asked for', () => {
  const obstacles = [{ x: 0, y: 0, width: 300, height: 200 }];
  const spot = nearestFreeSpot({ x: 20, y: 20, width: 300, height: 200 }, obstacles);
  const rect = { ...spot, width: 300, height: 200 };
  assert.equal(anyOverlap([rect, ...obstacles]), false);
  assert.ok(Math.hypot(spot.x - 20, spot.y - 20) < 400);
});
