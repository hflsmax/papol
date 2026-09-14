import { nativeDataActive, nativeSyncNow, scheduleNativeSync } from '../nativeData.js';
import { inOfflineMode, OnlineRequiredError } from '../connectivity.js';

// Operations absent from the local replica first publish pending dependencies;
// their authoritative result is reconciled into SQLite in the background.
export async function onServer(send, { pull = true } = {}) {
  if (!nativeDataActive()) return send();
  if (inOfflineMode() || globalThis.navigator?.onLine === false) {
    throw new OnlineRequiredError();
  }
  try {
    // Publish only the dependencies this server action may refer to. Snapshot,
    // pull, and unrelated downloads belong to the background reconciliation.
    await nativeSyncNow({ pushOnly: true });
  } catch {
    throw new OnlineRequiredError();
  }
  const result = await send();
  // The server response is enough to complete the requested online action.
  // Reconcile its authoritative rows in the background so an unrelated
  // snapshot or blob download never holds the control that initiated it.
  if (pull) void scheduleNativeSync().catch(() => {});
  return result;
}
