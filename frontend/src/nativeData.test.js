import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestIndexedDb } from './testIndexedDb.js';

global.indexedDB = createTestIndexedDb();
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true }, configurable: true, writable: true,
});

const values = new Map([
  ['papol.localAccountId', '7'],
  ['papol.syncPreference', 'manual'],
  ['papol_token', 'secret-token'],
]);
const calls = [];
let remoteBlobReady = false;

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
      calls.push([command, arguments_]);
      if (command === 'data_mutate') {
        return { local_sequence: 1, rows: [{ id: arguments_.changes[0].id }] };
      }
      if (command === 'blob_import') {
        return { sha256: 'a'.repeat(64), size: arguments_.bytes.length, mime_type: arguments_.mimeType };
      }
      if (command === 'credential_set') return null;
      if (command === 'blob_ensure') {
        remoteBlobReady = true;
        return null;
      }
      if (command === 'blob_read') {
        if (!remoteBlobReady) throw new Error('Blob is not available offline');
        return [37, 80, 68, 70];
      }
      if (command === 'local_setting_get') return 'manual';
      return null;
    },
    transformCallback: () => 1,
  },
  addEventListener() {},
  dispatchEvent() {},
};
global.Event = class Event { constructor(type) { this.type = type; } };

const credentials = await import('../../shared/credentials.js');
credentials.configureCredentialInvoke(window.__TAURI_INTERNALS__.invoke);
await credentials.hydrateCredential();

const {
  activateNativeAfterLegacyDrain, boardView, hydrateNativeSyncPreference,
  nativeBlobImport, nativeBlobUrl, nativeDataActive, nativeMutate, prepareNativeAccount,
  scheduleAutomaticNativeSync, setNativeAccount,
} = await import('./nativeData.js');
const {
  configureNetworkFetch, offlineFetch, syncOfflineQueue,
} = await import('../../shared/offlineStore.js');

test('native SQLite is authoritative for the local sync preference', async () => {
  values.set('papol.syncPreference', 'automatic');
  assert.equal(await hydrateNativeSyncPreference(), 'manual');
  assert.equal(values.get('papol.syncPreference'), 'manual');
});

test('manual mode never starts background native network traffic', async () => {
  values.set('papol.syncPreference', 'manual');
  const before = calls.filter(([command]) => command === 'sync_now').length;
  assert.equal(await scheduleAutomaticNativeSync(), null);
  assert.equal(calls.filter(([command]) => command === 'sync_now').length, before);
});

test('desktop native mutations carry the local account into Tauri IPC', async () => {
  assert.equal(nativeDataActive(), true);
  await nativeMutate([{
    table: 'boards', id: 'f5e4f3f9-a614-40a0-95d0-bad753642e2a',
    operation: 'upsert', values: { name: 'Offline' },
  }]);
  const call = calls.find(([command]) => command === 'data_mutate');
  assert.equal(call[1].accountId, 7);
  assert.equal(call[1].changes[0].values.name, 'Offline');
});

test('native blob import transfers exact bytes and metadata', async () => {
  const result = await nativeBlobImport(new Blob([new Uint8Array([0, 1, 2, 255])], { type: 'image/png' }));
  assert.equal(result.sha256, 'a'.repeat(64));
  const call = calls.find(([command]) => command === 'blob_import');
  assert.deepEqual([...call[1].bytes], [0, 1, 2, 255]);
  assert.equal(call[1].mimeType, 'image/png');
});

test('a missing synchronized file downloads through the native authenticated cache', async () => {
  remoteBlobReady = false;
  const digest = 'b'.repeat(64);
  const url = await nativeBlobUrl(digest, 'application/pdf');
  assert.match(url, /^blob:/);
  const ensure = calls.find(([command, args]) => command === 'blob_ensure'
    && args.sha256 === digest);
  assert.equal(ensure[1].token, 'secret-token');
  assert.equal(ensure[1].backendUrl, 'http://127.0.0.1:5173');
});

test('native board rows are shaped for the existing board UI without ID remapping', () => {
  const row = boardView({
    id: 'board-uuid', name: 'Local', item_count: 2,
    items: [{ id: 'item-uuid', staged: 0 }],
    staged_items: [{ id: 'staged-uuid', staged: 1 }],
    groups: [{ id: 'group-uuid', auto_arrange: 0, item_ids: ['item-uuid'] }],
  }, true);
  assert.equal(row.guid, 'board-uuid');
  assert.equal(row.items[0].id, 'item-uuid');
  assert.equal(row.staged_items[0].staged, true);
  assert.equal(row.groups[0].auto_arrange, false);
});

test('an upgrade stays on IndexedDB until legacy work drains, then activates SQLite', async () => {
  setNativeAccount(null);
  navigator.onLine = false;
  configureNetworkFetch(async () => { throw new TypeError('offline'); });
  await offlineFetch('https://example.test/api/boards', {
    method: 'POST',
    headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Legacy offline board' }),
  });
  assert.equal(await prepareNativeAccount({ id: 7 }), false);
  assert.equal(nativeDataActive(), false);

  navigator.onLine = true;
  configureNetworkFetch(async () => new Response(JSON.stringify({
    id: 1, guid: '33333333-3333-4333-8333-333333333333', name: 'Legacy offline board',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await syncOfflineQueue();
  assert.equal(await activateNativeAfterLegacyDrain(), true);
  assert.equal(nativeDataActive(), true);
});
