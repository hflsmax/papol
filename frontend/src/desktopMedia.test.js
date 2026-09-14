import test from 'node:test';
import assert from 'node:assert/strict';

global.location = new URL('https://example.test/index.html');
Object.defineProperty(global, 'navigator', { configurable: true, value: { onLine: true } });
global.window = {
  location: global.location,
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'main' },
  addEventListener() {},
  dispatchEvent() {},
};

const calls = [];
const { configureNativeBridge } = await import('../../shared/nativeData.js');
const { configureNetworkFetch } = await import('../../shared/connectivity.js');
configureNativeBridge({
  invoke: async (command, parameters) => {
    calls.push([command, parameters]);
    if (command === 'blob_read') throw new Error('Blob is not available offline');
    return null;
  },
  listen: async () => () => {},
});

let fetches = 0;
configureNetworkFetch(async () => {
  fetches += 1;
  return new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'content-type': 'video/mp4' },
  });
});

const { hydrateDesktopMedia } = await import('../../shared/desktopMedia.js');

test('concurrent hydration downloads and stores one verified copy', async () => {
  const asset = {
    path: '/assets/example.mp4', sha256: 'a'.repeat(64),
    mimeType: 'video/mp4', kind: 'video',
  };
  const [first, second] = await Promise.all([
    hydrateDesktopMedia(asset), hydrateDesktopMedia(asset),
  ]);

  assert.deepEqual([...first], [1, 2, 3]);
  assert.deepEqual([...second], [1, 2, 3]);
  assert.equal(fetches, 1);
  const cacheCalls = calls.filter(([command]) => command === 'blob_cache');
  assert.equal(cacheCalls.length, 1);
  assert.equal(cacheCalls[0][1].expectedSha256, asset.sha256);
  assert.equal(cacheCalls[0][1].mimeType, 'video/mp4');
});
