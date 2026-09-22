// The desktop's two outside worlds, faked for the unit tests: the Tauri
// bridge the replica answers through, and the network the app reaches
// through the HTTP plugin (or the webview's own fetch). Every test in a
// file that installs this starts from the same place, whatever the test
// before it did: no calls recorded, no routes, no blobs, online, signed
// in as ACCOUNT. Test files import this, call `installNativeHarness()`
// once, and only then import the shared modules, which read the window
// they find as they load.
//
// The fake is held to what the real bridge does, because a fake that is
// kinder than the Mac is how a test passes and the app does not:
//
// - A command answers `Result<_, String>`, so a failure arrives as a plain
//   string, never an Error. Handlers may throw either; the caller always
//   gets the string.
// - Commands, and the queries `data_query` takes, are the ones
//   desktop/src-tauri/src/lib.rs registers. Anything else is refused as
//   Tauri refuses it.
// - `data_mutate` checks a change as the replica does (the row's name, the
//   columns the sync registry lets a client write, a file it holds) and
//   answers the replica's MutationReceipt (data/database.rs).
// - `blob_import` names bytes by their SHA-256, as the store does.
// - A request no route answers throws, and fails the test: nothing reaches
//   a network that was not asked for.

import { afterEach, beforeEach } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import registry from '../../schema/sync_registry.json' with { type: 'json' };

export const ACCOUNT = '77777777-7777-4777-8777-777777777777';
export const DEFAULT_SHELF = '88888888-8888-4888-8888-888888888888';
export const TOKEN = 'secret-token';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// ------------------------------------------------ what the Mac registers

const libSource = readFileSync(new URL('../../desktop/src-tauri/src/lib.rs', import.meta.url), 'utf8');

function registeredCommands(source) {
  const body = source.match(/generate_handler!\[([\s\S]*?)\]/)?.[1];
  if (!body) throw new Error('lib.rs registers no commands the harness can find');
  return new Set([...body.matchAll(/\b([a-z_]+)\b/g)].map((match) => match[1]));
}

// `enum LocalDataQuery { Account, PaperByPdf, … }`, as serde names the
// variants (`rename_all = "snake_case"`).
function localDataQueries(source) {
  const body = source.match(/enum LocalDataQuery\s*\{([\s\S]*?)\}/)?.[1];
  if (!body) throw new Error('lib.rs has no LocalDataQuery the harness can find');
  return new Set([...body.matchAll(/\b([A-Z][A-Za-z]*)\b/g)]
    .map((match) => match[1].replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase()));
}

export const NATIVE_COMMANDS = registeredCommands(libSource);
export const LOCAL_DATA_QUERIES = localDataQueries(libSource);

// ------------------------------------------------ what the replica says

const rowKey = (table) => (table === 'papers' ? 'sha256' : 'uuid');
const validRowId = (table, id) => (table === 'papers' ? SHA256.test(id ?? '') : UUID.test(id ?? ''));

function defaultShelves() {
  return [{ uuid: DEFAULT_SHELF, name: 'Reading', is_default: 1, is_public: 0, position: 0 }];
}

const QUERY_DEFAULTS = {
  account: () => ({ uuid: ACCOUNT }),
  annotations: () => [],
  board: () => { throw 'Board not found'; },
  board_group: () => { throw 'Board group not found'; },
  boards: () => [],
  nook: () => ({ shelves: defaultShelves(), tags: [], copies: [], copy_tags: [] }),
  paper: () => { throw 'Paper not found'; },
  paper_by_pdf: () => { throw 'Paper not found'; },
  papers: () => [],
  shelves: defaultShelves,
  storage_status: () => ({}),
  sync_status: () => ({ syncing: false }),
  tags: () => [],
};

// A handler's failure as the bridge delivers it: the Err string.
function asCommandError(failure) {
  if (typeof failure === 'string') return failure;
  return String(failure?.message ?? failure);
}

// ------------------------------------------------ the network

function routeMatcher(pattern) {
  if (typeof pattern === 'function') return pattern;
  if (pattern instanceof RegExp) return ({ url }) => pattern.test(url);
  const [, method, target] = /^(?:([A-Z]+)\s+)?(\S+)$/.exec(pattern) ?? [];
  if (!target) throw new Error(`A route is "METHOD /path" or a URL, not ${JSON.stringify(pattern)}`);
  return ({ method: asked, url }) => {
    if (method && method !== asked) return false;
    const parsed = new URL(url);
    const withQuery = target.includes('?');
    if (target.startsWith('/')) return (withQuery ? parsed.pathname + parsed.search : parsed.pathname) === target;
    return (withQuery ? parsed.href : parsed.origin + parsed.pathname) === target;
  };
}

