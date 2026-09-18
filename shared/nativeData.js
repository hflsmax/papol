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

export const REPORTABLE_NATIVE_ERROR_EVENT = 'papol-reportable-native-error';

export function isReportableNativeBridgeError(error) {
  const message = error?.message || String(error || '');
  return /native bridge.*unavailable|command.*(?:not allowed|not found)|unknown command/i.test(message);
}

export function isOfflineNativeSyncError(error) {
  const message = error?.message || String(error || '');
  return /\b(?:network|offline|dns|tcp|tls|certificate)\b|connect(?:ion)? (?:error|failed|refused|reset)|error (?:sending request|trying to connect)|timed? out|timeout/i.test(message);
}

export function isReportableNativeSyncError(error) {
  const message = error?.message || String(error || '');
  return /applying (?:pushed rows|snapshot|pull page) failed|local database|database lock|constraint failed|server (?:sent|row)|push result row|pulled row|synchronized columns/i.test(message);
}

function announceReportableNativeError(error, area) {
  if (typeof CustomEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(REPORTABLE_NATIVE_ERROR_EVENT, {
    detail: { error, area },
  }));
}

function handleNativeSyncFailure(error) {
  if (isOfflineNativeSyncError(error)) enterOfflineMode();
  else exitOfflineMode();
  if (isReportableNativeSyncError(error)) {
    announceReportableNativeError(error, 'synchronizing local data');
  }
}

// Tauri broadcasts coordinator status to every webview. Latch failures in
// each window so a sync started in the library also makes the viewer and
// board surfaces stop issuing backend requests.
function listenForSyncStatus() {
  if (!IS_DESKTOP || syncStatusListening) return;
  syncStatusListening = true;
  listen('papol://sync-status', (event) => {
    if (event.payload?.error) handleNativeSyncFailure(event.payload.error);
    else if (Number.isFinite(event.payload?.cursor)) exitOfflineMode();
  }).catch(() => { syncStatusListening = false; });
}

// Applications own their Tauri dependency and supply it at composition time;
// this shared service owns only Papol's native data contract.
export function configureNativeBridge(bridge) {
  if (typeof bridge?.invoke !== 'function' || typeof bridge?.listen !== 'function') {
    throw new TypeError('Native bridge requires invoke and listen functions');
  }
  invoke = async (command, parameters) => {
    try {
      return await bridge.invoke(command, parameters);
    } catch (error) {
      // ACL and command-registration mismatches are application defects, not
      // user-recoverable failures. Announce them even when the calling screen
      // catches the rejection to show an inline message.
      if (isReportableNativeBridgeError(error)) {
        announceReportableNativeError(error, `native command ${command}`);
      }
      throw error;
    }
  };
  listen = bridge.listen;
  listenForSyncStatus();
}

function announceNativeSyncState() {
  window.dispatchEvent(new Event('papol-offline-status'));
}

export function recordDiagnosticEvent({ level = 'info', component, event, message = null, fields = null }) {
  if (!IS_DESKTOP) return Promise.resolve();
  return invoke('diagnostic_log', { level, component, event, message, fields }).catch(() => {});
}

export function recentDiagnosticEvents(limit = 80) {
  if (!IS_DESKTOP) return Promise.resolve([]);
  return invoke('diagnostic_recent', { limit });
}

