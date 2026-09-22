import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPictures } from './pictureRound.js';

test('a round asks every card in turn, passes over one it cannot fill, and counts the rest', async () => {
  const asked = [];
  const filled = await fillPictures(
    [{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'c' }, { uuid: 'd' }],
    async (item) => {
      asked.push(item.uuid);
      if (item.uuid === 'b') throw new Error('YouTube out of reach');
      return item.uuid === 'd' ? null : { uuid: item.uuid };
    },
  );
  assert.deepEqual(asked, ['a', 'b', 'c', 'd'], 'one at a time, and past the failure');
  assert.equal(filled, 2, 'a card with nothing to do is not counted');
});

test('a round with nothing filled says so, so the board does not load again for nothing', async () => {
  assert.equal(await fillPictures([], async () => ({})), 0);
  assert.equal(await fillPictures([{ uuid: 'a' }], async () => { throw new Error('offline'); }), 0);
});
