import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCardPreview } from './cardPreview.js';

test('image cards always reserve space for their preview', () => {
  assert.equal(hasCardPreview({ kind: 'image' }), true);
});

test('captured link cards use their stored preview', () => {
  assert.equal(hasCardPreview({ kind: 'youtube', sha256: 'thumbnail' }), true);
  assert.equal(hasCardPreview({ kind: 'webpage', file_path: 'snapshot.png' }), true);
  assert.equal(hasCardPreview({ kind: 'webpage' }), false);
});

test('attached files are not rendered as image previews', () => {
  assert.equal(hasCardPreview({ kind: 'file', mime_type: 'application/pdf', sha256: 'pdf' }), false);
  assert.equal(hasCardPreview({ kind: 'file', mime_type: 'text/plain', file_path: 'notes.txt' }), false);
});
