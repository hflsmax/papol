import assert from 'node:assert/strict';
import test from 'node:test';

import { showInNookTarget } from './nookOffer.js';

const HASH = 'b'.repeat(64);

test('an opened file offers Add to nook until the nook lookup finds it', () => {
  const opened = { openedFile: true, initialPaper: { sha256: HASH, opened_file: true } };
  assert.equal(showInNookTarget(opened, null), null);
  assert.equal(showInNookTarget(opened, { sha256: HASH, opened_file: true }), HASH);
});

test('a shared paper offers its own copy only once there is one', () => {
  const shared = { nookHref: (copy) => `/viewer/?pdf=${copy.sha256}` };
  assert.equal(showInNookTarget(shared, null), null);
  assert.equal(showInNookTarget(shared, { sha256: HASH }), `/viewer/?pdf=${HASH}`);
  assert.equal(showInNookTarget({}, { sha256: HASH }), null);
});
