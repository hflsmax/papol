// The small things a user's devices share (shared/userState.js), on the
// device outbox (shared/deviceOutbox.js): a change is kept until Papol has
// it, and a change still waiting wins over what Papol says.
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
    stored,
  };
}

global.localStorage = memoryStorage();
global.window = { location: new URL('https://papol.test/'), addEventListener: () => {}, dispatchEvent: () => {} };
global.location = global.window.location;
localStorage.setItem('papol_token', 'token-one');

const { configureNetworkFetch } = await import('../../shared/connectivity.js');
const { hydrateCredential } = await import('../../shared/credentials.js');
const { deviceOutbox } = await import('../../shared/deviceOutbox.js');
const { placeFromPapol, rememberState, sendUserStateNow, waitingState } = await import('../../shared/userState.js');
const { LINK_NAVIGATION_TIP, isFeatureStateSet, setFeatureState, takeFeatureStatesFromPapol } = await import('../../shared/featureStates.js');

// Papol, as these tests need it: it keeps the change made last.
const papol = new Map();
let offline = false;
const sent = [];
function respond(status, body) {
  return Promise.resolve({ ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) });
}
function fakePapol(url, options = {}) {
  if (offline) return Promise.reject(new TypeError('Failed to fetch'));
  const path = new URL(String(url), 'https://papol.test').pathname.replace(/^.*\/api/, '');
  if ((options.method || 'GET') === 'POST' && path === '/user-state') {
    const { changes } = JSON.parse(options.body);
    sent.push(changes);
    for (const change of changes) {
      const kept = papol.get(`${change.kind}:${change.key}`);
      if (!kept || Date.parse(change.at) > Date.parse(kept.at)) papol.set(`${change.kind}:${change.key}`, change);
    }
    return respond(200, { recorded: changes.length, skipped: 0 });
  }
  if (path === '/user-state/flag') {
    return respond(200, { states: [...papol.values()].filter((s) => s.kind === 'flag').map(({ key, value, at }) => ({ key, value, at })) });
  }
  const place = path.match(/^\/user-state\/place\/(\w+)$/);
  if (place) {
    const kept = papol.get(`place:${place[1]}`);
    return respond(200, { state: kept ? { key: kept.key, value: kept.value, at: kept.at } : null });
  }
  return respond(404, { error: 'Not found' });
}
configureNetworkFetch(fakePapol);
globalThis.fetch = fakePapol;
await hydrateCredential();

const PAPER = 'a'.repeat(64);

test('a place goes to Papol and is forgotten here once Papol has it', async () => {
  rememberState('place', PAPER, { page: 7, x: 0.5, y: 0.3, scale: 1.2 });
  assert.equal(waitingState('place', PAPER)?.value.page, 7);
  assert.equal(await placeFromPapol(PAPER), null, 'a change waiting here wins over Papol');
  await sendUserStateNow();
  assert.equal(waitingState('place', PAPER), null);
  assert.equal((await placeFromPapol(PAPER)).value.page, 7);
});

test('offline, a change is kept and goes when it can', async () => {
  offline = true;
  rememberState('place', PAPER, { page: 9, x: 0.5, y: 0.1, scale: 1 });
  await sendUserStateNow();
  assert.equal(waitingState('place', PAPER)?.value.page, 9, 'kept while offline');
  offline = false;
  await sendUserStateNow();
  assert.equal(waitingState('place', PAPER), null);
  assert.equal(papol.get(`place:${PAPER}`).value.page, 9);
});

test('a change made earlier does not undo a later one from another device', async () => {
  rememberState('place', PAPER, { page: 2, x: 0.5, y: 0.1, scale: 1 }, new Date(Date.now() - 60_000));
  papol.set(`place:${PAPER}`, { kind: 'place', key: PAPER, value: { page: 11, x: 0.5, y: 0.2, scale: 1 }, at: new Date().toISOString() });
  await sendUserStateNow();
  assert.equal((await placeFromPapol(PAPER)).value.page, 11);
});

test('a tip dismissed on one device is dismissed on the others', async () => {
  setFeatureState(LINK_NAVIGATION_TIP, true);
  await sendUserStateNow();
  assert.equal(papol.get(`flag:${LINK_NAVIGATION_TIP.key}`).value, LINK_NAVIGATION_TIP.value);
  // Another device, which has never seen it.
  localStorage.removeItem(LINK_NAVIGATION_TIP.key);
  assert.equal(await takeFeatureStatesFromPapol(), true);
  assert.equal(isFeatureStateSet(LINK_NAVIGATION_TIP), true);
  // And brought back there, it comes back here.
  papol.set(`flag:${LINK_NAVIGATION_TIP.key}`, { kind: 'flag', key: LINK_NAVIGATION_TIP.key, value: null, at: new Date(Date.now() + 1000).toISOString() });
  assert.equal(await takeFeatureStatesFromPapol(), true);
  assert.equal(isFeatureStateSet(LINK_NAVIGATION_TIP), false);
});

test('a tip set before devices shared them is told to Papol', async () => {
  papol.delete(`flag:${LINK_NAVIGATION_TIP.key}`);
  localStorage.setItem(LINK_NAVIGATION_TIP.key, LINK_NAVIGATION_TIP.value);
  await takeFeatureStatesFromPapol();
  await sendUserStateNow();
  assert.equal(papol.get(`flag:${LINK_NAVIGATION_TIP.key}`).value, LINK_NAVIGATION_TIP.value);
});

test('what one account kept is never sent as another', async () => {
  const storage = memoryStorage();
  const outbox = deviceOutbox(storage, 'p.');
  outbox.save('x', { account: 'one', n: 1 });
  outbox.save('y', { account: 'two', n: 2 });
  const got = [];
  await outbox.flush('two', async (batch) => { got.push(...batch); }, { limit: 10, wire: (r) => r.n });
  assert.deepEqual(got, [2]);
  assert.equal(outbox.pending('x', 'one').n, 1);
  assert.equal(outbox.pending('y', 'two'), null);
});

test('a record changed while it was being sent is kept for next time', async () => {
  const storage = memoryStorage();
  const outbox = deviceOutbox(storage, 'p.');
  outbox.save('x', { account: 'a', n: 1 });
  await outbox.flush('a', async () => { outbox.save('x', { account: 'a', n: 2 }); }, { limit: 10, wire: (r) => r });
  assert.equal(outbox.pending('x', 'a').n, 2);
});

test('refused outright, a record is not kept to be refused again', async () => {
  const storage = memoryStorage();
  const outbox = deviceOutbox(storage, 'p.');
  outbox.save('x', { account: 'a' });
  await outbox.flush('a', async () => { throw Object.assign(new Error('bad'), { status: 422 }); }, { limit: 10, wire: (r) => r });
  assert.equal(outbox.pending('x', 'a'), null);
});
