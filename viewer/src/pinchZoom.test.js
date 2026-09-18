import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinchScheduler, createZoomPageCache } from './pinchZoom.js';

function harness(settleMs = 220) {
  let now = 0;
  let id = 0;
  const frames = new Map();
  const timers = new Map();
  const visual = [];
  let commits = 0;
  const scheduler = createPinchScheduler({
    settleMs,
    onFrame: (factor, at) => visual.push({ factor, at }),
    onCommit: () => { commits += 1; },
    requestFrame: (callback) => { const key = ++id; frames.set(key, callback); return key; },
    cancelFrame: (key) => frames.delete(key),
    setTimer: (callback, delay) => {
      const key = ++id;
      timers.set(key, { callback, at: now + delay });
      return key;
    },
    clearTimer: (key) => timers.delete(key),
  });
  const flushFrames = () => {
    const queued = [...frames.values()];
    frames.clear();
    queued.forEach((callback) => callback(now));
  };
  const advance = (ms) => {
    now += ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
      if (!due.length) break;
      due.forEach(([key, timer]) => { timers.delete(key); timer.callback(); });
    }
  };
  return { scheduler, visual, flushFrames, advance, commits: () => commits };
}

test('coalesces a burst into one visual update without losing zoom distance', () => {
  const h = harness();
  for (let i = 0; i < 100; i += 1) h.scheduler.update(1.001, { x: i, y: 20 });
  assert.equal(h.visual.length, 0);
  h.flushFrames();
  assert.equal(h.visual.length, 1);
  assert.ok(Math.abs(h.visual[0].factor - (1.001 ** 100)) < 1e-12);
  assert.deepEqual(h.visual[0].at, { x: 99, y: 20 });
});

test('does not commit a native pinch while two fingers remain down', () => {
  const h = harness(120);
  h.scheduler.startNative();
  h.scheduler.update(1.1, { x: 10, y: 20 });
  h.flushFrames();
  h.advance(2_000);
  assert.equal(h.commits(), 0);
  h.scheduler.update(1.05, { x: 10, y: 20 });
  h.flushFrames();
  assert.equal(h.visual.length, 2);
  h.scheduler.endNative();
  h.advance(0);
  assert.equal(h.commits(), 1);
});

test('wheel pinch tolerates short delivery gaps and commits once after quiet', () => {
  const h = harness(220);
  for (let i = 0; i < 20; i += 1) {
    h.scheduler.update(1.01, { x: 50, y: 60 });
    h.flushFrames();
    h.advance(180);
  }
  assert.equal(h.commits(), 0);
  h.advance(40);
  assert.equal(h.commits(), 1);
});

test('cancel drops queued work and a pending commit', () => {
  const h = harness();
  h.scheduler.update(1.2, { x: 1, y: 2 });
  h.scheduler.cancel();
  h.flushFrames();
  h.advance(1_000);
  assert.deepEqual(h.visual, []);
  assert.equal(h.commits(), 0);
});

test('page cache performs selectors once until a mounted page is replaced', () => {
  let rootQueries = 0;
  let innerQueries = 0;
  const makePage = () => ({
    isConnected: true,
    querySelector() { innerQueries += 1; return {}; },
  });
  let nodes = Array.from({ length: 80 }, makePage);
  const root = { querySelectorAll() { rootQueries += 1; return nodes; } };
  const cache = createZoomPageCache();

  for (let frame = 0; frame < 600; frame += 1) cache.get(root);
  assert.equal(rootQueries, 1);
  assert.equal(innerQueries, 80);

  nodes[12].isConnected = false;
  nodes = Array.from({ length: 80 }, makePage);
  cache.invalidate();
  assert.equal(cache.get(root).length, 80);
  assert.equal(rootQueries, 2);
  assert.equal(innerQueries, 160);
});
