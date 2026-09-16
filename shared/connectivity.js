import { IS_DESKTOP } from './appEnvironment.js';

// Connectivity is process-external state, not a data store. Papol macOS's
// user data lives in SQLite; HTTP requests are always real network requests.
const LOCAL_SYNC_PREFERENCE_KEY = 'papol.syncPreference';

export const OFFLINE_MODE_MESSAGE = 'Papol is offline. Your local data is still available. Choose Sync to reconnect.';

let remoteNetworkFetch = (...args) => globalThis.fetch(...args);
let offlineMode = false;
let syncStatus = {
  pending: 0,
  syncing: false,
  offline: IS_DESKTOP && typeof navigator !== 'undefined' ? navigator.onLine === false : false,
  error: null,
  lastSynced: null,
};

const offlineModeChannel = IS_DESKTOP && typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function'
  ? new window.BroadcastChannel('papol-offline-mode')
  : null;

function storedSetting(key, fallback = null) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function notify(detail) {
  syncStatus = {
    ...syncStatus,
    ...detail,
    pending: detail.pending ?? syncStatus.pending,
    offline: offlineMode || (detail.offline ?? syncStatus.offline),
  };
  try {
    window.dispatchEvent(new CustomEvent('papol-offline-status', { detail }));
  } catch { /* no DOM */ }
}

export function configureNetworkFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Network fetch must be a function');
  remoteNetworkFetch = fetchImpl;
}

// HTTP(S) leaves the bundled UI through Tauri's native client. Bundled asset
// protocols remain in the WebView. No response is cached at this boundary.
export function runtimeFetch(input, options = {}) {
  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  let protocol = '';
  try { protocol = new URL(rawUrl, globalThis.location?.href).protocol; } catch { /* fetch reports malformed URLs */ }
  const requestOptions = { ...options, cache: options.cache ?? 'no-store' };
  if (/^https?:$/.test(protocol)) {
    if (IS_DESKTOP && offlineMode) return Promise.reject(new OnlineRequiredError());
    return remoteNetworkFetch(input, requestOptions);
  }
  return globalThis.fetch(input, requestOptions);
}

export function inOfflineMode() {
  return IS_DESKTOP && offlineMode;
}

export function enterOfflineMode() {
  if (!IS_DESKTOP) return;
  offlineMode = true;
  notify({ offline: true });
  offlineModeChannel?.postMessage({ offline: true });
}

export function exitOfflineMode() {
  if (!IS_DESKTOP) return;
  offlineMode = false;
  notify({ offline: typeof navigator !== 'undefined' && navigator.onLine === false, error: null });
  offlineModeChannel?.postMessage({ offline: false });
}

export function getLocalSyncPreference() {
  if (!IS_DESKTOP) return 'automatic';
  return storedSetting(LOCAL_SYNC_PREFERENCE_KEY, 'automatic');
}

export function setLocalSyncPreference(preference) {
  if (!['automatic', 'manual'].includes(preference)) throw new Error('Unknown sync preference');
  if (!IS_DESKTOP) return;
  try { localStorage.setItem(LOCAL_SYNC_PREFERENCE_KEY, preference); } catch { /* best effort */ }
  notify({ preference });
}

export function getSyncStatus() {
  return { ...syncStatus, preference: getLocalSyncPreference() };
}

export function refreshSyncStatus() {
  return Promise.resolve(getSyncStatus());
}

export class OnlineRequiredError extends Error {
  constructor() {
    super(OFFLINE_MODE_MESSAGE);
    this.name = 'OnlineRequiredError';
    this.code = 'PAPOL_OFFLINE';
  }
}

if (offlineModeChannel) {
  offlineModeChannel.onmessage = (event) => {
    if (event.data?.requestState) {
      if (offlineMode) offlineModeChannel.postMessage({ offline: true });
      return;
    }
    if (typeof event.data?.offline !== 'boolean') return;
    offlineMode = event.data.offline;
    notify({ offline: offlineMode || (typeof navigator !== 'undefined' && navigator.onLine === false) });
  };
  offlineModeChannel.postMessage({ requestState: true });
}

if (IS_DESKTOP && typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (!offlineMode) notify({ offline: false });
  });
  window.addEventListener('offline', () => notify({ offline: true }));
}
