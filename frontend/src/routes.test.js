import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute } from './routes.js';
import { paperName } from '../../shared/paperName.js';

// The names a link can carry. A paper is its file, so a paper link carries the
// digest of that file — the first half of it, which is the size of the UUID
// users and rooms carry.
const DIGEST = '5cf24221f8fa36824ddd1178cbfb5cf36d0dcfcf335c8de87826c4082b70cbf1';
const NAME = paperName(DIGEST);
const UUID = '2f1c6f60-3f5b-4a19-9c2a-7d0e1b8c4a53';

test('a paper is named in a link the way a user is: 32 characters', () => {
  assert.equal(NAME.length, UUID.replaceAll('-', '').length);
  assert.equal(NAME, '5cf24221f8fa36824ddd1178cbfb5cf3');
});

test('a paper link opens that paper', () => {
  assert.deepEqual(parseRoute(`/paper/${NAME}`), { page: 'paper', uuid: NAME });
  assert.deepEqual(parseRoute(`/paper/${NAME}/`), { page: 'paper', uuid: NAME });
  assert.deepEqual(
    parseRoute(`/paper/${NAME.toUpperCase()}`),
    { page: 'paper', uuid: NAME },
  );
});

// The whole digest is not a name. Papol has no readers holding old links to
// keep working, and one shape costs less to hold in the head than two.
test('a link carrying the whole digest is not a paper link', () => {
  assert.equal(parseRoute(`/paper/${DIGEST}`).page, 'home');
});

test('a paper link opens that paper in the demo', () => {
  assert.deepEqual(
    parseRoute(`/demo/paper/${NAME}`),
    { page: 'paper', uuid: NAME, demo: true },
  );
});

test('a user link opens their space', () => {
  assert.deepEqual(parseRoute(`/u/${UUID}`), { page: 'nook', uuid: UUID });
  assert.deepEqual(
    parseRoute(`/u/${UUID}/boards`),
    { page: 'nook', uuid: UUID, section: 'boards' },
  );
});

test('a room link opens that room', () => {
  assert.deepEqual(parseRoute(`/room/${UUID}`), { page: 'room', uuid: UUID });
});

test('every standing page is reachable by its path', () => {
  const pages = {
    '/': 'home',
    '/profile': 'profile',
    '/join': 'join',
    '/about': 'about',
    '/learn': 'learn',
    '/signin': 'signin',
    '/library': 'papers',
    '/inbox': 'inbox',
    '/admin': 'admin',
    '/demo': 'home',
  };
  for (const [path, page] of Object.entries(pages)) {
    assert.equal(parseRoute(path).page, page, `${path} should open ${page}`);
  }
});

// A name of the wrong shape is not a page. Landing on the home page for a
// link that was meant for a paper is how a good link goes quietly dead.
// Half a name is not a shorter name, it is a different one. One length is
// written and one is read; anything else is refused rather than resolved to
// whichever paper happens to start that way.
test('a name of the wrong shape is not a paper', () => {
  const wrong = [
    UUID,
    NAME.slice(0, 31), `${NAME}f`, DIGEST.slice(0, 48),
    DIGEST, `${DIGEST}f`,
    'new-paper', '',
  ];
  for (const name of wrong) {
    assert.equal(parseRoute(`/paper/${name}`).page, 'home', `/paper/${name}`);
  }
});

test('a paper name is not a user and not a room', () => {
  for (const name of [NAME, DIGEST]) {
    assert.equal(parseRoute(`/u/${name}`).page, 'home');
    assert.equal(parseRoute(`/room/${name}`).page, 'home');
  }
});

test("a board link opens that board's jacket, not its canvas", () => {
  // Singular, as a paper's is. The plural `/boards/<uuid>` belongs to the
  // board application — the canvas — which this router never sees.
  assert.deepEqual(parseRoute(`/board/${UUID}`), { page: 'board', uuid: UUID });
  assert.deepEqual(parseRoute(`/board/${UUID}/`), { page: 'board', uuid: UUID });
  assert.deepEqual(parseRoute(`/demo/board/${UUID}`), { page: 'board', uuid: UUID, demo: true });
});
