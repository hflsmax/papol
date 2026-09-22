import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';

import { HASH_SLICE_BYTES, sha256File } from '../../shared/fileHash.js';

const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('the sliced hash is the whole file\'s digest, and reports each slice', async () => {
  const bytes = randomBytes(2.5 * 1024 * 1024);
  const file = new Blob([bytes]);
  const seen = [];
  const digest = await sha256File(file, (progress) => seen.push(progress), 1024 * 1024);
  assert.equal(digest, digestOf(bytes));
  // WebCrypto, which the browsers used before, says the same.
  const whole = await crypto.subtle.digest('SHA-256', bytes);
  assert.equal(digest, Buffer.from(whole).toString('hex'));
  assert.deepEqual(seen, [
    { loaded: 0, total: bytes.length },
    { loaded: 1024 * 1024, total: bytes.length },
    { loaded: 2 * 1024 * 1024, total: bytes.length },
    { loaded: bytes.length, total: bytes.length },
  ]);
});

test('a file smaller than a slice, and an empty one, hash as well', async () => {
  const small = randomBytes(1000);
  assert.equal(await sha256File(new Blob([small])), digestOf(small));
  const empty = [];
  assert.equal(await sha256File(new Blob([]), (progress) => empty.push(progress)), digestOf(Buffer.alloc(0)));
  assert.deepEqual(empty, [{ loaded: 0, total: 0 }]);
});

test('the slices are a few megabytes', () => {
  assert.ok(HASH_SLICE_BYTES >= 1024 * 1024 && HASH_SLICE_BYTES <= 16 * 1024 * 1024);
});
