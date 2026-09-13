// Durable offline transport for Papol's user-owned data. Successful reads are
// cached in IndexedDB. Safe private mutations are queued after a network
// failure and replayed in order when the backend becomes reachable again.

const DB_NAME = 'papol-offline';
const DB_VERSION = 1;
const OFFLINE_FILE = 'offline-file:';
// Device settings live only in this installation's webview storage. They are
// deliberately named "local" at the API boundary so they cannot be mistaken
// for account settings persisted by the backend and shared across devices.
const LOCAL_SYNC_PREFERENCE_KEY = 'papol.syncPreference';
const LAST_SYNC_KEY = 'papol.lastSync';
const LOCAL_SYNC_CLIENT_UUID_KEY = 'papol.syncClientUuid';
const CLIENT_UUID_HEADER = 'X-Papol-Client-UUID';
const MUTATION_UUID_HEADER = 'X-Papol-Mutation-UUID';
let syncing = null;
const pendingBlobLoads = new Map();
let remoteNetworkFetch = (...args) => globalThis.fetch(...args);
let replayAuthorization = () => {
  try {
    const token = localStorage.getItem('papol_token');
    return token ? `Bearer ${token}` : null;
  } catch { return null; }
};
let latestAuthorization = null;
let syncStatus = {
  pending: 0,
  syncing: false,
  offline: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
  error: null,
  lastSynced: null,
};

export function configureNetworkFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Network fetch must be a function');
  remoteNetworkFetch = fetchImpl;
}

export function configureReplayAuthorization(provider) {
  if (typeof provider !== 'function') throw new TypeError('Authorization provider must be a function');
  replayAuthorization = provider;
}

// HTTP(S) leaves the bundled UI and uses Tauri's native client on desktop.
// Internal tauri:/asset requests must stay in the webview so bundled PDFs and
// other application resources continue to resolve through Tauri's protocol.
export function runtimeFetch(input, options) {
  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  let protocol = '';
  try { protocol = new URL(rawUrl, globalThis.location?.href).protocol; } catch { /* fetch reports malformed URLs */ }
  return /^https?:$/.test(protocol)
    ? remoteNetworkFetch(input, options)
    : globalThis.fetch(input, options);
}

function storedSetting(key, fallback = null) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function newUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getLocalSyncClientUuid() {
  const existing = storedSetting(LOCAL_SYNC_CLIENT_UUID_KEY);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing || '')) {
    return existing;
  }
  const created = newUuid();
  try { localStorage.setItem(LOCAL_SYNC_CLIENT_UUID_KEY, created); } catch { /* queue also retains it */ }
  return created;
}

function identifiedMutationOptions(options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has(CLIENT_UUID_HEADER)) headers.set(CLIENT_UUID_HEADER, getLocalSyncClientUuid());
  if (!headers.has(MUTATION_UUID_HEADER)) headers.set(MUTATION_UUID_HEADER, newUuid());
  return { ...options, headers };
}

export function getLocalSyncPreference() {
  return storedSetting(LOCAL_SYNC_PREFERENCE_KEY, 'automatic');
}

export function setLocalSyncPreference(preference) {
  if (!['automatic', 'manual'].includes(preference)) throw new Error('Unknown sync preference');
  try { localStorage.setItem(LOCAL_SYNC_PREFERENCE_KEY, preference); } catch { /* best effort */ }
  notify({ preference });
  if (preference === 'automatic') syncOfflineQueue().catch(() => {});
}

export function getSyncStatus() {
  return {
    ...syncStatus,
    preference: getLocalSyncPreference(),
    lastSynced: syncStatus.lastSynced || storedSetting(LAST_SYNC_KEY),
  };
}

export async function refreshSyncStatus() {
  const pending = (await allStored('queue')).length;
  notify({ pending });
  return getSyncStatus();
}

