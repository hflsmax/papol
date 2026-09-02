import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const FPS = 15;
const WIDTH = 1280;
const HEIGHT = 720;
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const FRAMES = path.join(ROOT, 'frames');
const TEAPOT = path.join(ROOT, 'utah-teapot.png');
const BUNNY = path.join(ROOT, 'stanford-bunny.png');
const ORIGIN = 'http://127.0.0.1:8000';
const token = process.env.PAPOL_TOKEN || execFileSync(
  'sqlite3',
  ['backend/papol.db', 'SELECT token FROM auth_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1;'],
  { encoding: 'utf8' },
).trim();
const chromiumPath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();

const request = async (route, options = {}) => {
  const response = await fetch(`${ORIGIN}/api${route}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${route}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
};

execFileSync('python', [path.join(ROOT, 'prepare_assets.py')]);
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

let browser;
let boardGuid = null;
try {
  browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  let frame = 0;
  let pointer = { x: 640, y: 640 };

  await page.evaluateOnNewDocument((value) => {
    localStorage.setItem('papol_token', value);
    window.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = `
        #tutorial-pointer { position: fixed; left: 640px; top: 640px; width: 27px; height: 35px; pointer-events: none; z-index: 2147483647; filter: drop-shadow(0 2px 2px rgba(0,0,0,.45)); transform: translate(-2px,-2px); }
        #tutorial-pointer svg { display: block; width: 100%; height: 100%; }
        #tutorial-click { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 3px solid #e25835; border-radius: 50%; opacity: 0; pointer-events: none; z-index: 2147483646; }
        #tutorial-click.on { opacity: .95; }
        #tutorial-keys { position: fixed; left: 50%; bottom: 38px; z-index: 2147483647; padding: 9px 14px; border: 1px solid rgba(255,255,255,.34); border-radius: 9px; background: rgba(22,29,39,.9); box-shadow: 0 5px 18px rgba(0,0,0,.2); color: white; font: 650 15px/1 system-ui,sans-serif; letter-spacing: .02em; opacity: 0; pointer-events: none; transform: translate(-50%,8px); transition: opacity .12s ease,transform .12s ease; }
        #tutorial-keys.on { opacity: 1; transform: translate(-50%,0); }
        #tutorial-file { position: fixed; z-index: 2147483645; padding: 7px 10px; border-radius: 7px; background: rgba(255,255,255,.96); box-shadow: 0 4px 15px rgba(0,0,0,.2); color: #253047; font: 600 13px/1 system-ui,sans-serif; opacity: 0; pointer-events: none; transform: translate(16px,15px); }
        #tutorial-file.on { opacity: 1; }
      `;
      document.head.append(style);
      const cursor = document.createElement('div');
      cursor.id = 'tutorial-pointer';
      cursor.innerHTML = '<svg viewBox="0 0 27 35" aria-hidden="true"><path d="M2 1.5 23 23l-9.2.7 5.3 8.2-5 2.8-5-8.4-6.8 6.4Z" fill="#fff" stroke="#171717" stroke-width="2.2" stroke-linejoin="round"/></svg>';
      document.body.append(cursor);
      const click = document.createElement('div');
      click.id = 'tutorial-click';
      document.body.append(click);
      const keys = document.createElement('div');
      keys.id = 'tutorial-keys';
      keys.textContent = 'Ctrl + V';
      document.body.append(keys);
      const file = document.createElement('div');
      file.id = 'tutorial-file';
      document.body.append(file);
    });
  }, token);

  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const save = async () => {
    await page.screenshot({ path: path.join(FRAMES, `${String(frame++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 88 });
  };
  const setPointer = async (x, y) => {
    pointer = { x, y };
    await page.mouse.move(x, y);
    await page.evaluate(({ px, py }) => {
      const cursor = document.querySelector('#tutorial-pointer');
      if (cursor) { cursor.style.left = `${px}px`; cursor.style.top = `${py}px`; }
    }, { px: x, py: y });
  };
  const hold = async (seconds) => { for (let i = 0; i < Math.round(seconds * FPS); i += 1) await save(); };
  const padTo = async (seconds) => { while (frame < Math.round(seconds * FPS)) await save(); };
  const moveTo = async (x, y, seconds = 1) => {
    const from = pointer;
    const count = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= count; i += 1) {
      const t = ease(i / count);
      await setPointer(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
      await save();
    }
  };
  const center = async (selector) => page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const cue = async (x, y) => {
    await page.evaluate(({ px, py }) => {
      const ring = document.querySelector('#tutorial-click');
      ring.style.left = `${px}px`; ring.style.top = `${py}px`; ring.classList.add('on');
    }, { px: x, py: y });
    await hold(0.13);
    await page.evaluate(() => document.querySelector('#tutorial-click').classList.remove('on'));
  };
  const clickSelector = async (selector, seconds = 1.1) => {
    const point = await center(selector);
    await moveTo(point.x, point.y, seconds);
    await cue(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    await sleep(120);
    await hold(0.12);
  };
  const dragSelector = async (selector, destination, seconds = 1.6) => {
    const start = await center(selector);
    await moveTo(start.x, start.y, 1.0);
    await page.mouse.down();
    await hold(0.16);
    await moveTo(destination.x, destination.y, seconds);
    await page.mouse.up();
    await sleep(350);
    await hold(0.2);
  };
  const dropExternalFile = async (filePath, filename, destination) => {
    const base64 = fs.readFileSync(filePath).toString('base64');
    await setPointer(-30, destination.y - 80);
    await page.evaluate(({ name, x, y }) => {
      const label = document.querySelector('#tutorial-file');
      label.textContent = name;
      label.style.left = `${x}px`;
      label.style.top = `${y}px`;
      label.classList.add('on');
    }, { name: filename, x: -30, y: destination.y - 80 });
    const start = pointer;
    const count = Math.round(1.8 * FPS);
    for (let i = 1; i <= count; i += 1) {
      const t = ease(i / count);
      const x = start.x + (destination.x - start.x) * t;
      const y = start.y + (destination.y - start.y) * t;
      await setPointer(x, y);
      await page.evaluate(({ px, py }) => {
        const label = document.querySelector('#tutorial-file');
        label.style.left = `${px}px`;
        label.style.top = `${py}px`;
      }, { px: x, py: y });
      await save();
    }
    await page.evaluate(({ encoded, name, x, y }) => {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: 'image/png' }));
      const target = document.querySelector('.board-viewport');
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer }));
      }
      document.querySelector('#tutorial-file').classList.remove('on');
    }, { encoded: base64, name: filename, x: destination.x, y: destination.y });
    await sleep(500);
    await hold(0.25);
  };

  await page.goto(ORIGIN, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.new-board-btn');
  await setPointer(640, 640);
  await padTo(4.8);

  await clickSelector('.new-board-btn', 1.25);
  await page.waitForSelector('#inline-board-name');
  await clickSelector('#inline-board-name', 0.7);
  await page.type('#inline-board-name', 'Ideas in motion', { delay: 85 });
  const createPoint = await center('.nook-inline-board-create button[type="submit"]');
  await moveTo(createPoint.x, createPoint.y, 1.0);
  await cue(createPoint.x, createPoint.y);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.mouse.click(createPoint.x, createPoint.y),
  ]);
  boardGuid = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  await page.waitForSelector('.board-viewport');
  await setPointer(640, 640);
  await padTo(12.0);

  await dropExternalFile(TEAPOT, 'utah-teapot.png', { x: 230, y: 245 });
  await page.waitForFunction(() => document.querySelectorAll('.board-canvas-card').length === 1);
  await padTo(16.8);
  await dropExternalFile(BUNNY, 'stanford-bunny.png', { x: 940, y: 255 });
  await page.waitForFunction(() => document.querySelectorAll('.board-canvas-card').length === 2);
  await moveTo(570, 590, 0.8);
  await padTo(20.0);

  const notePoint = { x: 1080, y: 630 };
  await moveTo(notePoint.x, notePoint.y, 1.15);
  await cue(notePoint.x, notePoint.y);
  await page.mouse.click(notePoint.x, notePoint.y, { clickCount: 2, delay: 120 });
  await page.waitForSelector('.board-inline-description');
  await page.type('.board-inline-description', 'What connects these ideas?', { delay: 65 });
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
  await sleep(260);
  await moveTo(610, 625, 0.7);
  await padTo(25.4);

  await page.evaluate(() => {
    const pasteOnShortcut = (event) => {
      if (!event.ctrlKey || event.key.toLowerCase() !== 'v') return;
      window.removeEventListener('keydown', pasteOnShortcut);
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'https://graphics.stanford.edu/data/3Dscanrep/');
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    };
    window.addEventListener('keydown', pasteOnShortcut);
  });
  await moveTo(1140, 130, 1.0);
  await page.evaluate(() => document.querySelector('#tutorial-keys').classList.add('on'));
  await hold(0.2);
  await page.keyboard.down('Control');
  await page.keyboard.press('V');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.querySelectorAll('.board-canvas-card').length === 4);
  await hold(0.65);
  await page.evaluate(() => document.querySelector('#tutorial-keys').classList.remove('on'));
  await hold(0.25);
  await padTo(33.0);

  await page.evaluate(() => {
    const pasteUrlOnShortcut = (event) => {
      if (!event.ctrlKey || event.key.toLowerCase() !== 'v') return;
      window.removeEventListener('keydown', pasteUrlOnShortcut);
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    };
    window.addEventListener('keydown', pasteUrlOnShortcut);
  });
  await page.evaluate(() => document.querySelector('#tutorial-keys').classList.add('on'));
  await hold(0.2);
  await page.keyboard.down('Control');
  await page.keyboard.press('V');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.querySelectorAll('.board-canvas-card').length === 5, { timeout: 30000 });
  await hold(0.65);
  await page.evaluate(() => document.querySelector('#tutorial-keys').classList.remove('on'));
  await padTo(40.2);

  await dragSelector('.board-canvas-card.selected .board-resize-handle', { x: 760, y: 570 }, 1.45);
  await dragSelector('.board-canvas-card.selected', { x: 620, y: 500 }, 1.55);
  await moveTo(1160, 140, 1.2);
  await padTo(55.0);

  console.log(JSON.stringify({ frames: frame, seconds: frame / FPS, board: boardGuid }));
} finally {
  if (browser) await browser.close();
  if (boardGuid) await request(`/boards/${boardGuid}`, { method: 'DELETE' });
  fs.rmSync(TEAPOT, { force: true });
  fs.rmSync(BUNNY, { force: true });
}
