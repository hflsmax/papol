import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
const calls = [];
global.window = {
  location: new URL('https://papol.test/demo'),
  sessionStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  },
};
global.location = window.location;
global.localStorage = { getItem: () => 'real-account-token' };
let expired = false;
global.fetch = async (input, options = {}) => {
  calls.push({ url: String(input), options });
  if (String(input) === '/api/demo/session') return Response.json({ session: 'temporary-key' });
  if (expired) return Response.json({ detail: 'Session ended' }, { status: 410 });
  return Response.json({ ok: true });
};

const { runtimeFetch } = await import('../../shared/connectivity.js');
const { request } = await import('../../shared/httpClient.js');
const { enterDemo } = await import('../../shared/demo.js');

test('JSON requests and raw multipart uploads share one isolated session', async () => {
  const upload = new FormData();
  upload.append('file', new Blob(['fake pdf']), 'paper.pdf');
  await Promise.all([
    request('/auth/me'),
    runtimeFetch('/api/papers', {
      method: 'POST', body: upload,
      headers: { Authorization: 'Bearer real-account-token', 'X-Papol-Client-UUID': 'real-client' },
    }),
  ]);
  assert.equal(calls.filter(({ url }) => url === '/api/demo/session').length, 1);
  assert.deepEqual(new Set(calls.slice(1).map(({ url }) => url)),
    new Set(['/api/demo/auth/me', '/api/demo/papers']));
  for (const { options } of calls.slice(1)) {
    assert.equal(options.headers.get('Authorization'), null);
    assert.equal(options.headers.get('X-Papol-Client-UUID'), null);
    assert.equal(options.headers.get('X-Papol-Demo-Session'), 'temporary-key');
    assert.equal(options.credentials, 'omit');
  }
  assert.equal(calls.find(({ url }) => url === '/api/demo/papers').options.body, upload);
});

test('navigation resumes the workspace and feedback cannot escape the demo', async () => {
  enterDemo();
  calls.length = 0;
  await request('/feedback', { method: 'POST', body: '{}' });
  assert.equal(calls[0].options.headers['X-Papol-Demo-Session'], 'temporary-key');
  assert.equal(calls[1].url, '/api/demo/feedback');
});

test('expiration does not replay edits or silently create a new world', async () => {
  expired = true;
  calls.length = 0;
  await assert.rejects(request('/tags', { method: 'POST', body: '{}' }), /Session ended/);
  await assert.rejects(request('/tags', { method: 'POST', body: '{}' }), /Session ended/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ url }) => url === '/api/demo/tags'));
  assert.equal(values.has('papol.demoSession'), false);
  expired = false;
});

test('static media and leaving demo retain ordinary networking', async () => {
  calls.length = 0;
  await runtimeFetch('/uploads/seed.pdf');
  window.location = new URL('https://papol.test/signin');
  await request('/auth/login', { method: 'POST', body: '{}' });
  assert.deepEqual(calls.map(({ url }) => url), ['/uploads/seed.pdf', '/api/auth/login']);
});
