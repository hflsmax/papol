import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { IS_DESKTOP } from '../../shared/appEnvironment.js';
import {
  clearOfflineData, getLocalSyncPreference, refreshSyncStatus, setLocalSyncPreference,
} from '../../shared/offlineStore.js';
import { BACKEND_BASE } from './base.js';
import { currentCredential } from '../../shared/credentials.js';

const ACCOUNT_KEY = 'papol.localAccountId';
const PENDING_ACCOUNT_KEY = 'papol.pendingNativeAccountId';
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
  if (user?.id != null) localStorage.setItem(ACCOUNT_KEY, String(user.id));
  else {
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(PENDING_ACCOUNT_KEY);
  }
}

export async function prepareNativeAccount(user) {
  if (!IS_DESKTOP || user?.id == null) return false;
  await invoke('local_account_set', { accountId: user.id, profile: user });
  const compatibility = await refreshSyncStatus();
  if (compatibility.pending > 0) {
    localStorage.setItem(PENDING_ACCOUNT_KEY, String(user.id));
    localStorage.removeItem(ACCOUNT_KEY);
    return false;
  }
  setNativeAccount(user);
  localStorage.removeItem(PENDING_ACCOUNT_KEY);
  return true;
}

export async function activateNativeAfterLegacyDrain() {
  if (!IS_DESKTOP || nativeDataActive()) return nativeDataActive();
  const pendingAccount = Number(localStorage.getItem(PENDING_ACCOUNT_KEY));
  if (!Number.isSafeInteger(pendingAccount) || pendingAccount < 1) return false;
  const compatibility = await refreshSyncStatus();
  if (compatibility.pending > 0) return false;
  localStorage.setItem(ACCOUNT_KEY, String(pendingAccount));
  localStorage.removeItem(PENDING_ACCOUNT_KEY);
  await nativeSyncNow();
  window.dispatchEvent(new Event('papol-offline-status'));
  return true;
}

export function nativeAccountId() {
  if (!IS_DESKTOP) return null;
  const value = Number(localStorage.getItem(ACCOUNT_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function nativeDataActive() {
  return nativeAccountId() != null;
}

export async function nativeQuery(queryName, parameters = {}) {
  const accountId = nativeAccountId();
  if (accountId == null) throw new Error('Local data requires a signed-in account');
  return invoke('data_query', { accountId, queryName, parameters });
}

export async function nativeMutate(changes) {
  const accountId = nativeAccountId();
  if (accountId == null) throw new Error('Local data requires a signed-in account');
  const receipt = await invoke('data_mutate', { accountId, changes });
  window.dispatchEvent(new Event('papol-offline-status'));
  if (getLocalSyncPreference() === 'automatic') scheduleNativeSync();
  return receipt;
}

export async function nativeBlobImport(blob) {
  if (!nativeDataActive()) throw new Error('Local files require a signed-in desktop account');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke('blob_import', { bytes, mimeType: blob.type || null });
}

export async function nativeBlobUrl(sha256, mimeType = 'application/octet-stream') {
  let bytes;
  try {
    bytes = await invoke('blob_read', { sha256 });
  } catch (readError) {
    const token = currentCredential();
    if (!token) throw readError;
    await invoke('blob_ensure', {
      backendUrl: nativeBackendUrl(),
      token,
      sha256,
    });
    bytes = await invoke('blob_read', { sha256 });
  }
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
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

export function discardNativeBlob(sha256) {
  return invoke('blob_discard', { sha256 });
}

export async function nativeSyncNow() {
  const accountId = nativeAccountId();
  const token = currentCredential();
  if (!IS_DESKTOP || accountId == null || !token) return null;
  try {
    return await invoke('sync_now', {
      accountId,
      backendUrl: nativeBackendUrl(),
      token,
    });
  } finally {
    // Failed automatic syncs are caught by the scheduler, but status still
    // needs to refresh in the window that initiated them.
    window.dispatchEvent(new Event('papol-offline-status'));
  }
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
  if (!IS_DESKTOP) return () => {};
  let disposed = false;
  const unlisteners = [];
  for (const eventName of ['papol://data-changed', 'papol://sync-status']) {
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

export function uuid() {
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
    guid: row.id,
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
    sync_id: row.id,
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
  window.addEventListener('papol-offline-status', () => {
    activateNativeAfterLegacyDrain().catch(() => {});
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleAutomaticNativeSync();
    });
  }
}
