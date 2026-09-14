import test from 'node:test';
import assert from 'node:assert/strict';
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
let syncGate = null;
let queryPaper = null;

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
      if (command === 'data_query' && arguments_.queryName === 'paper' && queryPaper) {
        return queryPaper;
      }
      if (command === 'data_query' && arguments_.queryName === 'shelves') {
        return [{ uuid: '88888888-8888-4888-8888-888888888888', is_default: 1 }];
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
      if (command === 'sync_now' && syncGate) await syncGate.promise;
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
const { configureNetworkFetch, enterOfflineMode, inOfflineMode } = await import('../../shared/connectivity.js');
configureNetworkFetch(async (url, options) => {
  calls.push(['network_fetch', { url: String(url), options }]);
  return new Response(new Blob(['%PDF-1.4\ntest\n%%EOF'], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  });
});

const {
  boardView, hydrateNativeSyncPreference, importNativeSharedPaper,
  isReportableNativeBridgeError,
  nativeBlobImport, nativeBlobUrl, nativeDataActive, nativeRepository, nativeSyncNow,
  nativeSyncInProgress, openDroppedPdf, openNativeStorageInFinder,
  prepareNativeAccount, removeNativeAccount, syncAllNow,
  scheduleAutomaticNativeSync, setNativeAccount,
} = await import('../../shared/nativeData.js');
const {
  addPaperEdition, addToNook, adoptEdition, deletePaper, ignoreEdition, updatePaper,
} = await import('../../shared/api/papers.js');

test('native SQLite is authoritative for the local sync preference', async () => {
  values.set('papol.syncPreference', 'automatic');
  assert.equal(await hydrateNativeSyncPreference(), 'manual');
  assert.equal(values.get('papol.syncPreference'), 'manual');
});

test('native command contract failures are reportable application errors', () => {
  assert.equal(isReportableNativeBridgeError('Command import_shared_paper not allowed by ACL'), true);
  assert.equal(isReportableNativeBridgeError(new Error('Unknown command import_shared_paper')), true);
  assert.equal(isReportableNativeBridgeError(new Error('network unavailable')), false);
});

test('manual mode automatically pulls without uploading local changes', async () => {
  values.set('papol.syncPreference', 'manual');
  await scheduleAutomaticNativeSync();
  const call = calls.findLast(([command]) => command === 'sync_now');
  assert.equal(call[1].request.pullOnly, true);
  assert.equal(call[1].request.pushOnly, false);
});

test('automatic mode permits uploads during background reconciliation', async () => {
  values.set('papol.syncPreference', 'automatic');
  await scheduleAutomaticNativeSync();
  const call = calls.findLast(([command]) => command === 'sync_now');
  assert.equal(call[1].request.pullOnly, false);
  values.set('papol.syncPreference', 'manual');
});

test('a failed native sync announces both start and settled status', async () => {
  dispatchedEvents.length = 0;
  syncFailure = new Error('network unavailable');
  await assert.rejects(nativeSyncNow(), /network unavailable/);
  syncFailure = null;
  assert.deepEqual(dispatchedEvents, [
    'papol-offline-status',
    'papol-offline-status',
    'papol-offline-status',
  ]);

  const syncCalls = calls.filter(([command]) => command === 'sync_now').length;
  await assert.rejects(nativeSyncNow(), { name: 'OnlineRequiredError' });
  assert.equal(calls.filter(([command]) => command === 'sync_now').length, syncCalls);
  assert.equal(await syncAllNow(), null);
  assert.equal(calls.filter(([command]) => command === 'sync_now').length, syncCalls + 1);
});

test('native sync activity is visible to screens mounted during sign-in', async () => {
  let release;
  syncGate = { promise: new Promise((resolve) => { release = resolve; }) };
  const syncing = nativeSyncNow();
  assert.equal(nativeSyncInProgress(), true);
  release();
  await syncing;
  syncGate = null;
  assert.equal(nativeSyncInProgress(), false);
});

test('a successful native sync clears the offline latch', async () => {
  enterOfflineMode();
  await nativeSyncNow({ manual: true });
  assert.equal(inOfflineMode(), false);
  const call = calls.findLast(([command]) => command === 'sync_now');
  assert.equal(call[1].request.retryBlocked, true);
});

test('a server prerequisite uses push-only sync', async () => {
  await nativeSyncNow({ manual: true, pushOnly: true });
  const call = calls.findLast(([command]) => command === 'sync_now');
  assert.equal(call[1].request.pushOnly, true);
  assert.equal(call[1].request.retryBlocked, true);
});

test('desktop native mutations carry the local account into Tauri IPC', async () => {
  assert.equal(nativeDataActive(), true);
  await nativeRepository.transact([{
    table: 'boards', uuid: 'f5e4f3f9-a614-40a0-95d0-bad753642e2a',
    operation: 'upsert', values: { name: 'Offline' },
  }]);
  const call = calls.find(([command]) => command === 'data_mutate');
  assert.equal(call[1].accountUuid, ACCOUNT);
  assert.equal(call[1].changes[0].values.name, 'Offline');
});

test('paper edits resolve their local copy without automatically uploading it', async () => {
  calls.length = 0;
  const paperUuid = '12121212-1212-4212-8212-121212121212';
  const copyUuid = '34343434-3434-4434-8434-343434343434';
  queryPaper = { uuid: paperUuid, copy_uuid: copyUuid, editions: [] };
  await updatePaper(paperUuid, { shelf_uuid: null });
  await deletePaper(paperUuid);
  const mutations = calls.filter(([command]) => command === 'data_mutate');
  assert.equal(mutations.length, 2);
  assert.ok(mutations.every(([, args]) => args.changes[0].uuid === copyUuid));
  const syncs = calls.filter(([command]) => command === 'sync_now');
  assert.ok(syncs.every(([, args]) => args.request.pullOnly === true));
  queryPaper = null;
});

test('edition changes commit locally while background reconciliation remains pull-only', async () => {
  calls.length = 0;
  const paperUuid = '56565656-5656-4656-8656-565656565656';
  const copyUuid = '78787878-7878-4878-8878-787878787878';
  const editionUuid = '90909090-9090-4090-8090-909090909090';
  queryPaper = {
    uuid: paperUuid,
    copy_uuid: copyUuid,
    edition_uuid: editionUuid,
    latest_edition: { uuid: editionUuid, sha256: 'b'.repeat(64) },
    editions: [{ uuid: editionUuid, sha256: 'b'.repeat(64) }],
  };
  await adoptEdition(paperUuid, editionUuid);
  await ignoreEdition(paperUuid, editionUuid);
  await addPaperEdition(paperUuid, new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
  const batches = calls.filter(([command]) => command === 'data_mutate').map(([, args]) => args.changes);
  assert.deepEqual(batches.slice(0, 2).map((changes) => changes[0].table), ['copies', 'copies']);
  assert.deepEqual(batches[2].map((change) => change.table), ['paper_editions', 'copies']);
  const syncs = calls.filter(([command]) => command === 'sync_now');
  assert.ok(syncs.every(([, args]) => args.request.pullOnly === true));
  queryPaper = null;
});

test('the native repository owns query names and parameter shapes', async () => {
  calls.length = 0;
  const uuid = 'f5e4f3f9-a614-40a0-95d0-bad753642e2a';
  await nativeRepository.board(uuid);
  await nativeRepository.comments(uuid);

  const queries = calls.filter(([command]) => command === 'data_query');
  assert.deepEqual(queries.map(([, arguments_]) => ({
    accountUuid: arguments_.accountUuid,
    queryName: arguments_.queryName,
    parameters: arguments_.parameters,
  })), [
    { accountUuid: ACCOUNT, queryName: 'board', parameters: { uuid } },
    { accountUuid: ACCOUNT, queryName: 'comments', parameters: { parent_uuid: uuid } },
  ]);
});

test('a shared paper and all of its editions can seed an offline nook copy', async () => {
  calls.length = 0;
  await importNativeSharedPaper({
    uuid: '11111111-1111-4111-8111-111111111111', title: 'Shared paper',
    created_at: '2026-09-14T00:00:00Z',
    editions: [
      {
        uuid: '22222222-2222-4222-8222-222222222222', file_path: 'first.pdf',
        sha256: 'a'.repeat(64), created_at: '2026-09-13T00:00:00Z',
      },
      {
        uuid: '33333333-3333-4333-8333-333333333333', file_path: 'second.pdf',
        sha256: 'b'.repeat(64), created_at: '2026-09-14T00:00:00Z',
      },
    ],
  });
  const call = calls.find(([command]) => command === 'import_shared_paper');
  assert.equal(call[1].accountUuid, ACCOUNT);
  assert.deepEqual(call[1].rows.map((row) => row.table), [
    'papers', 'paper_editions', 'paper_editions',
  ]);
  assert.equal(call[1].rows[2].paper_uuid, '11111111-1111-4111-8111-111111111111');
  assert.equal(call[1].rows[2].sha256, 'b'.repeat(64));
});

test('native blob import transfers exact bytes and metadata', async () => {
  const result = await nativeBlobImport(new Blob([new Uint8Array([0, 1, 2, 255])], { type: 'image/png' }));
  assert.equal(result.sha256, 'a'.repeat(64));
  const call = calls.find(([command]) => command === 'blob_import');
  assert.deepEqual([...call[1].bytes], [0, 1, 2, 255]);
  assert.equal(call[1].mimeType, 'image/png');
});

test('adding a Library paper directly downloads it without running manual sync', async () => {
  calls.length = 0;
  remoteBlobReady = false;
  const paperUuid = '11111111-1111-4111-8111-111111111111';
  const editionUuid = '22222222-2222-4222-8222-222222222222';
  const digest = 'a'.repeat(64);
  queryPaper = {
    uuid: paperUuid, title: 'Ready to read', file_path: 'ready.pdf', edition_uuid: editionUuid,
    edition_sha256: digest, editions: [{ uuid: editionUuid, sha256: digest }],
  };

  const added = await addToNook({
    ...queryPaper,
    created_at: '2026-09-14T00:00:00Z',
    editions: [{
      uuid: editionUuid, sha256: digest, file_path: 'ready.pdf',
      created_at: '2026-09-14T00:00:00Z',
    }],
  });

  const commands = calls.map(([command]) => command);
  assert.equal(commands.includes('blob_ensure'), false);
  const syncs = calls.filter(([command]) => command === 'sync_now');
  assert.ok(syncs.every(([, args]) => args.request.pullOnly === true));
  assert.ok(commands.indexOf('network_fetch') < commands.indexOf('blob_import'));
  assert.ok(commands.indexOf('blob_import') < commands.indexOf('data_mutate'));
  const download = calls.find(([command]) => command === 'network_fetch')[1];
  assert.match(download.url, /\/uploads\/ready\.pdf$/);
  assert.equal(download.options.headers, undefined);
  assert.equal(added.viewer_has_entry, true);
  queryPaper = null;
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

test('opening local storage asks the desktop shell to show it in Finder', async () => {
  await openNativeStorageInFinder();
  assert.ok(calls.some(([command]) => command === 'open_storage_in_finder'));
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
