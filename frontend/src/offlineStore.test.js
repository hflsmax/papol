import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOfflineQueue, configureNetworkFetch, getLocalSyncPreference, isSafeOfflineMutation,
  runtimeFetch, setLocalSyncPreference,
} from '../../shared/offlineStore.js';

const raw = (value) => ({ type: 'raw', value: JSON.stringify(value) });

test('only user-owned mutations are accepted for offline replay', () => {
  assert.equal(isSafeOfflineMutation('POST', '/papers/12/comments', '{}'), true);
  assert.equal(isSafeOfflineMutation('DELETE', '/papers/12'), true);
  assert.equal(isSafeOfflineMutation('PUT', '/papers/12', JSON.stringify({ summary: 'mine' })), true);
  assert.equal(isSafeOfflineMutation('PUT', '/papers/12', JSON.stringify({ thought: 'public' })), false);
  assert.equal(isSafeOfflineMutation('POST', '/rooms/4/messages', '{}'), false);
  assert.equal(isSafeOfflineMutation('DELETE', '/admin/tables/users/rows/2'), false);
  assert.equal(isSafeOfflineMutation('POST', '/boards/mine/files', new FormData()), true);
  assert.equal(isSafeOfflineMutation('PUT', '/board-items/12', JSON.stringify({ x: 4 })), true);
  assert.equal(isSafeOfflineMutation('PUT', '/board-groups/12/move', JSON.stringify({ dx: 4, dy: 2 })), true);
  assert.equal(isSafeOfflineMutation('POST', '/board-groups/12/ungroup', '{}'), true);
  assert.equal(isSafeOfflineMutation('POST', '/board-groups/12/restore', '{}'), false);
  assert.equal(isSafeOfflineMutation('PUT', '/board-items/12/layout', '{}'), false);
});

test('local sync preference persists on this device as automatic or manual', () => {
  const values = new Map();
  global.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  setLocalSyncPreference('manual');
  assert.equal(getLocalSyncPreference(), 'manual');
  setLocalSyncPreference('automatic');
  assert.equal(getLocalSyncPreference(), 'automatic');
  delete global.localStorage;
});

test('runtime transport keeps bundled assets local and sends HTTPS through native networking', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => { calls.push(['webview', String(url)]); return new Response(); };
  configureNetworkFetch(async (url) => { calls.push(['native', String(url)]); return new Response(); });
  try {
    await runtimeFetch('tauri://localhost/viewer/assets/demo.pdf');
    await runtimeFetch('https://mc-pony.com/papol/api/boards');
    assert.deepEqual(calls, [
      ['webview', 'tauri://localhost/viewer/assets/demo.pdf'],
      ['native', 'https://mc-pony.com/papol/api/boards'],
    ]);
  } finally {
    global.fetch = originalFetch;
    configureNetworkFetch((...args) => originalFetch(...args));
  }
});

test('queued notes are projected over a cached paper', () => {
  const paper = { id: 7, title: 'Paper', comments: [{ id: 1, content: 'old' }] };
  const operations = [
    { method: 'POST', path: '/papers/7/comments', body: raw({ content: 'new' }), optimistic: { id: -2, content: 'new' } },
    { method: 'PUT', path: '/comments/1', body: raw({ content: 'edited' }), optimistic: { id: 1, content: 'edited' } },
    { method: 'DELETE', path: '/comments/-2', body: raw(null), optimistic: { queued: true } },
  ];
  assert.deepEqual(applyOfflineQueue('/papers/7', paper, operations).comments, [
    { id: 1, content: 'edited' },
  ]);
});

test('queued ink is projected over its cached edition', () => {
  const operations = [
    { method: 'POST', path: '/editions/3/ink', body: raw({ points: [1] }), optimistic: { id: -4, points: [1] } },
    { method: 'PUT', path: '/ink/-4', body: raw({ points: [2] }), optimistic: { id: -4, points: [2] } },
  ];
  assert.deepEqual(applyOfflineQueue('/editions/3/ink', [], operations), [
    { id: -4, points: [2] },
  ]);
});

test('queued board operations are projected over the cached board', () => {
  const board = { guid: 'mine', name: 'Reading', items: [], staged_items: [], groups: [] };
  const operations = [
    { method: 'POST', path: '/boards/mine/comments', body: raw({ content: 'note' }), optimistic: { id: -1, kind: 'comment', content: 'note' } },
    { method: 'PUT', path: '/board-items/-1', body: raw({ x: 40, y: 20 }), optimistic: { id: -1, x: 40, y: 20 } },
    { method: 'POST', path: '/boards/mine/groups', body: raw({ title: 'Set' }), optimistic: { id: -2, title: 'Set' } },
  ];
  assert.deepEqual(applyOfflineQueue('/boards/mine', board, operations), {
    guid: 'mine', name: 'Reading', staged_items: [],
    items: [{ id: -1, kind: 'comment', content: 'note', x: 40, y: 20 }],
    groups: [{ id: -2, title: 'Set' }],
  });
});

test('offline-created boards appear in the viewer board picker', () => {
  const operations = [
    { method: 'POST', path: '/boards', body: raw({ name: 'Offline board' }), optimistic: { id: -1, guid: 'offline-one', name: 'Offline board' } },
    { method: 'PUT', path: '/boards/existing', body: raw({ name: 'Renamed' }), optimistic: { guid: 'existing', name: 'Renamed' } },
    { method: 'DELETE', path: '/boards/gone', body: raw(null), optimistic: { queued: true } },
  ];
  assert.deepEqual(applyOfflineQueue('/boards', [
    { guid: 'existing', name: 'Old name' },
    { guid: 'gone', name: 'Gone' },
  ], operations), [
    { guid: 'existing', name: 'Renamed' },
    { id: -1, guid: 'offline-one', name: 'Offline board' },
  ]);
});
