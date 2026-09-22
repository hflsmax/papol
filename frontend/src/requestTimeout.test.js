import test from 'node:test';
import assert from 'node:assert/strict';
import { withAbortTimeout } from '../../shared/requestTimeout.js';

// The deadline is under test, not the clock: time moves when a test says.
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('aborts a request that exceeds its deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const request = withAbortTimeout((requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve, reject) => {
      requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
    });
  }, 5);

  t.mock.timers.tick(4);
  assert.equal(signal.aborted, false, 'not before its deadline');
  t.mock.timers.tick(1);
  await assert.rejects(request, (error) => error?.name === 'AbortError');
  assert.equal(signal.aborted, true);
});

test('clears the deadline after a request finishes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const result = await withAbortTimeout((requestSignal) => {
    signal = requestSignal;
    return Promise.resolve('done');
  }, 5);

  assert.equal(result, 'done');
  t.mock.timers.tick(10);
  await flush();
  assert.equal(signal.aborted, false);
});

test('the caller’s own signal ends the request too, with its reason', async () => {
  const mine = new AbortController();
  const request = withAbortTimeout((requestSignal) => new Promise((resolve, reject) => {
    requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
  }), 10_000, { signal: mine.signal });
  mine.abort(new Error('saved'));
  await assert.rejects(request, /saved/);
});

test('a signal already aborted ends the request before it starts', async () => {
  const mine = new AbortController();
  mine.abort();
  let given;
  await withAbortTimeout((requestSignal) => { given = requestSignal; return Promise.resolve(); }, 10, { signal: mine.signal });
  assert.equal(given.aborted, true);
});
