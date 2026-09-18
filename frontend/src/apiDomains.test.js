import test from 'node:test';
import assert from 'node:assert/strict';

test('paper download URLs use the shared deployment URL policy', async () => {
  const { pdfHref } = await import('../../shared/api/papers.js');
  assert.equal(pdfHref({ file_path: 'paper.pdf' }), '/uploads/paper.pdf');
  assert.equal(pdfHref({ file_path: 'https://example.test/paper.pdf' }), 'https://example.test/paper.pdf');
});
