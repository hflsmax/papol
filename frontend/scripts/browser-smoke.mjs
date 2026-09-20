import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import {
  delimiter, extname, isAbsolute, join, relative as pathRelative, resolve,
} from 'node:path';

// Desktop builds can point this check at the exact web payload Tauri bundled.
// Standalone frontend checks retain the conventional frontend/dist default.
const dist = resolve(process.env.PAPOL_SMOKE_DIST || 'dist');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
// The links a visitor actually arrives on. A single-page app answers 200 for
// every path it has never heard of, so serving the shell proves nothing: each
// of these is opened in the browser and has to render the page it names.
// `/` alone is what let a paper link fall through to the home page unnoticed.
const PAPER_DIGEST = '5cf24221f8fa36824ddd1178cbfb5cf36d0dcfcf335c8de87826c4082b70cbf1';
const PAPER_NAME = PAPER_DIGEST.slice(0, 32);
const USER_UUID = '2f1c6f60-3f5b-4a19-9c2a-7d0e1b8c4a53';
const pages = [
  { path: '/', page: 'home' },
  { path: `/paper/${PAPER_NAME}`, page: 'paper' },
  { path: `/u/${USER_UUID}`, page: 'nook' },
  { path: `/room/${USER_UUID}`, page: 'room' },
  { path: '/library', page: 'papers' },
  { path: '/learn', page: 'learn' },
  { path: '/signin', page: 'signin' },
];

// The same bundle again, as Papol macOS runs it: a desktop environment and a
// Tauri bridge answering with replica-shaped rows — SQLite booleans, JSON
// authors, and none of the lists the replica does not store. This is the
// pass that fails when a surface dereferences a field only the web API
// sends: macOS v0.3.1 blanked on exactly that, and nothing rendered the
// desktop surfaces against replica data before it shipped.
const desktopPages = [
  { path: '/', page: 'desk' },
  { path: `/paper/${PAPER_NAME}`, page: 'desk-paper' },
];
const DESKTOP_ACCOUNT = '3a9f1d2e-6b4c-4f8a-9c1d-2e3f4a5b6c7d';
const DESKTOP_SHELF = '8b7a6c5d-4e3f-4a2b-8c9d-0e1f2a3b4c5d';
const DESKTOP_COPY = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const desktopPaperRow = {
  sha256: PAPER_DIGEST,
  title: 'The Smoke Paper',
  authors: '["Ada Lovelace","Grace Hopper"]',
  journal: 'Journal of Papol',
  year: 2026,
  doi: null,
  file_path: `${PAPER_DIGEST}.pdf`,
  created_at: '2026-01-02T03:04:05',
  updated_at: '2026-01-02T03:04:05',
  revision: 1,
  copy_uuid: DESKTOP_COPY,
  shelf_uuid: DESKTOP_SHELF,
  summary: null,
  thought: null,
  is_author: 0,
  is_public: 1,
  rating_expertise: null,
  rating_reading: null,
  rating_liking: null,
  tags: [],
};
const desktopBootstrap = `<script>
  localStorage.setItem('papol.localAccountUuid', '${DESKTOP_ACCOUNT}');
  localStorage.setItem('papol.syncPreference', 'manual');
  window.__PAPOL_ENV__ = { runtime: 'desktop', surface: 'desk', documentWindow: false };
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    invoke: async (command, parameters) => {
      if (command === 'data_query') {
        switch (parameters.queryName) {
          case 'account': return { uuid: '${DESKTOP_ACCOUNT}', display_name: 'Smoke Tester' };
          case 'paper': return ${JSON.stringify(desktopPaperRow)};
          case 'papers': return [${JSON.stringify(desktopPaperRow)}];
          case 'annotations': return [];
          case 'boards': return [];
          case 'shelves': return [{ uuid: '${DESKTOP_SHELF}', name: 'Reading', position: 1, is_default: 1, is_public: 0 }];
          case 'nook': return {
            shelves: [{ uuid: '${DESKTOP_SHELF}', name: 'Reading', position: 1, is_default: 1, is_public: 0 }],
            tags: [],
            copies: [{ uuid: '${DESKTOP_COPY}', paper_sha256: '${PAPER_DIGEST}', shelf_uuid: '${DESKTOP_SHELF}', updated_at: '2026-01-02T03:04:05' }],
            copy_tags: [],
          };
          case 'sync_status': return {
            pending: 0, cursor: 1, last_synced_at: '2026-01-02T03:04:05',
            error: null, conflicts: 0, attempts: 0, outbox_error: null, blocked: 0,
          };
          default: return null;
        }
      }
      if (command === 'local_setting_get') return null;
      if (command === 'pdf_viewer_status') return { supported: false, is_default: false };
      return null;
    },
  };
</script>`;

