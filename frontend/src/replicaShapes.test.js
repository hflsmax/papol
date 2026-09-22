import test from 'node:test';
import assert from 'node:assert/strict';
import apiShapes from '../../schema/api_shapes.json' with { type: 'json' };
import { ACCOUNT, installNativeHarness } from '../../shared/testing/nativeHarness.js';

const native = await installNativeHarness();
const {
  boardView, importNativeSharedPaper, nativeBlobImport, nativeBlobUrl, nativeDataActive,
  nativeRepository, openDroppedPdf, openNativeStorageInFinder,
} = await import('../../shared/nativeData.js');
const { deletePaper, getPaper, updatePaper } = await import('../../shared/api/papers.js');

const PAPER = '1'.repeat(64);
const COPY = '22222222-2222-4222-8222-222222222222';
const queriesNamed = (name) => native.argsOf('data_query').filter(({ queryName }) => queryName === name);
// Whether the user has a link out on the paper is the service's to say,
// and a replica read asks it alongside.
const linkOut = (json = null) => native.route(`GET /api/papers/${PAPER.slice(0, 32)}/sharable`, { json });

test('a paper and its notes are read from the replica together, not one after the other', async () => {
  linkOut();
  const gate = native.gate();
  native.query('paper', async () => { await gate.promise; return { sha256: PAPER, copy_uuid: COPY }; });

  const loading = getPaper(PAPER);
  // The notes are asked for while the paper is still being read.
  await native.until(() => queriesNamed('annotations').length === 1, { what: 'the notes query' });
  assert.equal(queriesNamed('paper').length, 1);
  assert.deepEqual(queriesNamed('annotations')[0].parameters, { paper_sha256: PAPER.slice(0, 32), kind: 'note' });
  gate.open();
  assert.equal((await loading).copy_uuid, COPY);
});

test('a replica paper carries every list the API declares', async () => {
  // The library app trusts the shape the API declares (schema/api_shapes.json),
  // so a paper read from the replica must say what the replica cannot know —
  // nobody else's nook is stored here — as an empty list, not a missing field.
  linkOut();
  native.query('paper', { sha256: PAPER, copy_uuid: COPY });
  const paper = await getPaper(PAPER);
  for (const field of [...apiShapes.views.paper, ...apiShapes.views.paper_list]) {
    assert.ok(Array.isArray(paper[field]), `paper.${field} is a list`);
  }
});

test('a replica paper says which link out the service has on it', async () => {
  linkOut({ uuid: '99999999-9999-4999-8999-999999999999' });
  native.query('paper', { sha256: PAPER, copy_uuid: COPY });
  assert.equal((await getPaper(PAPER)).sharable_uuid, '99999999-9999-4999-8999-999999999999');
});

test('a replica paper opens when the service cannot say whether it has a link out', async () => {
  native.route(`GET /api/papers/${PAPER.slice(0, 32)}/sharable`, { status: 502, body: 'Bad gateway' });
  native.query('paper', { sha256: PAPER, copy_uuid: COPY });
  assert.equal((await getPaper(PAPER)).sharable_uuid, null);
});

test('a replica board carries every list the API declares', () => {
  const board = boardView({ uuid: '33333333-3333-4333-8333-333333333333' }, true);
  for (const field of apiShapes.views.board) {
    assert.ok(Array.isArray(board[field]), `board.${field} is a list`);
  }
});

test('a paper outside this nook is read from the service instead', async () => {
  // The replica's Err string for a paper it does not hold, as the bridge
  // delivers it: a string, not an Error.
  linkOut();
  native.route(`GET /api/papers/${PAPER.slice(0, 32)}`, { json: { sha256: PAPER, title: 'From the Library' } });
  const paper = await getPaper(PAPER);
  assert.equal(paper.title, 'From the Library');
  assert.deepEqual(paper.notes, []);
});

test('a replica failure other than a missing paper is not hidden behind the service', async () => {
  linkOut();
  native.query('paper', () => { throw 'Local database lock failed'; });
  await assert.rejects(getPaper(PAPER), (failure) => failure === 'Local database lock failed');
  assert.ok(!native.requests().some(({ url }) => url.endsWith(`/api/papers/${PAPER.slice(0, 32)}`)));
});

test('desktop native mutations carry the local account into Tauri IPC', async () => {
  assert.equal(nativeDataActive(), true);
  const receipt = await nativeRepository.transact([{
    table: 'boards', uuid: 'f5e4f3f9-a614-40a0-95d0-bad753642e2a',
    operation: 'upsert', values: { name: 'Offline' },
  }]);
  const call = native.lastArgs('data_mutate');
  assert.equal(call.accountUuid, ACCOUNT);
  assert.equal(call.changes[0].values.name, 'Offline');
  // The receipt is the replica's (data/database.rs MutationReceipt).
  assert.deepEqual(Object.keys(receipt).sort(), ['client_uuid', 'local_sequence', 'mutation_uuid', 'rows']);
  assert.equal(receipt.rows[0].name, 'Offline');
});

