import test from 'node:test';
import assert from 'node:assert/strict';
import { withAbortTimeout } from './requestTimeout.js';

test('aborts a request that exceeds its deadline', async () => {
  let signal;
  const request = withAbortTimeout((requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve, reject) => {
      requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
    });
  }, 5);

  await assert.rejects(request, (error) => error?.name === 'AbortError');
  assert.equal(signal.aborted, true);
});

test('clears the deadline after a request finishes', async () => {
  let signal;
  const result = await withAbortTimeout((requestSignal) => {
    signal = requestSignal;
    return Promise.resolve('done');
  }, 5);

  assert.equal(result, 'done');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(signal.aborted, false);
});
