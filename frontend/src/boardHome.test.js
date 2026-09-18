import test from 'node:test';
import assert from 'node:assert/strict';
import { boardJacketPath, homePath, modePath, modeRoute } from '../../shared/appUrls.js';

const BOARD = '11111111-1111-4111-8111-111111111111';

test('the house leads out of the board and onto its jacket', () => {
  // Where the board is kept, which is what the viewer's house has always
  // done with a paper. Not a step backwards: the jacket is the board's own
  // place, so a link, a bookmark and a reload all leave by the same door.
  assert.equal(boardJacketPath(BOARD), `/board/${BOARD}`);
  assert.equal(boardJacketPath(BOARD, { demo: true }), `/demo/board/${BOARD}`);
});

test('with no board to name, the house leads to Papol itself', () => {
  assert.equal(homePath(), '/');
  assert.equal(homePath({ demo: true }), '/demo');
});

test('all surfaces use one demo route policy', () => {
  assert.equal(modeRoute('/viewer/?pdf=abc'), '/viewer/?pdf=abc');
  assert.equal(modeRoute('/viewer/?pdf=abc', { demo: true }), '/demo/viewer/?pdf=abc');
  assert.equal(modeRoute('/', { demo: true }), '/demo');
  assert.equal(modePath('/boards/board-1', { demo: true }), '/demo/boards/board-1');
});
