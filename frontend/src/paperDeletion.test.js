import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const desk = readFileSync(new URL('./components/NookDesk.jsx', import.meta.url), 'utf8');
const jacket = readFileSync(new URL('./components/PaperJacket.jsx', import.meta.url), 'utf8');

test('deleting a paper from the embedded nook refreshes its list and leaves the jacket', () => {
  assert.match(desk, /renderPaper\(paper, onChanged\)/);
  assert.match(app, /renderPaper=\{\(name, refreshNook\) =>/);
  assert.match(app, /onChanged=\{refreshNook\}/);
  assert.match(app, /onDeleted=\{\(\) => navigate\('\/', \{ replace: true \}\)\}/);
});

test('a paper deletion does not require a visible Back control', () => {
  assert.match(jacket, /\(onDeleted \|\| onBack\)\?\.\(\)/);
  assert.doesNotMatch(jacket, /await deletePaper\(paper\.sha256\);\s*onBack\(\)/);
});
