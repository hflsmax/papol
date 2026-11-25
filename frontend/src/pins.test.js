// The papers a user pinned to the top of their nook (shared/pins.js): kept
// on the device, shared through Papol, and what a nook's list leads with.
import test from 'node:test';
import assert from 'node:assert/strict';

function memoryStorage() {
  const stored = new Map();
  return {
    get length() { return stored.size; },
    key: (i) => [...stored.keys()][i] ?? null,
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
  };
}

const told = [];
global.localStorage = memoryStorage();
global.window = { location: new URL('https://papol.test/'), addEventListener: () => {}, dispatchEvent: (event) => { told.push(event.type); } };
global.location = global.window.location;
localStorage.setItem('papol_token', 'token-one');

const { configureNetworkFetch } = await import('../../shared/connectivity.js');
const { hydrateCredential } = await import('../../shared/credentials.js');
const { sendUserStateNow, waitingState } = await import('../../shared/userState.js');
const { PINS_CHANGED, pinnedPapers, setPaperPinned, takePinsFromPapol } = await import('../../shared/pins.js');
const { pinnedFirst } = await import('./paperFormat.js');
const { papersInListing } = await import('./desktopListings.js');

// Papol, as these tests need it: it keeps the change made last.
const papol = new Map();
let offline = false;
function respond(status, body) {
  return Promise.resolve({ ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) });
}
function fakePapol(url, options = {}) {
  if (offline) return Promise.reject(new TypeError('Failed to fetch'));
  const path = new URL(String(url), 'https://papol.test').pathname.replace(/^.*\/api/, '');
  if ((options.method || 'GET') === 'POST' && path === '/user-state') {
    const { changes } = JSON.parse(options.body);
    for (const change of changes) {
      const kept = papol.get(change.key);
      if (!kept || Date.parse(change.at) > Date.parse(kept.at)) papol.set(change.key, change);
    }
    return respond(200, { recorded: changes.length, skipped: 0 });
  }
  if (path === '/user-state/pin') {
    return respond(200, { states: [...papol.values()].map(({ key, value, at }) => ({ key, value, at })) });
  }
  return respond(404, { error: 'Not found' });
}
configureNetworkFetch(fakePapol);
globalThis.fetch = fakePapol;
await hydrateCredential();

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const elsewhere = (key, value, msFromNow = -1000) =>
  papol.set(key, { kind: 'pin', key, value, at: new Date(Date.now() + msFromNow).toISOString() });

test('a pin is kept here at once and goes to Papol', async () => {
  assert.deepEqual([...pinnedPapers()], []);
  assert.equal(setPaperPinned(A.toUpperCase(), true), true);
  assert.deepEqual([...pinnedPapers()], [A]);
  assert.ok(told.includes(PINS_CHANGED));
  await sendUserStateNow();
  assert.equal(papol.get(A).value, true);
  assert.equal(waitingState('pin', A), null);
});

test('what another device pinned and unpinned is taken here', async () => {
  elsewhere(B, true);
  elsewhere(A, null);
  assert.equal(await takePinsFromPapol(), true);
  assert.deepEqual([...pinnedPapers()], [B]);
  assert.equal(await takePinsFromPapol(), false, 'nothing new the second time');
});

test('offline, a pin holds, and is not undone by what Papol last heard', async () => {
  offline = true;
  setPaperPinned(C, true);
  setPaperPinned(B, false);
  await sendUserStateNow();
  assert.equal(await takePinsFromPapol(), false, 'Papol cannot be asked');
  assert.deepEqual([...pinnedPapers()], [C]);
  offline = false;
  // Asked before the changes have gone: this device's own answers stand.
  await takePinsFromPapol();
  assert.deepEqual([...pinnedPapers()], [C]);
  await sendUserStateNow();
  assert.equal(papol.get(C).value, true);
  assert.equal(papol.get(B).value, null);
});

test('one account’s pins are not the next one’s', async () => {
  localStorage.setItem('papol_token', 'token-two');
  await hydrateCredential();
  assert.deepEqual([...pinnedPapers()], []);
  localStorage.setItem('papol_token', 'token-one');
  await hydrateCredential();
  assert.deepEqual([...pinnedPapers()], [C]);
});

test('pinned papers lead a list, newest first among them and among the rest', () => {
  const papers = [
    { sha256: 'old', created_at: '2026-01-01T00:00:00Z', shelf_uuid: 1, tags: [] },
    { sha256: 'mid', created_at: '2026-02-01T00:00:00Z', shelf_uuid: 2, tags: [] },
    { sha256: 'new', created_at: '2026-03-01T00:00:00Z', shelf_uuid: 1, tags: [] },
    { sha256: 'older', created_at: '2025-12-01T00:00:00Z', shelf_uuid: 1, tags: [] },
  ];
  const ids = (list) => list.map((paper) => paper.sha256);
  assert.deepEqual(ids([...papers].sort(pinnedFirst(new Set()))), ['new', 'mid', 'old', 'older']);
  assert.deepEqual(ids([...papers].sort(pinnedFirst(new Set(['older', 'mid'])))), ['mid', 'older', 'new', 'old']);
  const nook = { papers, shelves: [{ uuid: 1 }, { uuid: 2 }], tags: [] };
  assert.deepEqual(ids(papersInListing('all', { nook, pinned: new Set(['old']) })), ['old', 'new', 'mid', 'older']);
  assert.deepEqual(ids(papersInListing('shelf:1', { nook, pinned: new Set(['older', 'mid']) })), ['older', 'new', 'old']);
});
