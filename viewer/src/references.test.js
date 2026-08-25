import test from 'node:test';
import assert from 'node:assert/strict';

import { destinationY } from './references.js';

test('reads the vertical position from each PDF destination shape', () => {
  const page = { num: 275, gen: 0 };

  assert.equal(destinationY([page, { name: 'XYZ' }, 0, 730.917, null]), 730.917);
  assert.equal(destinationY([page, { name: 'FitH' }, 730.917]), 730.917);
  assert.equal(destinationY([page, { name: 'FitBH' }, 730.917]), 730.917);
  assert.equal(destinationY([page, { name: 'Fit' }]), null);
});
