import assert from 'node:assert/strict';
import test from 'node:test';
import { planOfflineNookAddition } from '../../shared/nookTransition.js';

const PAPER = 'a'.repeat(64);
const SHELF = '33333333-3333-4333-8333-333333333333';
const COPY = '44444444-4444-4444-8444-444444444444';

test('an already-known public paper becomes an owned local copy', () => {
  const planned = planOfflineNookAddition({ sha256: PAPER }, [
    { uuid: '55555555-5555-4555-8555-555555555555', is_default: 0 },
    { uuid: SHELF, is_default: 1 },
  ], () => COPY);
  assert.equal(planned.copyUuid, COPY);
  assert.deepEqual(planned.change, {
    table: 'copies', uuid: COPY, operation: 'upsert',
    values: { paper_sha256: PAPER, shelf_uuid: SHELF },
  });
});

test('an offline addition does not wait for a shelf snapshot', () => {
  const planned = planOfflineNookAddition({ sha256: PAPER }, [], () => COPY);
  assert.equal(planned.change.values.shelf_uuid, null);
});
