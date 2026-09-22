import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT, installNativeHarness } from '../../shared/testing/nativeHarness.js';

const native = await installNativeHarness();
const { inOfflineMode, enterOfflineMode } = await import('../../shared/connectivity.js');
const {
  hydrateNativeSyncPreference, isNativeSyncResult, isOfflineNativeSyncError,
  isReportableNativeBridgeError, isReportableNativeSyncError, nativeDataActive, nativeSyncInProgress,
  nativeSyncNow, prepareNativeAccount, removeNativeAccount, scheduleAutomaticNativeSync,
  setNativeAccount, syncAllNow, REPORTABLE_NATIVE_ERROR_EVENT,
} = await import('../../shared/nativeData.js');

const syncRequests = () => native.argsOf('sync_now').map(({ request }) => request);

test('native SQLite is authoritative for the local sync preference', async () => {
  native.storage.set('papol.syncPreference', 'automatic');
  native.settings.set('sync_mode', 'manual');
  assert.equal(await hydrateNativeSyncPreference(), 'manual');
  assert.equal(native.storage.get('papol.syncPreference'), 'manual');
});

test('a preference SQLite does not hold yet is written there from the window', async () => {
  native.settings.delete('sync_mode');
  native.storage.set('papol.syncPreference', 'automatic');
  assert.equal(await hydrateNativeSyncPreference(), 'automatic');
  assert.equal(native.settings.get('sync_mode'), 'automatic');
});

test('native command contract failures are reportable application errors', () => {
  // What the bridge rejects with is the command's Err string, not an Error.
  assert.equal(isReportableNativeBridgeError('Command import_shared_paper not allowed by ACL'), true);
  assert.equal(isReportableNativeBridgeError('Command import_shared_paper not found'), true);
  assert.equal(isReportableNativeBridgeError(new Error('Unknown command import_shared_paper')), true);
  assert.equal(isReportableNativeBridgeError('network unavailable'), false);
});

test('sync failures distinguish connectivity from reportable local defects', async () => {
  assert.equal(isOfflineNativeSyncError('error sending request: connection refused'), true);
  assert.equal(isOfflineNativeSyncError('UNIQUE constraint failed'), false);
  assert.equal(isReportableNativeSyncError('Applying pushed rows failed: UNIQUE constraint failed'), true);

  native.on('sync_now', () => { throw 'Applying pushed rows failed: UNIQUE constraint failed'; });
  await assert.rejects(nativeSyncNow(), (failure) => {
    assert.equal(failure, 'Applying pushed rows failed: UNIQUE constraint failed');
    return true;
  });
  // A local defect is not a lost connection: Papol stays online, and the
  // error is offered for reporting.
  assert.equal(inOfflineMode(), false);
  const reported = native.events.find((event) => event.type === REPORTABLE_NATIVE_ERROR_EVENT);
  assert.equal(reported?.detail.area, 'synchronizing local data');
  assert.match(String(reported.detail.error), /UNIQUE constraint failed/);
});

test('manual mode automatically pulls without uploading local changes', async () => {
  native.storage.set('papol.syncPreference', 'manual');
  await scheduleAutomaticNativeSync();
  assert.equal(syncRequests().at(-1).mode, 'pull');
});

test('automatic mode permits uploads during background reconciliation', async () => {
  native.storage.set('papol.syncPreference', 'automatic');
  await scheduleAutomaticNativeSync();
  assert.equal(syncRequests().at(-1).mode, 'full');
});

test('a failed native sync announces its start and its end, and latches offline', async () => {
  native.on('sync_now', () => { throw 'error sending request: network unavailable'; });
  await assert.rejects(nativeSyncNow(), /network unavailable/);
  const statuses = native.eventTypes().filter((type) => type === 'papol-offline-status');
  assert.ok(statuses.length >= 2, 'announced as it started and again as it ended');
  assert.equal(nativeSyncInProgress(), false);
  assert.equal(inOfflineMode(), true);

  // Latched offline, an automatic sync is not even tried...
  await assert.rejects(nativeSyncNow(), { name: 'OnlineRequiredError' });
  assert.equal(syncRequests().length, 1);
  // ...and the user's own Sync reconnects.
  native.on('sync_now', () => ({ pushed: 0, pulled: 0, cursor: 2 }));
  assert.equal(await syncAllNow(), null);
  assert.equal(syncRequests().length, 2);
  assert.equal(inOfflineMode(), false);
});

test('a user sync that fails says why in a sentence', async () => {
  native.on('sync_now', () => { throw 'error sending request: connection refused'; });
  assert.match(await syncAllNow(), /offline/i);
});

test('native sync activity is visible to screens mounted during sign-in', async () => {
  const gate = native.gate();
  native.on('sync_now', async () => { await gate.promise; return { pushed: 0, pulled: 0, cursor: 1 }; });
  const syncing = nativeSyncNow();
  assert.equal(nativeSyncInProgress(), true);
  gate.open();
  await syncing;
  assert.equal(nativeSyncInProgress(), false);
});

test('a successful native sync clears the offline latch', async () => {
  enterOfflineMode();
  await nativeSyncNow({ manual: true });
  assert.equal(inOfflineMode(), false);
  assert.equal(syncRequests().at(-1).retryBlocked, true);
});

test('a server prerequisite uses push-only sync', async () => {
  await nativeSyncNow({ manual: true, mode: 'push' });
  assert.equal(syncRequests().at(-1).mode, 'push');
  assert.equal(syncRequests().at(-1).retryBlocked, true);
});

test('a sync carries the account, the backend and the session to the Mac', async () => {
  await nativeSyncNow();
  const request = syncRequests().at(-1);
  assert.equal(request.accountUuid, ACCOUNT);
  assert.match(request.backendUrl, /^https?:\/\//);
  assert.equal(request.token, 'secret-token');
});

test('successful uplink and downlink results both identify completed syncs', () => {
  assert.equal(isNativeSyncResult({ pushed: 2, pulled: 0, cursor: 4 }), true);
  assert.equal(isNativeSyncResult({ pushed: 0, pulled: 3, cursor: 7 }), true);
  assert.equal(isNativeSyncResult({ syncing: false }), false);
  assert.equal(isNativeSyncResult({ error: 'network unavailable' }), false);
});

test('signing in activates the native replica for that account', async () => {
  setNativeAccount(null);
  assert.equal(nativeDataActive(), false);
  assert.equal(await prepareNativeAccount({ uuid: ACCOUNT }), true);
  assert.equal(nativeDataActive(), true);
  assert.deepEqual(native.lastArgs('local_account_set'), { accountUuid: ACCOUNT, profile: { uuid: ACCOUNT } });
});

test('a replica the Mac cannot prepare leaves the window signed out of it', async () => {
  setNativeAccount(null);
  native.on('local_account_set', () => { throw 'Local database lock failed'; });
  await assert.rejects(prepareNativeAccount({ uuid: ACCOUNT }), (failure) => failure === 'Local database lock failed');
  assert.equal(nativeDataActive(), false);
});

test('sign-out removes only the active native account replica', async () => {
  native.on('local_account_remove', () => 2);
  assert.equal(await removeNativeAccount(ACCOUNT), 2);
  assert.deepEqual(native.argsOf('local_account_remove'), [{ accountUuid: ACCOUNT }]);
  assert.ok(native.eventTypes().includes('papol-offline-status'));
});