export class OnlineRequiredError extends Error {
  constructor() {
    super('This action needs an internet connection because it affects shared data.');
    this.name = 'OnlineRequiredError';
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('responses')) db.createObjectStore('responses');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'queueId', autoIncrement: true });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('mappings')) db.createObjectStore('mappings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let value;
    try { value = action(store); } catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve(value?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => db.close());
}

const getStored = (store, key) => transact(store, 'readonly', (s) => s.get(key));
const putStored = (store, value, key) => transact(store, 'readwrite', (s) => s.put(value, key));
const addStored = (store, value) => transact(store, 'readwrite', (s) => s.add(value));
const deleteStored = (store, key) => transact(store, 'readwrite', (s) => s.delete(key));

async function allStored(store) {
  return transact(store, 'readonly', (s) => s.getAll());
}

export async function clearOfflineData() {
  const db = await openDb();
  try {
    const storeNames = Array.from(db.objectStoreNames);
    if (storeNames.length > 0) {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeNames, 'readwrite');
        storeNames.forEach((name) => transaction.objectStore(name).clear());
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }
  } finally {
    db.close();
  }
  notify({ pending: 0, syncing: false, error: null, lastSynced: null });
}

function pathOf(url) {
  const marker = '/api';
  const pathname = new URL(url, window.location.href).pathname;
  const at = pathname.lastIndexOf(marker);
  return at >= 0 ? pathname.slice(at + marker.length) || '/' : pathname;
}

function authScope(options = {}) {
  const authorization = new Headers(options.headers || {}).get('authorization');
  if (!authorization) return 'guest';
  let hash = 2166136261;
  for (let index = 0; index < authorization.length; index += 1) {
    hash ^= authorization.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `account:${(hash >>> 0).toString(16)}`;
}

function responseKey(path, options = {}) {
  return `${authScope(options)}:${path}`;
}

function bodyObject(body) {
  if (!body) return null;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return body; }
  }
  if (body instanceof FormData) return Object.fromEntries(body.entries());
  return body;
}

const SAFE_ROUTES = [
  ['POST', /^\/papers\/extract$/],
  ['POST', /^\/papers$/],
  ['DELETE', /^\/papers\/[^/]+$/],
  ['PUT', /^\/papers\/[^/]+$/],
  ['POST', /^\/papers\/[^/]+\/editions$/],
  ['POST', /^\/papers\/[^/]+\/(?:adopt-edition|ignore-edition)$/],
  ['POST', /^\/papers\/[^/]+\/comments$/],
  ['PUT', /^\/comments\/[^/]+$/],
  ['DELETE', /^\/comments\/[^/]+$/],
  ['POST', /^\/editions\/[^/]+\/(?:ink|clips)$/],
  ['PUT', /^\/(?:ink|clips)\/[^/]+$/],
  ['DELETE', /^\/(?:ink|clips)\/[^/]+$/],
  ['POST', /^\/(?:tags|shelves)$/],
  ['PUT', /^\/shelves\/[^/]+$/],
  ['DELETE', /^\/(?:tags|shelves)\/[^/]+$/],
  ['POST', /^\/boards(?:\/[^/]+\/(?:comments|files|youtube|webpage|staging(?:\/clip)?|groups))?$/],
  ['PUT', /^\/boards\/[^/]+$/],
  ['DELETE', /^\/boards\/[^/]+$/],
  ['PUT', /^\/board-(?:items|groups)\/[^/]+$/],
  ['PUT', /^\/board-groups\/[^/]+\/(?:move|layout)$/],
  ['POST', /^\/board-items\/[^/]+\/(?:restore|place)$/],
  ['POST', /^\/board-groups\/[^/]+\/ungroup$/],
  ['DELETE', /^\/board-items\/[^/]+$/],
];

