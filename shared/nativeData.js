import { IS_DESKTOP } from './appEnvironment.js';
import {
  enterOfflineMode, exitOfflineMode, getLocalSyncPreference,
  inOfflineMode, OFFLINE_MODE_MESSAGE, OnlineRequiredError, setLocalSyncPreference,
} from './connectivity.js';
import { BACKEND_BASE, inDemo } from './appUrls.js';
import { currentCredential } from './credentials.js';

const ACCOUNT_KEY = 'papol.localAccountUuid';
// Accounts are named by UUID; anything else in storage is not an account.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let scheduledSync = null;
let activeNativeSyncs = 0;
let syncStatusListening = false;
let invoke = (command, parameters) => {
  const nativeInvoke = globalThis.window?.__TAURI_INTERNALS__?.invoke;
  if (typeof nativeInvoke !== 'function') return Promise.reject(new Error('Native bridge is unavailable'));
  return nativeInvoke(command, parameters);
};
let listen = () => Promise.resolve(() => {});

// Tauri broadcasts coordinator status to every webview. Latch failures in
// each window so a sync started in the library also makes the viewer and
// board surfaces stop issuing backend requests.
function listenForSyncStatus() {
  if (!IS_DESKTOP || syncStatusListening) return;
  syncStatusListening = true;
  listen('papol://sync-status', (event) => {
    if (event.payload?.error) enterOfflineMode();
    else if (Number.isFinite(event.payload?.cursor)) exitOfflineMode();
  }).catch(() => { syncStatusListening = false; });
}

// Applications own their Tauri dependency and supply it at composition time;
// this shared service owns only Papol's native data contract.
export function configureNativeBridge(bridge) {
  if (typeof bridge?.invoke !== 'function' || typeof bridge?.listen !== 'function') {
    throw new TypeError('Native bridge requires invoke and listen functions');
  }
  invoke = bridge.invoke;
  listen = bridge.listen;
  listenForSyncStatus();
}

function announceNativeSyncState() {
  window.dispatchEvent(new Event('papol-offline-status'));
}

// Native events are attached asynchronously. Keeping the lifecycle here as
// well lets a screen mounted immediately after sign-in know that the initial
// sync is already running, even if it missed the first Tauri event.
export function nativeSyncInProgress() {
  return activeNativeSyncs > 0 || scheduledSync != null;
}

function nativeBackendUrl() {
  const value = BACKEND_BASE || window.location.origin;
  if (!/^https?:\/\//.test(value)) {
    throw new Error('Desktop backend is not configured');
  }
  return value;
}

export function setNativeAccount(user) {
  if (!IS_DESKTOP) return;
  if (user?.uuid != null) localStorage.setItem(ACCOUNT_KEY, String(user.uuid));
  else localStorage.removeItem(ACCOUNT_KEY);
}

// The demo's reader lives in the page, never in the local replica.
export async function prepareNativeAccount(user) {
  if (!IS_DESKTOP || inDemo() || user?.uuid == null) return false;
  await invoke('local_account_set', { accountUuid: user.uuid, profile: user });
  setNativeAccount(user);
  return true;
}

export function nativeAccountUuid() {
  if (!IS_DESKTOP) return null;
  const value = localStorage.getItem(ACCOUNT_KEY);
  return UUID.test(value || '') ? value : null;
}

export function nativeDataActive() {
  return !inDemo() && nativeAccountUuid() != null;
}

export async function nativeQuery(queryName, parameters = {}) {
  const accountUuid = nativeAccountUuid();
  if (accountUuid == null) throw new Error('Local data requires a signed-in account');
  return invoke('data_query', { accountUuid, queryName, parameters });
}

export async function nativeMutate(changes) {
  const accountUuid = nativeAccountUuid();
  if (accountUuid == null) throw new Error('Local data requires a signed-in account');
  const receipt = await invoke('data_mutate', { accountUuid, changes });
  window.dispatchEvent(new Event('papol-offline-status'));
  if (getLocalSyncPreference() === 'automatic') scheduleNativeSync();
  return receipt;
}

export async function cacheNativeSharedPaper(paper) {
  const accountUuid = nativeAccountUuid();
  if (accountUuid == null) throw new Error('Local data requires a signed-in account');
  const createdAt = paper?.created_at || new Date().toISOString();
  const rows = [{
    table: 'papers', uuid: paper.uuid, doi: paper.doi ?? null,
    title: paper.title, authors: paper.authors ?? null, journal: paper.journal ?? null,
    year: paper.year ?? null, created_at: createdAt, updated_at: createdAt,
    revision: Number.isInteger(paper.revision) ? paper.revision : 0, deleted_at: null,
  }, ...(paper.editions || []).map((edition) => ({
    table: 'paper_editions', uuid: edition.uuid, paper_uuid: paper.uuid,
    file_path: edition.file_path, sha256: edition.sha256 ?? null,
    created_at: edition.created_at || createdAt,
    updated_at: edition.created_at || createdAt,
    revision: Number.isInteger(edition.revision) ? edition.revision : 0,
    deleted_at: null,
  }))];
  return invoke('shared_paper_cache', { accountUuid, rows });
}

