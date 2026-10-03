import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeHarness } from '../../shared/testing/nativeHarness.js';

// On the Mac the replica is the nook: it holds the user's own boards and
// nothing of a project's (cloudflare/src/sync/write.ts boardReplica). A
// project's board, whoever made it, is read and written through the
// service, as on the web; a board of the nook stays in the replica.
const native = await installNativeHarness();
const {
  addBoardComment, addBoardVideo, addBoardWebpage, deleteBoardItem, fillPageCard, getBoard, moveBoardItem, updateBoard,
} = await import('../../shared/api/boards.js');

const PROJECT_BOARD = '33333333-3333-4333-8333-333333333333';
const NOOK_BOARD = '66666666-6666-4666-8666-666666666666';
const CARD = '44444444-4444-4444-8444-444444444444';
const NOOK_CARD = '55555555-5555-4555-8555-555555555555';

// The replica holds the nook's board and the cards on it, and nothing else.
function replicaHoldsTheNook() {
  native.query('holds_board_row', ({ table, uuid }) => (
    (table === 'boards' && uuid === NOOK_BOARD) || (table === 'board_items' && uuid === NOOK_CARD)
  ));
}

const paths = () => native.requests().map((request) => `${request.method ?? 'GET'} ${new URL(request.url).pathname}`);

test("a project's board is read from the service, with its project and digs", async () => {
  replicaHoldsTheNook();
  native.route(`GET /api/boards/${PROJECT_BOARD}`, {
    json: { uuid: PROJECT_BOARD, name: 'Ideas', project: { uuid: 'p', name: 'Wavefronts' }, digs: {}, items: [], groups: [] },
  });
  const board = await getBoard(PROJECT_BOARD);
  assert.deepEqual(board.project, { uuid: 'p', name: 'Wavefronts' });
  assert.deepEqual(native.argsOf('data_query').map(({ queryName }) => queryName), ['holds_board_row']);
});

test("a project's board and its cards are written through the service, never the replica", async () => {
  replicaHoldsTheNook();
  native.route(`POST /api/boards/${PROJECT_BOARD}/comments`, { json: { uuid: CARD } });
  native.route(`PUT /api/board-items/${CARD}`, { json: { uuid: CARD } });
  native.route(`DELETE /api/board-items/${CARD}`, { status: 204 });
  native.route(`PUT /api/boards/${PROJECT_BOARD}`, { json: { uuid: PROJECT_BOARD } });
  native.route(`POST /api/boards/${PROJECT_BOARD}/webpage`, { json: { job: null, item: { uuid: CARD } } });
  await addBoardComment(PROJECT_BOARD, 'From the Mac', 1, 2);
  await moveBoardItem(CARD, 3, 4);
  await deleteBoardItem(CARD);
  await updateBoard(PROJECT_BOARD, { name: 'Plans' });
  await addBoardWebpage(PROJECT_BOARD, 'https://example.com/', 0, 0);
  assert.deepEqual(native.argsOf('data_mutate'), []);
  assert.deepEqual(native.argsOf('capture_webpage'), [], 'the Cloudflare Worker pictures a page on a project board');
  assert.equal(await fillPageCard({ uuid: CARD, kind: 'webpage', source_url: 'https://example.com/' }), null);
});

test('a Bilibili cover the Mac fetched for a project board is put in the bucket for the card to name', async () => {
  replicaHoldsTheNook();
  native.on('video_page', ({ url }) => ({
    url,
    html: '<meta property="og:title" content="A talk_哔哩哔哩_bilibili"><meta property="og:image" content="https://i0.hdslb.com/cover.jpg">',
  }));
  native.route('https://i0.hdslb.com/cover.jpg', { body: new Uint8Array([0xff, 0xd8, 0xff]), headers: { 'Content-Type': 'image/jpeg' } });
  let stored = null;
  native.route('POST /api/files/upload-address', ({ json }) => {
    stored = json();
    return { json: { stored: true, file_path: stored.sha256 } };
  });
  let card = null;
  native.route(`POST /api/boards/${PROJECT_BOARD}/video`, ({ json }) => {
    card = json();
    return { json: { uuid: CARD } };
  });
  await addBoardVideo(PROJECT_BOARD, 'https://www.bilibili.com/video/BV1xx411c7mD', 5, 6);
  assert.equal(stored.kind, 'board_file');
  assert.equal(card.sha256, stored.sha256);
  assert.equal(card.title, 'A talk');
  assert.deepEqual(native.argsOf('data_mutate'), []);
});

test("the nook's own board stays in the replica", async () => {
  replicaHoldsTheNook();
  await addBoardComment(NOOK_BOARD, 'Offline thought', 1, 2);
  await moveBoardItem(NOOK_CARD, 3, 4);
  assert.deepEqual(paths(), []);
  assert.deepEqual(native.argsOf('data_mutate').map(({ changes }) => changes[0].table), ['board_items', 'board_items']);
});
