import test from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_LONG_MS, createWakeWatch } from './pageWake.js';

function fakes() {
  const target = () => {
    const handlers = {};
    return {
      handlers,
      addEventListener(type, fn) { (handlers[type] ??= new Set()).add(fn); },
      removeEventListener(type, fn) { handlers[type]?.delete(fn); },
      fire(type, event) { for (const fn of handlers[type] || []) fn(event); },
    };
  };
  const doc = { ...target(), visibilityState: 'visible' };
  const win = target();
  let clock = 0;
  const heard = [];
  const watch = createWakeWatch({ doc, win, now: () => clock });
  watch.subscribe((reason) => heard.push(reason));
  const show = (state, after = 0) => {
    clock += after;
    doc.visibilityState = state;
    doc.fire('visibilitychange');
  };
  return { doc, win, watch, heard, show };
}

test('coming back after a long time away is a wake', () => {
  const { heard, show } = fakes();
  show('hidden');
  show('visible', AWAY_LONG_MS + 1);
  assert.deepEqual(heard, ['wake']);
});

test('a glance at another tab is not', () => {
  const { heard, show } = fakes();
  show('hidden');
  show('visible', 5_000);
  assert.deepEqual(heard, []);
});

test('time away counts from when the page was first hidden', () => {
  const { heard, show } = fakes();
  show('hidden');
  show('hidden', AWAY_LONG_MS - 10);
  show('visible', 20);
  assert.deepEqual(heard, ['wake']);
});

test('a page back from the back/forward cache, and the network back, are told', () => {
  const { win, heard } = fakes();
  win.fire('pageshow', { persisted: false });
  win.fire('pageshow', { persisted: true });
  win.fire('online');
  assert.deepEqual(heard, ['wake', 'online']);
});

test('stopping lets go of the document', () => {
  const { doc, win, watch } = fakes();
  watch.stop();
  assert.equal(doc.handlers.visibilitychange.size, 0);
  assert.equal(win.handlers.online.size, 0);
});
