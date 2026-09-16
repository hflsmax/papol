// A minimal Chrome DevTools Protocol driver, with no dependencies.
//
// Papol's browser smoke test spawns Chrome but never talks to it: it serves
// its own copy of the page with a readiness probe injected. That works when
// the harness owns the HTML. Driving the real application — putting a reader
// in, pressing things, reading what rendered — needs the protocol itself.
//
// Node 22 has a global WebSocket, so this is the whole of it.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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

  /// Put a reader in the way the application itself does, by storing the
  /// credential it would have stored. The token comes from the backend's own
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