export function isSafeOfflineMutation(method, path, body = null) {
  if (!SAFE_ROUTES.some(([allowedMethod, pattern]) =>
    method.toUpperCase() === allowedMethod && pattern.test(path))) return false;
  const data = bodyObject(body) || {};
  if (method.toUpperCase() === 'PUT' && /^\/papers\/[^/]+$/.test(path)) {
    const privateFields = new Set(['summary', 'shelf_uuid', 'tag_uuids']);
    return Object.keys(data).every((key) => privateFields.has(key));
  }
  if (/^\/shelves(?:\/[^/]+)?$/.test(path) && data.is_public === true) return false;
  return true;
}

function serializeBody(body) {
  if (body instanceof FormData) {
    return { type: 'form', value: Array.from(body.entries()) };
  }
  return { type: 'raw', value: body ?? null };
}

function deserializeBody(body) {
  if (body.type !== 'form') return body.value;
  const form = new FormData();
  for (const [key, value] of body.value) form.append(key, value);
  return form;
}

async function sha256(blob) {
  const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function optimisticValue(path, method, body) {
  const data = bodyObject(body) || {};
  // A queued row is named by a UUID of its own until the server names it.
  const uuid = newUuid();
  const now = new Date().toISOString();
  if (path === '/papers/extract') {
    const file = data.file;
    const digest = await sha256(file);
    const key = `${OFFLINE_FILE}${digest}`;
    await putStored('files', file, key);
    return {
      title: (file?.name || 'Untitled paper').replace(/\.pdf$/i, ''),
      authors: null, journal: null, year: null, doi: null, file_path: key,
      sha256: digest,
    };
  }
  if (method === 'DELETE') return { queued: true };
  if (path === '/papers') {
    const digest = data.file_path?.startsWith?.(OFFLINE_FILE)
      ? data.file_path.slice(OFFLINE_FILE.length)
      : null;
    return {
      uuid: newUuid(), ...data, created_at: now, comments: [], readers: [],
      sha256: digest, edition_sha256: digest, edition_uuid: uuid,
      editions: digest ? [{ uuid, sha256: digest, file_path: data.file_path, created_at: now }] : [],
    };
  }
  if (/\/comments$/.test(path)) return { uuid, ...data, created_at: now };
  if (/\/ink$/.test(path)) return { uuid, ...data };
  if (/\/clips$/.test(path)) return { uuid, ...data };
  if (path === '/tags') return { uuid, name: data.name };
  if (path === '/shelves') return { uuid, ...data, is_default: false };
  if (path === '/boards' && method === 'POST') {
    return {
      uuid, ...data, can_edit: true, items: [], staged_items: [], groups: [],
      created_at: now, updated_at: now,
    };
  }
  const boardItem = path.match(/^\/boards\/([^/]+)\/(comments|files|youtube|webpage|staging)(?:\/clip)?$/);
  if (boardItem) {
    const file = data.file;
    let filePath = null;
    if (file instanceof Blob) {
      filePath = `${OFFLINE_FILE}${await sha256(file)}`;
      await putStored('files', file, filePath);
    }
    const requestedKind = boardItem[2];
    const kind = requestedKind === 'comments' ? 'comment'
      : requestedKind === 'files' ? (file?.type?.startsWith('image/') ? 'image' : 'file')
      : requestedKind === 'staging' ? (file ? 'image' : (data.kind || 'excerpt'))
      : requestedKind;
    return {
      uuid, board_uuid: boardItem[1], kind, ...data,
      content: data.content || data.caption || (['youtube', 'webpage'].includes(kind) ? data.url : null),
      source_url: data.source_url || data.url || null,
      file_path: filePath,
      original_filename: file?.name || data.original_filename || null,
      mime_type: file?.type || null,
      staged: requestedKind === 'staging',
      created_at: now,
    };
  }
  if (/^\/boards\/[^/]+\/groups$/.test(path)) {
    return { uuid, ...data, item_uuids: data.item_uuids || [], x: data.x || 0, y: data.y || 0 };
  }
  const boardEntity = path.match(/^\/board-(?:items|groups)\/([^/]+)/);
  if (boardEntity) return { uuid: boardEntity[1], ...data };
  const routeParts = path.split('/').filter(Boolean);
  return { uuid: decodeURIComponent(routeParts[routeParts.length - 1] || ''), ...data };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Papol-Offline': 'queued' },
  });
}

