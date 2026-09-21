import assert from 'node:assert/strict';
import test from 'node:test';

import { pollUntil } from '../../shared/polling.js';
import { JobFailed, awaitJob } from '../../shared/api/jobs.js';

// Waits of a millisecond or two: the schedule is under test, not the clock.
const quick = { firstWaitMs: 1, backoff: 2, longestWaitMs: 4 };

test('asks again until the answer has settled, showing every answer', async () => {
  const answers = ['pending', 'pending', 'ready'];
  const shown = [];
  const settled = await pollUntil(
    async () => answers.shift(),
    (answer) => answer === 'ready',
    { ...quick, onAnswer: (answer) => shown.push(answer) },
  );
  assert.equal(settled, 'ready');
  assert.deepEqual(shown, ['pending', 'pending', 'ready']);
});

test('waits longer each time, up to the longest wait', async () => {
  // The schedule is what is under test, not the clock: record what the
  // loop asks the timer for, and fire at once.
  const waits = [];
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms) => { waits.push(ms); return realSetTimeout(fn, 0); };
  try {
    let answers = 5;
    await pollUntil(
      async () => --answers,
      (left) => left === 0,
      { firstWaitMs: 10, backoff: 2, longestWaitMs: 25 },
    );
  } finally {
    global.setTimeout = realSetTimeout;
  }
  assert.deepEqual(waits, [10, 20, 25, 25]);
});

test('aborting ends the waiting, not the asking that already answered', async () => {
  const waiting = new AbortController();
  let asks = 0;
  const wait = pollUntil(async () => { asks += 1; return 'pending'; }, () => false, {
    ...quick, longestWaitMs: 1000, firstWaitMs: 1000, signal: waiting.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  waiting.abort();
  await assert.rejects(wait, (error) => error.name === 'AbortError');
  assert.equal(asks, 1);
});

test('an answer that cannot be had ends the wait with its error', async () => {
  await assert.rejects(
    pollUntil(async () => { throw new Error('offline'); }, () => true, quick),
    /offline/,
  );
});

test('a job settles as its result, or as a failure carrying its detail', async () => {
  const answered = new Map([
    ['/api/jobs/j1', [{ status: 'queued' }, { status: 'running' }, { status: 'done', result: { title: 'T' } }]],
    ['/api/jobs/j2', [{ status: 'failed', detail: 'Could not capture the webpage: blocked' }]],
  ]);
  global.fetch = async (url) => {
    const queue = answered.get(new URL(url, 'http://papol.test').pathname);
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await awaitJob('j1'), { title: 'T' });
    await assert.rejects(awaitJob('j2'), (error) => (
      error instanceof JobFailed && error.message === 'Could not capture the webpage: blocked'
    ));
  } finally {
    delete global.fetch;
  }
});
