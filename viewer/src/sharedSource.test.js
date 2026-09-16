import assert from 'node:assert/strict';
import test from 'node:test';

const SHARE = '11111111-1111-4111-8111-111111111111';
const EDITION = '22222222-2222-4222-8222-222222222222';
const HASH = 'b'.repeat(64);
const PAPER = '44444444-4444-4444-8444-444444444444';

const reading = {
  uuid: SHARE,
  kind: 'rich',
  created_at: '2026-09-01T10:00:00',
  reader: { uuid: '33333333-3333-4333-8333-333333333333', display_name: 'Ada Lovelace' },
  paper: {
    uuid: PAPER,
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
// What the service says about this reader's own nook. `null` is "you have
// not got it"; 'explode' stands in for the lookup failing outright.
let inNook = { paper_uuid: PAPER, edition_sha256: HASH };

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
  if (path === `/api/shared/${SHARE}/nook`) {
    if (inNook === 'explode') return new Response('{"detail":"Nope"}', { status: 500 });
    return new Response(JSON.stringify(inNook), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (path === `/api/shared/${SHARE}/add-to-nook`) {
    return new Response(JSON.stringify({ paper_uuid: PAPER, edition_sha256: HASH }), {
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
const { hydrateCredential } = await import('../../shared/credentials.js');

// Signed in the way the web is: a token in storage, read into memory the
// same way the viewer's entry module reads it before mounting.
async function signedInAs(token) {
  values.set('papol_token', token);
  await hydrateCredential();
}

async function signedOut() {
  values.delete('papol_token');
  await hydrateCredential();
}

test('a share link opens without a hash in the URL, and without a sign-in', () => {
  const source = resolveSource();

  assert.equal(source.requiresSignIn, false);
  // Their marks are theirs. The writing half of the annotation interface is
  // simply absent, so there is nothing for the viewer to call even by
  // mistake.
  assert.equal(source.readOnly, true);
  assert.equal(source.annotations.create, undefined);
  assert.equal(source.annotations.update, undefined);
  assert.equal(source.annotations.remove, undefined);
  // A visitor's own marks are a different matter: the tools are offered,
  // and reaching for one asks for the paper to be theirs first.
  assert.equal(source.annotationsRequireNook, true);
});

test('a visitor with no account is never asked about a nook they have not', async () => {
  asked.length = 0;
  const source = resolveSource();

  assert.equal(await source.loadNookPaper(), null);
  // Not a request that was made and came back empty — one that was never
  // worth making. There is no nook to ask about.
  assert.deepEqual(asked, []);
});

test('a signed-in reader is told where their own copy is', async () => {
  await signedInAs('a-session-token');
  try {
    const source = resolveSource();
    const found = await source.loadNookPaper();

    assert.deepEqual(found, { paper_uuid: PAPER, edition_sha256: HASH });
    // And where pressing "Show in nook" would take them: their own copy of
    // this PDF, not the link that showed them someone else's reading.
    assert.equal(source.nookHref(found), `/viewer/?pdf=${HASH}`);
  } finally {
    await signedOut();
  }
});

test('a signed-in reader who has not got the paper is offered it', async () => {
  await signedInAs('a-session-token');
  inNook = null;
  try {
    const source = resolveSource();
    assert.equal(await source.loadNookPaper(), null);
    // Nothing to show, so there is nothing to build a link to either.
    assert.equal(source.nookHref(null), null);
  } finally {
    inNook = { paper_uuid: PAPER, edition_sha256: HASH };
    await signedOut();
  }
});

test('adding a shared paper asks on the authority of the link', async () => {
  await signedInAs('a-session-token');
  asked.length = 0;
  try {
    const source = resolveSource();
    const added = await source.addToNook();

    assert.deepEqual(added, { paper_uuid: PAPER, edition_sha256: HASH });
    const call = asked.at(-1);
    assert.equal(
      new URL(call.url, 'http://127.0.0.1').pathname,
      `/api/shared/${SHARE}/add-to-nook`,
    );
  } finally {
    await signedOut();
  }
});

test('a nook lookup that fails leaves the paper on offer', async () => {
  await signedInAs('a-session-token');
  const previous = inNook;
  inNook = 'explode';
  try {
    // Not knowing is the same as not having it. The reader is offered the
    // paper, and adding says so plainly if it turns out to be there already.
    assert.equal(await resolveSource().loadNookPaper(), null);
  } finally {
    inNook = previous;
    await signedOut();
  }
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
