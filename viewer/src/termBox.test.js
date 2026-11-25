import assert from 'node:assert/strict';
import test from 'node:test';

import { BOX_MIN, boxBetween, boxEnough, boxPulled } from './termBox.js';

const near = (box, want) => Object.keys(want).forEach((k) => assert.ok(Math.abs(box[k] - want[k]) < 1e-9, `${k}: ${box[k]} for ${want[k]}`));

test('a box is drawn between two points, whichever way the hand went, and kept on the page', () => {
  near(boxBetween({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 }), { x: 0.2, y: 0.3, w: 0.4, h: 0.2 });
  near(boxBetween({ x: 0.9, y: 0.9 }, { x: 1.4, y: -0.2 }), { x: 0.9, y: 0, w: 0.1, h: 0.9 });
});

test('a slip of the hand is no box', () => {
  assert.equal(boxEnough(null), false);
  assert.equal(boxEnough({ x: 0.1, y: 0.1, w: 0.3, h: BOX_MIN / 2 }), false);
  assert.equal(boxEnough({ x: 0.1, y: 0.1, w: 0.3, h: 0.1 }), true);
});

test('a box is carried whole and stays on the page', () => {
  const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };
  near(boxPulled(box, 'move', 0.1, -0.1), { x: 0.3, y: 0.2, w: 0.4, h: 0.2 });
  near(boxPulled(box, 'move', 0.9, 0.9), { x: 0.6, y: 0.8, w: 0.4, h: 0.2 });
});

test("a corner carries its two edges, not past the corner across from it", () => {
  const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };
  near(boxPulled(box, 'se', 0.1, 0.1), { x: 0.2, y: 0.3, w: 0.5, h: 0.3 });
  near(boxPulled(box, 'nw', 0.1, 0.1), { x: 0.3, y: 0.4, w: 0.3, h: 0.1 });
  near(boxPulled(box, 'nw', 0.9, 0.9), { x: 0.6 - BOX_MIN, y: 0.5 - BOX_MIN, w: BOX_MIN, h: BOX_MIN });
  near(boxPulled(box, 'ne', 0.9, -0.9), { x: 0.2, y: 0, w: 0.8, h: 0.5 });
});
