import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestIndexedDb } from './testIndexedDb.js';

global.indexedDB = createTestIndexedDb();
global.location = new URL('tauri://localhost/');
global.window = {
  location: global.location,
  dispatchEvent() {},
  addEventListener() {},
};
global.document = { getElementById: () => null, body: { appendChild() {} }, createElement: () => ({ style: {} }) };
global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const settings = new Map();
global.localStorage = {
  getItem: (key) => settings.get(key) ?? null,
  setItem: (key, value) => settings.set(key, String(value)),
};
global.sessionStorage = { getItem: () => null };
Object.defineProperty(global, 'navigator', { configurable: true, value: { onLine: true } });

const {
  cachedBlobUrl, configureNetworkFetch, configureReplayAuthorization, enterOfflineMode, exitOfflineMode,
  getSyncStatus, inOfflineMode, OFFLINE_MODE_MESSAGE, offlineFetch, refreshSyncStatus, runtimeFetch,
  setLocalSyncPreference, syncOfflineQueue,
} = await import('../../shared/offlineStore.js');

const API = 'https://backend.test/api';
const auth = { Authorization: 'Bearer integration-token' };
const json = (value, status = 200) => new Response(
  value === null ? null : JSON.stringify(value),
  { status, headers: value === null ? {} : { 'Content-Type': 'application/json' } },
);

function reset() {
  indexedDB.deleteDatabase('papol-offline');
  settings.clear();
  exitOfflineMode();
  setLocalSyncPreference('manual');
}

async function seedQueuedOperation(operation) {
  await refreshSyncStatus();
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('papol-offline', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('queue', 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.objectStore('queue').add(operation);
    });
  } finally {
    db.close();
  }
}

test('cached blobs are read locally before the network loader', async () => {
  reset();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return new Blob(['board image'], { type: 'image/png' });
  };

  const key = 'https://backend.test/api/board-items/7/file';
  const [first, simultaneous] = await Promise.all([
    cachedBlobUrl(key, loader),
    cachedBlobUrl(key, loader),
  ]);
  URL.revokeObjectURL(first);
  URL.revokeObjectURL(simultaneous);
  const second = await cachedBlobUrl(key, loader);
  URL.revokeObjectURL(second);

  assert.equal(loads, 1);
});

