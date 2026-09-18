import test from 'node:test';
import assert from 'node:assert/strict';

global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
global.window = {
  location: new URL('tauri://localhost/'),
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'desk', documentWindow: false },
  addEventListener: () => {},
  dispatchEvent: () => {},
};
global.location = global.window.location;

const { configureNetworkFetch } = await import('../../shared/connectivity.js');
const { PLATFORM_HEADER, request } = await import('../../shared/httpClient.js');

const calls = [];
function capture(url, options) {
  calls.push({ url: String(url), headers: options.headers });
  return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
}
// The desktop shell reaches the backend through the native client; a bundled
// page under tauri:// goes out through the platform fetch. Either way the
// request is the one under test.
configureNetworkFetch(capture);
globalThis.fetch = capture;

test('Papol macOS names its platform when it signs in', async () => {
  await request('/auth/login', { method: 'POST', body: '{}' });
  assert.equal(calls.at(-1).headers[PLATFORM_HEADER], 'macos');
});

test('a caller with its own headers still announces the platform', async () => {
  await request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(calls.at(-1).headers['Content-Type'], 'application/json');
  assert.equal(calls.at(-1).headers[PLATFORM_HEADER], 'macos');
});
