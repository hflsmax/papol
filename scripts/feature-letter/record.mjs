#!/usr/bin/env node
// Short GIFs of Papol in use, for a letter to users
// (.claude/skills/feature-letter). Each scene in scenes.mjs opens a page,
// plays what a reader does, with a pointer drawn where the mouse is, and
// Chrome's screencast keeps every frame the page draws; ffmpeg makes the
// frames a GIF at the pace they were drawn.
//
//   node scripts/feature-letter/record.mjs <out dir> [scene ...]
//
// Needs Chrome (as the share-e2e driver finds it) and ffmpeg.

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Browser } from '../share-e2e/cdp.mjs';
import { SCENES } from './scenes.mjs';

const WIDTH = 1280;
const HEIGHT = 800;
// The GIF's width: the letter shows it at most about this wide.
const GIF_WIDTH = 960;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// A pointer the reader can follow, drawn in the page: headless Chrome has
// none. It moves by real mouse events too, so what reacts to hover does.
const POINTER = `
  if (!document.getElementById('__letter-pointer')) {
    const pointer = document.createElement('div');
    pointer.id = '__letter-pointer';
    pointer.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M5 3 L5 22 L10 17 L13.5 25 L17 23.5 L13.5 16 L20 16 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    pointer.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))';
    document.documentElement.append(pointer);
  }
  return true;`;

export class Stage {
  constructor(browser) {
    this.browser = browser;
    this.at = { x: WIDTH * 0.6, y: HEIGHT * 0.7 };
  }

  wait(ms) { return sleep(ms); }

  waitFor(expression, options) { return this.browser.waitFor(expression, options); }

  evaluate(expression) { return this.browser.evaluate(expression); }

