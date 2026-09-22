import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeHarness } from '../../shared/testing/nativeHarness.js';

// configureNativeBridge replaces the module's bridge for good, so these
// tests have a process of their own rather than leaving every test after
// them talking to a stand-in.
const native = await installNativeHarness();
const {
  configureNativeBridge, nativeRepository, REPORTABLE_NATIVE_ERROR_EVENT, subscribeNativeData,
} = await import('../../shared/nativeData.js');

test('a bridge without both halves is refused', () => {
  assert.throws(() => configureNativeBridge({ invoke: async () => null }), TypeError);
});

test('native event cleanup retries Tauri registration races', async () => {
  const stopAttempts = new Map();
  let listenerCount = 0;
  configureNativeBridge({
    invoke: native.invoke,
    listen: async (eventName) => {
      // The bridge configuration also installs its permanent sync listener.
      const listenerId = listenerCount++;
      if (listenerId === 0) return () => {};
      const key = `${eventName}:${listenerId}`;
      stopAttempts.set(key, 0);
      return () => {
        const attempts = stopAttempts.get(key) + 1;
        stopAttempts.set(key, attempts);
        if (attempts === 1) return Promise.reject(new TypeError('listener entry is pending'));
        return Promise.resolve();
      };
    },
  });

  const unsubscribe = subscribeNativeData(() => {});
  await native.until(() => stopAttempts.size === 3, { what: 'the three listeners' });
  unsubscribe();
  await native.until(() => [...stopAttempts.values()].every((attempts) => attempts === 2), {
    what: 'every listener to be stopped on its second attempt',
  });
  assert.deepEqual([...stopAttempts.values()], [2, 2, 2]);
});

test('a command the Mac does not register is announced as a defect, even when the caller copes', async () => {
  configureNativeBridge({ invoke: native.invoke, listen: async () => () => {} });
  // The harness refuses what lib.rs does not register, in Tauri's words.
  await assert.rejects(native.invoke('no_such_command'), (failure) => failure === 'Command no_such_command not found');
  native.on('data_query', () => { throw 'Command data_query not allowed by ACL'; });
  await assert.rejects(nativeRepository.boards(), (failure) => /not allowed by ACL/.test(failure));
  const reported = native.events.find((event) => event.type === REPORTABLE_NATIVE_ERROR_EVENT);
  assert.equal(reported?.detail.area, 'native command data_query');
});
