import assert from 'node:assert/strict';
import test from 'node:test';

import { styles } from './styles.js';

test('viewer styles reference only declared or runtime tokens', () => {
  const declared = new Set(
    [...styles.matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1]),
  );
  const runtime = new Set(['danger', 'glyph-cutout', 'loaded', 'rail-user-w', 'swatch']);
  const unresolved = [...new Set(
    [...styles.matchAll(/var\(--([\w-]+)/g)].map((match) => match[1]),
  )].filter((token) => !declared.has(token) && !runtime.has(token));

  assert.deepEqual(unresolved, []);
});
