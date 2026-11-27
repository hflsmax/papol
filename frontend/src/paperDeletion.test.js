import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const desk = readFileSync(new URL('./components/NookDesk.jsx', import.meta.url), 'utf8');
const jacket = readFileSync(new URL('./components/PaperJacket.jsx', import.meta.url), 'utf8');

test('removing a paper from the embedded nook refreshes its list', () => {
  assert.match(desk, /renderPaper\(paper, onChanged\)/);
  assert.match(app, /renderPaper=\{\(name, refreshNook\) =>/);
  assert.match(app, /onChanged=\{refreshNook\}/);
});

test('removing a paper stays on its jacket, read again as a paper outside the nook', () => {
  const remove = jacket.slice(jacket.indexOf('const handleDelete'), jacket.indexOf('const handleMetadataSave'));
  assert.match(remove, /await deletePaper\(paper\.sha256\);[\s\S]*setPaper\(await getPaper\(paperSha256\)\);\s*onChanged\?\.\(\);/);
  // Nothing in the app leaves the jacket for the nook when a paper is removed.
  assert.doesNotMatch(app, /<PaperJacket[^>]*onDeleted=/);
});

test('a jacket whose paper cannot be read again after removal is left, with or without a Back', () => {
  assert.match(jacket, /catch \{\s*onChanged\?\.\(\);\s*\(onDeleted \|\| onBack\)\?\.\(\);/);
});