// What a route answers, as a Response whose `url` is the address it was
// finally answered from: the one asked, unless the route says it was
// redirected.
function responseFor(answer, request) {
  let response = answer;
  let finalUrl = request.url;
  if (!(answer instanceof Response)) {
    const { status = 200, json, body = null, headers = {}, url } = answer ?? {};
    finalUrl = url ?? finalUrl;
    response = json === undefined
      ? new Response(body, { status, headers })
      : new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }
  if (!response.url) Object.defineProperty(response, 'url', { value: finalUrl });
  return response;
}

// ------------------------------------------------ the harness

export async function installNativeHarness({
  runtime = 'desktop', surface = 'desk', documentWindow = false,
  href = 'http://127.0.0.1:5173/', signedIn = runtime === 'desktop', onLine = true, storage = {},
} = {}) {
  const calls = [];
  const events = [];
  const blobs = new Map();
  const commands = new Map();
  const queries = new Map();
  const routes = [];
  const unrouted = [];
  const settings = new Map();
  const local = new Map();
  const session = new Map();
  let sequence = 0;

  const defaultStorage = () => ({
    ...(signedIn ? { 'papol.localAccountUuid': ACCOUNT, papol_token: TOKEN } : {}),
    'papol.syncPreference': 'manual',
    ...storage,
  });

  function importBlob(bytes, mimeType = null) {
    const data = Uint8Array.from(bytes);
    const sha256 = sha256Hex(data);
    blobs.set(sha256, { bytes: data, mimeType });
    return { sha256, size: data.length, mime_type: mimeType };
  }

  const COMMAND_DEFAULTS = {
    data_query: ({ queryName, parameters }) => (queries.get(queryName) ?? QUERY_DEFAULTS[queryName])(parameters ?? {}),
    data_mutate: ({ changes }) => {
      if (!changes?.length) throw 'A mutation needs at least one row change';
      const rows = changes.map((change) => {
        if (!validRowId(change.table, change.uuid)) throw `A ${change.table} row is not named that way`;
        const rule = registry.tables[change.table];
        if (!rule) throw `${change.table} is not synchronized`;
        const field = Object.keys(change.values ?? {}).find((name) => !rule.client_writable.includes(name));
        if (field) throw `Client cannot write ${change.table}.${field}`;
        const digest = change.values?.sha256;
        if (typeof digest === 'string' && !blobs.has(digest)) throw 'A local file mutation must reference an imported blob';
        return { [rowKey(change.table)]: change.uuid, ...change.values, revision: 1 };
      });
      sequence += 1;
      return { client_uuid: 'harness-client', mutation_uuid: randomUUID(), local_sequence: sequence, rows };
    },
    blob_import: ({ bytes, mimeType }) => importBlob(bytes, mimeType ?? null),
    blob_cache: ({ expectedSha256, bytes, mimeType }) => {
      const stored = importBlob(bytes, mimeType ?? null);
      if (stored.sha256 !== expectedSha256) throw 'Cached media did not match its published digest';
      return stored;
    },
    blob_read: ({ sha256 }) => {
      const blob = blobs.get(sha256);
      if (!blob) throw 'Blob is not available offline';
      return [...blob.bytes];
    },
    blob_discard: ({ sha256 }) => { blobs.delete(sha256); return null; },
    // The Mac's picture of a page: a JPEG, kept in the store like any file.
    capture_webpage: ({ url }) => importBlob(new Uint8Array([0xff, 0xd8, 0xff, ...new TextEncoder().encode(url)]), 'image/jpeg'),
    local_setting_get: ({ key }) => settings.get(key) ?? null,
    local_setting_set: ({ key, value }) => { settings.set(key, value); return null; },
    local_account_remove: () => 0,
    sync_now: () => ({ pushed: 0, pulled: 0, cursor: 1 }),
  };

  async function invoke(command, args = {}) {
    calls.push([command, args]);
    try {
      if (!NATIVE_COMMANDS.has(command)) throw `Command ${command} not found`;
      if (command === 'data_query') {
        if (!UUID.test(args.accountUuid ?? '')) throw 'invalid args `accountUuid` for command `data_query`';
        if (!LOCAL_DATA_QUERIES.has(args.queryName)) {
          throw `invalid args \`queryName\` for command \`data_query\`: unknown variant \`${args.queryName}\``;
        }
      }
      const handler = commands.get(command) ?? COMMAND_DEFAULTS[command];
      return handler ? await handler(args) : null;
    } catch (failure) {
      throw asCommandError(failure);
    }
  }

  function routed(via) {
    return async (input, options = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, globalThis.location.href).href;
      const request = {
        method: (options.method ?? 'GET').toUpperCase(), url, options, via,
        json: () => JSON.parse(options.body),
      };
      calls.push([via === 'plugin' ? 'network_fetch' : 'fetch', request]);
      const route = routes.find(({ matches }) => matches(request));
      if (!route) {
        unrouted.push(`${request.method} ${url}`);
        throw new TypeError(`No route answers ${request.method} ${url}`);
      }
      const answer = typeof route.responder === 'function' ? await route.responder(request) : route.responder;
      return responseFor(answer, request);
    };
  }
  const pluginFetch = routed('plugin');
  const webviewFetch = routed('webview');

  const makeStorage = (map) => ({
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
  });

  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true, writable: true });
  globalThis.localStorage = makeStorage(local);
  globalThis.sessionStorage = makeStorage(session);
  globalThis.location = new URL(href);
  globalThis.window = {
    location: globalThis.location,
    sessionStorage: globalThis.sessionStorage,
    __PAPOL_ENV__: { runtime, surface, documentWindow },
    ...(runtime === 'desktop' ? { __TAURI_INTERNALS__: { invoke, transformCallback: () => 1 } } : {}),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event) { events.push(event); return true; },
  };
  globalThis.fetch = webviewFetch;

  for (const [key, value] of Object.entries(defaultStorage())) local.set(key, value);
  // Loaded only now: they read the window above as they load.
  const connectivity = await import('../connectivity.js');
  const credentials = await import('../credentials.js');
  const nativeData = await import('../nativeData.js');
  const paperState = await import('../api/paperState.js');

  const native = {
    calls,
    events,
    blobs,
    storage: local,
    session,
    settings,
    invoke,

    // Answer `command` this way for the rest of the test.
    on(command, handler) {
      if (!NATIVE_COMMANDS.has(command)) throw new Error(`The Mac registers no command ${command}`);
      commands.set(command, handler);
    },
    // Answer the replica query `name` this way for the rest of the test.
    query(name, handler) {
      if (!LOCAL_DATA_QUERIES.has(name)) throw new Error(`The replica answers no query ${name}`);
      queries.set(name, typeof handler === 'function' ? handler : () => handler);
    },
    // Answer requests matching `pattern` ("METHOD /path", "/path", a URL,
    // a RegExp over the URL, or a predicate) with `responder`: a Response,
    // `{ status, json | body, headers, url }`, or a function of the request
    // answering either or throwing as the network does.
    route(pattern, responder) {
      routes.push({ matches: routeMatcher(pattern), responder });
    },
    importBlob,

    // The arguments of every call to `command`, in order.
    argsOf(command) {
      return calls.filter(([name]) => name === command).map(([, args]) => args);
    },
    lastArgs(command) {
      return native.argsOf(command).at(-1);
    },
    // Every request that left, by the plugin ('plugin'), the page ('webview') or either.
    requests(via = null) {
      return calls
        .filter(([name, request]) => (name === 'network_fetch' || name === 'fetch') && (!via || request.via === via))
        .map(([, request]) => request);
    },
    commandNames() {
      return calls.map(([name]) => name);
    },
    eventTypes() {
      return events.map((event) => event.type);
    },

    // A promise a handler can wait on, and its release.
    gate() {
      let open;
      const promise = new Promise((resolve) => { open = resolve; });
      return { promise, open };
    },
    // Resolves once `condition()` holds, turning the event loop in between;
    // fails after `timeoutMs`.
    async until(condition, { timeoutMs = 2000, what = 'the condition' } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (!(await condition())) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };

  beforeEach(async () => {
    calls.length = 0;
    events.length = 0;
    blobs.clear();
    commands.clear();
    queries.clear();
    routes.length = 0;
    unrouted.length = 0;
    settings.clear();
    settings.set('sync_mode', 'manual');
    session.clear();
    local.clear();
    for (const [key, value] of Object.entries(defaultStorage())) local.set(key, value);
    navigator.onLine = onLine;
    globalThis.location.href = href;
    globalThis.fetch = webviewFetch;
    connectivity.configureNetworkFetch(runtime === 'desktop' ? pluginFetch : (...args) => globalThis.fetch(...args));
    connectivity.exitOfflineMode();
    paperState.resetPaperState();
    await credentials.hydrateCredential();
    events.length = 0;
  });

  afterEach(async () => {
    // A mutation schedules a sync it does not wait for; it must settle
    // here, not land in the next test's calls.
    await native.until(() => !nativeData.nativeSyncInProgress(), { what: 'the scheduled sync to settle' });
    const stray = unrouted.splice(0);
    if (stray.length) throw new Error(`Requests no route answered:\n${stray.join('\n')}`);
  });

  return native;
}
