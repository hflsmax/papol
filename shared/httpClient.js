import { CLIENT_PLATFORM } from './appEnvironment.js';
import { backendPath } from './appUrls.js';
import { inDemo } from './appUrls.js';
import { currentCredential } from './credentials.js';
import { runtimeFetch } from './connectivity.js';

export const API_BASE = backendPath('/api');

// Every call says which Papol made it. Signing in is the one that is kept:
// the server stamps the platform on the new session.
export const PLATFORM_HEADER = 'X-Papol-Platform';

export function authHeaders(extra = {}) {
  const token = currentCredential();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

export async function handleResponse(response) {
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      const error = await response.json();
      message = error.detail || message;
    } catch {
      message = await response.text() || message;
    }
    const failure = new Error(typeof message === 'string' ? message : JSON.stringify(message));
    failure.status = response.status;
    throw failure;
  }
  if (response.status === 204) return null;
  return response.json();
}

// A 401 from these is the server checking a password the user just typed,
// not a verdict on their session. From anywhere else it says this Papol has
// no session the server accepts: none was sent, or the one sent has expired,
// been revoked, or belongs to a closed account.
const CREDENTIAL_CHECKS = ['/auth/login', '/auth/logout', '/auth/password'];

const unauthenticatedListeners = new Set();

// Told once per request the server refuses for want of a session. The
// application that owns the window decides what that means there: the
// library takes the user to sign in, and back afterwards.
export function subscribeUnauthenticated(listener) {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

function reportUnauthenticated(path, failure) {
  if (CREDENTIAL_CHECKS.some((prefix) => path.startsWith(prefix))) return;
  for (const listener of unauthenticatedListeners) {
    try {
      listener({ path, message: failure.message });
    } catch {
      // A listener's failure must not change what the caller is told.
    }
  }
}

export async function request(path, options = {}) {
  // Authentication and feedback deliberately leave the fictional demo.
  const alwaysReal = ['/auth/login', '/auth/register', '/feedback'];
  if (inDemo() && !alwaysReal.some((prefix) => path.startsWith(prefix))) {
    const { demoRequest } = await import('./demo.js');
    return demoRequest(path, options);
  }
  const response = await runtimeFetch(`${API_BASE}${path}`, {
    ...options,
    headers: authHeaders({ [PLATFORM_HEADER]: CLIENT_PLATFORM, ...(options.headers || {}) }),
  });
  try {
    return await handleResponse(response);
  } catch (failure) {
    if (failure?.status === 401) reportUnauthenticated(path, failure);
    throw failure;
  }
}

export function jsonRequest(path, method, body) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
