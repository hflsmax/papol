import assert from 'node:assert/strict';
import test from 'node:test';
import { activateDesktopSession } from './authTransition.js';

const result = {
  token: 'credential',
  user: { uuid: '77777777-7777-4777-8777-777777777777' },
};

test('the credential is visible before the native account activates', async () => {
  const calls = [];
  await activateDesktopSession(result, {
    rememberIdentity: async () => calls.push('identity'),
    storeToken: async (token) => calls.push(token ? 'token' : 'clear'),
    prepareAccount: async () => calls.push('account'),
  });
  assert.deepEqual(calls, ['identity', 'token', 'account']);
});

test('a failed native activation does not leave a half-signed-in credential', async () => {
  const calls = [];
  await assert.rejects(activateDesktopSession(result, {
    rememberIdentity: async () => {},
    storeToken: async (token) => calls.push(token ? 'token' : 'clear'),
    prepareAccount: async () => { throw new Error('native failure'); },
  }), /native failure/);
  assert.deepEqual(calls, ['token', 'clear']);
});
