import test from 'node:test';
import assert from 'node:assert/strict';

import { citationProblemReport } from './citationReport.js';

test('a matched reference is reported with the paper, the marker, and what it matched', () => {
  const report = citationProblemReport({
    paper: { title: 'Attention', sha256: 'abc' },
    page: 3,
    label: '[12]',
    referenceUuid: 'ref-1',
    reference: {
      uuid: 'ref-1',
      raw: 'Vaswani et al. 2017.',
      resolved_status: 'resolved',
      resolution: {
        title: 'Attention Is All You Need',
        authors: ['A', 'B', 'C', 'D'],
        venue: 'NeurIPS',
        year: 2017,
        doi: '10.1/x',
      },
    },
    href: 'https://papol.io/paper/abc',
  });

  // Room to write first; the details follow.
  assert.match(report, /^\n\n--- Citation card ---\n/);
  assert.match(report, /^Paper: Attention \(abc\)$/m);
  assert.match(report, /^Page: 3$/m);
  assert.match(report, /^Marker: \[12\]$/m);
  assert.match(report, /^Reference: ref-1$/m);
  assert.match(report, /^Status: resolved$/m);
  assert.match(report, /^Printed: Vaswani et al\. 2017\.$/m);
  assert.match(report, /^Matched: Attention Is All You Need · A, B, C · NeurIPS 2017 · 10\.1\/x$/m);
  assert.match(report, /^Address: https:\/\/papol\.io\/paper\/abc$/m);
});

test('a reference that is still unknown reports only what there is', () => {
  const report = citationProblemReport({
    referenceUuid: 'pdf:cite.x',
    error: 'Reference unreadable.',
  });

  assert.match(report, /^Reference: pdf:cite\.x$/m);
  assert.match(report, /^Error: Reference unreadable\.$/m);
  assert.doesNotMatch(report, /Paper:|Page:|Matched:|Printed:/);
});
