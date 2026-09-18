import test from 'node:test';
import assert from 'node:assert/strict';

const ACCOUNT = '77777777-7777-4777-8777-777777777777';
const localUser = { uuid: ACCOUNT, display_name: 'Local User' };
let localProfile = localUser;
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
      if (command === 'data_query' && arguments_.queryName === 'account') return localProfile;
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
const { getMe, getStartupUser, refreshStartupUser } = await import('../../shared/api/account.js');

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

test('a replica without the profile forgets the remembered account, and signing in online writes it back', async () => {
  // A newer build discarded the replica an older build wrote; the profile
  // stored at sign-in went with it, but the browser's memory of the account
  // did not.
  localProfile = null;
  remoteStatus = 200;
  configureNetworkFetch(async () => new Response(
    JSON.stringify(localUser), { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  await credentials.storeCredential('still-valid-token');
  nativeCalls.length = 0;

  assert.equal(await getStartupUser(), null);
  assert.equal(values.get('papol.localAccountUuid'), undefined);
  assert.ok(!nativeCalls.some(([command]) => command === 'local_account_set'));

  assert.deepEqual(await getMe(), localUser);
  const written = nativeCalls.find(([command]) => command === 'local_account_set');
  assert.deepEqual(written?.[1], { accountUuid: ACCOUNT, profile: localUser });
  assert.equal(values.get('papol.localAccountUuid'), ACCOUNT);
});
