import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { IS_DESKTOP } from '../../shared/appEnvironment.js';
import {
  clearOfflineData, getLocalSyncPreference, setLocalSyncPreference, syncOfflineQueue,
} from '../../shared/offlineStore.js';
import { BACKEND_BASE, inDemo } from './base.js';
import { currentCredential } from '../../shared/credentials.js';

const ACCOUNT_KEY = 'papol.localAccountUuid';
// Accounts are named by UUID; anything else in storage is not an account.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let scheduledSync = null;

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

export async function clearNativeData() {
  const removed = await invoke('local_clear_data');
  await clearOfflineData();
  window.dispatchEvent(new Event('papol-offline-status'));
  return removed;
}

export async function removeNativeAccount(accountUuid) {
  if (!IS_DESKTOP || !UUID.test(accountUuid || '')) return 0;
  // IndexedDB is not keyed by account. Clear it in full so no response or
  // queued request survives sign-out.
  await clearOfflineData();
  const removed = await invoke('local_account_remove', { accountUuid });
  return removed;
}

export function discardNativeBlob(sha256) {
  return invoke('blob_discard', { sha256 });
}

export async function nativeSyncNow() {
  const accountUuid = nativeAccountUuid();
  const token = currentCredential();
  if (!IS_DESKTOP || accountUuid == null || !token) return null;
  try {
    return await invoke('sync_now', {
      accountUuid,
      backendUrl: nativeBackendUrl(),
      token,
    });
  } finally {
    // Failed automatic syncs are caught by the scheduler, but status still
    // needs to refresh in the window that initiated them.
    window.dispatchEvent(new Event('papol-offline-status'));
  }
}

// A user-initiated sync, from the sidebar or Settings: drain the IndexedDB
// request queue first, then the native replica. Resolves to the first
// failure message, or null.
export async function syncAllNow() {
  const queued = await Promise.allSettled([syncOfflineQueue()]);
  const native = await Promise.allSettled([
    nativeDataActive() ? nativeSyncNow() : Promise.resolve(),
  ]);
  const failure = [...queued, ...native].find((result) => result.status === 'rejected');
  if (failure) return failure.reason?.message || String(failure.reason);
  try { sessionStorage.setItem('papol.syncPullUntil', String(Date.now() + 15_000)); } catch { /* best effort */ }
  return null;
}

export function scheduleNativeSync() {
  if (scheduledSync) return scheduledSync;
  scheduledSync = Promise.resolve()
    .then(nativeSyncNow)
    .catch(() => null)
    .finally(() => { scheduledSync = null; });
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
