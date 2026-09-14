import { nativeDataActive, nativeSyncNow } from '../nativeData.js';
import { inOfflineMode, OnlineRequiredError } from '../connectivity.js';

// Operations absent from the local replica must first publish pending local
// work, then pull the authoritative result back into SQLite.
export async function onServer(send, { pull = true } = {}) {
  if (!nativeDataActive()) return send();
  if (inOfflineMode() || globalThis.navigator?.onLine === false) {
    throw new OnlineRequiredError();
  }
  try {
    await nativeSyncNow();
  } catch {
    throw new OnlineRequiredError();
  }
  const result = await send();
  if (pull) await nativeSyncNow().catch(() => {});
  return result;
}
