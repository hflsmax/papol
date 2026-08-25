import test from 'node:test';
import assert from 'node:assert/strict';

import { destinationY, referenceAt } from './references.js';

test('reads the vertical position from each PDF destination shape', () => {
  const page = { num: 275, gen: 0 };

  assert.equal(destinationY([page, { name: 'XYZ' }, 0, 730.917, null]), 730.917);
  assert.equal(destinationY([page, { name: 'FitH' }, 730.917]), 730.917);
  assert.equal(destinationY([page, { name: 'FitBH' }, 730.917]), 730.917);
  assert.equal(destinationY([page, { name: 'Fit' }]), null);
});

test('distinguishes tightly spaced references using the raised-link offset', () => {
  const references = [
    { id: 407, page: 15, y: 0.5584217171717172, title: 'CodeT5' },
    { id: 398, page: 15, y: 0.5622474747474747, title: 'Synchromesh' },
  ];

  assert.equal(
    referenceAt(references, { page: 15, y: 0.5515151515151515 }).id,
    407,
  );
  assert.equal(
    referenceAt(references, { page: 15, y: 0.5553472222222222 }).id,
    398,
  );
});
