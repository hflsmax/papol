import assert from 'node:assert/strict';
import test from 'node:test';

import { pollUntil } from '../../shared/polling.js';
import { JobFailed, awaitJob } from '../../shared/api/jobs.js';

// The schedule is under test, not the clock: timers are the test's, and
// time moves only when it says. `flush` lets whatever a tick released run.
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function tickUntilSettled(t, promise, stepMs = 100) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let turns = 0; !settled; turns += 1) {
    if (turns > 1000) throw new Error('The wait never settled');
    t.mock.timers.tick(stepMs);
    await flush();
  }
  return promise;
}

test('asks again until the answer has settled, showing every answer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const answers = ['pending', 'pending', 'ready'];
  const shown = [];
  const settled = await tickUntilSettled(t, pollUntil(
    async () => answers.shift(),
    (answer) => answer === 'ready',
    { firstWaitMs: 1, backoff: 2, longestWaitMs: 4, onAnswer: (answer) => shown.push(answer) },
  ), 1);
  assert.equal(settled, 'ready');
  assert.deepEqual(shown, ['pending', 'pending', 'ready']);
});

test('waits longer each time, up to the longest wait', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let asks = 0;
  const polling = pollUntil(
    async () => { asks += 1; return asks; },
    (count) => count === 5,
    { firstWaitMs: 10, backoff: 2, longestWaitMs: 25 },
  );
  await flush();
  // Asked at once, then again after 10, 20, 25 and 25 more.
  for (const wait of [10, 20, 25, 25]) {
    const before = asks;
    t.mock.timers.tick(wait - 1);
    await flush();
    assert.equal(asks, before, `not asked again before ${wait} ms`);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(asks, before + 1, `asked again after ${wait} ms`);
  }
  assert.equal(await polling, 5);
});

test('aborting ends the waiting, not the asking that already answered', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const waiting = new AbortController();
  let asks = 0;
  const wait = pollUntil(async () => { asks += 1; return 'pending'; }, () => false, {
    firstWaitMs: 1000, longestWaitMs: 1000, signal: waiting.signal,
  });
  await flush();
  waiting.abort();
  await assert.rejects(wait, (error) => error.name === 'AbortError');
  assert.equal(asks, 1);
});

test('an answer that cannot be had ends the wait with its error', async () => {
  await assert.rejects(
    pollUntil(async () => { throw new Error('offline'); }, () => true),
    /offline/,
  );
});

test('a job settles as its result, or as a failure carrying its detail', async (t) => {
  // At the schedule every wait in Papol uses, which is most of two seconds
  // of real time for these three answers.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const answered = new Map([
    ['/api/jobs/j1', [{ status: 'queued' }, { status: 'running' }, { status: 'done', result: { title: 'T' } }]],
    ['/api/jobs/j2', [{ status: 'failed', detail: 'Could not capture the webpage: blocked' }]],
  ]);
  t.mock.method(globalThis, 'fetch', async (url) => {
    const queue = answered.get(new URL(url, 'http://papol.test').pathname);
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert.deepEqual(await tickUntilSettled(t, awaitJob('j1')), { title: 'T' });
  await assert.rejects(awaitJob('j2'), (error) => (
    error instanceof JobFailed && error.message === 'Could not capture the webpage: blocked'
  ));
});
