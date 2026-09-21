import test from 'node:test';
import assert from 'node:assert/strict';
import { localViewerBacklink } from './sourceLink.js';

test('maps a stored viewer backlink to the desktop viewer without losing its text annotation', () => {
  const href = localViewerBacklink(
    'https://papol.example/papol/viewer/?pdf=paper-1&page=3&mark=encoded#source',
    (path) => `tauri://localhost${path}`,
  );
  assert.equal(href, 'tauri://localhost/viewer/?pdf=paper-1&page=3&mark=encoded#source');
});

test('leaves non-viewer sources to the browser', () => {
  assert.equal(localViewerBacklink('https://example.com/article', (path) => path), null);
});
