import test from 'node:test';
import assert from 'node:assert/strict';
import { createValueStore } from './valueStore.js';

test('a store tells its subscribers when its value changes, and only then', () => {
  const store = createValueStore(1.5);
  const heard = [];
  const unsubscribe = store.subscribe(() => heard.push(store.get()));
  store.set(1.5);
  assert.deepEqual(heard, [], 'setting the same value is not a change');
  store.set(3);
  assert.deepEqual(heard, [3]);
  unsubscribe();
  store.set(4);
  assert.deepEqual(heard, [3], 'an unsubscribed listener hears nothing');
  assert.equal(store.get(), 4);
});

test('a listener may unsubscribe itself while being told', () => {
  const store = createValueStore(0);
  const heard = [];
  const first = store.subscribe(() => { heard.push('first'); first(); });
  store.subscribe(() => heard.push('second'));
  store.set(1);
  store.set(2);
  assert.deepEqual(heard, ['first', 'second', 'second']);
});
