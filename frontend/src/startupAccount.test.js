import test from 'node:test';
import assert from 'node:assert/strict';

const ACCOUNT = '77777777-7777-4777-8777-777777777777';
const localUser = { uuid: ACCOUNT, display_name: 'Local User' };
const values = new Map([
  ['papol.localAccountUuid', ACCOUNT],
  ['papol.syncPreference', 'manual'],
  ['papol_token', 'expired-token'],
]);
const nativeCalls = [];
let remoteStatus = 200;

global.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
global.location = new URL('http://127.0.0.1:5173/');
global.window = {
  location: global.location,
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'main', documentWindow: false },
  __TAURI_INTERNALS__: {
    invoke: async (command, arguments_) => {
      nativeCalls.push([command, arguments_]);
      if (command === 'data_query' && arguments_.queryName === 'account') return localUser;
      return null;
    },
    transformCallback: () => 1,
  },
  addEventListener() {},
  dispatchEvent() {},
};
global.Event = class Event { constructor(type) { this.type = type; } };
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true }, configurable: true, writable: true,
});

const credentials = await import('../../shared/credentials.js');
await credentials.hydrateCredential();
const { configureNetworkFetch } = await import('../../shared/connectivity.js');
configureNetworkFetch(async () => new Response(
  remoteStatus === 200 ? JSON.stringify(localUser) : JSON.stringify({ detail: 'Sign in again' }),
  { status: remoteStatus, headers: { 'content-type': 'application/json' } },
));
const { getStartupUser, refreshStartupUser } = await import('../../shared/api/account.js');

test('desktop startup gets its identity from SQLite without a network request', async () => {
  let networkRequests = 0;
  configureNetworkFetch(async () => {
    networkRequests += 1;
    throw new Error('startup must not use the network');
  });

  assert.deepEqual(await getStartupUser(), localUser);
  assert.equal(networkRequests, 0);
  assert.ok(nativeCalls.some(([, arguments_]) => arguments_?.queryName === 'account'));
});

test('rejected background auth keeps the local identity and removes only the credential', async () => {
  remoteStatus = 401;
  configureNetworkFetch(async () => new Response(
    JSON.stringify({ detail: 'Sign in again' }),
    { status: remoteStatus, headers: { 'content-type': 'application/json' } },
  ));

  assert.deepEqual(await refreshStartupUser(localUser), localUser);
  assert.equal(credentials.currentCredential(), null);
  assert.equal(values.get('papol.localAccountUuid'), ACCOUNT);
  assert.deepEqual(await getStartupUser(), localUser);
});
