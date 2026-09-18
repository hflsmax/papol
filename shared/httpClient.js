import { CLIENT_PLATFORM } from './appEnvironment.js';
import { backendPath, inDemo } from './appUrls.js';
import { currentCredential } from './credentials.js';
import { runtimeFetch } from './connectivity.js';
import registry from '../schema/sync_registry.json' with { type: 'json' };

export const API_BASE = backendPath('/api');

// Every call says which Papol made it. Signing in is the one that is kept:
// the server stamps the platform on the new session.
export const PLATFORM_HEADER = 'X-Papol-Platform';
// And which schema it was built for. The server compares it with its own
// and answers 426 to any other, which is the whole of the compatibility gate.
export const SCHEMA_HEADER = 'X-Papol-Schema';

export function authHeaders(extra = {}) {
  const token = currentCredential();
  const headers = { [SCHEMA_HEADER]: String(registry.schema_version), ...extra };
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

export async function handleResponse(response) {
  if (!response.ok) {
    const detail = (await response.json().catch(() => null))?.detail;
    const message = detail == null ? `Error ${response.status}`
      : typeof detail === 'string' ? detail : JSON.stringify(detail);
    const failure = new Error(message);
    failure.status = response.status;
    throw failure;
  }
  if (response.status === 204) return null;
  return response.json();
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
  return handleResponse(response);
}

export function jsonRequest(path, method, body) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
