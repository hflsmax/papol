import test from 'node:test';
import assert from 'node:assert/strict';
import apiShapes from '../../schema/api_shapes.json' with { type: 'json' };
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
let queryPaperGate = null;
let networkMode = 'pdf';

global.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
global.location = new URL('http://127.0.0.1:5173/');
global.window = {
  location: global.location,
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'desk', documentWindow: false },
  __TAURI_INTERNALS__: {
    invoke: async (command, arguments_) => {
      calls.push([command, arguments_]);
      if (command === 'data_mutate') {
        return { local_sequence: 1, rows: [{ uuid: arguments_.changes[0].uuid }] };
      }
      if (command === 'data_query' && arguments_.queryName === 'paper' && queryPaper) {
        if (queryPaperGate) await queryPaperGate.promise;
        return queryPaper;
      }
      if (command === 'data_query' && arguments_.queryName === 'annotations') return [];
      if (command === 'data_query' && arguments_.queryName === 'shelves') {
        return [{ uuid: '88888888-8888-4888-8888-888888888888', is_default: 1 }];
      }
      if (command === 'blob_import') {
        return { sha256: 'a'.repeat(64), size: arguments_.bytes.length, mime_type: arguments_.mimeType };
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
global.CustomEvent = class CustomEvent extends Event {
  constructor(type, init) { super(type); this.detail = init?.detail; }
};

const credentials = await import('../../shared/credentials.js');
await credentials.hydrateCredential();
const {
  configureNetworkFetch, enterOfflineMode, exitOfflineMode, inOfflineMode,
} = await import('../../shared/connectivity.js');
configureNetworkFetch(async (url, options) => {
  calls.push(['network_fetch', { url: String(url), options }]);
  // The send of a PDF to be read: the bucket holds the bytes already, and
  // the server queues the reading. `refused` is what the Tauri HTTP plugin
  // says of a URL outside its scope.
  if (networkMode === 'refused') throw new Error('url not allowed on the configured scope');
  if (networkMode === 'upload') {
    const answer = String(url).endsWith('/files/upload-address')
      ? { stored: true, file_path: `${'a'.repeat(64)}.pdf` }
      : { job: 'reading-job', file_path: `${'a'.repeat(64)}.pdf`, sha256: 'a'.repeat(64) };
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (networkMode === 'seminar') {
    return new Response(JSON.stringify({ uuid: 'room-uuid', status: 'open' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(new Blob(['%PDF-1.4\ntest\n%%EOF'], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  });
});

const {
  boardView, configureNativeBridge, hydrateNativeSyncPreference, importNativeSharedPaper,
  isNativeSyncResult, isOfflineNativeSyncError, isReportableNativeBridgeError,
  isReportableNativeSyncError,
  nativeBlobImport, nativeBlobUrl, nativeDataActive, nativeRepository, nativeSyncNow,
  nativeSyncInProgress, openDroppedPdf, openNativeStorageInFinder,
  prepareNativeAccount, removeNativeAccount, syncAllNow,
  scheduleAutomaticNativeSync, setNativeAccount, subscribeNativeData,
} = await import('../../shared/nativeData.js');
const {
  announceRoom, callSeminar, finishRoom, joinRoom, leadRoom, leaveRoom,
  postRoomMessage, setRoomAvailability, uncallSeminar, unhostRoom,
} = await import('../../shared/api/rooms.js');
const {
  addToNook, awaitPaperReading, createPaper, deletePaper, getPaper, updatePaper, uploadPaper,
} = await import('../../shared/api/papers.js');
const { addBoardYouTube, fillVideoCard } = await import('../../shared/api/boards.js');

test('paper and comment reads start together', async () => {
  const paperSha256 = '11111111-1111-4111-8111-111111111111';
  queryPaper = { uuid: paperSha256, copy_uuid: '22222222-2222-4222-8222-222222222222' };
  let releasePaper;
  queryPaperGate = {
    promise: new Promise((resolve) => { releasePaper = resolve; }),
  };
  calls.length = 0;

  const loading = getPaper(paperSha256);
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(calls.some(([, args]) => args?.queryName === 'paper'));
  assert.ok(calls.some(([, args]) => args?.queryName === 'annotations'));
  releasePaper();
  await loading;
  queryPaperGate = null;
  queryPaper = null;
});

test('a replica paper carries every list the API declares', async () => {
  // The library app trusts the shape the API declares (schema/api_shapes.json),
  // so a paper read from the replica must say what the replica cannot know —
  // nobody else's nook is stored here — as an empty list, not a missing field.
  const paperSha256 = '11111111-1111-4111-8111-111111111111';
  queryPaper = { uuid: paperSha256, copy_uuid: '22222222-2222-4222-8222-222222222222' };
  const paper = await getPaper(paperSha256);
  queryPaper = null;
  for (const field of [...apiShapes.views.paper, ...apiShapes.views.paper_list]) {
    assert.ok(Array.isArray(paper[field]), `paper.${field} is a list`);
  }
});

test('a replica board carries every list the API declares', () => {
  const board = boardView({ uuid: '33333333-3333-4333-8333-333333333333' }, true);
  for (const field of apiShapes.views.board) {
    assert.ok(Array.isArray(board[field]), `board.${field} is a list`);
  }
});

test('a desktop PDF is kept in the nook and sent to be read, as a web upload is', async () => {
  calls.length = 0;
  networkMode = 'upload';
  let uploaded;
  try {
    uploaded = await uploadPaper(
      new File(['%PDF-1.4\nsent\n%%EOF'], 'sent.pdf', { type: 'application/pdf' }),
      { identifier: { doi: '10.1145/3526113.3545636' } },
    );
  } finally {
    networkMode = 'pdf';
  }
  assert.deepEqual(
    { job: uploaded.job, sha256: uploaded.sha256, sendFailure: uploaded.sendFailure, offline: uploaded.offline },
    { job: 'reading-job', sha256: 'a'.repeat(64), sendFailure: undefined, offline: undefined },
  );
  const kept = calls.findIndex(([command]) => command === 'blob_import');
  const told = calls.findIndex(([command, args]) => command === 'network_fetch' && args.url.endsWith('/papers/uploaded'));
  assert.ok(kept >= 0 && told > kept, 'kept first, then sent');
  assert.deepEqual(JSON.parse(calls[told][1].options.body).identifier, { doi: '10.1145/3526113.3545636' });
});

test('a desktop PDF whose send fails is kept, and says why rather than that it could not be read', async () => {
  networkMode = 'refused';
  let uploaded;
  try {
    uploaded = await uploadPaper(new File(['%PDF-1.4\nrefused\n%%EOF'], 'refused.pdf', { type: 'application/pdf' }));
  } finally {
    networkMode = 'pdf';
  }
  assert.equal(uploaded.sha256, 'a'.repeat(64), 'the nook has it all the same');
  assert.equal(uploaded.job, null);
  assert.match(uploaded.sendFailure.message, /not allowed on the configured scope/);
  assert.equal(await awaitPaperReading(uploaded), null);
});

test('a desktop video card is made with the title and thumbnail the app fetched, or as the link alone', async () => {
  const board = '33333333-3333-4333-8333-333333333333';
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const originalFetch = globalThis.fetch;
  const cardChange = () => calls.findLast(([command]) => command === 'data_mutate')[1].changes[0];
  try {
    // YouTube answers the page itself; the desktop's HTTP plugin is not asked.
    globalThis.fetch = async (asked) => (String(asked).includes('/oembed')
      ? new Response(JSON.stringify({ title: 'Never Gonna', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }))
      : new Response(new Uint8Array([0xff, 0xd8, 0xff])));
    calls.length = 0;
    await addBoardYouTube(board, url, 10, 20);
    assert.ok(!calls.some(([command]) => command === 'network_fetch'));
    assert.equal(calls.find(([command]) => command === 'blob_import')[1].mimeType, 'image/jpeg');
    assert.deepEqual(cardChange().values, {
      board_uuid: board, kind: 'youtube', content: 'Never Gonna', source_url: url, x: 10, y: 20,
      sha256: 'a'.repeat(64), original_filename: 'youtube-dQw4w9WgXcQ.jpg', mime_type: 'image/jpeg',
    });

    // Offline, or YouTube unreachable: the card is the link, and the error says why.
    globalThis.fetch = async () => { throw new TypeError('Load failed'); };
    calls.length = 0;
    await assert.rejects(addBoardYouTube(board, url, 10, 20), (error) => {
      assert.match(error.message, /could not be fetched: Load failed/);
      assert.ok(error.item);
      return true;
    });
    assert.ok(!calls.some(([command]) => command === 'blob_import'));
    assert.deepEqual(cardChange().values, { board_uuid: board, kind: 'youtube', content: url, source_url: url, x: 10, y: 20 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('offline, a desktop video card is the link, and the board fills it once online', async () => {
  const board = '33333333-3333-4333-8333-333333333333';
  const url = 'https://youtu.be/dQw4w9WgXcQ';
  const originalFetch = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async (target) => {
    asked += 1;
    return String(target).includes('/oembed')
      ? new Response(JSON.stringify({ title: 'Never Gonna', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }))
      : new Response(new Uint8Array([0xff, 0xd8, 0xff]));
  };
  const lastValues = () => calls.findLast(([command]) => command === 'data_mutate')[1].changes[0].values;
  try {
    enterOfflineMode();
    calls.length = 0;
    // No attempt and no error: the card is the link, and says so on the board.
    await addBoardYouTube(board, url, 0, 0);
    assert.equal(asked, 0);
    assert.deepEqual(lastValues(), { board_uuid: board, kind: 'youtube', content: url, source_url: url, x: 0, y: 0 });
    const card = { uuid: '44444444-4444-4444-8444-444444444444', kind: 'youtube', content: url, source_url: url };
    assert.equal(await fillVideoCard(card), null, 'still offline: nothing is tried');
    assert.equal(asked, 0);

    exitOfflineMode();
    calls.length = 0;
    await fillVideoCard(card);
    assert.deepEqual(lastValues(), {
      sha256: 'a'.repeat(64), original_filename: 'youtube-dQw4w9WgXcQ.jpg', mime_type: 'image/jpeg', content: 'Never Gonna',
    });
    // A description written meanwhile stands; only the thumbnail is added.
    await fillVideoCard({ ...card, content: 'Watch the ending' });
    assert.equal(lastValues().content, undefined);
    // A card that has its thumbnail, or names no video, is left alone.
    assert.equal(await fillVideoCard({ ...card, sha256: 'b'.repeat(64) }), null);
    assert.equal(await fillVideoCard({ ...card, source_url: 'https://example.com/' }), null);
  } finally {
    exitOfflineMode();
    globalThis.fetch = originalFetch;
  }
});

test('a PDF added offline is named by its file, and its first thought is a note', async () => {
  // A paper is its PDF on this side of the wire too. Naming the row anything
  // else is refused by the replica before it is refused by the service, so
  // the import simply never lands.
  const digest = 'a'.repeat(64);
  enterOfflineMode();
  calls.length = 0;
  let extracted;
  try {
    extracted = await uploadPaper(
      new File(['%PDF-1.4\noffline\n%%EOF'], 'offline.pdf', { type: 'application/pdf' }),
    );
  } finally {
    exitOfflineMode();
  }
  assert.equal(extracted.sha256, digest);
  assert.equal(extracted.offline, true);
  assert.equal(extracted.job, null, 'offline, it is not sent to be read');
  assert.ok(!calls.some(([command]) => command === 'network_fetch'));
  assert.equal(await awaitPaperReading(extracted), null, 'and there is no reading to wait for');

  queryPaper = { uuid: digest, sha256: digest };
  calls.length = 0;
  await createPaper({
    ...extracted, title: 'Added while offline',
    shelf_uuid: '88888888-8888-4888-8888-888888888888',
    initial_comment: 'Worth a second read',
  });
  queryPaper = null;

  const [, mutation] = calls.find(([command]) => command === 'data_mutate');
  const byTable = Object.fromEntries(
    mutation.changes.map((change) => [change.table, change]),
  );
  assert.equal(byTable.papers.uuid, digest, 'the paper is named by its file');
  assert.equal(byTable.copies.values.paper_sha256, digest);
  // Notes, ink and clips are one table; `comments` is not synchronized at all.
  assert.equal(byTable.comments, undefined);
  assert.equal(byTable.annotations.values.kind, 'note');
  assert.equal(byTable.annotations.values.paper_sha256, digest);
  assert.equal(byTable.annotations.values.content, 'Worth a second read');
});

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

test('sync failures distinguish connectivity from reportable local defects', async () => {
  assert.equal(isOfflineNativeSyncError(new Error('error sending request: connection refused')), true);
  assert.equal(isOfflineNativeSyncError(new Error('UNIQUE constraint failed')), false);
  assert.equal(isReportableNativeSyncError(new Error('Applying pushed rows failed: UNIQUE constraint failed')), true);

  dispatchedEvents.length = 0;
  syncFailure = new Error('Applying pushed rows failed: UNIQUE constraint failed');
  await assert.rejects(nativeSyncNow(), /UNIQUE constraint failed/);
  syncFailure = null;
  assert.equal(inOfflineMode(), false);
  assert.deepEqual(dispatchedEvents, [
    'papol-offline-status',
    'papol-offline-status',
    'papol-reportable-native-error',
    'papol-offline-status',
  ]);
});

test('manual mode automatically pulls without uploading local changes', async () => {
  values.set('papol.syncPreference', 'manual');
  await scheduleAutomaticNativeSync();
  const call = calls.findLast(([command]) => command === 'sync_now');
  assert.equal(call[1].request.mode, 'pull');
});

test('automatic mode permits uploads during background reconciliation', async () => {
  values.set('papol.syncPreference', 'automatic');
  await scheduleAutomaticNativeSync();
  const call = calls.findLast(([command]) => command === 'sync_now');
  assert.equal(call[1].request.mode, 'full');
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
  await nativeSyncNow({ manual: true, mode: 'push' });
  const call = calls.findLast(([command]) => command === 'sync_now');
  assert.equal(call[1].request.mode, 'push');
  assert.equal(call[1].request.retryBlocked, true);
});

test('successful uplink and downlink results both identify completed syncs', () => {
  assert.equal(isNativeSyncResult({ pushed: 2, pulled: 0, cursor: 4 }), true);
  assert.equal(isNativeSyncResult({ pushed: 0, pulled: 3, cursor: 7 }), true);
  assert.equal(isNativeSyncResult({ syncing: false }), false);
  assert.equal(isNativeSyncResult({ error: 'network unavailable' }), false);
});

test('every seminar mutation syncs desktop prerequisites up and reconciles down', async () => {
  calls.length = 0;
  networkMode = 'seminar';
  const actions = [
    ['/api/papers/paper-uuid/room', 'POST', () => callSeminar('paper-uuid')],
    ['/api/rooms/room-uuid/lead', 'POST', () => leadRoom('room-uuid')],
    ['/api/rooms/room-uuid/join', 'POST', () => joinRoom('room-uuid')],
    ['/api/rooms/room-uuid/unhost', 'POST', () => unhostRoom('room-uuid')],
    ['/api/rooms/room-uuid/uncall', 'POST', () => uncallSeminar('room-uuid')],
    ['/api/rooms/room-uuid/leave', 'POST', () => leaveRoom('room-uuid')],
    ['/api/rooms/room-uuid/messages', 'POST', () => postRoomMessage('room-uuid', 'Hello')],
    ['/api/rooms/room-uuid/availability', 'POST', () => setRoomAvailability('room-uuid', 'Friday')],
    ['/api/rooms/room-uuid/announce', 'PUT', () => announceRoom(
      'room-uuid', 'Friday at 16:00', 'Room 2.13', 'discussion',
    )],
    ['/api/rooms/room-uuid/finish', 'POST', () => finishRoom('room-uuid')],
  ];
  try {
    for (const [, , run] of actions) {
      await run();
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    networkMode = 'pdf';
  }

  const syncs = calls.filter(([command]) => command === 'sync_now');
  const syncDirections = syncs.map(([, args]) => args.request.mode);
  assert.equal(syncDirections.length, actions.length * 2);
  for (let index = 0; index < syncDirections.length; index += 2) {
    assert.deepEqual(syncDirections.slice(index, index + 2), ['push', 'full']);
  }
  assert.deepEqual(
    calls.filter(([command]) => command === 'network_fetch')
      .map(([, args]) => [new URL(args.url, global.location).pathname, args.options.method]),
    actions.map(([path, method]) => [path, method]),
  );
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
  const paperSha256 = '12121212-1212-4212-8212-121212121212';
  const copyUuid = '34343434-3434-4434-8434-343434343434';
  queryPaper = { uuid: paperSha256, copy_uuid: copyUuid };
  await updatePaper(paperSha256, { shelf_uuid: null });
  await deletePaper(paperSha256);
  const mutations = calls.filter(([command]) => command === 'data_mutate');
  assert.equal(mutations.length, 2);
  assert.ok(mutations.every(([, args]) => args.changes[0].uuid === copyUuid));
  const syncs = calls.filter(([command]) => command === 'sync_now');
  assert.ok(syncs.every(([, args]) => args.request.mode === 'pull'));
  queryPaper = null;
});

test('the native repository owns query names and parameter shapes', async () => {
  calls.length = 0;
  const uuid = 'f5e4f3f9-a614-40a0-95d0-bad753642e2a';
  await nativeRepository.board(uuid);
  await nativeRepository.annotations(uuid, 'note');

  const queries = calls.filter(([command]) => command === 'data_query');
  assert.deepEqual(queries.map(([, arguments_]) => ({
    accountUuid: arguments_.accountUuid,
    queryName: arguments_.queryName,
    parameters: arguments_.parameters,
  })), [
    { accountUuid: ACCOUNT, queryName: 'board', parameters: { uuid } },
    {
      accountUuid: ACCOUNT,
      queryName: 'annotations',
      parameters: { paper_sha256: uuid, kind: 'note' },
    },
  ]);
});

test('a shared paper and its file can seed an offline nook copy', async () => {
  calls.length = 0;
  await importNativeSharedPaper({
    title: 'Shared paper', created_at: '2026-09-14T00:00:00Z',
    file_path: 'shared.pdf', sha256: 'b'.repeat(64),
  });
  const call = calls.find(([command]) => command === 'import_shared_paper');
  assert.equal(call[1].accountUuid, ACCOUNT);
  // The cached row is named by the file, which is the paper's only name,
  // and makes no revision claim of its own.
  assert.equal(call[1].row.uuid, undefined);
  assert.equal(call[1].row.revision, undefined);
  assert.equal(call[1].row.sha256, 'b'.repeat(64));
  assert.equal(call[1].row.file_path, 'shared.pdf');
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
  const paperSha256 = '11111111-1111-4111-8111-111111111111';
  const digest = 'a'.repeat(64);
  queryPaper = {
    uuid: paperSha256, title: 'Ready to read', file_path: 'ready.pdf', sha256: digest,
    copy_uuid: '33333333-3333-4333-8333-333333333333',
  };

  const added = await addToNook({
    ...queryPaper,
    created_at: '2026-09-14T00:00:00Z',
  });

  const commands = calls.map(([command]) => command);
  const syncs = calls.filter(([command]) => command === 'sync_now');
  assert.ok(syncs.every(([, args]) => args.request.mode === 'pull'));
  assert.ok(commands.indexOf('network_fetch') < commands.indexOf('blob_import'));
  assert.ok(commands.indexOf('blob_import') < commands.indexOf('data_mutate'));
  const download = calls.find(([command]) => command === 'network_fetch')[1];
  assert.match(download.url, /\/uploads\/ready\.pdf$/);
  assert.equal(download.options.headers, undefined);
  assert.ok(added.copy_uuid);
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
  await assert.rejects(nativeBlobUrl(digest, 'application/pdf'), /not available offline/);

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

test('native event cleanup retries Tauri registration races', async () => {
  const stopAttempts = new Map();
  let listenerCount = 0;
  configureNativeBridge({
    invoke: async () => null,
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
  await Promise.resolve();
  unsubscribe();
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const subscriberAttempts = [...stopAttempts.values()];
  assert.deepEqual(subscriberAttempts, [2, 2, 2]);
});
