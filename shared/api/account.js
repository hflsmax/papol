import { IS_DESKTOP } from '../appEnvironment.js';
import {
  nativeAccountUuid, nativeDataActive, nativeRepository, prepareNativeAccount,
  removeNativeAccount, scheduleAutomaticNativeSync, setNativeAccount,
} from '../nativeData.js';
import { runtimeFetch } from '../connectivity.js';
import { API_BASE, authHeaders, handleResponse, jsonRequest, request } from '../httpClient.js';
import { currentCredential, storeCredential } from '../credentials.js';
import { withAbortTimeout } from '../requestTimeout.js';
import { activateDesktopSession } from '../authTransition.js';
import { resetPaperState } from './paperState.js';
import appLimits from '../appLimits.js';

const DESKTOP_AUTH_TIMEOUT_MS = appLimits.timeouts_ms.desktop_auth;

export function getToken() {
  return currentCredential();
}

// Papol macOS treats the local replica as the startup identity. Reading it
// is deliberately separate from getMe(): the server may refresh network
// authorization after the shell is visible, but it does not grant permission
// to show the owner of this computer their local nook.
export async function getStartupUser() {
  if (!IS_DESKTOP || !nativeDataActive()) return null;
  const user = await nativeRepository.account();
  if (user) return user;
  // The replica holds no profile for the account this computer remembers.
  // A newer build discards a replica an older one wrote, and the profile
  // written at sign-in goes with it; the browser storage naming the account
  // is not the replica's and outlives it. Forget the name too. What is left
  // is a computer with a credential and no local account, and getMe() writes
  // the profile again the way a first sign-in does — or, with no network,
  // the user signs in when there is one.
  setNativeAccount(null);
  return null;
}

async function desktopAuthRequest(requester) {
  if (!IS_DESKTOP) return requester(undefined);
  try {
    return await withAbortTimeout(requester, DESKTOP_AUTH_TIMEOUT_MS);
  } catch (error) {
    if (error?.name === 'OnlineRequiredError') throw error;
    if (error?.name === 'AbortError') {
      throw new Error('Cannot reach the Papol backend. Start it or choose a working backend URL.');
    }
    throw error;
  }
}

// ---------- Auth ----------

export async function register(email, displayName, affiliation, password) {
  const result = await desktopAuthRequest((signal) => request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      display_name: displayName,
      affiliation: affiliation || null,
      password,
    }),
    signal,
  }));
  await activateDesktopSession(result, {
    storeToken: storeCredential,
    prepareAccount: prepareNativeAccount,
  });
  void scheduleAutomaticNativeSync().catch(() => {});
  return result;
}

export async function login(email, password) {
  const result = await desktopAuthRequest((signal) => request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal,
  }));
  await activateDesktopSession(result, {
    storeToken: storeCredential,
    prepareAccount: prepareNativeAccount,
  });
  void scheduleAutomaticNativeSync().catch(() => {});
  return result;
}

export async function logout(accountUuid = nativeAccountUuid()) {
  if (IS_DESKTOP && accountUuid != null) await removeNativeAccount(accountUuid);
  resetPaperState();
  try {
    await desktopAuthRequest((signal) => request('/auth/logout', { method: 'POST', signal }));
  } catch {
    // Local sign-out must remain available while the backend is offline.
  } finally {
    try {
      await storeCredential(null);
    } finally {
      setNativeAccount(null);
    }
  }
}

export async function pendingLocalChanges() {
  if (!nativeDataActive()) return 0;
  const native = await nativeRepository.syncStatus();
  return native.pending;
}

export async function getMe() {
  let user;
  try {
    // A half-open backend must not hold the desktop shell on “Loading…”.
    user = await desktopAuthRequest((signal) => request('/auth/me', { signal }));
  } catch (error) {
    if (!nativeDataActive() || error?.status === 401 || error?.status === 403) throw error;
    // Offline, SQLite holds the signed-in user's identity.
    user = await nativeRepository.account();
  }
  if (!user) throw new Error('Account profile is unavailable');
  if (!nativeDataActive()) {
    await prepareNativeAccount(user);
  }
  // Connectivity is not part of rendering the local shell. The sync status
  // control reports this background attempt independently.
  void scheduleAutomaticNativeSync().catch(() => {});
  return user;
}

export async function refreshStartupUser(localUser) {
  try {
    return await getMe();
  } catch (error) {
    const rejected = error?.status === 401 || error?.status === 403;
    if (!IS_DESKTOP || !nativeDataActive() || !rejected) throw error;
    // A rejected server credential removes network access, not the identity
    // and local work stored on this computer. Reauthentication can restore
    // remote operations without tearing down the local shell.
    await storeCredential(null);
    return localUser || nativeRepository.account();
  }
}

export async function updateProfile(data) {
  const user = await jsonRequest('/auth/profile', 'PUT', data);
  await prepareNativeAccount(user);
  return user;
}

/**
 * Download everything Papol holds about the user, as a tar archive.
 *
 * Fetched rather than linked: the export needs the bearer token, and a
 * plain <a href> cannot carry one. The blob is handed to the browser
 * through a link that is clicked and thrown away — the only way to name a
 * downloaded file from script.
 */
export async function downloadMyData() {
  const response = await runtimeFetch(`${API_BASE}/auth/export`, {
    headers: authHeaders(),
  });
  if (!response.ok) await handleResponse(response);
  // The server names the file; fall back to the same shape if the header
  // is missing (a proxy may strip it).
  const disposition = response.headers.get('Content-Disposition') || '';
  const named = /filename="?([^"]+)"?/.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = named ? named[1] : `papol-export-${new Date().toISOString().slice(0, 10)}.tar`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // WebKit may not consume the URL until after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return blob.size;
}

export function deleteAccount(confirmEmail) {
  return jsonRequest('/auth/account', 'DELETE', { confirm_email: confirmEmail });
}

export function uploadAvatar(file) {
  const formData = new FormData();
  formData.append('file', file);
  return request('/auth/avatar', { method: 'POST', body: formData });
}

export function changePassword(currentPassword, newPassword) {
  return jsonRequest('/auth/password', 'PUT', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}
