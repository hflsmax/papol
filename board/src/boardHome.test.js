import test from 'node:test';
import assert from 'node:assert/strict';
import { boardJacketPath, homePath } from '../../shared/appUrls.js';

const BOARD = '11111111-1111-4111-8111-111111111111';

test('the home button leads to Papol itself, naming nothing', () => {
  // Not the nook the board sits in, and not the board: a home button that
  // points back at the thing just closed is a back button wearing a house.
  assert.equal(homePath(), '/');
});

test('a demo board goes home to the demo', () => {
  assert.equal(homePath({ demo: true }), '/demo');
});

test("Back leads to the board's jacket, which is where the board is kept", () => {
  // The way out that *does* name what it leaves, because that is what a Back
  // is for. Singular: the plural belongs to the canvas.
  assert.equal(boardJacketPath(BOARD), `/board/${BOARD}`);
  assert.equal(boardJacketPath(BOARD, { demo: true }), `/demo/board/${BOARD}`);
});
