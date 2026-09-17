import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute } from './routes.js';

// The names a link can carry. A paper is its file, so a paper link carries
// the digest of that file; users and rooms carry a UUID.
const DIGEST = '5cf24221f8fa36824ddd1178cbfb5cf36d0dcfcf335c8de87826c4082b70cbf1';
const UUID = '2f1c6f60-3f5b-4a19-9c2a-7d0e1b8c4a53';

test('a paper link opens that paper', () => {
  assert.deepEqual(parseRoute(`/paper/${DIGEST}`), { page: 'paper', uuid: DIGEST });
  assert.deepEqual(parseRoute(`/paper/${DIGEST}/`), { page: 'paper', uuid: DIGEST });
  assert.deepEqual(
    parseRoute(`/paper/${DIGEST.toUpperCase()}`),
    { page: 'paper', uuid: DIGEST },
  );
});

test('a paper link opens that paper in the demo', () => {
  assert.deepEqual(
    parseRoute(`/demo/paper/${DIGEST}`),
    { page: 'paper', uuid: DIGEST, demo: true },
  );
});

test('a user link opens their space', () => {
  assert.deepEqual(parseRoute(`/u/${UUID}`), { page: 'space', uuid: UUID });
  assert.deepEqual(
    parseRoute(`/u/${UUID}/boards`),
    { page: 'space', uuid: UUID, section: 'boards' },
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
    '/papers': 'papers',
    '/village': 'papers',
    '/users': 'papers',
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
test('a name of the wrong shape is not a paper', () => {
  for (const name of [UUID, DIGEST.slice(0, 63), `${DIGEST}f`, 'new-paper', '']) {
    assert.equal(parseRoute(`/paper/${name}`).page, 'home', `/paper/${name}`);
  }
});

test('a digest is not a user and not a room', () => {
  assert.equal(parseRoute(`/u/${DIGEST}`).page, 'home');
  assert.equal(parseRoute(`/room/${DIGEST}`).page, 'home');
});