// Ready is a settled surface: the desk shows the nook's rows, the jacket
// shows its title. A boundary panel means a surface crashed — reported as
// its own page name so the failure says what happened.
const desktopProbe = (wantsJacket) => `<script>
  (() => {
    const ready = () => {
      if (document.querySelector('.render-error')) {
        fetch('/__papol_smoke_ready?page=render-error', { method: 'POST' });
        return;
      }
      ${wantsJacket ? `
      const title = document.querySelector('.paper-jacket h2');
      if (title && title.textContent.trim()) {
        fetch('/__papol_smoke_ready?page=desk-paper', { method: 'POST' });
        return;
      }` : `
      if (document.querySelector('.desktop-browser .desktop-row')) {
        fetch('/__papol_smoke_ready?page=desk', { method: 'POST' });
        return;
      }`}
      setTimeout(ready, 10);
    };
    ready();
  })();
</script>`;

// Which world the next launch renders. Links are opened one at a time, so
// the server can hold this between requests.
let desktopMode = false;

let markRendered;
let rendered;
const awaitNextRender = () => {
  rendered = new Promise((resolveRendered) => { markRendered = resolveRendered; });
};
awaitNextRender();

const browserCandidates = () => {
  const configured = process.env.CHROME || process.env.CHROMIUM;
  if (configured) return [configured];

  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      'google-chrome',
      'chromium',
    ];
  }
  if (process.platform === 'win32') {
    return [
      process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
      process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
      'chrome.exe',
      'msedge.exe',
    ].filter(Boolean);
  }
  return ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
};