export async function nativeBlobImport(blob) {
  if (!nativeDataActive()) throw new Error('Local files require a signed-in desktop account');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke('blob_import', { bytes, mimeType: blob.type || null });
}

export async function nativeBlobBytes(sha256) {
  // Rendering is strictly local. Synchronization hydrates every referenced
  // blob before it reports success; views must never initiate network I/O.
  const bytes = await invoke('blob_read', { sha256 });
  return new Uint8Array(bytes);
}

export async function nativeBlobUrl(sha256, mimeType = 'application/octet-stream') {
  return URL.createObjectURL(new Blob([await nativeBlobBytes(sha256)], { type: mimeType }));
}

export function nativeStorageStatus() {
  return nativeQuery('storage_status');
}

export function openNativeStorageInFinder() {
  if (!IS_DESKTOP) return Promise.resolve();
  return invoke('open_storage_in_finder');
}

export async function clearNativeData() {
  const removed = await invoke('local_clear_data');
  window.dispatchEvent(new Event('papol-offline-status'));
  return removed;
}

export async function removeNativeAccount(accountUuid) {
  if (!IS_DESKTOP || !UUID.test(accountUuid || '')) return 0;
  const removed = await invoke('local_account_remove', { accountUuid });
  window.dispatchEvent(new Event('papol-offline-status'));
  return removed;
}

export function discardNativeBlob(sha256) {
  return invoke('blob_discard', { sha256 });
}

export async function nativeSyncNow({ manual = false } = {}) {
  const accountUuid = nativeAccountUuid();
  const token = currentCredential();
  if (!IS_DESKTOP || accountUuid == null || !token) return null;
  if (inOfflineMode() && !manual) throw new OnlineRequiredError();
  activeNativeSyncs += 1;
  announceNativeSyncState();
  try {
    try {
      const result = await invoke('sync_now', {
        accountUuid,
        backendUrl: nativeBackendUrl(),
        token,
      });
      exitOfflineMode();
      return result;
    } catch (error) {
      enterOfflineMode();
      throw error;
    }
  } finally {
    // Failed automatic syncs are caught by the scheduler, but status still
    // needs to refresh in the window that initiated them.
    activeNativeSyncs = Math.max(0, activeNativeSyncs - 1);
    announceNativeSyncState();
  }
}

// A user-initiated sync reconciles the one local source of truth: SQLite.
// Resolves to a failure message, or null.
export async function syncAllNow() {
  exitOfflineMode();
  const native = await Promise.allSettled([
    nativeDataActive() ? nativeSyncNow({ manual: true }) : Promise.resolve(),
  ]);
  const failure = native.find((result) => result.status === 'rejected');
  if (failure) {
    const detail = failure.reason?.message || String(failure.reason || 'Sync failed');
    return `${OFFLINE_MODE_MESSAGE} (${detail})`;
  }
  if (inOfflineMode()) return OFFLINE_MODE_MESSAGE;
  try { sessionStorage.setItem('papol.syncPullUntil', String(Date.now() + 15_000)); } catch { /* best effort */ }
  return null;
}

export function scheduleNativeSync() {
  if (scheduledSync) return scheduledSync;
  scheduledSync = Promise.resolve()
    .then(nativeSyncNow)
    .catch(() => null)
    .finally(() => {
      scheduledSync = null;
      announceNativeSyncState();
    });
  announceNativeSyncState();
  return scheduledSync;
}

export function scheduleAutomaticNativeSync() {
  if (getLocalSyncPreference() !== 'automatic') return Promise.resolve(null);
  return scheduleNativeSync();
}

export function persistNativeSyncPreference(preference) {
  if (!IS_DESKTOP) return Promise.resolve();
  return invoke('local_setting_set', { key: 'sync_mode', value: preference });
}

export async function hydrateNativeSyncPreference() {
  if (!IS_DESKTOP) return getLocalSyncPreference();
  const stored = await invoke('local_setting_get', { key: 'sync_mode' });
  if (stored === 'automatic' || stored === 'manual') {
    setLocalSyncPreference(stored);
    return stored;
  }
  const fallback = getLocalSyncPreference();
  await persistNativeSyncPreference(fallback);
  return fallback;
}

export function subscribeNativeData(listener) {
  return subscribeNativeEvents(['papol://data-changed', 'papol://sync-status'], listener);
}

