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
let markRendered;
const rendered = new Promise((resolveRendered) => { markRendered = resolveRendered; });

const browserCandidates = () => {
  const configured = process.env.CHROME || process.env.CHROMIUM;
  if (configured) return [configured];

  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"detail":"Not authenticated"}');
      return;
    }
    const relative = url.pathname === '/papol/' || url.pathname === '/'
      ? 'index.html'
      : url.pathname.replace(/^\/(?:papol\/)?/, '');
    const file = resolve(dist, relative);
    const relativeToDist = pathRelative(dist, file);
    if (relativeToDist.startsWith('..') || isAbsolute(relativeToDist)
        || !(await stat(file)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    const body = await readFile(file);
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
            if (document.querySelector('#root > style')
                && document.querySelector('.app')
                && document.querySelector('.topnav')) {
              loadingObserver.disconnect();
              fetch('/__papol_smoke_ready?startupLoading=' + startupLoading, { method: 'POST' });
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
const profile = await mkdtemp(join(tmpdir(), 'papol-browser-smoke-'));
let errors = '';
let child;

try {
  const chromium = await findExecutable(browserCandidates());
  child = spawn(chromium, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--enable-logging=stderr',
    '--v=0',
    `http://127.0.0.1:${port}/papol/`,
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
  if (outcome.kind === 'error') throw outcome.error;
  if (outcome.kind === 'timeout') throw new Error(`Papol did not render within 20 seconds.\n${errors}`);
  if (outcome.kind === 'closed') {
    throw new Error(`Chromium exited with status ${outcome.code} before Papol rendered.\n${errors}`);
  }
  if (outcome.startupLoading) {
    throw new Error('Papol rendered the full-page startup loading screen before the guest shell.');
  }
} finally {
  if (child?.exitCode === null) {
    const closed = new Promise((resolveClosed) => child.once('close', resolveClosed));
    child.kill('SIGTERM');
    await closed;
  }
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true });
}

if (/Uncaught (?:ReferenceError|TypeError|SyntaxError)/.test(errors)) {
  throw new Error(`Browser runtime error:\n${errors}`);
}

console.log('Production browser smoke test rendered the Papol app.');
