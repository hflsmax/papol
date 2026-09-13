import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCAL_ANNOTATIONS_NOTICE_KEY,
  localAnnotationsNoticeHidden,
  rememberLocalAnnotationsNoticeChoice,
} from './localAnnotationsNotice.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('the annotation notice returns on the next viewer visit after an ordinary dismissal', () => {
  const storage = memoryStorage();
  assert.equal(localAnnotationsNoticeHidden(storage), false);
  rememberLocalAnnotationsNoticeChoice(false, storage);
  assert.equal(localAnnotationsNoticeHidden(storage), false);
});

test("Don't show again suppresses the annotation notice on later visits", () => {
  const storage = memoryStorage();
  rememberLocalAnnotationsNoticeChoice(true, storage);
  assert.equal(storage.getItem(LOCAL_ANNOTATIONS_NOTICE_KEY), 'hidden');
  assert.equal(localAnnotationsNoticeHidden(storage), true);
});

test('unavailable preference storage leaves the annotation warning enabled', () => {
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(localAnnotationsNoticeHidden(storage), false);
  assert.doesNotThrow(() => rememberLocalAnnotationsNoticeChoice(true, storage));
});
