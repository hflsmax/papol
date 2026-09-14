import assert from 'node:assert/strict';
import test from 'node:test';
import { planOfflineNookAddition } from '../../shared/nookTransition.js';

const PAPER = '11111111-1111-4111-8111-111111111111';
const EDITION = '22222222-2222-4222-8222-222222222222';
const SHELF = '33333333-3333-4333-8333-333333333333';
const COPY = '44444444-4444-4444-8444-444444444444';

test('an already-known public paper becomes an owned local copy', () => {
  const planned = planOfflineNookAddition({
    uuid: PAPER, edition_uuid: EDITION,
    editions: [{ uuid: EDITION, sha256: 'a'.repeat(64) }],
  }, [
    { uuid: '55555555-5555-4555-8555-555555555555', is_default: 0 },
    { uuid: SHELF, is_default: 1 },
  ], () => COPY);
  assert.equal(planned.copyUuid, COPY);
  assert.deepEqual(planned.change, {
    table: 'copies', uuid: COPY, operation: 'upsert',
    values: {
      paper_uuid: PAPER, shelf_uuid: SHELF,
      edition_uuid: EDITION, edition_sha256: 'a'.repeat(64),
    },
  });
});

test('an offline addition waits for the nook snapshot when no shelf exists', () => {
  assert.throws(() => planOfflineNookAddition({ uuid: PAPER }, [], () => COPY),
    /nook is still loading/);
});
