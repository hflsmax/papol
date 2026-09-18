import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map([
  ['papol.localAccountUuid', '7'],
  ['papol_token', 'stored-token'],
]);

global.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
global.window = {
  location: new URL('tauri://localhost/'),
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'desk', documentWindow: false },
  __TAURI_INTERNALS__: {
    transformCallback: () => 1,
  },
};
global.location = global.window.location;

const {
  currentCredential, hydrateCredential, storeCredential,
} = await import('../../shared/credentials.js');

test('desktop startup hydrates the token from web storage', async () => {
  assert.equal(await hydrateCredential(), 'stored-token');
  assert.equal(currentCredential(), 'stored-token');
});

test('desktop credentials are stored in and removed from web storage', async () => {
  await storeCredential('replacement');
  assert.equal(values.get('papol_token'), 'replacement');
  await storeCredential(null);
  assert.equal(currentCredential(), null);
  assert.equal(values.has('papol_token'), false);
});