function notify(detail) {
  try {
    const pending = detail.pending ?? detail.queued ?? syncStatus.pending;
    syncStatus = {
      pending,
      syncing: detail.syncing ?? syncStatus.syncing,
      offline: detail.offline ?? syncStatus.offline,
      error: Object.prototype.hasOwnProperty.call(detail, 'error')
        ? detail.error
        : detail.conflict ?? (detail.syncing ? null : syncStatus.error),
      lastSynced: detail.lastSynced ?? syncStatus.lastSynced,
    };
    window.dispatchEvent(new CustomEvent('papol-offline-status', { detail }));
    if (document.getElementById('desktop-sync-control')) {
      document.getElementById('papol-offline-status')?.remove();
      return;
    }
    let banner = document.getElementById('papol-offline-status');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'papol-offline-status';
      banner.setAttribute('role', 'status');
      Object.assign(banner.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',
        padding: '7px 12px', borderRadius: '999px', font: '12px -apple-system, sans-serif',
        color: '#fff', background: '#644f1f', boxShadow: '0 2px 10px #0003',
      });
      document.body.appendChild(banner);
    }
    const queued = syncStatus.pending || 0;
    banner.textContent = syncStatus.error || (syncStatus.offline
      ? `Offline${queued ? ` · ${queued} change${queued === 1 ? '' : 's'} waiting to sync` : ''}`
      : syncStatus.syncing ? `Syncing ${queued} change${queued === 1 ? '' : 's'}…` : '');
    banner.hidden = !banner.textContent;
    if (detail.conflict) banner.style.background = '#8c2f22';
    else banner.style.background = '#644f1f';
  } catch { /* no DOM */ }
}

