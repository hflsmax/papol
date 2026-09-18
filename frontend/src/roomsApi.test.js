import test from 'node:test';
import assert from 'node:assert/strict';

global.location = new URL('https://papol.test/');
global.window = {
  location: global.location,
  __PAPOL_ENV__: { runtime: 'web', surface: 'desk', documentWindow: false },
};

const calls = [];
const createdRoom = { uuid: 'room-new', status: 'open' };
const existingRoom = { uuid: 'room-old', status: 'finished' };
const { configureNetworkFetch } = await import('../../shared/connectivity.js');
configureNetworkFetch(async (url, options) => {
  calls.push([String(url), options]);
  return new Response(JSON.stringify(
    options?.method === 'POST' ? createdRoom : { rooms: [existingRoom] },
  ), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

const {
  callSeminar, listPaperRooms, uncallSeminar,
} = await import('../../shared/api/rooms.js');

test('paper seminar summaries come from shared server state', async () => {
  assert.deepEqual(await listPaperRooms('paper-uuid'), [existingRoom]);
  assert.match(calls.at(-1)[0], /\/api\/papers\/paper-uuid$/);
});

test('calling a seminar returns the authoritative room for immediate display', async () => {
  assert.deepEqual(await callSeminar('paper-uuid'), createdRoom);
  assert.equal(calls.at(-1)[1].method, 'POST');
});

test('uncalling a seminar uses its lifecycle endpoint', async () => {
  await uncallSeminar('room-uuid');
  assert.match(calls.at(-1)[0], /\/api\/rooms\/room-uuid\/uncall$/);
  assert.equal(calls.at(-1)[1].method, 'POST');
});
