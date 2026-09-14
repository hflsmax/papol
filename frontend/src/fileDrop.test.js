import test from 'node:test';
import assert from 'node:assert/strict';

import { carriesFiles, isPdfFile, libraryFileDragState } from '../../shared/fileDrop.js';

test('recognizes file drags without intercepting internal app drags', () => {
  assert.equal(carriesFiles({ types: ['Files', 'text/plain'] }), true);
  assert.equal(carriesFiles({ types: ['application/x-papol-paper', 'text/plain'] }), false);
});

test('accepts PDFs by MIME type or filename', () => {
  assert.equal(isPdfFile({ type: 'application/pdf', name: 'paper' }), true);
  assert.equal(isPdfFile({ type: '', name: 'PAPER.PDF' }), true);
  assert.equal(isPdfFile({ type: 'text/plain', name: 'notes.txt' }), false);
});

test('shows rejection while dragging a known non-PDF into the library', () => {
  assert.equal(libraryFileDragState({ items: [{ kind: 'file', type: 'text/plain' }] }), 'reject');
  assert.equal(libraryFileDragState({ items: [{ kind: 'file', type: 'application/pdf' }] }), 'accept');
  assert.equal(libraryFileDragState({ items: [{ kind: 'file', type: '' }] }), 'accept');
});
