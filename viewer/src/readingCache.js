/**
 * Readings kept on this device (paperReading.js): a paper opened again is
 * not read again. A reading is kept under the PDF's own fingerprint and
 * the version of the rules that made it, so a paper opened after the rules
 * change is read afresh, and the old reading is never shown.
 *
 * IndexedDB, because a long paper's reading runs to hundreds of kilobytes.
 * Only the most recent readings are kept. A browser without storage, or
 * one that refuses it, reads every paper every time, as before.
 */

// The rules' version: a digest of their source, set by the build
// (vite.config.js). Without one, nothing is kept.
const VERSION = typeof __PAPOL_RULES_VERSION__ === 'string' ? __PAPOL_RULES_VERSION__ : null;
const DATABASE = 'papol-readings';
const STORE = 'readings';
const KEPT = 40;

let opened = null;
function database() {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

const keyOf = (doc) => {
  const fingerprint = doc?.fingerprints?.[0];
  return VERSION && fingerprint ? `${VERSION}:${fingerprint}` : null;
};

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** The reading kept for this document, or null. */
export async function keptReading(doc) {
  const key = keyOf(doc);
  if (!key) return null;
  try {
    const db = await database();
    const kept = await done(db.transaction(STORE).objectStore(STORE).get(key));
    return kept?.read ?? null;
  } catch {
    return null;
  }
}

/** Keep this document's reading, and let the oldest go. */
export async function keepReading(doc, read) {
  const key = keyOf(doc);
  if (!key) return;
  try {
    const db = await database();
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    await done(store.put({ read, at: Date.now() }, key));
    const all = db.transaction(STORE, 'readwrite').objectStore(STORE);
    const keys = await done(all.getAllKeys());
    if (keys.length <= KEPT) return;
    const values = await done(all.getAll());
    const oldest = keys
      .map((k, i) => [k, values[i]?.at ?? 0])
      .sort((a, b) => a[1] - b[1])
      .slice(0, keys.length - KEPT);
    const prune = db.transaction(STORE, 'readwrite').objectStore(STORE);
    for (const [k] of oldest) prune.delete(k);
  } catch {
    // Not kept: the next open reads the paper again.
  }
}
