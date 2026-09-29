// PDFs dropped where they cannot be taken in at once (the viewer, or before
// signing in), handed to the nook's upload across the page load or the
// sign-in that takes the reader there.
// IndexedDB, because a File outlives neither a navigation nor
// sessionStorage's size. Taken once: the nook reads them and they are gone.
const DATABASE = 'papol-dropped';
const STORE = 'dropped';
const KEY = 'next';

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function database() {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  return done(request);
}

// Keep these files for the nook. Answers false when the browser keeps
// nothing, so the caller can say so rather than lose the drop.
export async function handOverDroppedPdfs(files) {
  try {
    const db = await database();
    const kept = files.map((file) => ({ name: file.name, type: file.type, blob: file }));
    await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ files: kept, at: Date.now() }, KEY));
    db.close();
    return true;
  } catch {
    return false;
  }
}

// The files handed over, as Files, and forgotten; none when there are
// none, or when they were left more than ten minutes ago (a drop that
// never reached the nook is not brought up days later).
export async function takeDroppedPdfs(now = Date.now()) {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await database();
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    const kept = await done(store.get(KEY));
    if (kept) await done(store.delete(KEY));
    db.close();
    if (!kept || now - kept.at > 600_000) return [];
    return kept.files.map(({ name, type, blob }) => new File([blob], name, { type }));
  } catch {
    return [];
  }
}