async function queueMutation(url, path, method, options) {
  const optimistic = await optimisticValue(path, method, options.body);
  const headers = new Headers(options.headers || {});
  const accountScope = authScope({ headers });
  headers.delete('authorization');
  await addStored('queue', {
    url, path, method,
    headers: Object.fromEntries(headers.entries()),
    accountScope,
    body: serializeBody(options.body),
    optimistic,
    queuedAt: new Date().toISOString(),
  });
  if (path === '/papers' && optimistic?.uuid != null) {
    await putStored('responses', optimistic, responseKey(`/papers/${optimistic.uuid}`, options));
    if (optimistic.sha256) {
      await putStored('responses', optimistic, responseKey(`/viewer/${optimistic.sha256}`, options));
    }
  }
  if (path === '/boards' && optimistic?.uuid) {
    await putStored('responses', optimistic, responseKey(`/boards/${optimistic.uuid}`, options));
  }
  notify({
    offline: typeof navigator !== 'undefined' ? navigator.onLine === false : true,
    queued: (await allStored('queue')).length,
  });
  return jsonResponse(optimistic);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function applyCollection(items, operations, kind) {
  let result = Array.isArray(items) ? clone(items) : [];
  for (const operation of operations) {
    const bits = operation.path.split('/').filter(Boolean);
    const body = bodyObject(deserializeBody(operation.body)) || {};
    if (operation.method === 'POST' && operation.path.endsWith(`/${kind}`)) {
      result.push(operation.optimistic);
    } else if (bits[0] === kind && bits.length === 2) {
      const uuid = String(bits[1]);
      if (operation.method === 'DELETE') result = result.filter((item) => String(item.uuid) !== uuid);
      if (operation.method === 'PUT') result = result.map((item) => String(item.uuid) === uuid ? { ...item, ...body } : item);
    }
  }
  return result;
}

function applyBoardQueue(board, operations) {
  let next = clone(board);
  let items = [...(next.items || [])];
  let staged = [...(next.staged_items || [])];
  let groups = [...(next.groups || [])];
  for (const operation of operations) {
    const bits = operation.path.split('/').filter(Boolean);
    const body = bodyObject(deserializeBody(operation.body)) || {};
    if (bits[0] === 'boards' && bits.length === 2 && bits[1] === String(next.uuid)) {
      if (operation.method === 'PUT') next = { ...next, ...body };
      if (operation.method === 'DELETE') next.__offlineDeleted = true;
    }
    if (bits[0] === 'boards' && bits[1] === String(next.uuid) && operation.method === 'POST') {
      if (bits[2] === 'groups') {
        groups.push(operation.optimistic);
        const members = new Set((operation.optimistic.item_uuids || []).map(String));
        items = items.map((item) => members.has(String(item.uuid))
          ? { ...item, group_uuid: operation.optimistic.uuid }
          : item);
      }
      else if (bits[2] === 'staging') staged.push(operation.optimistic);
      else if (['comments', 'files', 'youtube', 'webpage'].includes(bits[2])) items.push(operation.optimistic);
    }
    if (bits[0] === 'board-items') {
      const itemUuid = bits[1];
      const patch = (collection) => collection.map((item) =>
        String(item.uuid) === itemUuid ? { ...item, ...body } : item);
      if (operation.method === 'PUT') { items = patch(items); staged = patch(staged); }
      if (operation.method === 'DELETE') {
        items = items.map((item) => String(item.uuid) === itemUuid ? { ...item, __offlineDeleted: true } : item);
        staged = staged.map((item) => String(item.uuid) === itemUuid ? { ...item, __offlineDeleted: true } : item);
      }
      if (bits[2] === 'restore') {
        items = items.map((item) => String(item.uuid) === itemUuid ? { ...item, __offlineDeleted: false } : item);
        staged = staged.map((item) => String(item.uuid) === itemUuid ? { ...item, __offlineDeleted: false } : item);
      }
      if (bits[2] === 'place') {
        const found = staged.find((item) => String(item.uuid) === itemUuid);
        staged = staged.filter((item) => String(item.uuid) !== itemUuid);
        if (found) items.push({ ...found, ...body, staged: false });
      }
    }
    if (bits[0] === 'board-groups') {
      const groupUuid = bits[1];
      if (operation.method === 'PUT') groups = groups.map((group) =>
        String(group.uuid) === groupUuid ? { ...group, ...body } : group);
      if (bits[2] === 'move') {
        groups = groups.map((group) => String(group.uuid) === groupUuid
          ? { ...group, x: (group.x || 0) + Number(body.dx || 0), y: (group.y || 0) + Number(body.dy || 0) }
          : group);
        items = items.map((item) => String(item.group_uuid) === groupUuid
          ? { ...item, x: (item.x || 0) + Number(body.dx || 0), y: (item.y || 0) + Number(body.dy || 0) }
          : item);
      }
      if (['layout', 'ungroup'].includes(bits[2]) && Array.isArray(body.items)) {
        const changes = new Map(body.items.map((item) => [String(item.uuid), item]));
        items = items.map((item) => changes.has(String(item.uuid)) ? { ...item, ...changes.get(String(item.uuid)) } : item);
      }
      if (bits[2] === 'ungroup') {
        groups = groups.filter((group) => String(group.uuid) !== groupUuid);
        items = items.map((item) => String(item.group_uuid) === groupUuid ? { ...item, group_uuid: null } : item);
      }
    }
  }
  next.items = items.filter((item) => !item.__offlineDeleted);
  next.staged_items = staged.filter((item) => !item.__offlineDeleted);
  next.groups = groups;
  return next;
}

export function applyOfflineQueue(path, value, operations) {
  let result = clone(value);
  if (path === '/boards') return applyCollection(result, operations, 'boards');
  if (/^\/boards\/[^/]+$/.test(path)) return applyBoardQueue(result, operations);
  if (/^\/editions\/[^/]+\/ink$/.test(path)) return applyCollection(result, operations, 'ink');
  if (/^\/editions\/[^/]+\/clips$/.test(path)) return applyCollection(result, operations, 'clips');
  if (path === '/tags') return applyCollection(result, operations, 'tags');
  if (path === '/shelves') return applyCollection(result, operations, 'shelves');

  // A paper detail owns its private notes. The same paper objects also occur
  // in the user's cached nook, so apply private paper edits wherever found.
  const visit = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(visit);
    let next = { ...node };
    if (Array.isArray(next.papers)) {
      for (const operation of operations) {
        if (operation.path === '/papers' && operation.method === 'POST' &&
            !next.papers.some((paper) => String(paper.uuid) === String(operation.optimistic.uuid))) {
          next.papers = [operation.optimistic, ...next.papers];
        }
      }
    }
    if (Array.isArray(next.boards)) {
      for (const operation of operations) {
        if (operation.path === '/boards' && operation.method === 'POST' &&
            !next.boards.some((board) => board.uuid === operation.optimistic.uuid)) {
          next.boards = [operation.optimistic, ...next.boards];
        }
        const bits = operation.path.split('/').filter(Boolean);
        if (bits[0] === 'boards' && bits.length === 2) {
          if (operation.method === 'DELETE') next.boards = next.boards.filter((board) => String(board.uuid) !== bits[1]);
          if (operation.method === 'PUT') next.boards = next.boards.map((board) => String(board.uuid) === bits[1] ? { ...board, ...bodyObject(deserializeBody(operation.body)) } : board);
        }
      }
    }
    if (Array.isArray(next.tags)) next.tags = applyCollection(next.tags, operations, 'tags');
    if (Array.isArray(next.shelves)) next.shelves = applyCollection(next.shelves, operations, 'shelves');
    for (const operation of operations) {
      const bits = operation.path.split('/').filter(Boolean);
      const body = bodyObject(deserializeBody(operation.body)) || {};
      if (bits[0] === 'papers' && bits.length === 2 && String(next.uuid) === bits[1]) {
        if (operation.method === 'PUT') next = { ...next, ...body };
        if (operation.method === 'DELETE') next.__offlineDeleted = true;
      }
      if (bits[0] === 'papers' && bits[2] === 'comments' && String(next.uuid) === bits[1]) {
        next.comments = [...(next.comments || []), operation.optimistic];
      }
      if (bits[0] === 'comments' && Array.isArray(next.comments)) {
        if (operation.method === 'DELETE') next.comments = next.comments.filter((item) => String(item.uuid) !== bits[1]);
        if (operation.method === 'PUT') next.comments = next.comments.map((item) => String(item.uuid) === bits[1] ? { ...item, ...body } : item);
      }
    }
    for (const [key, child] of Object.entries(next)) {
      if (key !== 'comments' && child && typeof child === 'object') next[key] = visit(child);
    }
    return next;
  };
  result = visit(result);
  if (Array.isArray(result)) result = result.filter((item) => !item?.__offlineDeleted);
  else if (result?.papers) result.papers = result.papers.filter((item) => !item?.__offlineDeleted);
  return result;
}

