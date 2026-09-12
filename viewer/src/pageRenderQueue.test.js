import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderQueue, SCROLL_QUIET_MS } from './pageRenderQueue.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

const gate = () => {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
};

function queueWithClock() {
  let clock = 1000;
  const timers = [];
  const errors = [];
  const queue = createRenderQueue({
    now: () => clock,
    later: (fn, ms) => timers.push({ fn, at: clock + ms }),
    onError: (error) => errors.push(error),
  });
  const advance = async (ms) => {
    clock += ms;
    for (const timer of timers.splice(0)) {
      if (timer.at <= clock) timer.fn();
      else timers.push(timer);
    }
    await flush();
  };
  return { queue, advance, errors };
}

test('draws one page at a time, nearest the view first', async () => {
  const { queue } = queueWithClock();
  const order = [];
  const gates = {};
  const page = (name, distance) => {
    gates[name] = gate();
    return { priority: () => distance, run: () => { order.push(name); return gates[name].promise; } };
  };
  queue.request(page('far', 900));
  queue.request(page('onscreen', 0));
  queue.request(page('near', 200));
  await flush();
  assert.deepEqual(order, ['onscreen']);
  gates.onscreen.open();
  await flush();
  assert.deepEqual(order, ['onscreen', 'near']);
  gates.near.open();
  await flush();
  assert.deepEqual(order, ['onscreen', 'near', 'far']);
});

test('priority is asked when a job could start, so the view at that moment decides', async () => {
  const { queue } = queueWithClock();
  const order = [];
  const first = gate();
  let aDistance = 0;
  let bDistance = 500;
  queue.request({ priority: () => 0, run: () => { order.push('current'); return first.promise; } });
  queue.request({ priority: () => aDistance, run: () => { order.push('a'); } });
  queue.request({ priority: () => bDistance, run: () => { order.push('b'); } });
  await flush();
  // The reader scrolled while the first page was drawing.
  aDistance = 800;
  bDistance = 0;
  first.open();
  await flush();
  assert.deepEqual(order, ['current', 'b', 'a']);
});

test('a page that is no longer wanted, or withdrawn, is never drawn', async () => {
  const { queue } = queueWithClock();
  const ran = [];
  const blocker = gate();
  let wanted = true;
  queue.request({ priority: () => 0, run: () => blocker.promise });
  queue.request({ priority: () => (wanted ? 1 : null), run: () => { ran.push('scrolled away'); } });
  const withdraw = queue.request({ priority: () => 2, run: () => { ran.push('withdrawn'); } });
  await flush();
  wanted = false;
  withdraw();
  blocker.open();
  await flush();
  assert.deepEqual(ran, []);
});

test('an idle job waits for drawing to finish and for scrolling to pause', async () => {
  const { queue, advance } = queueWithClock();
  const ran = [];
  const drawing = gate();
  queue.scrolled();
  queue.request({ priority: () => 0, run: () => { ran.push('draw'); return drawing.promise; } });
  queue.request({ idle: true, priority: () => 0, run: () => { ran.push('text'); } });
  await flush();
  assert.deepEqual(ran, ['draw']);
  drawing.open();
  await flush();
  assert.deepEqual(ran, ['draw'], 'scrolling was only a moment ago');
  await advance(SCROLL_QUIET_MS / 2);
  queue.scrolled();
  await advance(SCROLL_QUIET_MS / 2);
  assert.deepEqual(ran, ['draw'], 'still scrolling');
  await advance(SCROLL_QUIET_MS);
  assert.deepEqual(ran, ['draw', 'text']);
});

test('quiet() waits for scrolling to pause, and always for a later task', async () => {
  const { queue, advance } = queueWithClock();
  let resolved = false;
  queue.quiet().then(() => { resolved = true; });
  await flush();
  assert.equal(resolved, false, 'not within the same task');
  await advance(0);
  assert.equal(resolved, true);

  resolved = false;
  queue.scrolled();
  queue.quiet().then(() => { resolved = true; });
  await advance(SCROLL_QUIET_MS / 2);
  assert.equal(resolved, false, 'scrolling was a moment ago');
  queue.scrolled();
  await advance(SCROLL_QUIET_MS / 2);
  assert.equal(resolved, false, 'still scrolling');
  await advance(SCROLL_QUIET_MS);
  await advance(0);
  assert.equal(resolved, true);
});

test('a failing drawing is reported and does not stall the pages behind it', async () => {
  const { queue, errors } = queueWithClock();
  const ran = [];
  queue.request({ priority: () => 0, run: () => { throw new Error('broken page'); } });
  queue.request({ priority: () => 1, run: () => { ran.push('next'); } });
  await flush();
  await flush();
  assert.equal(errors.length, 1);
  assert.deepEqual(ran, ['next']);
});
