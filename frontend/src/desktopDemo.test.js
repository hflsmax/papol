import test from 'node:test';
import assert from 'node:assert/strict';

const stored = new Map([['papol.localAccountUuid', '11111111-1111-4111-8111-111111111111']]);
const commands = [];
const replies = [];
let requestsReady;
const ready = new Promise((resolve) => { requestsReady = resolve; });
global.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
};
global.location = new URL('http://localhost/demo');
global.window = {
  location: global.location,
  localStorage: global.localStorage,
  __PAPOL_ENV__: { runtime: 'desktop', surface: 'desk', documentWindow: false },
  addEventListener() {},
  dispatchEvent() {},
};
global.fetch = async (url) => {
  if (String(url) === '/api/demo/session') return Response.json({ session: 'demo-key' });
  return new Promise((resolve) => {
    replies.push(resolve);
    if (replies.length === 2) requestsReady();
  });
};
const { configureNativeBridge } = await import('../../shared/nativeData.js');
configureNativeBridge({
  invoke: async (command) => { commands.push(command); },
  listen: async () => () => {},
});
const { getMe, updateProfile } = await import('../../shared/api/account.js');

test('late demo identity and profile responses never activate a permanent desktop account', async () => {
  const reading = getMe();
  const editing = updateProfile({ display_name: 'Temporary name' });
  await ready;
  window.location = new URL('http://localhost/');
  const user = { uuid: '00000000-0000-4000-8000-a00000000001', display_name: 'Temporary name' };
  for (const reply of replies) reply(Response.json(user));
  assert.deepEqual(await reading, user);
  assert.deepEqual(await editing, user);
  assert.deepEqual(commands, []);
  assert.equal(stored.get('papol.localAccountUuid'), '11111111-1111-4111-8111-111111111111');
});
