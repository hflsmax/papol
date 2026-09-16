import test from 'node:test';
import assert from 'node:assert/strict';
import { boardHomePath } from '../../shared/appUrls.js';

const BOARD = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';

test('leaving your own board lands in your nook, on the board', () => {
  // A board has no page of its own — the row in the nook is its whole
  // presence — so home names it and the nook reveals it there.
  assert.equal(boardHomePath({ uuid: BOARD, can_edit: true }), `/?board=${BOARD}`);
});

test("leaving someone else's board lands in their nook, on the board", () => {
  // Theirs is the only list the board appears in; going to your own nook
  // would be going somewhere it cannot be shown.
  assert.equal(
    boardHomePath({ uuid: BOARD, can_edit: false, user_uuid: OWNER }),
    `/u/${OWNER}?board=${BOARD}`,
  );
});

test('a board just deleted names nothing, and home is the library itself', () => {
  assert.equal(boardHomePath(null), '/');
});

test('a demo board goes home to the demo', () => {
  assert.equal(
    boardHomePath({ uuid: BOARD, can_edit: true }, { demo: true }),
    `/demo?board=${BOARD}`,
  );
});