  // The middle of the first element the selector finds, or of the one a
  // function body returns, in the window's coordinates.
  async centre(target) {
    const find = target.startsWith('return ') ? `(() => { ${target} })()` : `document.querySelector(${JSON.stringify(target)})`;
    const box = await this.browser.evaluate(`const el = ${find}; if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
    if (!box) throw new Error(`Nothing to point at: ${target}`);
    return box;
  }

  async move(target, { ms = 700 } = {}) {
    await this.browser.evaluate(POINTER);
    const to = typeof target === 'string' ? await this.centre(target) : target;
    const from = this.at;
    const steps = Math.max(8, Math.round(ms / 25));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const x = from.x + (to.x - from.x) * ease;
      const y = from.y + (to.y - from.y) * ease;
      await this.browser.evaluate(`document.getElementById('__letter-pointer').style.transform = 'translate(${x - 5}px, ${y - 3}px)';
        const carried = document.getElementById('__letter-carry');
        if (carried) carried.style.transform = 'translate(${x + 14}px, ${y + 16}px)';
        return true;`);
      await this.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await sleep(ms / steps);
    }
    this.at = to;
  }

  async click(target, options) {
    await this.move(target, options);
    await sleep(250);
    const { x, y } = this.at;
    await this.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  // Something the pointer drags, like a folder from the Finder: a label
  // with a folder glyph, following the pointer until `drop`.
  async carry(label) {
    await this.browser.evaluate(`${POINTER}`);
    await this.browser.evaluate(`const carried = document.createElement('div');
      carried.id = '__letter-carry';
      carried.innerHTML = '<svg width="34" height="28" viewBox="0 0 34 28"><path d="M2 5 Q2 2 5 2 L13 2 L16 6 L29 6 Q32 6 32 9 L32 24 Q32 27 29 27 L5 27 Q2 27 2 24 Z" fill="#6aa8e8" stroke="#3f7fc4" stroke-width="1.5"/></svg><span></span>';
      carried.querySelector('span').textContent = ${JSON.stringify(label)};
      carried.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;display:flex;align-items:center;gap:8px;padding:6px 10px 6px 8px;border-radius:8px;background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(0,0,0,.18);font:500 14px -apple-system,system-ui,sans-serif;color:#1d2733;opacity:.95;transform:translate(${this.at.x + 14}px, ${this.at.y + 16}px)';
      document.documentElement.append(carried);
      return true;`);
  }

  async drop() {
    await this.browser.evaluate(`document.getElementById('__letter-carry')?.remove(); return true;`);
  }

  async key(key, { code = key, keyCode } = {}) {
    const codes = { ArrowDown: 40, ArrowUp: 38, Escape: 27, '[': 219, ']': 221 };
    const windowsVirtualKeyCode = keyCode ?? codes[key];
    await this.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key.length === 1 ? { text: key } : {}) });
    await this.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  }

  // Scroll the page's scroller by a distance, smoothly, as a wheel would.
  async wheel(deltaY, { steps = 12, ms = 600 } = {}) {
    const { x, y } = this.at;
    for (let i = 0; i < steps; i++) {
      await this.browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: deltaY / steps });
      await sleep(ms / steps);
    }
  }
}

// What a returning reader has already dismissed (shared/featureStates.js):
// the first-link tip, the Mac app's offers. Set before the scene's page
// loads, so none of them covers what the scene is about.
const QUIET = {
  papol_learn_link_navigation: 'seen',
  'papol.handoff.retired': '1',
  'papol.macosDownloadBannerDismissed': '1',
};

async function recordScene(browser, name, scene, outDir) {
  await browser.navigate(scene.url);
  await browser.evaluate(`const quiet = ${JSON.stringify(QUIET)};
    for (const [key, value] of Object.entries(quiet)) localStorage.setItem(key, value); return true;`);
  await browser.navigate(scene.url);
  if (scene.prepare) await scene.prepare(new Stage(browser));

  const frames = [];
  const listener = (message) => {
    if (message.method !== 'Page.screencastFrame') return;
    const { data, metadata, sessionId } = message.params;
    frames.push({ data, at: metadata.timestamp });
    browser.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  };
  browser.listeners.push(listener);
  await browser.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: scene.viewport?.width ?? WIDTH, maxHeight: scene.viewport?.height ?? HEIGHT, everyNthFrame: 1 });
  const started = Date.now() / 1000;
  await scene.play(new Stage(browser));
  const ended = Date.now() / 1000;
  await browser.send('Page.stopScreencast');
  browser.listeners = browser.listeners.filter((l) => l !== listener);
  if (!frames.length) throw new Error(`${name}: the page drew no frames`);

  // Each frame shows until the next was drawn; the last until the end.
  const work = await mkdtemp(join(tmpdir(), `letter-${name}-`));
  try {
    const lines = [];
    const first = Math.min(frames[0].at, started);
    for (let i = 0; i < frames.length; i++) {
      const file = join(work, `${String(i).padStart(5, '0')}.jpg`);
      await writeFile(file, Buffer.from(frames[i].data, 'base64'));
      const from = i === 0 ? first : frames[i].at;
      const until = i + 1 < frames.length ? frames[i + 1].at : Math.max(ended, frames[i].at + 0.1);
      lines.push(`file '${file}'`, `duration ${Math.max(0.02, until - from).toFixed(3)}`);
    }
    // The concat demuxer takes the last file's duration only if it is named again.
    lines.push(`file '${join(work, `${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`);
    const list = join(work, 'frames.txt');
    await writeFile(list, `${lines.join('\n')}\n`);
    const out = join(resolve(outDir), `${name}.gif`);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf',
      `fps=12,scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop', '0', out]);
    console.log(`${out} (${frames.length} frames, ${(ended - started).toFixed(1)} s)`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const [outDir, ...asked] = process.argv.slice(2);
if (!outDir) {
  console.error(`usage: node scripts/feature-letter/record.mjs <out dir> [${Object.keys(SCENES).join(' | ')} ...]`);
  process.exit(2);
}
const names = asked.length ? asked : Object.keys(SCENES);
const unknown = names.filter((name) => !SCENES[name]);
if (unknown.length) throw new Error(`No such scene: ${unknown.join(', ')}`);

await mkdir(outDir, { recursive: true });
for (const name of names) {
  const scene = SCENES[name];
  const setup = scene.setup ? await scene.setup() : null;
  const browser = new Browser();
  try {
    await browser.start();
    const { width = WIDTH, height = HEIGHT } = scene.viewport ?? {};
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await recordScene(browser, name, { ...scene, url: typeof scene.url === 'function' ? scene.url(setup) : scene.url }, outDir);
  } finally {
    await browser.stop();
    await setup?.close?.();
  }
}
