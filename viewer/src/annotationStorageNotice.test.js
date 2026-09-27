import assert from 'node:assert/strict';
import test from 'node:test';

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
};

const { closeAnnotationStorageNotice, showsAnnotationStorageNotice } = await import('./annotationStorageNotice.js');
const { ANNOTATION_STORAGE_NOTICE_HIDDEN, FEATURE_STATES, setFeatureState } = await import('../../shared/featureStates.js');

test('the notice shows on every opening until the reader opts out', () => {
  stored.clear();
  assert.equal(showsAnnotationStorageNotice({ neverAnnotatable: false }), true);
  closeAnnotationStorageNotice(false);
  assert.equal(showsAnnotationStorageNotice({ neverAnnotatable: false }), true);
  closeAnnotationStorageNotice(true);
  assert.equal(showsAnnotationStorageNotice({ neverAnnotatable: false }), false);
});

test('a paper nobody can write on has no notice', () => {
  stored.clear();
  assert.equal(showsAnnotationStorageNotice({ neverAnnotatable: true }), false);
});

test('Admin can bring the notice back', () => {
  stored.clear();
  assert.ok(FEATURE_STATES.includes(ANNOTATION_STORAGE_NOTICE_HIDDEN));
  closeAnnotationStorageNotice(true);
  setFeatureState(ANNOTATION_STORAGE_NOTICE_HIDDEN, false);
  assert.equal(showsAnnotationStorageNotice({ neverAnnotatable: false }), true);
});

test('storage that cannot be read still shows the notice', () => {
  const kept = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); } };
  try {
    assert.equal(showsAnnotationStorageNotice({ neverAnnotatable: false }), true);
  } finally {
    globalThis.localStorage = kept;
  }
});
