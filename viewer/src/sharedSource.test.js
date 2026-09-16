import assert from 'node:assert/strict';
import test from 'node:test';

const SHARE = '11111111-1111-4111-8111-111111111111';
const EDITION = '22222222-2222-4222-8222-222222222222';
const HASH = 'b'.repeat(64);

const reading = {
  uuid: SHARE,
  kind: 'rich',
  created_at: '2026-09-01T10:00:00',
  reader: { uuid: '33333333-3333-4333-8333-333333333333', display_name: 'Ada Lovelace' },
  paper: {
    uuid: '44444444-4444-4444-8444-444444444444',
    doi: '10.1234/shared',
    title: 'On the shared reading',
    authors: '[{"name":"Ada Lovelace"}]',
    journal: 'Reading Letters',
    year: 2026,
    file_path: `${HASH}.pdf`,
    edition_uuid: EDITION,
    edition_sha256: HASH,
  },
  annotations: [
    {
      uuid: 'note-1', kind: 'note', content: 'Here', page: 2,
      body: { anchor: { type: 'point', x: 0.1, y: 0.2 } },
    },
    { uuid: 'stroke-1', kind: 'ink', page: 2, body: { points: [{ x: 0.1, y: 0.2 }] } },
    { uuid: 'clip-1', kind: 'clip', page: 3, body: { source: {}, frame: {}, floating: false } },
  ],
};

const values = new Map();
const asked = [];

global.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
global.location = new URL(`http://127.0.0.1/viewer/?share=${SHARE}`);
global.window = {
  location: global.location,
  addEventListener() {},
  dispatchEvent() {},
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true }, configurable: true, writable: true,
});
global.fetch = async (url, options = {}) => {
  asked.push({ url: String(url), headers: options.headers || {} });
  const path = new URL(String(url), 'http://127.0.0.1').pathname;
  if (path === `/api/shared/${SHARE}`) {
    return new Response(JSON.stringify(reading), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (path === `/api/viewer-references/${HASH}`) {
    return new Response(JSON.stringify({ edition_uuid: EDITION, status: 'ready', references: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('{"detail":"Not found"}', { status: 404 });
};

const { resolveSource } = await import('./source.js');

test('a share link resolves a read-only source without a hash in the URL', () => {
  const source = resolveSource();

  assert.equal(source.readOnly, true);
  assert.equal(source.requiresSignIn, false);
  // The writing half of the annotation interface is simply absent, so there
  // is nothing for the viewer to call even by mistake.
  assert.equal(source.annotations.create, undefined);
  assert.equal(source.annotations.update, undefined);
  assert.equal(source.annotations.remove, undefined);
});

test('a shared reading carries the paper, the reader, and their marks', async () => {
  const source = resolveSource();
  const { doc, notes } = await source.load();

  assert.equal(doc.title, 'On the shared reading');
  assert.equal(doc.edition_uuid, EDITION);
  assert.equal(doc.edition_sha256, HASH);
  assert.deepEqual(doc.latest_edition, {
    uuid: EDITION, file_path: `${HASH}.pdf`, sha256: HASH,
  });
  assert.equal(doc.shared_by.display_name, 'Ada Lovelace');
  assert.equal(doc.shared_kind, 'rich');
  assert.deepEqual(notes.map((row) => row.uuid), ['note-1']);
  assert.deepEqual(
    (await source.annotations.list(EDITION, 'ink')).map((row) => row.uuid), ['stroke-1'],
  );
  assert.deepEqual(
    (await source.annotations.list(EDITION, 'clip')).map((row) => row.uuid), ['clip-1'],
  );
  assert.equal((await source.annotations.list(EDITION)).length, 3);
});

test('one request answers the whole reading', async () => {
  asked.length = 0;
  const source = resolveSource();

  await Promise.all([
    source.load(),
    source.annotations.list(EDITION, 'ink'),
    source.annotations.list(EDITION, 'clip'),
  ]);

  assert.deepEqual(asked.map((call) => new URL(call.url, 'http://127.0.0.1').pathname), [`/api/shared/${SHARE}`]);
});

test('a shared reading reads its bibliography on the authority of the link', async () => {
  asked.length = 0;
  const source = resolveSource();

  await source.references.list(HASH, EDITION);

  const url = new URL(asked.at(-1).url, 'http://127.0.0.1');
  assert.equal(url.pathname, `/api/viewer-references/${HASH}`);
  assert.equal(url.searchParams.get('share'), SHARE);
  assert.equal(url.searchParams.get('edition_uuid'), EDITION);
});

test('a lean link carries the paper and none of the reader\u2019s marks', async () => {
  const rich = { ...reading };
  Object.assign(reading, { kind: 'lean', reader: null, annotations: [] });
  try {
    const source = resolveSource();
    const { doc, notes } = await source.load();

    // A lean link is nobody's: it names no reader, so the viewer has none
    // to show and says the paper was shared rather than whose reading it is.
    assert.equal(doc.shared_kind, 'lean');
    assert.equal(doc.shared_by, null);
    assert.deepEqual(notes, []);
    assert.deepEqual(await source.annotations.list(EDITION), []);
  } finally {
    Object.assign(reading, rich);
  }
});

test('a demo viewer never follows a share link', () => {
  const previous = global.location.pathname;
  global.window.location = new URL(`http://127.0.0.1/demo/viewer/?share=${SHARE}`);
  global.location = global.window.location;
  try {
    assert.equal(resolveSource(), null);
  } finally {
    global.window.location = new URL(`http://127.0.0.1/viewer/?share=${SHARE}`);
    global.location = global.window.location;
    assert.equal(global.location.pathname, previous);
  }
});
