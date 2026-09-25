import assert from 'node:assert/strict';
import test from 'node:test';

const SHARE = '11111111-1111-4111-8111-111111111111';
const HASH = 'b'.repeat(64);
const PAPER = '44444444-4444-4444-8444-444444444444';

const reading = {
  uuid: SHARE,
  kind: 'rich',
  created_at: '2026-09-01T10:00:00',
  user: { uuid: '33333333-3333-4333-8333-333333333333', display_name: 'Ada Lovelace' },
  paper: {
    uuid: PAPER,
    doi: '10.1234/shared',
    title: 'On the shared reading',
    authors: '[{"name":"Ada Lovelace"}]',
    journal: 'Reading Letters',
    year: 2026,
    file_path: `${HASH}.pdf`,
    sha256: HASH,
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
// What the service says about this user's own nook. `null` is "you have
// not got it"; 'explode' stands in for the lookup failing outright.
let inNook = { paper_sha256: PAPER, sha256: HASH };

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
    return new Response(JSON.stringify({ paper_sha256: PAPER, sha256: HASH }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (path === `/api/viewer/${HASH}/lean`) {
    return new Response(JSON.stringify({ ...reading, uuid: null, kind: 'lean', user: null, annotations: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (path === `/api/papers/${HASH.slice(0, 32)}/add-to-nook`) {
    return new Response(JSON.stringify({ sha256: HASH }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (path === `/api/viewer-references/${HASH}`) {
    return new Response(JSON.stringify({ paper_sha256: PAPER, status: 'ready', references: [] }), {
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
  // Their annotations are theirs. The writing half of the annotation interface is
  // simply absent, so there is nothing for the viewer to call even by
  // mistake.
  assert.equal(source.readOnly, true);
  assert.equal(source.annotations.create, undefined);
  assert.equal(source.annotations.update, undefined);
  assert.equal(source.annotations.remove, undefined);
  // A visitor's own annotations are a different matter: the tools are offered,
  // and reaching for one asks for the paper to be theirs first.
  assert.equal(source.annotationsRequireNook, true);
});

test('the way out of a shared paper is Papol itself', () => {
  // A link is followed from a mail, a chat, someone else's page, and the
  // sharer's paper page is not this visitor's to open. Papol's front door
  // is the whole of where they can go, and the way home says so rather
  // than stepping back into wherever the link was.
  assert.equal(resolveSource().homeHref, '/');
});

test('a visitor with no account is never asked about a nook they have not', async () => {
  asked.length = 0;
  const source = resolveSource();

  assert.equal(await source.loadNookPaper(), null);
  // Not a request that was made and came back empty — one that was never
  // worth making. There is no nook to ask about.
  assert.deepEqual(asked, []);
});

test('a signed-in user is told where their own copy is', async () => {
  await signedInAs('a-session-token');
  try {
    const source = resolveSource();
    const found = await source.loadNookPaper();

    assert.deepEqual(found, { paper_sha256: PAPER, sha256: HASH });
    // And where pressing "Show in nook" would take them: their own copy of
    // this PDF, not the link that showed them someone else's reading.
    assert.equal(source.nookHref(found), `/viewer/?pdf=${HASH}`);
  } finally {
    await signedOut();
  }
});

test('a signed-in user who has not got the paper is offered it', async () => {
  await signedInAs('a-session-token');
  inNook = null;
  try {
    const source = resolveSource();
    assert.equal(await source.loadNookPaper(), null);
    // Nothing to show, so there is nothing to build a link to either.
    assert.equal(source.nookHref(null), null);
  } finally {
    inNook = { paper_sha256: PAPER, sha256: HASH };
    await signedOut();
  }
});

test('adding a shared paper asks on the authority of the link', async () => {
  await signedInAs('a-session-token');
  asked.length = 0;
  try {
    const source = resolveSource();
    const added = await source.addToNook();

    assert.deepEqual(added, { paper_sha256: PAPER, sha256: HASH });
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
    // Not knowing is the same as not having it. The user is offered the
    // paper, and adding says so plainly if it turns out to be there already.
    assert.equal(await resolveSource().loadNookPaper(), null);
  } finally {
    inNook = previous;
    await signedOut();
  }
});

test('a shared reading carries the paper, the user, and their annotations', async () => {
  const source = resolveSource();
  const { doc, notes } = await source.load();

  assert.equal(doc.title, 'On the shared reading');
  assert.equal(doc.sha256, HASH);
  assert.equal(doc.file_path, `${HASH}.pdf`);
  assert.equal(doc.shared_by.display_name, 'Ada Lovelace');
  assert.equal(doc.shared_kind, 'rich');
  assert.deepEqual(notes.map((row) => row.uuid), ['note-1']);
  assert.deepEqual(
    (await source.annotations.list('ink')).map((row) => row.uuid), ['stroke-1'],
  );
  assert.deepEqual(
    (await source.annotations.list('clip')).map((row) => row.uuid), ['clip-1'],
  );
  assert.equal((await source.annotations.list()).length, 3);
});

test('one request answers the whole reading', async () => {
  asked.length = 0;
  const source = resolveSource();

  await Promise.all([
    source.load(),
    source.annotations.list('ink'),
    source.annotations.list('clip'),
  ]);

  assert.deepEqual(asked.map((call) => new URL(call.url, 'http://127.0.0.1').pathname), [`/api/shared/${SHARE}`]);
});

test('a shared reading reads its bibliography on the authority of the link', async () => {
  asked.length = 0;
  const source = resolveSource();

  await source.references.list(HASH, PAPER);

  const url = new URL(asked.at(-1).url, 'http://127.0.0.1');
  assert.equal(url.pathname, `/api/viewer-references/${HASH}`);
  assert.equal(url.searchParams.get('share'), SHARE);
  assert.equal(url.searchParams.get('paper_sha256'), PAPER);
});

test('a lean link carries the paper and none of the user\u2019s annotations', async () => {
  const rich = { ...reading };
  Object.assign(reading, { kind: 'lean', user: null, annotations: [] });
  try {
    const source = resolveSource();
    const { doc, notes } = await source.load();

    // A lean link is nobody's: it names no user, so the viewer has none
    // to show and says the paper was shared rather than whose reading it is.
    assert.equal(doc.shared_kind, 'lean');
    assert.equal(doc.shared_by, null);
    assert.deepEqual(notes, []);
    assert.deepEqual(await source.annotations.list(), []);
  } finally {
    Object.assign(reading, rich);
  }
});

// The viewer at another address for the length of one test.
async function at(href, run) {
  const previous = global.window.location;
  global.window.location = new URL(href);
  try {
    return await run();
  } finally {
    global.window.location = previous;
  }
}

const pathsAsked = () => asked.map((call) => new URL(call.url, 'http://127.0.0.1').pathname);

test('a short code opens a link as a UUID did', async () => {
  await at('http://127.0.0.1/viewer/?share=k3m9x2p7q4ab', async () => {
    asked.length = 0;
    const source = resolveSource();
    assert.equal(source.readOnly, true);
    await source.load().catch(() => {});
    assert.deepEqual(pathsAsked(), ['/api/shared/k3m9x2p7q4ab']);
  });
  // Neither a code nor a UUID is no link at all.
  await at('http://127.0.0.1/viewer/?share=nope', () => assert.equal(resolveSource(), null));
});

test('a paper’s own address opens the paper alone for a visitor, as a lean link', async () => {
  await at(`http://127.0.0.1/viewer/?pdf=${HASH}`, async () => {
    asked.length = 0;
    const source = resolveSource();
    assert.equal(source.requiresSignIn, false);
    assert.equal(source.readOnly, true);
    assert.equal(source.annotationsRequireNook, true);
    const { doc, notes } = await source.load();
    assert.equal(doc.sha256, HASH);
    assert.equal(doc.shared_kind, 'lean');
    assert.equal(doc.shared_by, null);
    assert.deepEqual(notes, []);
    assert.deepEqual(pathsAsked(), [`/api/viewer/${HASH}/lean`]);
    // What it cites and what it is are read without a link to read them by.
    assert.equal(source.references, undefined);
    assert.equal(source.info, undefined);
    assert.equal(await source.loadNookPaper(), null);
  });
});

test('a paper’s own address asks a signed-in user’s nook first, and falls back to the paper alone', async () => {
  await signedInAs('a-session-token');
  try {
    await at(`http://127.0.0.1/viewer/?pdf=${HASH}`, async () => {
      const source = resolveSource();
      assert.equal(source.requiresSignIn, true);
      assert.equal(source.readOnly, undefined);
      const lean = source.leanFallback();
      assert.equal(lean.readOnly, true);
      asked.length = 0;
      // Adding asks for the paper by its own name: no link stands behind it.
      const added = await lean.addToNook();
      assert.deepEqual(pathsAsked(), [`/api/papers/${HASH.slice(0, 32)}/add-to-nook`]);
      assert.equal(lean.nookHref(added), `/viewer/?pdf=${HASH}`);
    });
  } finally {
    await signedOut();
  }
});
