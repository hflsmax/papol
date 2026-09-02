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
const ORIGIN = 'http://127.0.0.1:8000';
const token = process.env.PAPOL_TOKEN || execFileSync(
  'sqlite3',
  ['backend/papol.db', 'SELECT token FROM auth_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1;'],
  { encoding: 'utf8' },
).trim();
const chromiumPath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();

const api = async (route, options = {}) => {
  const response = await fetch(`${ORIGIN}/api${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${route}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
};

fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const board = await api('/boards', {
  method: 'POST',
  body: JSON.stringify({ name: 'Ideas for a paper' }),
});
const cards = [
  ['Question', 70, 60],
  ['Evidence', 350, 235],
  ['Conclusion', 165, 410],
  ['Related method', 650, 75],
  ['Useful example', 920, 180],
  ['Open possibility', 685, 390],
];
const items = [];
let browser;

try {
  for (const [content, x, y] of cards) {
    items.push(await api(`/boards/${board.guid}/comments`, {
      method: 'POST', body: JSON.stringify({ content, x, y }),
    }));
  }

  browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  let frame = 0;
  let pointer = { x: 640, y: 630 };

  await page.evaluateOnNewDocument((value) => {
    localStorage.setItem('papol_token', value);
  }, token);
  await page.goto(`${ORIGIN}/boards/${board.guid}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.board-canvas-card');
  await page.waitForFunction((count) => document.querySelectorAll('.board-canvas-card').length === count, {}, cards.length);

  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #tutorial-pointer {
        position: fixed; left: 0; top: 0; width: 27px; height: 35px;
        pointer-events: none; z-index: 2147483647;
        filter: drop-shadow(0 2px 2px rgba(0,0,0,.45));
        transform: translate(-2px,-2px);
      }
      #tutorial-pointer svg { display: block; width: 100%; height: 100%; }
      #tutorial-click {
        position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px;
        border: 3px solid #e25835; border-radius: 50%; opacity: 0;
        pointer-events: none; z-index: 2147483646;
      }
      #tutorial-click.on { opacity: .95; transform: scale(1); }
    `;
    document.head.append(style);
    const cursor = document.createElement('div');
    cursor.id = 'tutorial-pointer';
    cursor.innerHTML = '<svg viewBox="0 0 27 35" aria-hidden="true"><path d="M2 1.5 23 23l-9.2.7 5.3 8.2-5 2.8-5-8.4-6.8 6.4Z" fill="#fff" stroke="#171717" stroke-width="2.2" stroke-linejoin="round"/></svg>';
    document.body.append(cursor);
    const click = document.createElement('div');
    click.id = 'tutorial-click';
    document.body.append(click);
  });

  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const save = async () => {
    const name = `${String(frame++).padStart(5, '0')}.jpg`;
    await page.screenshot({ path: path.join(FRAMES, name), type: 'jpeg', quality: 88 });
  };
  const setPointer = async (x, y) => {
    pointer = { x, y };
    await page.mouse.move(x, y);
    await page.evaluate(({ x: px, y: py }) => {
      const cursor = document.querySelector('#tutorial-pointer');
      cursor.style.left = `${px}px`;
      cursor.style.top = `${py}px`;
    }, pointer);
  };
  const hold = async (seconds) => {
    for (let i = 0; i < Math.round(seconds * FPS); i += 1) await save();
  };
  const padTo = async (seconds) => {
    while (frame < Math.round(seconds * FPS)) await save();
  };
  const moveTo = async (x, y, seconds) => {
    const from = pointer;
    const count = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= count; i += 1) {
      const t = ease(i / count);
      await setPointer(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
      await save();
    }
  };
  const center = async (selector) => page.$eval(selector, (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const clickAt = async (x, y, seconds = 1.1, shift = false) => {
    await moveTo(x, y, seconds);
    await page.evaluate(({ px, py }) => {
      const ring = document.querySelector('#tutorial-click');
      ring.style.left = `${px}px`;
      ring.style.top = `${py}px`;
      ring.classList.add('on');
    }, { px: x, py: y });
    await hold(0.12);
    await page.evaluate(() => document.querySelector('#tutorial-click').classList.remove('on'));
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(x, y);
    if (shift) await page.keyboard.up('Shift');
    await sleep(120);
    await hold(0.12);
  };
  const clickSelector = async (selector, seconds = 1.1, shift = false) => {
    const point = await center(selector);
    console.log(JSON.stringify({ action: 'click', selector, second: frame / FPS, point }));
    await clickAt(point.x, point.y, seconds, shift);
  };
  const selectCards = async (selected, from, to) => {
    for (const item of selected) {
      await clickSelector(`[data-item-id="${item.id}"] .board-card-content`, 0.75, true);
    }
    await padTo(to);
  };

  await setPointer(640, 635);
  await padTo(6.1);

  // 6.1–10.3s: Shift-select the first three cards.
  await selectCards(items.slice(0, 3), 6.1, 10.3);

  // 10.3–17.9s: make the ordered booklet and title it.
  await clickSelector('.board-selection-menu button:last-child', 1.25);
  await page.waitForSelector('input[aria-label="Booklet title"]');
  await page.type('input[aria-label="Booklet title"]', 'Reading path', { delay: 65 });
  await page.keyboard.press('Enter');
  await sleep(220);
  await moveTo(540, 620, 0.9);
  await padTo(17.9);

  // 17.9–26s: select the remaining cards and make a collection.
  await selectCards(items.slice(3), 17.9, 22.1);
  await clickSelector('.board-selection-menu button:nth-last-child(2)', 1.25);
  await page.waitForSelector('input[aria-label="Collection title"]');
  await page.type('input[aria-label="Collection title"]', 'Related ideas', { delay: 60 });
  await page.keyboard.press('Enter');
  await sleep(220);
  await moveTo(560, 625, 0.8);
  await padTo(26.0);

  // 26–35s: select the collection and demonstrate its two layout modes.
  await clickSelector('button[aria-label^="Move or select collection"]', 1.25);
  await page.waitForSelector('.board-selection-menu button');
  await clickSelector('.board-selection-menu button:nth-of-type(1)', 1.25);
  await page.waitForFunction(() => [...document.querySelectorAll('.board-selection-menu button')].some((button) => button.textContent === 'Freeform'));
  await hold(1.1);
  await clickSelector('.board-selection-menu button:nth-of-type(1)', 1.25);
  await moveTo(620, 625, 1.0);
  await padTo(35.0);

  // 35–40s: hold on both structures while the comparison and sign-off land.
  await moveTo(620, 650, 0.8);
  await padTo(40.0);

  console.log(JSON.stringify({ frames: frame, seconds: frame / FPS, board: board.guid }));
} finally {
  if (browser) await browser.close();
  await api(`/boards/${board.guid}`, { method: 'DELETE' });
}
