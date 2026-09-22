import test from 'node:test';
import assert from 'node:assert/strict';

test('paper download URLs use the shared deployment URL policy', async () => {
  const { pdfHref } = await import('../../shared/api/papers.js');
  assert.equal(pdfHref({ file_path: 'paper.pdf' }), '/uploads/paper.pdf');
  assert.equal(pdfHref({ file_path: 'https://example.test/paper.pdf' }), 'https://example.test/paper.pdf');
  // The address the server gives for the file, when it gives one, is where the bytes are.
  assert.equal(pdfHref({ file_path: 'paper.pdf', file_url: 'https://files.example.test/uploads/paper.pdf' }), 'https://files.example.test/uploads/paper.pdf');
  assert.equal(pdfHref({ file_path: 'paper.pdf', file_url: '/uploads/paper.pdf' }), '/uploads/paper.pdf');
});
