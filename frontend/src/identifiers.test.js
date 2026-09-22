import assert from 'node:assert/strict';
import test from 'node:test';

import { extractArxivId, extractDoi, identifierIn } from '../../shared/identifiers.js';

// The same cases the Worker's suite holds its reading to
// (cloudflare/test/papers.test.ts): the two must agree.
test('the complete DOI is found, skipping a split one', () => {
  assert.equal(extractDoi('supporting info at 10.1073/pnas. and then doi: 10.1073/pnas.2423301122.'), '10.1073/pnas.2423301122');
  assert.equal(extractDoi('see https://doi.org/10.1145/2984511.2984540, cited'), '10.1145/2984511.2984540');
  assert.equal(extractDoi('only a split one: 10.1073/pnas.'), '10.1073/pnas');
  assert.equal(extractDoi('nothing here'), null);
  assert.equal(extractDoi(''), null);
});

test('an arXiv id is found in either spelling, with the spaces layout puts in it taken out', () => {
  assert.equal(extractArxivId('arXiv:1607.06450v2 [cs.LG]'), '1607.06450v2');
  assert.equal(extractArxivId('at arxiv.org/abs/hep-th/9901001'), 'hep-th/9901001');
  assert.equal(extractArxivId('arXiv : 1706 . 03762'), '1706.03762');
  assert.equal(extractArxivId('no preprint'), null);
});

test('the upload sends the arXiv id before a DOI, and nothing when neither is printed', () => {
  assert.deepEqual(identifierIn('arXiv:1706.03762v5 [cs.CL] and doi:10.5555/cited'), { arxiv_id: '1706.03762v5' });
  assert.deepEqual(identifierIn('https://doi.org/10.1145/2984511.2984540'), { doi: '10.1145/2984511.2984540' });
  assert.equal(identifierIn('a scan with no identifier'), null);
});