async function findExecutable(candidates) {
  const pathDirectories = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const candidate of candidates) {
    const paths = isAbsolute(candidate) || candidate.includes('/') || candidate.includes('\\')
      ? [candidate]
      : pathDirectories.map((directory) => join(directory, candidate));
    for (const executable of paths) {
      try {
        await access(executable, fsConstants.X_OK);
        return executable;
      } catch {
        // Try the next browser installation.
      }
    }
  }
  throw new Error(
    'No Chromium-based browser found. Install Chrome or Chromium, '
    + 'or set CHROME to the browser executable path.',
  );
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/__papol_smoke_ready') {
      response.writeHead(204).end();
      markRendered({
        startupLoading: url.searchParams.get('startupLoading') === 'true',
        page: url.searchParams.get('page'),
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"detail":"Not authenticated"}');
      return;
    }
    // Production serves the application shell for any path that is not a
    // built file. Do the same here, or a deep link 404s in the smoke test for
    // a reason production would never have.
    const requested = url.pathname.replace(/^\/(?:papol\/)?/, '');
    const relative = requested === '' || !/\.[a-z0-9]+$/i.test(requested)
      ? 'index.html'
      : requested;
    const file = resolve(dist, relative);
    const relativeToDist = pathRelative(dist, file);
    if (relativeToDist.startsWith('..') || isAbsolute(relativeToDist)
        || !(await stat(file)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    const body = await readFile(file);
    if (relative === 'index.html' && desktopMode) {
      const probe = desktopProbe(/\/paper\//.test(url.pathname));
      response.end(body.toString('utf8').replace('</body>', `${desktopBootstrap}${probe}</body>`));
      return;
    }
    if (relative === 'index.html') {
      const readinessProbe = `<script>
        (() => {
          let startupLoading = false;
          const observeLoading = () => {
            startupLoading ||= [...document.querySelectorAll('.loading')]
              .some((element) => element.textContent.trim() === 'Loading…');
          };
          const loadingObserver = new MutationObserver(observeLoading);
          loadingObserver.observe(document, { childList: true, subtree: true });
          const ready = () => {
            observeLoading();
            const app = document.querySelector('.app');
            if (document.querySelector('#root > style')
                && app
                && document.querySelector('.topnav')) {
              loadingObserver.disconnect();
              fetch('/__papol_smoke_ready?startupLoading=' + startupLoading
                + '&page=' + encodeURIComponent(app.dataset.page || ''), { method: 'POST' });
            } else {
              setTimeout(ready, 10);
            }
          };
          ready();
        })();
      </script>`;
      response.end(body.toString('utf8').replace('</body>', `${readinessProbe}</body>`));
      return;
    }
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const chromium = await findExecutable(browserCandidates());

// One headless run of one link: open it, wait for the application to say it
// has rendered, and report which page it rendered.
async function openLink(path) {
  const profile = await mkdtemp(join(tmpdir(), 'papol-browser-smoke-'));
  let errors = '';
  let child;
  awaitNextRender();
  try {
    child = spawn(chromium, [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--enable-logging=stderr',
      '--v=0',
      `http://127.0.0.1:${port}/papol${path}`,
    ]);

    child.stderr.on('data', (chunk) => { errors += chunk; });
    const closed = new Promise((resolveClosed) => {
      child.once('close', (code) => resolveClosed({ kind: 'closed', code }));
    });
    const launchError = new Promise((resolveLaunchError) => {
      child.once('error', (error) => resolveLaunchError({ kind: 'error', error }));
    });
    let timeoutId;
    const timeout = new Promise((resolveTimeout) => {
      timeoutId = setTimeout(() => resolveTimeout({ kind: 'timeout' }), 20_000);
    });
    const outcome = await Promise.race([
      rendered.then((result) => ({ kind: 'rendered', ...result })),
      closed,
      launchError,
      timeout,
    ]);
    clearTimeout(timeoutId);
    return { ...outcome, errors };
  } finally {
    if (child?.exitCode === null) {
      const closed = new Promise((resolveClosed) => child.once('close', resolveClosed));
      child.kill('SIGTERM');
      await closed;
    }
    await rm(profile, { recursive: true, force: true });
  }
}

try {
  for (const { path, page } of pages) {
    const link = `/papol${path}`;
    const outcome = await openLink(path);
    if (outcome.kind === 'error') throw outcome.error;
    if (outcome.kind === 'timeout') {
      throw new Error(`${link} did not render within 20 seconds.\n${outcome.errors}`);
    }
    if (outcome.kind === 'closed') {
      throw new Error(
        `Chromium exited with status ${outcome.code} before ${link} rendered.\n${outcome.errors}`,
      );
    }
    if (outcome.startupLoading) {
      throw new Error(`${link} rendered the full-page startup loading screen before the guest shell.`);
    }
    // The whole point of walking these links. A path the router does not know
    // renders the home page and looks perfectly healthy from outside.
    if (outcome.page !== page) {
      throw new Error(
        `${link} opened the ${outcome.page || 'unnamed'} page, not the ${page} page. `
        + 'A link of this shape no longer reaches what it names.',
      );
    }
    if (/Uncaught (?:ReferenceError|TypeError|SyntaxError)/.test(outcome.errors)) {
      throw new Error(`Browser runtime error on ${link}:\n${outcome.errors}`);
    }
  }

  desktopMode = true;
  for (const { path, page } of desktopPages) {
    const link = `/papol${path} (desktop)`;
    const outcome = await openLink(path);
    if (outcome.kind === 'error') throw outcome.error;
    if (outcome.kind === 'timeout') {
      throw new Error(`${link} did not render within 20 seconds.\n${outcome.errors}`);
    }
    if (outcome.kind === 'closed') {
      throw new Error(
        `Chromium exited with status ${outcome.code} before ${link} rendered.\n${outcome.errors}`,
      );
    }
    if (outcome.page === 'render-error') {
      throw new Error(
        `${link} crashed while rendering: the error boundary is standing where `
        + 'the surface should be. A desktop surface dereferenced something a '
        + 'replica-served row does not carry — see schema/api_shapes.json.',
      );
    }
    if (outcome.page !== page) {
      throw new Error(`${link} rendered ${outcome.page || 'nothing it named'}, not ${page}.`);
    }
    if (/Uncaught (?:ReferenceError|TypeError|SyntaxError)/.test(outcome.errors)) {
      throw new Error(`Browser runtime error on ${link}:\n${outcome.errors}`);
    }
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

console.log(
  `Production browser smoke test opened ${pages.length} links, each on the page it names, `
  + `and ${desktopPages.length} desktop surfaces against replica-shaped data.`,
);
