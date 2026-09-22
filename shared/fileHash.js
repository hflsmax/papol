// A file's SHA-256, taken in slices so the taking can be watched.
//
// WebCrypto digests a buffer whole and says nothing until it is done; a
// 200 MB PDF is a long silence. The streaming hash reads the file a few
// megabytes at a time and reports after each slice, and the same digest
// comes out: the unit test checks it against Node's own.

import { sha256 } from '@noble/hashes/sha2.js';

export const HASH_SLICE_BYTES = 4 * 1024 * 1024;

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// The hex digest of `file` (a Blob). `onProgress` hears `{ loaded, total }`
// in bytes, once at the start and after every slice.
export async function sha256File(file, onProgress = () => {}, sliceBytes = HASH_SLICE_BYTES) {
  const hash = sha256.create();
  const total = file.size;
  onProgress({ loaded: 0, total });
  for (let at = 0; at < total; at += sliceBytes) {
    const end = Math.min(at + sliceBytes, total);
    hash.update(new Uint8Array(await file.slice(at, end).arrayBuffer()));
    onProgress({ loaded: end, total });
  }
  return hex(hash.digest());
}
