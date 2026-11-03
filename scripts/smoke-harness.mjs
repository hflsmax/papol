// What every browser smoke needs and none should restate: find a Chromium,
// serve built files with a script injected, open one URL headless, and wait
// for the page's own probe to call home. The frontend, viewer and board
// smokes each own what they serve and what "rendered" means; this owns how
// a page is opened and how its answer comes back.
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import {
  delimiter, extname, isAbsolute, join, relative as pathRelative, resolve,
} from 'node:path';

export const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

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

const settles = (promise, ms) => Promise.race([
  promise.then(() => true),
  new Promise((resolveLate) => { setTimeout(resolveLate, ms, false).unref(); }),
]);

/**
 * Stop a Chromium spawned with `detached: true`, and every process it
 * started, before its profile is removed. SIGTERM goes to the whole group;
 * one that has not let go of its pipes in five seconds gets SIGKILL. A
 * Chromium that ignored SIGTERM used to hold CI's tests job until its
 * 45-minute timeout.
 */
export async function stopBrowser(child) {
  if (child?.pid === undefined) return;
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
      return true;
    } catch {
      return false; // the group is gone
    }
  };
  const closed = new Promise((resolveClosed) => child.once('close', resolveClosed));
  if (signal('SIGTERM') && !(await settles(closed, 5_000))) {
    signal('SIGKILL');
    await settles(closed, 5_000);
  }
  // Nothing in the group is left to write; a pipe still open is held elsewhere.
  child.stdout?.destroy();
  child.stderr?.destroy();
}

/** One built file from under `dist`, or null when the path leaves it. */
export async function distFile(dist, relative) {
  const file = resolve(dist, relative);
  const relativeToDist = pathRelative(dist, file);
  if (relativeToDist.startsWith('..') || isAbsolute(relativeToDist)) return null;
  try {
    if (!(await stat(file)).isFile()) return null;
  } catch {
    return null;
  }
  return { body: await readFile(file), type: mime[extname(file)] || 'application/octet-stream' };
}

/**
 * Flags for a throwaway headless Chrome. Beyond headless and the profile,
 * they turn off what a first run of a fresh profile does in the background
 * (sign-in, sync, component and extension updates, the OS keyring over
 * D-Bus, its own network chatter), none of which a smoke needs and all of
 * which compete with the page on a two-core runner.
 */
export const HEADLESS_CHROME_FLAGS = [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--disable-dev-shm-usage',
  '--password-store=basic',
  '--use-mock-keychain',
  '--mute-audio',
  '--remote-debugging-port=0',
  '--enable-logging=stderr',
  '--v=0',
];

// Two budgets, so a slow machine and a broken page fail differently. CI's
// first Chrome of a job reads its whole binary from a cold disk and has
// taken 30–40 s to say it is listening; once it is, a page that does not
// report within a minute is the page's fault.
export const STARTUP_BUDGET_MS = 120_000;
export const RENDER_BUDGET_MS = 60_000;
const STARTUP_ATTEMPTS = 2;

const after = (ms, kind) => new Promise((resolveLate) => {
  setTimeout(resolveLate, ms, { kind }).unref();
});

/**
 * Open `url` in a fresh headless Chrome and wait for `rendered` (a promise
 * the caller's probe endpoint resolves). Resolves `{ kind, errors, ... }`:
 * `rendered` (with what it resolved), `closed`, `error`, or `timeout` with
 * `during` saying whether Chrome never came up or the page never reported.
 * A Chrome that never came up is launched once more; a page that came up
 * and did not report is not retried.
 */
