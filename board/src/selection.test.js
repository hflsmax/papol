import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardsIntersectingRect, mergeSelection, nearestCardWithin, selectionMode,
} from './selection.js';

test('plain selection replaces the current selection', () => {
  assert.equal(selectionMode({ shiftKey: false, metaKey: false, ctrlKey: false }), 'replace');
  assert.deepEqual(mergeSelection([1, 2], [3], 'replace'), [3]);
});

test('Shift and Cmd or Ctrl all toggle selection membership', () => {
  assert.equal(selectionMode({ shiftKey: true, metaKey: false, ctrlKey: false }), 'toggle');
  assert.equal(selectionMode({ shiftKey: false, metaKey: true, ctrlKey: false }), 'toggle');
  assert.equal(selectionMode({ shiftKey: false, metaKey: false, ctrlKey: true }), 'toggle');
  assert.deepEqual(mergeSelection([1, 2], [2, 3], 'toggle'), [1, 3]);
});

const cards = [
  { itemUuid: 'back', left: 10, top: 10, right: 110, bottom: 90, z: 1 },
  { itemUuid: 'front', left: 40, top: 30, right: 140, bottom: 110, z: 4 },
  { itemUuid: 'far', left: 300, top: 300, right: 380, bottom: 380, z: 2 },
];

test('nearestCardWithin uses the halo and prefers the top card on equal distances', () => {
  assert.equal(nearestCardWithin(new Map(cards.map((card) => [card.itemUuid, card])).values(), { x: 50, y: 50 }, 24).itemUuid, 'front');
  assert.equal(nearestCardWithin(cards, { x: 155, y: 50 }, 14), null);
  assert.equal(nearestCardWithin(cards, { x: 155, y: 50 }, 15).itemUuid, 'front');
});

test('cardsIntersectingRect selects cached board-space bounds', () => {
  const cached = new Map(cards.map((card) => [card.itemUuid, card]));
  assert.deepEqual(cardsIntersectingRect(cached.values(), { left: 100, top: 80, right: 160, bottom: 120 }), ['back', 'front']);
  assert.deepEqual(cardsIntersectingRect(cards, { left: 200, top: 200, right: 250, bottom: 250 }), []);
});