test('desktop queue replays dependent board operations against the backend in order', async () => {
  reset();
  const board = await (await offlineFetch(`${API}/boards`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Synced board' }),
  })).json();
  const note = await (await offlineFetch(`${API}/boards/${board.uuid}/comments`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Made offline', x: 3, y: 4 }),
  })).json();
  const secondNote = await (await offlineFetch(`${API}/boards/${board.uuid}/comments`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    // Content that happens to equal a temporary identifier is still content;
    // only URL segments and ID-bearing fields may be rewritten.
    body: JSON.stringify({ content: board.uuid, x: 13, y: 14 }),
  })).json();
  await offlineFetch(`${API}/board-items/${note.uuid}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 30, y: 40 }),
  });
  await offlineFetch(`${API}/boards/${board.uuid}/groups`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'collection', title: 'Related', item_uuids: [note.uuid, secondNote.uuid] }),
  });

  const calls = [];
  const backend = async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: JSON.parse(options.body) });
    if (calls.length === 1) return json({ uuid: 'server-board', name: 'Synced board' });
    if (calls.length === 2) return json({ uuid: 'server-note', board_uuid: 'server-board', kind: 'comment' });
    if (calls.length === 3) return json({ uuid: 'server-second-note', board_uuid: 'server-board', kind: 'comment' });
    if (calls.length === 4) return json({ uuid: 'server-note', x: 30, y: 40 });
    return json({ uuid: 'server-group', kind: 'collection', item_uuids: ['server-note', 'server-second-note'] });
  };

  assert.equal(await syncOfflineQueue(backend), 0);
  assert.deepEqual(calls.map(({ url, method }) => [method, url]), [
    ['POST', `${API}/boards`],
    ['POST', `${API}/boards/server-board/comments`],
    ['POST', `${API}/boards/server-board/comments`],
    ['PUT', `${API}/board-items/server-note`],
    ['POST', `${API}/boards/server-board/groups`],
  ]);
  assert.deepEqual(calls[3].body, { x: 30, y: 40 });
  assert.equal(calls[2].body.content, board.uuid);
  assert.deepEqual(calls[4].body.item_uuids, ['server-note', 'server-second-note']);
  assert.equal(getSyncStatus().pending, 0);
  assert.ok(getSyncStatus().lastSynced);
});

test('a large offline annotation batch survives reconnection and replays every mutation once', async () => {
  reset();
  enterOfflineMode();

  const expected = [];
  for (let index = 0; index < 40; index += 1) {
    const path = `${API}/papers/paper-${index % 4}/comments`;
    const body = { content: `offline note ${index}`, page: (index % 12) + 1 };
    await offlineFetch(path, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expected.push([path, body]);
  }
  for (let index = 0; index < 20; index += 1) {
    const path = `${API}/editions/edition-${index % 3}/ink`;
    const body = { points: [{ x: index / 20, y: 0.5 }], color: '#123456' };
    await offlineFetch(path, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expected.push([path, body]);
  }
  for (let index = 0; index < 20; index += 1) {
    const path = `${API}/editions/edition-${index % 3}/clips`;
    const body = { page: index + 1, source: { x: 0, y: 0, w: 0.2, h: 0.2 } };
    await offlineFetch(path, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expected.push([path, body]);
  }
  assert.equal(getSyncStatus().pending, expected.length);

  const replayed = [];
  assert.equal(await syncOfflineQueue(async (url, options) => {
    replayed.push([String(url), JSON.parse(options.body)]);
    return json({ uuid: `server-${replayed.length}` });
  }, { manual: true }), 0);
  assert.deepEqual(replayed, expected);
  assert.equal(getSyncStatus().pending, 0);
  assert.equal(getSyncStatus().error, null);
  assert.equal(inOfflineMode(), false);
  assert.ok(getSyncStatus().lastSynced);
});

test('a server failure commits only the successful prefix and retry resumes at the failed operation', async () => {
  reset();
  for (const name of ['one', 'two', 'three']) {
    await offlineFetch(`${API}/tags`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }
  let calls = 0;
  let failedIdentity;
  assert.equal(await syncOfflineQueue(async (_url, options) => {
    calls += 1;
    if (calls === 2) {
      const headers = new Headers(options.headers);
      failedIdentity = [
        headers.get('X-Papol-Client-UUID'), headers.get('X-Papol-Mutation-UUID'),
      ];
    }
    return calls === 2 ? json({ detail: 'temporary failure' }, 503) : json({ uuid: 100 + calls });
  }), 2);
  assert.equal(getSyncStatus().error, 'Sync stopped: server returned 503');
  assert.equal(getSyncStatus().offline, false);
  assert.equal(inOfflineMode(), false);

  const retried = [];
  assert.equal(await syncOfflineQueue(async (_url, options) => {
    const headers = new Headers(options.headers);
    retried.push({
      name: JSON.parse(options.body).name,
      identity: [headers.get('X-Papol-Client-UUID'), headers.get('X-Papol-Mutation-UUID')],
    });
    return json({ uuid: 200 + retried.length });
  }, { manual: true }), 0);
  assert.deepEqual(retried.map(({ name }) => name), ['two', 'three']);
  assert.deepEqual(retried[0].identity, failedIdentity);
  assert.match(failedIdentity[0], /^[0-9a-f-]{36}$/);
  assert.match(failedIdentity[1], /^[0-9a-f-]{36}$/);
});

test('an ambiguous transport failure queues the already identified mutation', async () => {
  reset();
  settings.set('papol.syncPreference', 'automatic');
  let attemptedIdentity;
  const response = await offlineFetch(`${API}/boards`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Committed maybe' }),
  }, async (_url, options) => {
    const headers = new Headers(options.headers);
    attemptedIdentity = [
      headers.get('X-Papol-Client-UUID'), headers.get('X-Papol-Mutation-UUID'),
    ];
    throw new TypeError('response connection was lost');
  });
  assert.equal((await response.json()).name, 'Committed maybe');
  assert.equal(getSyncStatus().pending, 1);

  let replayedIdentity;
  assert.equal(await syncOfflineQueue(async (_url, options) => {
    const headers = new Headers(options.headers);
    replayedIdentity = [
      headers.get('X-Papol-Client-UUID'), headers.get('X-Papol-Mutation-UUID'),
    ];
    return json({ uuid: 'server-board', name: 'Committed maybe' });
  }), 0);
  assert.deepEqual(replayedIdentity, attemptedIdentity);
});

test('persisted queues use account scope and inject current authorization only at replay', async () => {
  reset();
  await offlineFetch(`${API}/boards`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Private queue' }),
  });
  configureReplayAuthorization(() => 'Bearer another-account');
  let calls = 0;
  assert.equal(await syncOfflineQueue(async () => { calls += 1; return json({}); }), 1);
  assert.equal(calls, 0);

  configureReplayAuthorization(() => auth.Authorization);
  let replayHeaders;
  assert.equal(await syncOfflineQueue(async (_url, options) => {
    replayHeaders = new Headers(options.headers);
    return json({ uuid: 'private' });
  }), 0);
  assert.equal(replayHeaders.get('authorization'), auth.Authorization);
});

test('simultaneous sync requests share one replay and never duplicate a create', async () => {
  reset();
  await offlineFetch(`${API}/boards`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Once' }),
  });
  let calls = 0;
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const backend = async () => {
    calls += 1;
    await waiting;
    return json({ uuid: 'once' });
  };
  const first = syncOfflineQueue(backend);
  const second = syncOfflineQueue(backend);
  release();
  assert.deepEqual(await Promise.all([first, second]), [0, 0]);
  assert.equal(calls, 1);
});

test('queued multipart files retain bytes and metadata when replayed', async () => {
  reset();
  const form = new FormData();
  form.append('file', new File(['image bytes'], 'diagram.png', { type: 'image/png' }));
  form.append('caption', 'offline image');
  await offlineFetch(`${API}/boards/existing/files`, { method: 'POST', headers: auth, body: form });

  let replayed;
  await syncOfflineQueue(async (_url, options) => {
    replayed = options.body;
    return json({ uuid: 7, file_path: '4/upload.png' });
  });
  const file = replayed.get('file');
  assert.equal(file.name, 'diagram.png');
  assert.equal(file.type, 'image/png');
  assert.equal(await file.text(), 'image bytes');
  assert.equal(replayed.get('caption'), 'offline image');
});

test('multipart replay replaces a stale persisted boundary', async () => {
  reset();
  const staleBoundary = '----WebKitFormBoundaryFromOriginalRequest';
  const form = new FormData();
  form.append('file', new File(['image bytes'], 'diagram.png', { type: 'image/png' }));
  await offlineFetch(`${API}/boards/existing/files`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': `multipart/form-data; boundary=${staleBoundary}` },
    body: form,
  });

  await syncOfflineQueue(async (url, options) => {
    const request = new Request(url, options);
    const contentType = request.headers.get('Content-Type');
    const boundary = contentType.match(/boundary=(.+)$/)?.[1];
    const body = Buffer.from(await request.arrayBuffer()).toString();
    assert.ok(boundary);
    assert.notEqual(boundary, staleBoundary);
    assert.ok(body.startsWith(`--${boundary}\r\n`));
    return json({ uuid: 7, file_path: '4/upload.png' });
  });
});

test('upgrades retire queued metadata previews without replaying them', async () => {
  reset();
  await seedQueuedOperation({
    method: 'POST',
    path: '/papers/extract',
    url: `${API}/papers/extract`,
    headers: {},
    accountScope: 'guest',
    body: { type: 'form', value: [] },
    optimistic: { title: 'Legacy preview' },
  });

  let calls = 0;
  assert.equal(await syncOfflineQueue(async () => {
    calls += 1;
    return json({});
  }), 0);
  assert.equal(calls, 0);
  assert.equal(getSyncStatus().pending, 0);
});

test('network loss pauses a replay without dropping its operation', async () => {
  reset();
  await offlineFetch(`${API}/tags`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'durable' }),
  });
  assert.equal(await syncOfflineQueue(async () => { throw new TypeError('offline'); }), 1);
  await refreshSyncStatus();
  const status = getSyncStatus();
  assert.equal(status.pending, 1);
  assert.equal(status.syncing, false);
  assert.equal(status.offline, true);
  assert.equal(status.error, 'Sync paused — no connection');
  assert.equal(status.preference, 'manual');
  assert.deepEqual(Object.keys(status).sort(), [
    'error', 'lastSynced', 'offline', 'pending', 'preference', 'syncing',
  ]);
});

test('a failed sync latches offline mode and backend requests return without network traffic', async () => {
  reset();
  await offlineFetch(`${API}/tags`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'waiting' }),
  });
  await syncOfflineQueue(async () => { throw new TypeError('offline'); });
  assert.equal(inOfflineMode(), true);

  let calls = 0;
  configureNetworkFetch(async () => { calls += 1; return json({ title: 'too late' }); });
  await assert.rejects(
    runtimeFetch(`${API}/papers/extract`, { method: 'POST' }),
    { name: 'OnlineRequiredError', message: OFFLINE_MODE_MESSAGE },
  );
  await assert.rejects(
    offlineFetch(`${API}/papers/paper-id/extract-metadata`, { method: 'POST' }, async () => {
      calls += 1;
      return json({});
    }),
    { name: 'OnlineRequiredError', message: OFFLINE_MODE_MESSAGE },
  );
  assert.equal(calls, 0);
});
