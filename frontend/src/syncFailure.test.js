import test from 'node:test';
import assert from 'node:assert/strict';

// A desktop window as Tauri makes one: the environment the build injects,
// the bridge, and the window events the prompt and the gate listen for.
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true }, configurable: true, writable: true,
});
const stored = new Map([['papol.localAccountUuid', '77777777-7777-4777-8777-777777777777']]);
global.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
};
global.location = new URL('http://127.0.0.1:5173/');
const heard = [];
const windowListeners = new Map();
global.window = {
  location: global.location,
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'desk', documentWindow: false, version: '0.5.1' },
  addEventListener(type, listener) { windowListeners.set(type, [...(windowListeners.get(type) || []), listener]); },
  removeEventListener() {},
  dispatchEvent(event) {
    heard.push(event);
    for (const listener of windowListeners.get(event.type) || []) listener(event);
  },
};
global.Event = class Event { constructor(type) { this.type = type; } };
global.CustomEvent = class CustomEvent extends Event {
  constructor(type, init) { super(type); this.detail = init?.detail; }
};

const { classifySyncFailure, syncFailureText, SYNC_ATTENTION_EVENT } = await import('../../shared/syncFailure.js');
const { configureNativeBridge } = await import('../../shared/nativeData.js');
const { getClientCompatibility, COMPATIBILITY_EVENT } = await import('../../shared/clientCompatibility.js');
const { authHeaders, DESKTOP_VERSION_HEADER } = await import('../../shared/httpClient.js');

// The line the synchronizer sends for a refusal, as coordinator.rs writes it.
const refused = (status, reason, body) => `Sync server returned ${status} ${reason}: ${JSON.stringify(body)}`;
const OBSOLETE = refused(426, 'Upgrade Required', {
  detail: { error: 'client_incompatible', download_url: 'https://github.com/hflsmax/papol/releases', minimum_desktop_version: '0.5.0' },
});

test('an obsolete build is told to update, with where to get the update', () => {
  const failure = classifySyncFailure(OBSOLETE);
  assert.equal(failure.kind, 'incompatible');
  assert.equal(failure.downloadUrl, 'https://github.com/hflsmax/papol/releases');
  assert.match(failure.text, /Update Papol/);
});

test('each kind of failure is told apart', () => {
  assert.equal(classifySyncFailure(refused(401, 'Unauthorized', { detail: 'Not signed in' })).kind, 'signed_out');
  assert.equal(classifySyncFailure('error sending request: connection refused').kind, 'offline');
  assert.equal(classifySyncFailure('Applying pull page failed: UNIQUE constraint failed').kind, 'reportable');
  assert.equal(classifySyncFailure(refused(503, 'Service Unavailable', {})).kind, 'server');
  assert.equal(classifySyncFailure('Sync server returned 502 Bad Gateway').kind, 'server');
  // A 5xx whose body mentions a timeout is the server's failure, not the network's.
  assert.equal(classifySyncFailure(refused(504, 'Gateway Timeout', { detail: 'upstream timed out' })).kind, 'server');
  const other = classifySyncFailure(refused(409, 'Conflict', { detail: 'That shelf no longer exists' }));
  assert.equal(other.kind, 'other');
  assert.equal(other.text, 'Sync did not finish: That shelf no longer exists');
});

test('the settings page and the Sync button show the sentence, not the response', () => {
  assert.equal(syncFailureText(null), null);
  const text = syncFailureText(OBSOLETE);
  assert.doesNotMatch(text, /426|client_incompatible|\{/);
});

test('the app\'s own requests say which version sent them', () => {
  assert.equal(authHeaders()[DESKTOP_VERSION_HEADER], '0.5.1');
});

// The permanent sync listener every window installs, driven as Tauri would.
let onSyncStatus = null;
configureNativeBridge({
  invoke: async () => null,
  listen: async (name, handler) => {
    if (name === 'papol://sync-status') onSyncStatus = handler;
    return () => {};
  },
});
await new Promise((resolve) => setTimeout(resolve, 0));

const lastAttention = () => heard.filter((event) => event.type === SYNC_ATTENTION_EVENT).at(-1);

test('a refused build covers the window with the update screen at once', () => {
  assert.ok(onSyncStatus, 'the sync listener was installed');
  heard.length = 0;
  onSyncStatus({ payload: { error: OBSOLETE } });
  assert.equal(getClientCompatibility().verdict, 'incompatible');
  assert.equal(getClientCompatibility().downloadUrl, 'https://github.com/hflsmax/papol/releases');
  assert.ok(heard.some((event) => event.type === COMPATIBILITY_EVENT));
  // The gate answers it; the prompt does not repeat it.
  assert.equal(lastAttention(), undefined);
});

test('a sync the server accepts takes the update screen down', () => {
  onSyncStatus({ payload: { pushed: 0, pulled: 3, cursor: 12 } });
  assert.equal(getClientCompatibility().verdict, 'supported');
  assert.equal(lastAttention().detail, null);
});

test('a refused session and a server failure reach the desk window\'s prompt', () => {
  onSyncStatus({ payload: { error: refused(401, 'Unauthorized', { detail: 'Not signed in' }) } });
  assert.equal(lastAttention().detail.kind, 'signed_out');
  onSyncStatus({ payload: { error: refused(500, 'Internal Server Error', {}) } });
  assert.equal(lastAttention().detail.kind, 'server');
});

test('being offline is left to offline mode', () => {
  heard.length = 0;
  onSyncStatus({ payload: { error: 'error trying to connect: dns error' } });
  assert.equal(lastAttention(), undefined);
});
