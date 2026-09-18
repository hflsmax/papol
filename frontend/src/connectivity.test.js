import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
const calls = [];

global.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
global.location = new URL('tauri://localhost/');
global.window = {
  location: global.location,
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'desk', documentWindow: false },
  addEventListener() {},
  dispatchEvent() {},
};
global.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true }, configurable: true, writable: true,
});

const {
  configureNetworkFetch, enterOfflineMode, exitOfflineMode, getLocalSyncPreference,
  inOfflineMode, runtimeFetch, setLocalSyncPreference,
} = await import('../../shared/connectivity.js');

test('sync preference remains a local desktop setting', () => {
  setLocalSyncPreference('manual');
  assert.equal(getLocalSyncPreference(), 'manual');
  assert.equal(values.get('papol.syncPreference'), 'manual');
});

test('HTTP uses native networking without a response cache', async () => {
  configureNetworkFetch(async (url, options) => {
    calls.push([String(url), options]);
    return new Response('[]');
  });
  const response = await runtimeFetch('https://backend.test/api/boards');
  assert.equal(await response.text(), '[]');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].cache, 'no-store');
});

test('an offline latch rejects network access instead of returning cached data', async () => {
  enterOfflineMode();
  assert.equal(inOfflineMode(), true);
  await assert.rejects(runtimeFetch('https://backend.test/api/boards'), {
    name: 'OnlineRequiredError',
  });
  assert.equal(calls.length, 1);
  exitOfflineMode();
});