export async function openHeadless(chromium, url, rendered) {
  for (let attempt = 1; ; attempt += 1) {
    const profile = await mkdtemp(join(tmpdir(), 'papol-browser-smoke-'));
    let errors = '';
    let child;
    try {
      // Its own process group, so stopBrowser reaches every process it starts.
      child = spawn(chromium, [...HEADLESS_CHROME_FLAGS, `--user-data-dir=${profile}`, url], {
        detached: true,
      });
      let markListening;
      const listening = new Promise((resolveListening) => { markListening = resolveListening; });
      child.stderr.on('data', (chunk) => {
        errors += chunk;
        if (errors.includes('DevTools listening on')) markListening({ kind: 'listening' });
      });
      const closed = new Promise((resolveClosed) => {
        child.once('close', (code) => resolveClosed({ kind: 'closed', code }));
      });
      const launchError = new Promise((resolveLaunchError) => {
        child.once('error', (error) => resolveLaunchError({ kind: 'error', error }));
      });
      const done = rendered.then((result) => ({ kind: 'rendered', ...result }));

      const startedAt = Date.now();
      let outcome = await Promise.race([
        done, closed, launchError, listening, after(STARTUP_BUDGET_MS, 'startup-timeout'),
      ]);
      if (outcome.kind === 'startup-timeout') {
        if (attempt < STARTUP_ATTEMPTS) {
          console.warn(`Chrome did not start within ${STARTUP_BUDGET_MS / 1000} s; launching it again.`);
          continue;
        }
        return { kind: 'timeout', during: 'startup', errors };
      }
      if (outcome.kind === 'listening') {
        const startup = Date.now() - startedAt;
        if (startup > 10_000) console.warn(`Chrome took ${Math.round(startup / 1000)} s to start.`);
        outcome = await Promise.race([done, closed, launchError, after(RENDER_BUDGET_MS, 'timeout')]);
        if (outcome.kind === 'timeout') outcome.during = 'render';
      }
      return { ...outcome, errors };
    } finally {
      await stopBrowser(child);
      await rm(profile, { recursive: true, force: true, maxRetries: 5 });
    }
  }
}

/** What a smoke says when `openHeadless` timed out on `link`. */
export function timeoutMessage(link, outcome) {
  const said = outcome.during === 'startup'
    ? `Chrome did not start within ${STARTUP_BUDGET_MS / 1000} seconds, twice, before ${link} could open.`
    : `${link} did not render within ${RENDER_BUDGET_MS / 1000} seconds of Chrome starting.`;
  return `${said}\n${outcome.errors}`;
}

/**
 * Serve `respond(url)` and open each page in its own headless browser.
 *
 * `respond` answers with `{ status?, type?, body }` or null for a 404; the
 * injected probe reports by fetching `/__papol_smoke_ready?page=<name>`.
 * Each page names what its probe must report; anything else — a timeout, a
 * crash, an uncaught error — fails with the browser's stderr attached.
 */
export async function runSmoke(pages, respond) {
  let markRendered;
  let rendered;
  const awaitNextRender = () => {
    rendered = new Promise((resolveRendered) => { markRendered = resolveRendered; });
  };
  awaitNextRender();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/__papol_smoke_ready') {
        response.writeHead(204).end();
        markRendered({ page: url.searchParams.get('page') });
        return;
      }
      const answer = await respond(url, request);
      if (!answer) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(answer.status || 200, {
        'content-type': answer.type || 'application/octet-stream',
      });
      response.end(answer.body);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  const chromium = await findExecutable(browserCandidates());

  async function openLink(path) {
    awaitNextRender();
    return openHeadless(chromium, `http://127.0.0.1:${port}${path}`, rendered);
  }

  try {
    for (const { path, page } of pages) {
      const outcome = await openLink(path);
      if (outcome.kind === 'error') throw outcome.error;
      if (outcome.kind === 'timeout') throw new Error(timeoutMessage(path, outcome));
      if (outcome.kind === 'closed') {
        throw new Error(
          `Chromium exited with status ${outcome.code} before ${path} rendered.\n${outcome.errors}`,
        );
      }
      if (outcome.page !== page) {
        throw new Error(
          `${path} reported "${outcome.page || 'nothing'}", not "${page}".\n${outcome.errors}`,
        );
      }
      if (/Uncaught (?:ReferenceError|TypeError|SyntaxError)/.test(outcome.errors)) {
        throw new Error(`Browser runtime error on ${path}:\n${outcome.errors}`);
      }
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}
