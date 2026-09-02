import test from 'node:test';
import assert from 'node:assert/strict';
import { boardPointFromClient, cardCenter, bookletDropTarget, bookletInsertionIndex, collectionMasonryLayout, collectionReorderLayout, exceedsDragThreshold, membershipHistorySnapshots, previewBookletHeight, stackWithInsertion, stackWithout, tidyCollectionPositions } from './bookletDrag.js';

const booklet = { id: 7, x: 66, y: 14, width: 334, height: 500 };
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

test('client coordinates convert through viewport offset, pan, zoom, and card offset', () => {
  assert.deepEqual(boardPointFromClient(
    510, 370,
    { left: 10, top: 20 },
    { x: 100, y: 50, zoom: 2 },
    { x: 150, y: 40 },
  ), { x: 50, y: 110 });
});

test('external cards must be inside both booklet axes', () => {
  assert.equal(bookletDropTarget([booklet], { x: 200, y: 200 })?.id, 7);
  assert.equal(bookletDropTarget([booklet], { x: 200, y: 600 }), null);
  assert.equal(bookletDropTarget([booklet], { x: 500, y: 200 }), null);
});

test('attached cards stay attached vertically but leave horizontally', () => {
  assert.equal(bookletDropTarget([booklet], { x: 200, y: -500 }, 7)?.id, 7);
  assert.equal(bookletDropTarget([booklet], { x: 401, y: 200 }, 7), null);
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

test('booklet insertion changes only after crossing a card midpoint', () => {
  assert.equal(bookletInsertionIndex(members, 140), 0);
  assert.equal(bookletInsertionIndex(members, 140.01), 1);
  assert.equal(bookletInsertionIndex(members, 268), 1);
  assert.equal(bookletInsertionIndex(members, 268.01), 2);
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

test('leaving any booklet slot closes exactly that gap', () => {
  assert.deepEqual(stackWithout(members, 1, 7).map((p) => [p.id, p.y]), [[2, 100], [3, 258]]);
  assert.deepEqual(stackWithout(members, 2, 7).map((p) => [p.id, p.y]), [[1, 100], [3, 198]]);
  assert.deepEqual(stackWithout(members, 3, 7).map((p) => [p.id, p.y]), [[1, 100], [2, 198]]);
  assert.deepEqual(stackWithout([members[0]], 1, 7), []);
});

test('preview spine height follows content and respects its minimum', () => {
  const positions = [{ id: 1, y: 100 }, { id: 2, y: 198 }];
  assert.equal(previewBookletHeight(14, positions, new Map([[1, 80], [2, 140]])), 324);
  assert.equal(previewBookletHeight(14, [], new Map()), 74);
});

test('membership history captures a booklet leave and its closed gap', () => {
  const items = [
    { id: 1, group_id: 7, x: 100, y: 100 },
    { id: 2, group_id: 7, x: 100, y: 198 },
  ];
  assert.deepEqual(membershipHistorySnapshots(
    items, 1, null, { x: 500, y: 240 }, [{ id: 2, group_id: 7, x: 100, y: 100 }], [],
  ), {
    before: items,
    after: [
      { id: 1, group_id: null, x: 500, y: 240 },
      { id: 2, group_id: 7, x: 100, y: 100 },
    ],
  });
});

test('membership history captures both sides of a cross-group move', () => {
  const items = [
    { id: 1, group_id: 7, x: 100, y: 100 },
    { id: 2, group_id: 7, x: 100, y: 198 },
    { id: 3, group_id: 9, x: 600, y: 100 },
  ];
  const result = membershipHistorySnapshots(
    items, 1, 9, { x: 600, y: 198 },
    [{ id: 2, group_id: 7, x: 100, y: 100 }],
    [{ id: 3, group_id: 9, x: 600, y: 100 }, { id: 1, group_id: 9, x: 600, y: 198 }],
  );
  assert.deepEqual(result.before, items);
  assert.deepEqual(result.after, [
    { id: 1, group_id: 9, x: 600, y: 198 },
    { id: 2, group_id: 7, x: 100, y: 100 },
    { id: 3, group_id: 9, x: 600, y: 100 },
  ]);
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

test('collection layout chooses near-square dimensions and fills the shortest column', () => {
  const result = collectionMasonryLayout([
    { id: 1, x: 40, y: 20, height: 100 },
    { id: 2, x: 500, y: 30, height: 160 },
    { id: 3, x: 20, y: 400, height: 80 },
    { id: 4, x: 700, y: 420, height: 120 },
    { id: 5, x: 900, y: 440, height: 90 },
  ]);
  assert.deepEqual([result.columns, result.rows], [3, 2]);
  assert.deepEqual(result.positions, [
    { id: 1, x: 20, y: 20 },
    { id: 2, x: 338, y: 20 },
    { id: 3, x: 656, y: 20 },
    { id: 4, x: 656, y: 118 },
    { id: 5, x: 20, y: 138 },
  ]);
});

test('short cards make their remaining column space available immediately', () => {
  const result = collectionMasonryLayout([
    { id: 1, x: 0, y: 0, height: 240 },
    { id: 2, x: 318, y: 0, height: 60 },
    { id: 3, x: 0, y: 300, height: 80 },
    { id: 4, x: 318, y: 300, height: 90 },
  ]);
  assert.deepEqual(result.positions.map(({ id, x, y }) => ({ id, x, y })), [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 318, y: 0 },
    { id: 3, x: 318, y: 78 },
    { id: 4, x: 318, y: 176 },
  ]);
});

const masonryCards = [
  { id: 1, x: 0, y: 0, width: 300, height: 100 },
  { id: 2, x: 318, y: 0, width: 300, height: 140 },
  { id: 3, x: 0, y: 158, width: 300, height: 80 },
  { id: 4, x: 318, y: 158, width: 300, height: 120 },
];

test('auto-arrange keeps the order while a drag remains nearest its current slot', () => {
  const result = collectionReorderLayout(masonryCards, 1, { x: 40, y: 30 });
  assert.deepEqual(result.positions.map((position) => position.id), [1, 2, 3, 4]);
});

test('auto-arrange reorders horizontally in the same row', () => {
  const result = collectionReorderLayout(masonryCards, 1, { x: 340, y: 10 });
  assert.deepEqual(result.positions.map((position) => position.id), [2, 1, 3, 4]);
});

test('auto-arrange moves later cards back into the first slot', () => {
  const result = collectionReorderLayout(masonryCards, 4, { x: -10, y: -10 });
  assert.deepEqual(result.positions.map((position) => position.id), [4, 1, 2, 3]);
});

test('auto-arrange reorders across rows and into the final slot', () => {
  const middle = collectionReorderLayout(masonryCards, 1, { x: 10, y: 180 });
  assert.deepEqual(middle.positions.map((position) => position.id), [2, 3, 1, 4]);
  const last = collectionReorderLayout(masonryCards, 1, { x: 350, y: 190 });
  assert.deepEqual(last.positions.map((position) => position.id), [2, 3, 4, 1]);
});

test('auto-arrange lays out a card joining a collection using the hovered slot', () => {
  const joining = [...masonryCards, { id: 9, x: 0, y: 0, width: 300, height: 90 }];
  const result = collectionReorderLayout(joining, 9, { x: 330, y: 170 });
  assert.equal(result.positions.length, 5);
  assert.equal(result.positions.findIndex((position) => position.id === 9), 3);
  assert.ok(result.positions.every((position) => Number.isFinite(position.x) && Number.isFinite(position.y)));
});
