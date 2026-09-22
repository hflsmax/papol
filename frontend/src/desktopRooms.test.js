import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeHarness } from '../../shared/testing/nativeHarness.js';

const native = await installNativeHarness();
const { enterOfflineMode } = await import('../../shared/connectivity.js');
const { nativeSyncInProgress } = await import('../../shared/nativeData.js');
const {
  announceRoom, callSeminar, finishRoom, joinRoom, leadRoom, leaveRoom,
  postRoomMessage, setRoomAvailability, uncallSeminar, unhostRoom,
} = await import('../../shared/api/rooms.js');

const PAPER = 'f'.repeat(64);
const syncModes = () => native.argsOf('sync_now').map(({ request }) => request.mode);
const roomRequests = () => native.requests('plugin')
  .map(({ method, url }) => [new URL(url).pathname, method]);
const answerEveryRoomRequest = () => native.route(/\/api\/(?:papers|rooms)\//, { json: { uuid: 'room-uuid', status: 'open' } });

test('every seminar mutation syncs desktop prerequisites up and reconciles down', async () => {
  answerEveryRoomRequest();
  const actions = [
    [`/api/papers/${PAPER.slice(0, 32)}/room`, 'POST', () => callSeminar(PAPER)],
    ['/api/rooms/room-uuid/lead', 'POST', () => leadRoom('room-uuid')],
    ['/api/rooms/room-uuid/join', 'POST', () => joinRoom('room-uuid')],
    ['/api/rooms/room-uuid/unhost', 'POST', () => unhostRoom('room-uuid')],
    ['/api/rooms/room-uuid/uncall', 'POST', () => uncallSeminar('room-uuid')],
    ['/api/rooms/room-uuid/leave', 'POST', () => leaveRoom('room-uuid')],
    ['/api/rooms/room-uuid/messages', 'POST', () => postRoomMessage('room-uuid', 'Hello')],
    ['/api/rooms/room-uuid/availability', 'POST', () => setRoomAvailability('room-uuid', 'Friday')],
    ['/api/rooms/room-uuid/announce', 'PUT', () => announceRoom(
      'room-uuid', 'Friday at 16:00', 'Room 2.13', 'discussion',
    )],
    ['/api/rooms/room-uuid/finish', 'POST', () => finishRoom('room-uuid')],
  ];
  for (const [, , run] of actions) {
    await run();
    // The reconciliation runs in the background; each is let finish, so
    // one action's cannot absorb the next one's.
    await native.until(() => !nativeSyncInProgress(), { what: 'the reconciling sync' });
  }

  assert.deepEqual(syncModes(), actions.flatMap(() => ['push', 'full']));
  assert.deepEqual(roomRequests(), actions.map(([path, method]) => [path, method]));
});

test('a seminar mutation offline is refused before anything is sent', async () => {
  answerEveryRoomRequest();
  enterOfflineMode();
  await assert.rejects(joinRoom('room-uuid'), { name: 'OnlineRequiredError' });
  assert.deepEqual(native.argsOf('sync_now'), []);
  assert.deepEqual(native.requests(), []);
});

test('a seminar mutation whose prerequisites cannot be pushed is not sent', async () => {
  // The server would be asked about rows it has not seen.
  answerEveryRoomRequest();
  native.on('sync_now', () => { throw 'error sending request: connection refused'; });
  await assert.rejects(joinRoom('room-uuid'), { name: 'OnlineRequiredError' });
  assert.deepEqual(syncModes(), ['push']);
  assert.deepEqual(native.requests(), []);
});