async function cachedResponse(path, options) {
  const cached = await getStored('responses', responseKey(path, options));
  if (cached === undefined) return null;
  const scope = authScope(options);
  const operations = (await allStored('queue')).filter((operation) =>
    operation.accountScope === scope);
  return jsonResponse(applyOfflineQueue(path, cached, operations));
}

async function rememberResponse(path, response, options) {
  if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) return;
  try {
    await putStored('responses', await response.clone().json(), responseKey(path, options));
  } catch { /* cache is best effort */ }
}

function replaceMappings(value, mappings, field = '') {
  const identifierField = field === 'uuid' || field === 'file_path' ||
    field.endsWith('_uuid') || field.endsWith('_uuids');
  if (typeof value === 'string' && identifierField &&
      Object.prototype.hasOwnProperty.call(mappings, String(value))) {
    return mappings[String(value)];
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => replaceMappings(item, mappings, field));
  if (value && typeof value === 'object' && !(value instanceof Blob)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceMappings(item, mappings, key)]));
  }
  return value;
}

function mappedUrl(url, mappings) {
  const raw = String(url);
  try {
    const parsed = new URL(raw, window.location.href);
    parsed.pathname = parsed.pathname.split('/').map((part) => {
      const decoded = decodeURIComponent(part);
      return Object.prototype.hasOwnProperty.call(mappings, decoded)
        ? encodeURIComponent(String(mappings[decoded]))
        : part;
    }).join('/');
    return /^https?:\/\//i.test(raw)
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw;
  }
}

