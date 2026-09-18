// Demo changes live in a disposable server workspace. Only its opaque session
// key crosses document navigation; real account credentials never leave here.
import { backendPath, inDemo } from './appUrls.js';
import { IS_DESKTOP } from './appEnvironment.js';

const SESSION_KEY = 'papol.demoSession';
let pendingSession = null;
const storage = () => IS_DESKTOP ? window.localStorage : window.sessionStorage;

export const demoActive = inDemo;
export function enterDemo() { pendingSession = null; }
export function exitDemo() { pendingSession = null; }
export const resetDemo = enterDemo;

function storedSession() {
  try { return storage().getItem(SESSION_KEY); } catch { return null; }
}

async function session(fetchNetwork) {
  if (!pendingSession) {
    pendingSession = (async () => {
      const stored = storedSession();
      const response = await fetchNetwork(backendPath('/api/demo/session'), {
        method: 'POST', credentials: 'omit',
        headers: stored ? { 'X-Papol-Demo-Session': stored } : {},
      });
      if (!response.ok) throw new Error('The demo is unavailable. Please try again later.');
      const { session: key } = await response.json();
      try { storage().setItem(SESSION_KEY, key); } catch { /* document lifetime only */ }
      return key;
    })().catch((error) => { pendingSession = null; throw error; });
  }
  return pendingSession;
}

// Multipart uploads and requests outside the JSON client are isolated too.
// Never retry an expired mutation.
export async function demoFetch(path, options, fetchNetwork) {
  const key = await session(fetchNetwork);
  const headers = new Headers(options.headers);
  headers.delete('Authorization');
  headers.delete('X-Papol-Client-UUID');
  headers.delete('X-Papol-Mutation-UUID');
  headers.set('X-Papol-Demo-Session', key);
  const response = await fetchNetwork(backendPath(`/api/demo${path}`), {
    ...options, headers, credentials: 'omit',
  });
  if (response.status === 410) {
    // Keep this document on the expired session; reloading starts a fresh visit.
    try { storage().removeItem(SESSION_KEY); } catch { /* unavailable */ }
  }
  return response;
}
