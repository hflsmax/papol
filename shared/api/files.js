// One way a file reaches Papol, for a paper's PDF and a board file alike.
//
// The file is hashed here, so the server can say whether it holds the
// bytes already and, if not, where they go: the bucket itself, by a
// signed URL, with the headers the server lists and no credential of
// Papol's — or, on a Worker with no bucket to sign for, that Worker's
// own door, which the listed headers open. The client sends the same PUT
// either way. The server is then told, by the route that records the
// row, and that is the only request of the upload it ever handles.
//
// The wait is measured (docs/waiting.md): the hash is taken in slices
// and the bytes go up through XMLHttpRequest, whose upload.onprogress
// says how many have gone, so `onProgress` hears the whole of it.

import { backendPath } from '../appUrls.js';
import { runtimeFetch } from '../connectivity.js';
import { sha256File } from '../fileHash.js';
import { request } from '../httpClient.js';
import { formatProgressDetail } from '../waiting.js';

// The file's SHA-256, in hex: the name it is stored under.
export async function sha256Hex(blob, onProgress) {
  return sha256File(blob, onProgress);
}

// A PUT whose progress can be watched. fetch says nothing about a request
// body on its way up; XMLHttpRequest's upload.onprogress does. The
// headers are exactly the ones the address lists. Answers `{ status, ok }`;
// rejects on a network failure or when `signal` aborts.
export function putWithProgress(url, { headers = {}, body, signal, onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    const total = body?.size ?? body?.byteLength ?? 0;
    onProgress({ loaded: 0, total });
    xhr.upload.onprogress = (event) => {
      onProgress({ loaded: Math.min(event.loaded, total), total });
    };
    xhr.onload = () => {
      onProgress({ loaded: total, total });
      resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300 });
    };
    xhr.onerror = () => reject(new Error('The file could not reach the bucket'));
    xhr.onabort = () => reject(signal?.reason ?? new DOMException('The upload was aborted', 'AbortError'));
    if (signal) {
      if (signal.aborted) { reject(signal.reason); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

// Put the bytes where the server says, unless it holds them already.
// `kind` is 'paper' or 'board_file'. Answers `{ sha256, file_path }`:
// what the route that records the row is then told.
//
// `onProgress` hears `{ phase, loaded, total }` in bytes as it goes:
// phase 'hashing' while the digest is taken, 'uploading' while the bytes
// go up, and 'stored' once — at the end, or at once after the hash when
// the server held the bytes already. `uploadProgressView` turns the
// events into the one bar the callers show.
export async function storeFile(kind, blob, { name, mime = blob.type || null, signal, onProgress = () => {} } = {}) {
  const sha256 = await sha256Hex(blob, ({ loaded, total }) => onProgress({ phase: 'hashing', loaded, total }));
  const address = await request('/files/upload-address', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, sha256, size: blob.size, name, mime }), signal,
  });
  if (!address.stored) {
    const url = /^https?:/.test(address.url) ? address.url : backendPath(address.url);
    const put = await putWithProgress(url, {
      headers: address.headers, body: blob, signal,
      onProgress: ({ loaded, total }) => onProgress({ phase: 'uploading', loaded, total }),
    });
    if (!put.ok) {
      const failure = new Error(`The file could not be stored (the bucket answered ${put.status})`);
      failure.status = put.status;
      throw failure;
    }
  }
  onProgress({ phase: 'stored', loaded: blob.size, total: blob.size });
  return { sha256, file_path: address.file_path };
}

// The share of the bar the hash takes. Hashing runs at hundreds of
// megabytes a second and the upload at a few, so the bar gives the hash
// a sliver and the upload the rest, and never sits at half done with the
// whole upload still to come.
const HASH_SHARE = 0.08;

// One bar over both phases: the fraction and the detail a `Progress`
// takes, from the latest event `storeFile` reported. Null before the
// first event, which the callers show as `Working`.
export function uploadProgressView(progress) {
  if (!progress || !progress.total) return null;
  const detail = formatProgressDetail({ loaded: progress.loaded, total: progress.total });
  if (progress.phase === 'hashing') return { fraction: HASH_SHARE * (progress.loaded / progress.total), detail };
  if (progress.phase === 'uploading') return { fraction: HASH_SHARE + (1 - HASH_SHARE) * (progress.loaded / progress.total), detail };
  return { fraction: 1, detail };
}
