import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestIndexedDb } from './testIndexedDb.js';

global.indexedDB = createTestIndexedDb();
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true }, configurable: true, writable: true,
});

const ACCOUNT = '77777777-7777-4777-8777-777777777777';
const values = new Map([
  ['papol.localAccountUuid', ACCOUNT],
  ['papol.syncPreference', 'manual'],
  ['papol_token', 'secret-token'],
]);
const calls = [];
const dispatchedEvents = [];
let remoteBlobReady = false;
let syncFailure = null;

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
        return { local_sequence: 1, rows: [{ uuid: arguments_.changes[0].uuid }] };
      }
      if (command === 'blob_import') {
        return { sha256: 'a'.repeat(64), size: arguments_.bytes.length, mime_type: arguments_.mimeType };
      }
      if (command === 'blob_ensure') {
        remoteBlobReady = true;
        return null;
      }
      if (command === 'blob_read') {
        if (!remoteBlobReady) throw new Error('Blob is not available offline');
        return [37, 80, 68, 70];
      }
      if (command === 'local_setting_get') return 'manual';
      if (command === 'local_account_remove') return 2;
      if (command === 'sync_now' && syncFailure) throw syncFailure;
      return null;
    },
    transformCallback: () => 1,
  },
  addEventListener() {},
  dispatchEvent(event) { dispatchedEvents.push(event.type); },
};
global.Event = class Event { constructor(type) { this.type = type; } };

const credentials = await import('../../shared/credentials.js');
await credentials.hydrateCredential();

const {
  boardView, hydrateNativeSyncPreference,
  nativeBlobImport, nativeBlobUrl, nativeDataActive, nativeMutate, nativeSyncNow,
  openDroppedPdf, prepareNativeAccount, removeNativeAccount,
  scheduleAutomaticNativeSync, setNativeAccount,
} = await import('./nativeData.js');

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

test('a failed native sync still refreshes offline status', async () => {
  dispatchedEvents.length = 0;
  syncFailure = new Error('network unavailable');
  await assert.rejects(nativeSyncNow(), /network unavailable/);
  syncFailure = null;
  assert.deepEqual(dispatchedEvents, ['papol-offline-status']);
});

test('desktop native mutations carry the local account into Tauri IPC', async () => {
  assert.equal(nativeDataActive(), true);
  await nativeMutate([{
    table: 'boards', uuid: 'f5e4f3f9-a614-40a0-95d0-bad753642e2a',
    operation: 'upsert', values: { name: 'Offline' },
  }]);
  const call = calls.find(([command]) => command === 'data_mutate');
  assert.equal(call[1].accountUuid, ACCOUNT);
  assert.equal(call[1].changes[0].values.name, 'Offline');
});

test('native blob import transfers exact bytes and metadata', async () => {
  const result = await nativeBlobImport(new Blob([new Uint8Array([0, 1, 2, 255])], { type: 'image/png' }));
  assert.equal(result.sha256, 'a'.repeat(64));
  const call = calls.find(([command]) => command === 'blob_import');
  assert.deepEqual([...call[1].bytes], [0, 1, 2, 255]);
  assert.equal(call[1].mimeType, 'image/png');
});

test('a desktop file drop transfers the PDF to the native viewer', async () => {
  await openDroppedPdf(new File(
    [new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])],
    'Local paper.pdf',
    { type: 'application/pdf' },
  ));
  const call = calls.find(([command]) => command === 'opened_file_open');
  assert.equal(call[1].name, 'Local paper.pdf');
  assert.deepEqual([...call[1].bytes], [37, 80, 68, 70, 45, 49, 46, 55]);
});

test('native blob reads are local-only and never trigger a download', async () => {
  remoteBlobReady = false;
  const digest = 'b'.repeat(64);
  const ensuresBefore = calls.filter(([command]) => command === 'blob_ensure').length;
  await assert.rejects(nativeBlobUrl(digest, 'application/pdf'), /not available offline/);
  assert.equal(calls.filter(([command]) => command === 'blob_ensure').length, ensuresBefore);

  remoteBlobReady = true;
  const url = await nativeBlobUrl(digest, 'application/pdf');
  assert.match(url, /^blob:/);
});

test('native board rows are shaped for the existing board UI without ID remapping', () => {
  const row = boardView({
    uuid: 'board-uuid', name: 'Local', item_count: 2,
    items: [{ uuid: 'item-uuid', staged: 0 }],
    staged_items: [{ uuid: 'staged-uuid', staged: 1 }],
    groups: [{ uuid: 'group-uuid', auto_arrange: 0, item_uuids: ['item-uuid'] }],
  }, true);
  assert.equal(row.uuid, 'board-uuid');
  assert.equal(row.items[0].uuid, 'item-uuid');
  assert.equal(row.staged_items[0].staged, true);
  assert.equal(row.groups[0].auto_arrange, false);
});

test('signing in activates the native replica for that account', async () => {
  setNativeAccount(null);
  assert.equal(nativeDataActive(), false);
  assert.equal(await prepareNativeAccount({ uuid: ACCOUNT }), true);
  assert.equal(nativeDataActive(), true);
});

test('sign-out removes only the active native account replica', async () => {
  dispatchedEvents.length = 0;
  assert.equal(await removeNativeAccount(ACCOUNT), 2);
  const call = calls.find(([command]) => command === 'local_account_remove');
  assert.deepEqual(call[1], { accountUuid: ACCOUNT });
  assert.deepEqual(dispatchedEvents, ['papol-offline-status']);
});