test('paper edits resolve their local copy without automatically uploading it', async () => {
  const copyUuid = '34343434-3434-4434-8434-343434343434';
  native.query('paper', { sha256: PAPER, copy_uuid: copyUuid });
  await updatePaper(PAPER, { shelf_uuid: null });
  await deletePaper(PAPER);
  const mutations = native.argsOf('data_mutate');
  assert.equal(mutations.length, 2);
  assert.ok(mutations.every(({ changes }) => changes[0].table === 'copies' && changes[0].uuid === copyUuid));
  await native.until(() => native.argsOf('sync_now').length > 0, { what: 'the background sync' });
  assert.ok(native.argsOf('sync_now').every(({ request }) => request.mode === 'pull'));
});

test('the native repository owns query names and parameter shapes', async () => {
  const uuid = 'f5e4f3f9-a614-40a0-95d0-bad753642e2a';
  native.query('board', { uuid });
  await nativeRepository.board(uuid);
  await nativeRepository.annotations(uuid, 'note');

  assert.deepEqual(native.argsOf('data_query').map(({ accountUuid, queryName, parameters }) => ({
    accountUuid, queryName, parameters,
  })), [
    { accountUuid: ACCOUNT, queryName: 'board', parameters: { uuid } },
    { accountUuid: ACCOUNT, queryName: 'annotations', parameters: { paper_sha256: uuid, kind: 'note' } },
  ]);
});

test('every query the repository names is one the Mac answers', async () => {
  // The harness refuses a name lib.rs's LocalDataQuery does not list, as
  // serde does; so a repository query that drifted from it fails here.
  for (const [name, read] of Object.entries(nativeRepository)) {
    if (name === 'transact') continue;
    await read('f5e4f3f9-a614-40a0-95d0-bad753642e2a').catch((failure) => {
      assert.doesNotMatch(String(failure), /unknown variant/, `nativeRepository.${name}`);
    });
  }
});

test('a shared paper and its file can seed an offline nook copy', async () => {
  await importNativeSharedPaper({
    title: 'Shared paper', created_at: '2026-09-14T00:00:00Z',
    file_path: 'shared.pdf', sha256: 'b'.repeat(64),
  });
  const call = native.lastArgs('import_shared_paper');
  assert.equal(call.accountUuid, ACCOUNT);
  // The cached row is named by the file, which is the paper's only name,
  // and makes no revision claim of its own.
  assert.equal(call.row.uuid, undefined);
  assert.equal(call.row.revision, undefined);
  assert.equal(call.row.sha256, 'b'.repeat(64));
  assert.equal(call.row.file_path, 'shared.pdf');
});

test('native blob import transfers exact bytes and metadata', async () => {
  const result = await nativeBlobImport(new Blob([new Uint8Array([0, 1, 2, 255])], { type: 'image/png' }));
  const call = native.lastArgs('blob_import');
  assert.deepEqual([...call.bytes], [0, 1, 2, 255]);
  assert.equal(call.mimeType, 'image/png');
  assert.deepEqual([...native.blobs.get(result.sha256).bytes], [0, 1, 2, 255]);
});

test('a desktop file drop transfers the PDF to the native viewer', async () => {
  await openDroppedPdf(new File(
    [new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])],
    'Local paper.pdf',
    { type: 'application/pdf' },
  ));
  const call = native.lastArgs('opened_file_open');
  assert.equal(call.name, 'Local paper.pdf');
  assert.deepEqual([...call.bytes], [37, 80, 68, 70, 45, 49, 46, 55]);
});

test('opening local storage asks the desktop shell to show it in Finder', async () => {
  await openNativeStorageInFinder();
  assert.deepEqual(native.commandNames(), ['open_storage_in_finder']);
});

test('native blob reads are local-only and never trigger a download', async () => {
  const digest = 'b'.repeat(64);
  await assert.rejects(nativeBlobUrl(digest, 'application/pdf'), (failure) => failure === 'Blob is not available offline');
  assert.deepEqual(native.argsOf('blob_ensure'), []);

  const { sha256 } = native.importBlob([37, 80, 68, 70]);
  assert.match(await nativeBlobUrl(sha256, 'application/pdf'), /^blob:/);
  assert.deepEqual(native.requests(), []);
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