function mappedOptions(options, mappings) {
  if (!options.body) return options;
  if (options.body instanceof FormData) {
    const form = new FormData();
    for (const [key, value] of options.body.entries()) form.append(key, replaceMappings(value, mappings, key));
    return { ...options, body: form };
  }
  if (typeof options.body === 'string') {
    try {
      return { ...options, body: JSON.stringify(replaceMappings(JSON.parse(options.body), mappings)) };
    } catch { return options; }
  }
  return options;
}

export async function syncOfflineQueue(fetchImpl = runtimeFetch) {
  if (syncing) return syncing;
  syncing = (async () => {
    const operations = await allStored('queue');
    notify({ syncing: true, pending: operations.length, error: null });
    const mappings = (await getStored('mappings', 'ids')) || {};
    let syncError = null;
    for (const operation of operations) {
      const authorization = replayAuthorization() || latestAuthorization;
      const currentScope = authScope({
        headers: authorization ? { Authorization: authorization } : {},
      });
      if (operation.accountScope !== currentScope) continue;
      const url = mappedUrl(operation.url, mappings);
      const rawBody = deserializeBody(operation.body);
      let body = rawBody;
      if (operation.body.type === 'raw' && typeof rawBody === 'string') {
        try { body = JSON.stringify(replaceMappings(JSON.parse(rawBody), mappings)); } catch { /* raw text */ }
      } else if (operation.body.type === 'form') {
        const form = new FormData();
        for (const [key, value] of operation.body.value) form.append(key, replaceMappings(value, mappings, key));
        body = form;
      }
      let response;
      const requestHeaders = new Headers(operation.headers);
      if (authorization) requestHeaders.set('Authorization', authorization);
      try { response = await fetchImpl(url, { method: operation.method, headers: requestHeaders, body }); }
      catch { syncError = 'Sync paused — no connection'; break; }
      if (!response.ok) {
        syncError = `Sync stopped: server returned ${response.status}`;
        break;
      }
      let actual = null;
      try { actual = await response.clone().json(); } catch { /* empty response */ }
      if (operation.optimistic?.uuid != null && actual?.uuid != null) mappings[String(operation.optimistic.uuid)] = actual.uuid;
      if (operation.optimistic?.file_path?.startsWith?.(OFFLINE_FILE) && actual?.file_path) {
        mappings[operation.optimistic.file_path] = actual.file_path;
      }
      await putStored('mappings', mappings, 'ids');
      await deleteStored('queue', operation.queueId);
    }
    const remaining = (await allStored('queue')).length;
    let lastSynced = syncStatus.lastSynced;
    if (!syncError && remaining === 0) {
      lastSynced = new Date().toISOString();
      try { localStorage.setItem(LAST_SYNC_KEY, lastSynced); } catch { /* best effort */ }
    }
    notify({
      offline: syncError === 'Sync paused — no connection',
      syncing: false,
      pending: remaining,
      error: syncError,
      lastSynced,
    });
    return remaining;
  })().finally(() => { syncing = null; });
  return syncing;
}

