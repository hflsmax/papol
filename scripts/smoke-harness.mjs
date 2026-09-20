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
        `http://127.0.0.1:${port}${path}`,
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
        timeoutId = setTimeout(() => resolveTimeout({ kind: 'timeout' }), 30_000);
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
        const done = new Promise((resolveClosed) => child.once('close', resolveClosed));
        child.kill('SIGTERM');
        await done;
      }
      await rm(profile, { recursive: true, force: true });
    }
  }

  try {
    for (const { path, page } of pages) {
      const outcome = await openLink(path);
      if (outcome.kind === 'error') throw outcome.error;
      if (outcome.kind === 'timeout') {
        throw new Error(`${path} did not render within 30 seconds.\n${outcome.errors}`);
      }
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