export function openDiagnosticLogsInFinder() {
  if (!IS_DESKTOP) return Promise.resolve();
  return invoke('open_diagnostic_logs');
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

// The demo's user lives in the page, never in the local replica.
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

async function nativeQuery(queryName, parameters = {}) {
  const accountUuid = nativeAccountUuid();
  if (accountUuid == null) throw new Error('Local data requires a signed-in account');
  try {
    return await invoke('data_query', { accountUuid, queryName, parameters });
  } catch (error) {
    void recordDiagnosticEvent({
      level: 'error', component: 'native_data', event: 'query_failed',
      message: error?.message || String(error),
      fields: { operation: queryName },
    });
    throw error;
  }
}

async function nativeMutate(changes) {
  const accountUuid = nativeAccountUuid();
  if (accountUuid == null) throw new Error('Local data requires a signed-in account');
  const started = Date.now();
  let receipt;
  try {
    receipt = await invoke('data_mutate', { accountUuid, changes });
  } catch (error) {
    void recordDiagnosticEvent({
      level: 'error', component: 'native_data', event: 'mutation_failed',
      message: error?.message || String(error),
      fields: { operation: 'data_mutate', total: changes.length },
    });
    throw error;
  }
  void recordDiagnosticEvent({
    component: 'native_data', event: 'mutation_committed',
    fields: { duration_ms: Date.now() - started, total: changes.length },
  });
  window.dispatchEvent(new Event('papol-offline-status'));
  scheduleAutomaticNativeSync();
  return receipt;
}

// This is the local replica's public data interface. Query names and parameter
// shapes belong here rather than in screens or product APIs; `transact` remains
// intentionally batch-oriented so related offline changes stay atomic.
export const nativeRepository = Object.freeze({
  account: () => nativeQuery('account'),
  board: (uuid) => nativeQuery('board', { uuid }),
  boardGroup: (uuid) => nativeQuery('board_group', { uuid }),
  boards: () => nativeQuery('boards'),
  // Every annotation on a paper, narrowed to one kind when the caller
  // wants less.
  annotations: (paperSha256, kind = null) => nativeQuery(
    'annotations', { paper_sha256: paperSha256, kind },
  ),
  copies: () => nativeQuery('copies'),
  copyTags: () => nativeQuery('copy_tags'),
  nook: () => nativeQuery('nook'),
  paper: (uuid) => nativeQuery('paper', { uuid }),
  paperByPdf: (sha256) => nativeQuery('paper_by_pdf', { sha256 }),
  papers: () => nativeQuery('papers'),
  shelves: () => nativeQuery('shelves'),
  storageStatus: () => nativeQuery('storage_status'),
  syncStatus: () => nativeQuery('sync_status'),
  tags: () => nativeQuery('tags'),
  transact: (changes) => nativeMutate(changes),
});

export async function importNativeSharedPaper(paper) {
  const accountUuid = nativeAccountUuid();
  if (accountUuid == null) throw new Error('Local data requires a signed-in account');
  const createdAt = paper?.created_at || new Date().toISOString();
  const rows = [{
    table: 'papers', doi: paper.doi ?? null,
    title: paper.title, authors: paper.authors ?? null, journal: paper.journal ?? null,
    year: paper.year ?? null, file_path: paper.file_path ?? null,
    sha256: paper.sha256, created_at: createdAt, updated_at: createdAt,
    revision: Number.isInteger(paper.revision) ? paper.revision : 0, deleted_at: null,
  }];
  return invoke('import_shared_paper', { accountUuid, rows });
}

export async function nativeBlobImport(blob) {
  if (!nativeDataActive()) throw new Error('Local files require a signed-in desktop account');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke('blob_import', { bytes, mimeType: blob.type || null });
}

// Product media is a disposable cache, not user data. It is available before
// sign-in and is verified by its published digest before the native store
// adopts it. The content-addressed store ensures another surface cannot save
// a second copy of the same bytes.
export async function nativeBlobCache(expectedSha256, blob, mimeType = blob.type || null) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await invoke('blob_cache', {
    expectedSha256,
    bytes,
    mimeType,
  });
  return bytes;
}

export async function nativeBlobBytes(sha256) {
  // Keep the read itself strictly local. A viewer that deliberately wants to
  // recover a missing handed-off file uses ensureNativeBlob before retrying.
  const bytes = await invoke('blob_read', { sha256 });
  return new Uint8Array(bytes);
}

// A handed-off document can arrive before its PDF has reached this Mac. Fetch
// that one content-addressed file directly, instead of making the reader wait
// for an account-wide synchronization to walk every pending row and blob.
export async function ensureNativeBlob(sha256, onProgress) {
  const token = currentCredential();
  if (!nativeDataActive() || !token) {
    throw new Error('Downloading this PDF requires a signed-in account');
  }
  onProgress?.({ sha256, fraction: 0, bytes: 0, bytes_per_second: 0 });
  const stop = subscribeNativeEvents(['papol://blob-progress'], (progress) => {
    if (progress?.sha256 === sha256) onProgress?.(progress);
  });
  try {
    await invoke('blob_ensure', {
      backendUrl: nativeBackendUrl(), token, sha256,
    });
  } finally {
    stop();
  }
}

export async function nativeBlobUrl(sha256, mimeType = 'application/octet-stream') {
  return URL.createObjectURL(new Blob([await nativeBlobBytes(sha256)], { type: mimeType }));
}

