import test from 'node:test';
import assert from 'node:assert/strict';

const publicApi = await import('../../shared/api.js');
const domains = await Promise.all([
  'account', 'people', 'boards', 'papers', 'rooms', 'notifications', 'feedback', 'admin',
].map((domain) => import(`../../shared/api/${domain}.js`)));

test('the compatibility API barrel contains exactly the domain client exports', () => {
  const domainExports = [...new Set(domains.flatMap(Object.keys))].sort();
  assert.deepEqual(Object.keys(publicApi).sort(), domainExports);
});

test('paper download URLs use the shared deployment URL policy', async () => {
  const { pdfHref } = await import('../../shared/api/papers.js');
  assert.equal(pdfHref({ file_path: 'paper.pdf' }), '/uploads/paper.pdf');
  assert.equal(pdfHref({ file_path: 'https://example.test/paper.pdf' }), 'https://example.test/paper.pdf');
});
