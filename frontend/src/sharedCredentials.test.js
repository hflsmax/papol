import test from 'node:test';
import assert from 'node:assert/strict';

// A page on dev.papol.io, with its own localStorage and the domain's cookies.
const values = new Map();
global.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const jar = new Map();
const written = [];
global.document = {
  get cookie() {
    return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  },
  set cookie(line) {
    written.push(line);
    const [pair, ...attributes] = line.split('; ');
    const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
    if (attributes.includes('Max-Age=0')) jar.delete(name);
    else jar.set(name, value);
  },
};
global.window = { location: new URL('https://dev.papol.io/viewer/') };
global.location = global.window.location;

const {
  currentCredential, hydrateCredential, storeCredential,
} = await import('../../shared/credentials.js');

const reset = () => { values.clear(); jar.clear(); written.length = 0; };

test('a session signed into on one papol.io site is found by the other', async () => {
  reset();
  jar.set('papol_token', 'from-papol-io');
  assert.equal(await hydrateCredential(), 'from-papol-io');
  assert.equal(values.get('papol_token'), 'from-papol-io');
});

test('signing in writes the token for the whole domain, secure and same-site', async () => {
  reset();
  await storeCredential('signed-in-here');
  assert.equal(values.get('papol_token'), 'signed-in-here');
  assert.equal(jar.get('papol_token'), 'signed-in-here');
  assert.match(written.at(-1), /; Domain=papol\.io; Path=\/; Max-Age=\d+; Secure; SameSite=Strict$/);
});

test('a session from before the cookie is offered to the other site', async () => {
  reset();
  values.set('papol_token', 'older-session');
  assert.equal(await hydrateCredential(), 'older-session');
  assert.equal(jar.get('papol_token'), 'older-session');
});

test("a site's own session is kept over the other site's", async () => {
  reset();
  values.set('papol_token', 'mine');
  jar.set('papol_token', 'theirs');
  assert.equal(await hydrateCredential(), 'mine');
  assert.equal(jar.get('papol_token'), 'theirs');
});

test('letting a token go clears the cookie only when it holds that token', async () => {
  reset();
  values.set('papol_token', 'refused-here');
  jar.set('papol_token', 'refused-here');
  await hydrateCredential();
  await storeCredential(null);
  assert.equal(currentCredential(), null);
  assert.equal(values.has('papol_token'), false);
  assert.equal(jar.has('papol_token'), false);

  // A newer session the other site wrote since is that site's to keep.
  values.set('papol_token', 'stale');
  jar.set('papol_token', 'newer-elsewhere');
  await hydrateCredential();
  await storeCredential(null);
  assert.equal(jar.get('papol_token'), 'newer-elsewhere');
});