export function nativeStorageStatus() {
  return nativeRepository.storageStatus();
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

// Everything queued, conflicted or not yet uploaded, written out as a zip.
// Reachable from the compatibility bar, because a user being asked to
// replace the application needs somewhere to put the work only this copy
// holds before they do.
export function exportNativeRecovery(accountUuid = nativeAccountUuid()) {
  if (!IS_DESKTOP || accountUuid == null) return Promise.resolve(null);
  return invoke('local_recovery_export', { accountUuid });
}

// What the synchronizer last heard about this build. Written natively when
// a push or pull is refused with 426, and read here at startup so a window
// opened offline carries the verdict rather than starting hopeful.
export async function nativeCompatibilityVerdict() {
  if (!IS_DESKTOP) return null;
  try {
    return await invoke('local_setting_get', { key: 'client_compatibility' });
  } catch {
    return null;
  }
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

export async function nativeSyncNow({ manual = false, pushOnly = false, pullOnly = false } = {}) {
  const accountUuid = nativeAccountUuid();
  const token = currentCredential();
  if (!IS_DESKTOP || accountUuid == null || !token) return null;
  if (inOfflineMode() && !manual) throw new OnlineRequiredError();
  activeNativeSyncs += 1;
  announceNativeSyncState();
  try {
    try {
      const result = await invoke('sync_now', {
        request: {
          accountUuid,
          backendUrl: nativeBackendUrl(),
          token,
          pushOnly,
          pullOnly,
          retryBlocked: manual,
        },
      });
      exitOfflineMode();
      return result;
    } catch (error) {
      handleNativeSyncFailure(error);
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

export function scheduleNativeSync({ pullOnly = false } = {}) {
  if (scheduledSync) {
    // An automatic-upload request arriving during a pull-only pass must run
    // after it; otherwise that local change could wait for another trigger.
    if (!pullOnly && scheduledSync.pullOnly) {
      return scheduledSync.then(() => scheduleNativeSync());
    }
    return scheduledSync;
  }
  scheduledSync = Promise.resolve()
    .then(() => nativeSyncNow({ pullOnly }))
    .catch(() => null)
    .finally(() => {
      scheduledSync = null;
      announceNativeSyncState();
    });
  announceNativeSyncState();
  scheduledSync.pullOnly = pullOnly;
  return scheduledSync;
}

export function scheduleAutomaticNativeSync() {
  return scheduleNativeSync({
    pullOnly: getLocalSyncPreference() !== 'automatic',
  });
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
  return subscribeNativeEvents([
    'papol://account-changed', 'papol://data-changed', 'papol://sync-status',
  ], listener);
}

export function subscribeNativeHandoffs(listener) {
  return subscribeNativeEvents(['papol://handoff-received'], listener);
}

export function isNativeSyncResult(payload) {
  return Number.isFinite(payload?.pushed) && Number.isFinite(payload?.pulled);
}

// Successful push-only and full/pull-only runs all carry both counters. This
// deliberately excludes the adjacent {syncing:false} status event so callers
// refresh shared online state exactly once per completed synchronization.
export function subscribeNativeSyncResults(listener) {
  return subscribeNativeEvents(['papol://sync-status'], (payload) => {
    if (isNativeSyncResult(payload)) listener(payload);
  });
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
      if (disposed) stopNativeListener(stop);
      else unlisteners.push(stop);
    });
  }
  return () => {
    disposed = true;
    unlisteners.splice(0).forEach((stop) => stopNativeListener(stop));
  };
}

// Tauri 2.11 can resolve listen() before WebKit has evaluated the script that
// installs its page-side listener entry. React Strict Mode then cleans up the
// first mount immediately, and unlisten() rejects while looking up that entry.
// Retrying on the next task lets the pending eval land and, importantly, lets
// Tauri remove both the JavaScript callback and its backend listener.
function stopNativeListener(stop, retries = 2) {
  Promise.resolve().then(stop).catch(() => {
    if (retries > 0) setTimeout(() => stopNativeListener(stop, retries - 1), 0);
  });
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
    if (UUID.test(payload?.paper_sha256 || '')) listener(payload.paper_sha256.toLowerCase());
  });
}

export function pdfViewerStatus() {
  if (!IS_DESKTOP) return Promise.resolve({ supported: false, is_default: false });
  return invoke('pdf_viewer_status');
}

export function makePdfViewerDefault() {
  return invoke('pdf_viewer_make_default');
}

export function dismissPdfViewerPrompt() {
  if (!IS_DESKTOP) return Promise.resolve();
  return invoke('pdf_viewer_prompt_dismiss');
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

// One shape for every kind of annotation: the geometry that differs between
// them travels as JSON in `body`, so reading a row back is the same work
// whether it is a note, a stroke or a clip.
export function annotationView(row) {
  return { ...row, body: parsedJson(row.body, {}) };
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
    is_public: bool(row.is_public),
    is_author: bool(row.is_author),
    viewer_has_entry: true,
    viewer_has_copy: bool(row.is_public),
  };
}

if (typeof window !== 'undefined' && IS_DESKTOP) {
  hydrateNativeSyncPreference().catch(() => {});
  window.addEventListener('online', () => {
    exitOfflineMode();
    scheduleAutomaticNativeSync();
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && globalThis.navigator?.onLine !== false) {
        exitOfflineMode();
        scheduleAutomaticNativeSync();
      }
    });
  }
}
