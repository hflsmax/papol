// One way a file reaches Papol, for a paper's PDF and a board file alike.
//
// The file is hashed here, so the server can say whether it holds the
// bytes already and, if not, where they go: the bucket itself, by a
// signed URL, with the headers the server lists and no credential of
// Papol's — or, on a Worker with no bucket to sign for, that Worker's
// own door, which the listed headers open. The client sends the same PUT
// either way. The server is then told, by the route that records the
// row, and that is the only request of the upload it ever handles.

import { backendPath } from '../appUrls.js';
import { runtimeFetch } from '../connectivity.js';
import { request } from '../httpClient.js';

// The file's SHA-256, in hex: the name it is stored under.
export async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Put the bytes where the server says, unless it holds them already.
// `kind` is 'paper' or 'board_file'. Answers `{ sha256, file_path }`:
// what the route that records the row is then told.
export async function storeFile(kind, blob, { name, mime = blob.type || null, signal } = {}) {
  const sha256 = await sha256Hex(blob);
  const address = await request('/files/upload-address', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, sha256, size: blob.size, name, mime }), signal,
  });
  if (!address.stored) {
    const url = /^https?:/.test(address.url) ? address.url : backendPath(address.url);
    const put = await runtimeFetch(url, { method: 'PUT', headers: address.headers, body: blob, signal });
    if (!put.ok) {
      const failure = new Error(`The file could not be stored (the bucket answered ${put.status})`);
      failure.status = put.status;
      throw failure;
    }
  }
  return { sha256, file_path: address.file_path };
}
