import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeHarness } from '../../shared/testing/nativeHarness.js';

const native = await installNativeHarness();
const { enterOfflineMode, exitOfflineMode } = await import('../../shared/connectivity.js');
const {
  addBoardVideo, addBoardWebpage, fillPageCard, fillVideoCard,
} = await import('../../shared/api/boards.js');

const BOARD = '33333333-3333-4333-8333-333333333333';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);
const cardValues = () => native.lastArgs('data_mutate').changes[0].values;

// YouTube answers the page itself: oEmbed for the title, ytimg for the
// thumbnail. The desktop's HTTP plugin is not asked.
function youtubeAnswers() {
  let asked = 0;
  native.route('GET https://www.youtube.com/oembed', () => {
    asked += 1;
    return { json: { title: 'Never Gonna', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' } };
  });
  native.route('GET https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', () => { asked += 1; return { body: JPEG }; });
  return { get asked() { return asked; } };
}

test('a desktop video card is made with the title and thumbnail the app fetched', async () => {
  youtubeAnswers();
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  await addBoardVideo(BOARD, url, 10, 20);
  assert.deepEqual(native.requests('plugin'), []);
  assert.equal(native.lastArgs('blob_import').mimeType, 'image/jpeg');
  const values = cardValues();
  assert.deepEqual(
    { ...values, sha256: undefined },
    {
      board_uuid: BOARD, kind: 'youtube', content: 'Never Gonna', source_url: url, x: 10, y: 20,
      sha256: undefined, original_filename: 'youtube-dQw4w9WgXcQ.jpg', mime_type: 'image/jpeg',
    },
  );
  assert.ok(native.blobs.has(values.sha256), 'the card names the thumbnail the nook holds');
});

test('a desktop video card whose site cannot be reached is the link, and the error says why', async () => {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  native.route(/youtube\.com/, () => { throw new TypeError('Load failed'); });
  await assert.rejects(addBoardVideo(BOARD, url, 10, 20), (error) => {
    assert.match(error.message, /could not be fetched: Load failed/);
    assert.equal(error.item.source_url, url, 'the card that was made rides on the error');
    return true;
  });
  assert.deepEqual(native.argsOf('blob_import'), []);
  assert.deepEqual(cardValues(), { board_uuid: BOARD, kind: 'youtube', content: url, source_url: url, x: 10, y: 20 });
});

test('a video card the replica refuses leaves no thumbnail behind', async () => {
  youtubeAnswers();
  native.on('data_mutate', () => { throw 'Local database lock failed'; });
  await assert.rejects(
    addBoardVideo(BOARD, 'https://youtu.be/dQw4w9WgXcQ', 0, 0),
    (failure) => failure === 'Local database lock failed',
  );
  assert.equal(native.argsOf('blob_discard').length, 1, 'the thumbnail it kept is let go');
  assert.equal(native.blobs.size, 0);
});

test('a desktop Bilibili card asks the application for the mobile page, and takes its title and cover', async () => {
  const url = 'https://b23.tv/AbC123';
  // Bilibili answers a phone, and no page may say it is one: the browser
  // refuses to send a User-Agent, and the HTTP plugin drops the header
  // without a word. So the application fetches the page (videos.rs) and
  // says where the short link landed.
  native.on('video_page', ({ url: asked }) => ({
    url: 'https://m.bilibili.com/video/BV11kev6cEhk',
    html: '<html><head><meta property="og:title" content="正视_哔哩哔哩_bilibili"/>'
      + `<meta property="og:image" content="https://i1.hdslb.com/bfs/archive/cover.jpg@1200w_630h"/><link rel="canonical" href="${asked}"/></head></html>`,
  }));
  native.route('GET https://i1.hdslb.com/bfs/archive/cover.jpg', { body: JPEG });

  await addBoardVideo(BOARD, url, 5, 6);

  assert.deepEqual(native.argsOf('video_page'), [{ url }], 'the short link goes to the application, unfollowed');
  assert.deepEqual(native.requests('plugin'), [], 'and never to the plugin, which cannot ask as a phone');
  const [cover] = native.requests('webview');
  assert.equal(cover.url, 'https://i1.hdslb.com/bfs/archive/cover.jpg');
  assert.equal(cover.options.referrerPolicy, 'no-referrer');
  const values = cardValues();
  assert.equal(values.kind, 'bilibili');
  assert.equal(values.content, '正视');
  assert.equal(values.source_url, url);
  assert.equal(values.original_filename, 'bilibili-BV11kev6cEhk.jpg', 'named by the video the link landed on');
  assert.ok(native.blobs.has(values.sha256));
});

test('a desktop page card is made with the picture the Mac took', async () => {
  const url = 'https://flexible.seas.ucla.edu/';
  await addBoardWebpage(BOARD, url, 1, 2);
  assert.deepEqual(native.lastArgs('capture_webpage'), { url });
  assert.deepEqual(native.requests(), [], 'no Worker: nothing leaves for Papol');
  const values = cardValues();
  assert.equal(values.kind, 'webpage');
  assert.equal(values.content, 'flexible.seas.ucla.edu');
  assert.equal(values.width, 480);
  assert.equal(values.original_filename, 'webpage-flexible.seas.ucla.edu.jpg');
  assert.ok(native.blobs.has(values.sha256));
});

test('a page the Mac could not load is a link card, and the error says why', async () => {
  const url = 'https://flexible.seas.ucla.edu/';
  // The capture's Err string, as the bridge delivers it.
  native.on('capture_webpage', () => { throw 'The page took too long to load'; });
  await assert.rejects(addBoardWebpage(BOARD, url, 1, 2), (error) => {
    assert.match(error.message, /picture could not be taken: The page took too long to load/);
    assert.equal(error.item.source_url, url);
    return true;
  });
  assert.equal(cardValues().sha256, undefined);
});

test('a page card made offline is the link, and the board fills it once online', async () => {
  const url = 'https://flexible.seas.ucla.edu/';
  enterOfflineMode();
  // Offline: nothing is tried, and nothing is wrong.
  await addBoardWebpage(BOARD, url, 1, 2);
  assert.deepEqual(native.argsOf('capture_webpage'), []);
  const card = { uuid: '55555555-5555-4555-8555-555555555555', kind: 'webpage', content: 'flexible.seas.ucla.edu', source_url: url };
  assert.equal(await fillPageCard(card), null, 'still offline');

  exitOfflineMode();
  await fillPageCard(card);
  const values = cardValues();
  assert.deepEqual(Object.keys(values).sort(), ['mime_type', 'original_filename', 'sha256']);
  assert.ok(native.blobs.has(values.sha256));
  assert.equal(await fillPageCard({ ...card, sha256: 'd'.repeat(64) }), null, 'a card with its picture is left alone');
});

test('a page picture the replica will not attach is let go', async () => {
  const card = { uuid: '55555555-5555-4555-8555-555555555555', kind: 'webpage', source_url: 'https://example.com/' };
  native.on('data_mutate', () => { throw 'Local database lock failed'; });
  await assert.rejects(fillPageCard(card), (failure) => failure === 'Local database lock failed');
  assert.equal(native.blobs.size, 0);
});

test('offline, a desktop video card is the link, and the board fills it once online', async () => {
  const youtube = youtubeAnswers();
  const url = 'https://youtu.be/dQw4w9WgXcQ';
  enterOfflineMode();
  // No attempt and no error: the card is the link, and says so on the board.
  await addBoardVideo(BOARD, url, 0, 0);
  assert.equal(youtube.asked, 0);
  assert.deepEqual(cardValues(), { board_uuid: BOARD, kind: 'youtube', content: url, source_url: url, x: 0, y: 0 });
  const card = { uuid: '44444444-4444-4444-8444-444444444444', kind: 'youtube', content: url, source_url: url };
  assert.equal(await fillVideoCard(card), null, 'still offline: nothing is tried');
  assert.equal(youtube.asked, 0);

  exitOfflineMode();
  await fillVideoCard(card);
  assert.equal(cardValues().content, 'Never Gonna', 'the bare link gives way to the title');
  assert.equal(cardValues().original_filename, 'youtube-dQw4w9WgXcQ.jpg');
  // A description written meanwhile stands; only the thumbnail is added.
  await fillVideoCard({ ...card, content: 'Watch the ending' });
  assert.equal(cardValues().content, undefined);
  // A card that has its thumbnail, or names no video, is left alone.
  assert.equal(await fillVideoCard({ ...card, sha256: 'b'.repeat(64) }), null);
  assert.equal(await fillVideoCard({ ...card, source_url: 'https://example.com/' }), null);
});