export async function offlineFetch(url, options = {}, fetchImpl = runtimeFetch) {
  const method = (options.method || 'GET').toUpperCase();
  const path = pathOf(url);
  const requestAuthorization = new Headers(options.headers || {}).get('authorization');
  if (requestAuthorization) latestAuthorization = requestAuthorization;
  const safeMutation = method !== 'GET' && isSafeOfflineMutation(method, path, options.body);
  if (safeMutation) options = identifiedMutationOptions(options);
  let pullRequested = false;
  try { pullRequested = Number(sessionStorage.getItem('papol.syncPullUntil') || 0) > Date.now(); }
  catch { /* session storage unavailable */ }
  if (method === 'GET' && getLocalSyncPreference() === 'manual' && !pullRequested) {
    const cached = await cachedResponse(path, options);
    if (cached) return cached;
  }
  if (method !== 'GET') {
    if (getLocalSyncPreference() === 'manual' && safeMutation) {
      return queueMutation(url, path, method, options);
    }
    const pending = (await allStored('queue')).length;
    if (pending) {
      await syncOfflineQueue(fetchImpl);
      if ((await allStored('queue')).length && safeMutation) {
        return queueMutation(url, path, method, options);
      }
    }
    // Queue before issuing a request when the platform knows it is offline.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (safeMutation) {
        return queueMutation(url, path, method, options);
      }
      throw new OnlineRequiredError();
    }
  }
  const mappings = (await getStored('mappings', 'ids')) || {};
  const requestUrl = mappedUrl(url, mappings);
  const requestOptions = mappedOptions(options, mappings);
  try {
    const response = await fetchImpl(requestUrl, requestOptions);
    if (method === 'GET') await rememberResponse(path, response, options);
    if (response.ok && getLocalSyncPreference() === 'automatic') syncOfflineQueue(fetchImpl);
    notify({ offline: false });
    return response;
  } catch (error) {
    if (method === 'GET') {
      const cached = await cachedResponse(path, options);
      if (cached) { notify({ offline: true, queued: (await allStored('queue')).length }); return cached; }
    }
    // Identified mutations are safe to retain after an ambiguous transport
    // failure: if the server committed, replay returns its recorded result.
    if (safeMutation) {
      return queueMutation(url, path, method, options);
    }
    if (method !== 'GET') throw new OnlineRequiredError();
    throw error;
  }
}

export async function cachedBlobUrl(key, loader = null) {
  if (!key) return null;
  if (key.startsWith(OFFLINE_FILE)) {
    const blob = await getStored('files', key);
    return blob ? URL.createObjectURL(blob) : null;
  }

  // Blobs are immutable at their Papol URLs. Prefer the durable local copy so
  // reopening a board or paper does not download the same bytes again. The
  // network is only responsible for filling a cache miss.
  try {
    const blob = await getStored('files', key);
    if (blob) return URL.createObjectURL(blob);
  } catch { /* IndexedDB is best effort; the network may still be available */ }

  if (!loader) throw new Error('No cached blob or online loader');
  let pending = pendingBlobLoads.get(key);
  if (!pending) {
    pending = (async () => {
      const loaded = await loader();
      try {
        await putStored('files', loaded, key);
      } catch { /* a full or unavailable cache must not hide fetched content */ }
      return loaded;
    })();
    pendingBlobLoads.set(key, pending);
    pending.finally(() => {
      if (pendingBlobLoads.get(key) === pending) pendingBlobLoads.delete(key);
    }).catch(() => {});
  }
  const blob = await pending;
  return URL.createObjectURL(blob);
}

export function offlinePdfUrl(url) {
  return cachedBlobUrl(url, async () => {
    const response = await runtimeFetch(url);
    if (!response.ok) throw new Error(`Error ${response.status}`);
    return response.blob();
  });
}

export function rememberOfflineIdentity(token, user) {
  if (!token || !user) return Promise.resolve();
  return putStored('responses', user, responseKey('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  }));
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    notify({ offline: false });
    if (getLocalSyncPreference() === 'automatic') syncOfflineQueue();
  });
  window.addEventListener('offline', () => notify({ offline: true }));
}
