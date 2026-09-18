import test from 'node:test';
import assert from 'node:assert/strict';

global.location = new URL('https://papol.test/paper/abc');
global.window = {
  location: global.location,
  __PAPOL_ENV__: { runtime: 'web', surface: 'main', documentWindow: false },
};

let status = 200;
let detail = 'Not authenticated';
const { configureNetworkFetch } = await import('../../shared/connectivity.js');
configureNetworkFetch(async () => new Response(
  JSON.stringify(status === 200 ? { ok: true } : { detail }),
  { status, headers: { 'Content-Type': 'application/json' } },
));

const { request, subscribeUnauthenticated } = await import('../../shared/httpClient.js');

const heard = [];
const unsubscribe = subscribeUnauthenticated((report) => heard.push(report));

test('a request refused for want of a session is reported, and still fails', async () => {
  status = 401;
  await assert.rejects(request('/papers/abc'), { message: 'Not authenticated', status: 401 });
  assert.deepEqual(heard, [{ path: '/papers/abc', message: 'Not authenticated' }]);
});

test('an ended session is reported the same way', async () => {
  heard.length = 0;
  detail = 'Invalid or expired session';
  await assert.rejects(request('/auth/me'));
  assert.deepEqual(heard, [{ path: '/auth/me', message: 'Invalid or expired session' }]);
});

test('a wrong password is the server checking what was typed, not a lost session', async () => {
  heard.length = 0;
  detail = 'Invalid email or password';
  await assert.rejects(request('/auth/login', { method: 'POST' }));
  detail = 'Current password is incorrect';
  await assert.rejects(request('/auth/password', { method: 'PUT' }));
  assert.deepEqual(heard, []);
});

test('other failures and successes say nothing', async () => {
  heard.length = 0;
  status = 403;
  detail = 'Forbidden';
  await assert.rejects(request('/papers/abc'), { status: 403 });
  status = 200;
  assert.deepEqual(await request('/papers/abc'), { ok: true });
  assert.deepEqual(heard, []);
});

test('unsubscribing stops the reports', async () => {
  unsubscribe();
  status = 401;
  detail = 'Not authenticated';
  await assert.rejects(request('/papers/abc'));
  assert.deepEqual(heard, []);
});
