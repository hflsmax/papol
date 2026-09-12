import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map([
  ['papol.localAccountId', '7'],
  ['papol_token', 'legacy-token'],
]);
const keychain = new Map();
const calls = [];

global.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
global.window = {
  location: new URL('tauri://localhost/'),
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'main', documentWindow: false },
  __TAURI_INTERNALS__: {
    invoke: async (command, arguments_) => {
      calls.push([command, arguments_]);
      const account = String(arguments_.accountId);
      if (command === 'credential_get') return keychain.get(account) ?? null;
      if (command === 'credential_set') {
        if (arguments_.token) keychain.set(account, arguments_.token);
        else keychain.delete(account);
        return null;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    transformCallback: () => 1,
  },
};
global.location = global.window.location;

const {
  configureCredentialInvoke, currentCredential, hydrateCredential, storeCredential,
} = await import('../../shared/credentials.js');
configureCredentialInvoke(window.__TAURI_INTERNALS__.invoke);

test('desktop startup migrates a legacy web-storage token into Keychain', async () => {
  assert.equal(await hydrateCredential(), 'legacy-token');
  assert.equal(currentCredential(), 'legacy-token');
  assert.equal(values.has('papol_token'), false);
  assert.equal(keychain.get('7'), 'legacy-token');
  assert.deepEqual(calls[0], [
    'credential_set', { accountId: 7, token: 'legacy-token' },
  ]);
});

test('desktop credentials are read from and removed from Keychain', async () => {
  await storeCredential('replacement', 7);
  assert.equal(values.has('papol_token'), false);
  assert.equal(keychain.get('7'), 'replacement');
  await storeCredential(null, 7);
  assert.equal(currentCredential(), null);
  assert.equal(keychain.has('7'), false);
});
