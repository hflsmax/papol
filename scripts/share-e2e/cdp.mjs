// A minimal Chrome DevTools Protocol driver, with no dependencies.
//
// Papol's browser smoke test spawns Chrome but never talks to it: it serves
// its own copy of the page with a readiness probe injected. That works when
// the harness owns the HTML. Driving the real application — putting a user
// in, pressing things, reading what rendered — needs the protocol itself.
//
// Node 22 has a global WebSocket, so this is the whole of it.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CHROME names the binary. Unset, a Mac's Chrome where there is one, and
// else the `chromium` the nix shell puts on PATH — which is what CI has,
// so a smoke run from an app's `npm test` there needs no variable.
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME = process.env.CHROME || process.env.CHROMIUM
  || (existsSync(MAC_CHROME) ? MAC_CHROME : 'chromium');

// Where a failing run leaves what the page looked like (`capture`). CI
// names a directory of its own and uploads it; locally it is the temp dir.
export const ARTIFACTS = process.env.PAPOL_E2E_ARTIFACTS || join(tmpdir(), 'papol-e2e-artifacts');

/// The suites' one way of saying how a check went: a line per check, and,
/// for one that failed, the page as it stood kept beside the run. The
/// screenshot is asked for at once, so it is queued on the socket ahead
/// of whatever the suite does next; `settle` waits for the files.
export function checker(browser) {
  const kept = [];
  const state = { failures: 0 };
  state.check = (label, ok, detail = '') => {
    console.log(`  [${ok ? 'ok  ' : 'FAIL'}] ${label}${ok || !detail ? '' : `  — ${detail}`}`);
    if (ok) return;
    state.failures += 1;
    if (browser.socket) kept.push(browser.capture(`${String(state.failures).padStart(2, '0')}-${label}`));
  };
  state.settle = () => Promise.all(kept);
  return state;
}

export class Browser {
  constructor({ headless = true } = {}) {
    this.headless = headless;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
  }

  async start() {
    this.profile = await mkdtemp(join(tmpdir(), 'papol-cdp-'));
    const port = 9222 + Math.floor(Math.random() * 500);
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${this.profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ];
    if (this.headless) args.unshift('--headless=new');
    this.chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.stderr = '';
    this.chrome.on('error', (error) => { this.stderr += `${error.message}\n`; });
    this.chrome.stderr.on('data', (chunk) => { this.stderr += chunk; });

    const endpoint = await this.#endpoint(port);
    this.socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => this.#receive(event.data));

    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.session = sessionId;
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }

  async #endpoint(port, deadline = Date.now() + 20_000) {
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        const body = await response.json();
        if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
      } catch { /* chrome is still starting */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(
      `Chrome never opened a debugging port. Set CHROME to its binary if it is `
      + `installed elsewhere.\n${this.stderr}`,
    );
  }

  #receive(raw) {
    const message = JSON.parse(raw);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (this.session && !method.startsWith('Target.')) payload.sessionId = this.session;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 30_000);
    });
  }

  async navigate(url) {
    const loaded = new Promise((resolve) => {
      const listener = (message) => {
        if (message.method === 'Page.loadEventFired') {
          this.listeners = this.listeners.filter((l) => l !== listener);
          resolve();
        }
      };
      this.listeners.push(listener);
    });
    await this.send('Page.navigate', { url });
    await loaded;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description
        || JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  /// Poll until the page says yes, so a check never races a render.
  async waitFor(expression, { timeout = 15_000, what = expression } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        // Coerced to a boolean deliberately: returnByValue cannot serialize a
        // DOM node, so a predicate ending in querySelector would throw on
        // every poll and read as a page that never rendered at all.
        const value = await this.evaluate(`return !!(${expression});`);
        if (value) return value;
      } catch { /* the page may still be mounting */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`timed out waiting for: ${what}`);
  }

  text() {
    return this.evaluate('return document.body.innerText;');
  }

  /// Put files on an <input type=file>, as a user choosing them would: the
  /// input's change event fires, and the page reads real bytes from disk.
  async setFiles(selector, files) {
    const { root } = await this.send('DOM.getDocument');
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no ${selector} to put a file on`);
    await this.send('DOM.setFileInputFiles', { nodeId, files });
  }

  /// Answer requests the page makes to the outside world from here, so a
  /// check does not depend on a third party being up. `routes` pairs a
  /// URL pattern (the Fetch domain's glob) with a function from the
  /// request to `{ status, headers, body }`; anything it answers null for
  /// goes on to the network as it was.
  async intercept(routes) {
    this.routes = routes;
    this.listeners.push(async (message) => {
      if (message.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = message.params;
      const route = this.routes.find(({ match }) => match(request.url));
      const answer = route ? await route.answer(request) : null;
      if (!answer) {
        await this.send('Fetch.continueRequest', { requestId }).catch(() => {});
        return;
      }
      const body = Buffer.isBuffer(answer.body) ? answer.body : Buffer.from(String(answer.body ?? ''));
      await this.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: answer.status ?? 200,
        responseHeaders: Object.entries(answer.headers ?? {}).map(([name, value]) => ({ name, value: String(value) })),
        body: body.toString('base64'),
      }).catch(() => {});
    });
    await this.send('Fetch.enable', { patterns: routes.map(({ pattern }) => ({ urlPattern: pattern })) });
  }

  /// What the page looked like when a check failed: a screenshot, and the
  /// document as it stood, so a red run in CI can be read without being
  /// run again. Never throws — it runs on the way out of a failure, and a
  /// second error there would hide the first.
  async capture(name) {
    const stem = join(ARTIFACTS, name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'page');
    // The document first: it needs only the page's script, and a page that
    // draws no frame (a hung renderer) still has one to give.
    const kept = [];
    const keep = async (file, make) => {
      try {
        await writeFile(file, await Promise.race([make(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('no answer in 10 s')), 10_000))]));
        kept.push(file);
      } catch (error) {
        console.log(`    (could not keep ${file}: ${error.message})`);
      }
    };
    await mkdir(ARTIFACTS, { recursive: true }).catch(() => {});
    await keep(`${stem}.html`, () => this.evaluate('return "<!-- " + location.href + " -->\\n" + document.documentElement.outerHTML;'));
    await keep(`${stem}.png`, async () => Buffer.from((await this.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    if (kept.length) console.log(`    page kept: ${kept.join(', ')}`);
  }

  /// Put a user in the way the application itself does, by storing the
  /// credential it would have stored. The token comes from the Worker's own
  /// API, so no password is typed into any field.
  async signIn({ token, accountUuid, origin }) {
    await this.navigate(`${origin}/`);
    await this.evaluate(`
      localStorage.setItem('papol_token', ${JSON.stringify(token)});
      ${accountUuid ? `localStorage.setItem('papol.localAccountUuid', ${JSON.stringify(accountUuid)});` : ''}
      return true;
    `);
  }

  async stop() {
    try { this.socket?.close(); } catch { /* already gone */ }
    if (this.chrome?.exitCode === null) {
      const closed = new Promise((resolve) => this.chrome.once('close', resolve));
      this.chrome.kill('SIGTERM');
      await closed;
    }
    if (this.profile) await rm(this.profile, { recursive: true, force: true });
  }
}
