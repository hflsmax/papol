import test from 'node:test';
import assert from 'node:assert/strict';
import { cardCenter, chapterDropTarget, chapterInsertionIndex, exceedsDragThreshold, previewChapterHeight, stackWithInsertion, stackWithout, tidyCollectionPositions } from './chapterDrag.js';

const chapter = { id: 7, x: 66, y: 14, width: 334, height: 500 };
const members = [
  { id: 1, x: 100, y: 100, height: 80 },
  { id: 2, x: 100, y: 198, height: 140 },
  { id: 3, x: 100, y: 356, height: 60 },
];

test('card center uses the full rendered card bounds', () => {
  assert.deepEqual(cardCenter({ x: 10, y: 20 }, 300, 80), { x: 160, y: 60 });
});

test('click-versus-drag threshold is stable in screen pixels', () => {
  assert.equal(exceedsDragThreshold(10, 10, 13, 12), false);
  assert.equal(exceedsDragThreshold(10, 10, 15, 10), true);
});

test('external cards must be inside both chapter axes', () => {
  assert.equal(chapterDropTarget([chapter], { x: 200, y: 200 })?.id, 7);
  assert.equal(chapterDropTarget([chapter], { x: 200, y: 600 }), null);
  assert.equal(chapterDropTarget([chapter], { x: 500, y: 200 }), null);
});

test('attached cards stay attached vertically but leave horizontally', () => {
  assert.equal(chapterDropTarget([chapter], { x: 200, y: -500 }, 7)?.id, 7);
  assert.equal(chapterDropTarget([chapter], { x: 401, y: 200 }, 7), null);
});

test('insertion opens first, middle, and last slots with mixed heights', () => {
  const first = stackWithInsertion(members, { id: 9, x: 100, y: 0, height: 50, centerY: 50 }, 7);
  assert.deepEqual(first.positions.map((p) => p.id), [9, 1, 2, 3]);
  assert.deepEqual(first.positions.map((p) => p.y), [100, 168, 266, 424]);
  const middle = stackWithInsertion(members, { id: 9, x: 100, y: 200, height: 50, centerY: 250 }, 7);
  assert.deepEqual(middle.positions.map((p) => p.id), [1, 9, 2, 3]);
  const last = stackWithInsertion(members, { id: 9, x: 100, y: 500, height: 50, centerY: 525 }, 7);
  assert.deepEqual(last.positions.map((p) => p.id), [1, 2, 3, 9]);
});

test('chapter insertion changes only after crossing a card midpoint', () => {
  assert.equal(chapterInsertionIndex(members, 140), 0);
  assert.equal(chapterInsertionIndex(members, 140.01), 1);
  assert.equal(chapterInsertionIndex(members, 268), 1);
  assert.equal(chapterInsertionIndex(members, 268.01), 2);
});

test('reordering the first card keeps the stack anchored until it crosses the next slot', () => {
  const remaining = members.slice(1);
  const stillFirst = stackWithInsertion(
    remaining,
    { id: 1, x: 100, y: 104, height: 80, centerY: 144 },
    7,
    { x: 100, y: 100 },
  );
  assert.deepEqual(stillFirst.positions.map((p) => [p.id, p.y]), [[1, 100], [2, 198], [3, 356]]);

  const crossedSecond = stackWithInsertion(
    remaining,
    { id: 1, x: 100, y: 240, height: 80, centerY: 280 },
    7,
    { x: 100, y: 100 },
  );
  assert.deepEqual(crossedSecond.positions.map((p) => [p.id, p.y]), [[2, 100], [1, 258], [3, 356]]);
});

test('an only card and an empty target produce finite positions', () => {
  const result = stackWithInsertion([], { id: 9, x: 120, y: 240, height: 50, centerY: 265 }, 7);
  assert.deepEqual(result.positions, [{ id: 9, group_id: 7, x: 120, y: 240 }]);
});

test('leaving any chapter slot closes exactly that gap', () => {
  assert.deepEqual(stackWithout(members, 1, 7).map((p) => [p.id, p.y]), [[2, 100], [3, 258]]);
  assert.deepEqual(stackWithout(members, 2, 7).map((p) => [p.id, p.y]), [[1, 100], [3, 198]]);
  assert.deepEqual(stackWithout(members, 3, 7).map((p) => [p.id, p.y]), [[1, 100], [2, 198]]);
  assert.deepEqual(stackWithout([members[0]], 1, 7), []);
});

test('preview spine height follows content and respects its minimum', () => {
  const positions = [{ id: 1, y: 100 }, { id: 2, y: 198 }];
  assert.equal(previewChapterHeight(14, positions, new Map([[1, 80], [2, 140]])), 324);
  assert.equal(previewChapterHeight(14, [], new Map()), 74);
});

test('collection tidy pulls distant cards closer', () => {
  const result = tidyCollectionPositions([
    { id: 1, x: 0, y: 0, width: 300, height: 100 },
    { id: 2, x: 1000, y: 0, width: 300, height: 100 },
  ]);
  assert.ok(result[1].x < 1000);
});

test('collection tidy leaves overlapping cards in place', () => {
  const result = tidyCollectionPositions([
    { id: 1, x: 0, y: 0, width: 300, height: 100 },
    { id: 2, x: 200, y: 20, width: 300, height: 100 },
  ]);
  assert.deepEqual(result[1], { id: 2, x: 200, y: 20 });
});