// Payload: { phase, completed, total, fraction, bytes, bytes_per_second }.
export function subscribeNativeSyncProgress(listener) {
  return subscribeNativeEvents(['papol://sync-progress'], listener);
}

function subscribeNativeEvents(eventNames, listener) {
  if (!IS_DESKTOP) return () => {};
  let disposed = false;
  const unlisteners = [];
  for (const eventName of eventNames) {
    listen(eventName, (event) => listener(event.payload)).then((stop) => {
      if (disposed) stop();
      else unlisteners.push(stop);
    });
  }
  return () => {
    disposed = true;
    unlisteners.splice(0).forEach((stop) => stop());
  };
}

// A PDF opened from the file system, read from where it lies on disk.
export async function openedFileBytes(sha256) {
  const bytes = await invoke('opened_file_read', { sha256 });
  return new Uint8Array(bytes);
}

export async function openedFileBlob(sha256) {
  return new Blob([await openedFileBytes(sha256)], { type: 'application/pdf' });
}

export async function openedFileUrl(sha256) {
  return URL.createObjectURL(await openedFileBlob(sha256));
}

// A file dropped on the unsigned desktop library should be read by Papol's
// viewer, not by the webview's built-in PDF renderer.
export async function openDroppedPdf(file) {
  if (!IS_DESKTOP) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await invoke('opened_file_open', { bytes, name: file.name || 'PDF document.pdf' });
}

// This device's notes, ink and clips on an opened file, by its SHA-256.
export const localAnnotations = {
  list: (sha256) => invoke('local_annotations_list', { sha256 }),
  put: (sha256, kind, uuid, row) => invoke('local_annotation_put', { sha256, kind, uuid, row }),
  remove: (uuid) => invoke('local_annotation_delete', { uuid }),
  clear: (sha256) => invoke('local_annotations_clear', { sha256 }),
};

// A document window cannot sign in itself; the library window does.
export function requestSignIn({ register = false } = {}) {
  return IS_DESKTOP ? invoke('request_sign_in', { register }) : Promise.resolve();
}

export function subscribeSignInRequests(listener) {
  return subscribeNativeEvents(['papol://sign-in-requested'], listener);
}

export function subscribeShowPaperRequests(listener) {
  return subscribeNativeEvents(['papol://show-paper-requested'], (payload) => {
    if (UUID.test(payload?.paper_uuid || '')) listener(payload.paper_uuid.toLowerCase());
  });
}

export function pdfViewerStatus() {
  if (!IS_DESKTOP) return Promise.resolve({ supported: false, is_default: false });
  return invoke('pdf_viewer_status');
}

export function makePdfViewerDefault() {
  return invoke('pdf_viewer_make_default');
}

export function newUuid() {
  return globalThis.crypto.randomUUID();
}

export function boardView(row, detail = false) {
  const bool = (value) => value === true || value === 1;
  const item = (value) => ({
    ...value,
    staged: bool(value.staged),
  });
  const items = (row.items || []).map(item);
  const stagedItems = (row.staged_items || []).map(item);
  return {
    ...row,
    can_edit: true,
    item_count: detail ? items.length : (row.item_count || 0),
    items: detail ? items : [],
    staged_items: detail ? stagedItems : [],
    groups: detail ? (row.groups || []).map((group) => ({
      ...group,
      auto_arrange: bool(group.auto_arrange),
      header: group.header || '',
    })) : [],
  };
}

function parsedJson(value, fallback) {
  if (value == null || typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function noteView(row) {
  const anchor = parsedJson(row.anchor, null);
  return {
    ...row,
    anchor: anchor && row.anchor_type ? { type: row.anchor_type, ...anchor } : null,
  };
}

export function inkView(row) {
  return { ...row, points: parsedJson(row.points, []) };
}

export function clipView(row) {
  return {
    ...row,
    source: parsedJson(row.source, {}),
    frame: parsedJson(row.frame, {}),
    floating: row.floating === true || row.floating === 1,
  };
}

export function shelfView(row) {
  const bool = (value) => value === true || value === 1;
  return {
    ...row,
    is_public: bool(row.is_public),
    is_default: bool(row.is_default),
    paper_count: row.paper_count || 0,
    board_count: row.board_count || 0,
  };
}

export function paperView(row) {
  const bool = (value) => value === true || value === 1;
  return {
    ...row,
    marketed: bool(row.marketed),
    is_author: bool(row.is_author),
    viewer_has_entry: true,
    viewer_is_reader: bool(row.marketed),
  };
}

if (typeof window !== 'undefined' && IS_DESKTOP) {
  hydrateNativeSyncPreference().catch(() => {});
  window.addEventListener('online', () => {
    scheduleAutomaticNativeSync();
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleAutomaticNativeSync();
    });
  }
}
