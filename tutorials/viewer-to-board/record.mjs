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
const PDF = 'f389e052386e9dbd19e78db426f84f4935045471e7613957fb69dade09cfab21';
const VIEWER_URL = `${ORIGIN}/viewer/?pdf=${PDF}`;
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
  body: JSON.stringify({ name: 'Viewer highlights' }),
});
let browser;
let createdClipId = null;

try {
  browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });
  let page = await browser.newPage();
  let frame = 0;
  let pointer = { x: 640, y: 650 };

  page.on('response', async (response) => {
    if (response.request().method() !== 'POST' || !response.ok()) return;
    if (!/\/api\/editions\/\d+\/clips$/.test(response.url())) return;
    try { createdClipId = (await response.json()).id; } catch { /* cleanup remains best effort */ }
  });

  await page.evaluateOnNewDocument((value) => localStorage.setItem('papol_token', value), token);
  await page.goto(VIEWER_URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.pdf-page[data-page="3"]', { timeout: 30000 });
  await page.$eval('.pdf-page[data-page="3"]', (el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForSelector('.pdf-page[data-page="3"] canvas', { timeout: 30000 });

  const installPointer = async () => page.evaluate(() => {
    document.querySelector('#tutorial-pointer')?.remove();
    document.querySelector('#tutorial-click')?.remove();
    if (!document.querySelector('#tutorial-pointer-style')) {
      const style = document.createElement('style');
      style.id = 'tutorial-pointer-style';
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
        #tutorial-click.on { opacity: .95; }
      `;
      document.head.append(style);
    }
    const cursor = document.createElement('div');
    cursor.id = 'tutorial-pointer';
    cursor.innerHTML = '<svg viewBox="0 0 27 35" aria-hidden="true"><path d="M2 1.5 23 23l-9.2.7 5.3 8.2-5 2.8-5-8.4-6.8 6.4Z" fill="#fff" stroke="#171717" stroke-width="2.2" stroke-linejoin="round"/></svg>';
    document.body.append(cursor);
    const click = document.createElement('div');
    click.id = 'tutorial-click';
    document.body.append(click);
  });
  await installPointer();

  const railPressed = await page.$eval('.rail-handle', (el) => el.getAttribute('aria-pressed') === 'true');
  if (railPressed) await page.$eval('.rail-handle', (el) => el.click());
  await page.$eval('.pdf-page[data-page="3"]', (el) => el.scrollIntoView({ block: 'start' }));
  await new Promise((resolve) => setTimeout(resolve, 450));

  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const save = async () => {
    await page.screenshot({
      path: path.join(FRAMES, `${String(frame++).padStart(5, '0')}.jpg`),
      type: 'jpeg', quality: 88,
    });
  };
  const setPointer = async (x, y) => {
    pointer = { x, y };
    await page.mouse.move(x, y);
    await page.evaluate(({ px, py }) => {
      const cursor = document.querySelector('#tutorial-pointer');
      if (cursor) {
        cursor.style.left = `${px}px`;
        cursor.style.top = `${py}px`;
      }
    }, { px: x, py: y });
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
  const clickAt = async (x, y, seconds = 0.85) => {
    await moveTo(x, y, seconds);
    await page.evaluate(({ px, py }) => {
      const ring = document.querySelector('#tutorial-click');
      ring.style.left = `${px}px`;
      ring.style.top = `${py}px`;
      ring.classList.add('on');
    }, { px: x, py: y });
    await hold(0.12);
    await page.evaluate(() => document.querySelector('#tutorial-click').classList.remove('on'));
    await page.mouse.click(x, y);
    await sleep(100);
    await hold(0.1);
  };
  const clickSelector = async (selector, seconds = 0.85) => {
    const point = await center(selector);
    console.log(JSON.stringify({ action: 'click', selector, second: frame / FPS, point }));
    await clickAt(point.x, point.y, seconds);
  };
  const drag = async (from, to, seconds) => {
    await moveTo(from.x, from.y, 0.75);
    await page.mouse.down();
    const count = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= count; i += 1) {
      const t = ease(i / count);
      await setPointer(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      await save();
    }
    await page.mouse.up();
    await sleep(120);
    await hold(0.1);
  };
  const chooseBoard = async () => {
    await clickSelector('.send-selection-sheet select', 0.75);
    await page.select('.send-selection-sheet select', board.guid);
    await page.keyboard.press('Escape');
    await hold(0.3);
  };

  const pageCenter = await center('.pdf-page[data-page="3"]');
  await setPointer(pageCenter.x, Math.min(650, pageCenter.y));
  await padTo(4.6);

  // 4.6–13s: select one complete sentence, add a comment, choose the board, and send.
  const textLine = await page.$eval('.pdf-page[data-page="3"]', (page3) => {
    const lines = [...page3.querySelectorAll('.textLayer span')];
    const opening = 'The unit cell has a degree-4 vertex, and thus it';
    const closing = 'is a single degree of freedom system.';
    const first = lines.find((span) => span.textContent.includes(opening));
    const last = lines.find((span) => span.textContent.includes(closing));
    if (!first || !last) throw new Error('The tutorial sentence was not found in the text layer');
    const characterRect = (span, offset) => {
      const range = document.createRange();
      range.setStart(span.firstChild, offset);
      range.setEnd(span.firstChild, offset + 1);
      return range.getBoundingClientRect();
    };
    const startOffset = first.textContent.indexOf(opening);
    const endOffset = last.textContent.indexOf(closing) + closing.length - 1;
    const startRect = characterRect(first, startOffset);
    const endRect = characterRect(last, endOffset);
    return {
      from: { x: startRect.left, y: startRect.top + startRect.height * 0.55 },
      to: { x: endRect.right, y: endRect.top + endRect.height * 0.55 },
      text: `${opening} ${closing}`,
    };
  });
  console.log(JSON.stringify({ action: 'select-text', second: frame / FPS, textLine }));
  await drag(textLine.from, textLine.to, 1.1);
  await page.waitForSelector('.selection-send', { timeout: 5000 });
  await clickSelector('.selection-send', 0.8);
  await page.waitForSelector('.send-selection-sheet', { timeout: 5000 });
  const excerpt = await page.$eval('.send-selection-sheet textarea[rows="7"]', (el) => el.value);
  if (excerpt !== 'The unit cell has a degree-4 vertex, and thus it is a single degree of freedom system.') {
    throw new Error(`The selected excerpt is not one complete sentence: ${excerpt}`);
  }
  await chooseBoard();
  await clickSelector('.send-selection-sheet textarea[placeholder="Why are you saving this?"]', 0.55);
  await page.type('.send-selection-sheet textarea[placeholder="Why are you saving this?"]', 'Worth discussing together.', { delay: 35 });
  await hold(0.2);
  await clickSelector('.send-selection-sheet button.primary', 0.8);
  await page.waitForFunction(() => document.querySelector('.send-selection-sheet h3')?.textContent.includes('Sent to staging'));
  await hold(0.2);
  await clickSelector('.send-selection-sheet button.primary', 0.55);
  await padTo(13.0);

  // 13–18.5s: choose the clipping feature and crop only the figure graphics.
  await clickSelector('button[aria-label="Clipper"]', 0.95);
  const maxLeft = await page.$eval('.pages', (el) => el.scrollWidth - el.clientWidth);
  await page.$eval('.pages', (el, left) => el.scrollTo({ left }), maxLeft);
  await sleep(180);
  const figure = await page.$eval('.pdf-page[data-page="3"]', (el) => {
    const rect = el.getBoundingClientRect();
    return {
      from: { x: rect.left + rect.width * 0.515, y: Math.max(62, rect.top + rect.height * 0.05) },
      to: { x: rect.left + rect.width * 0.945, y: Math.min(704, rect.top + rect.height * 0.315) },
    };
  });
  const clipsBefore = await page.$$eval('.paper-clip', (all) => all.length);
  await drag(figure.from, figure.to, 1.2);
  await page.waitForFunction((count) => document.querySelectorAll('.paper-clip').length > count, {}, clipsBefore);
  await page.$$eval('.paper-clip', (all) => all[all.length - 1].click());
  await page.waitForSelector('.paper-clip.selected .clip-send', { timeout: 5000 });
  await padTo(18.5);

  // 18.5–25.2s: send the clean figure crop to the same board.
  await clickSelector('.paper-clip.selected .clip-send', 0.9);
  await page.waitForSelector('.send-selection-sheet', { timeout: 5000 });
  await chooseBoard();
  await clickSelector('.send-selection-sheet button.primary', 0.85);
  await page.waitForFunction(() => document.querySelector('.send-selection-sheet h3')?.textContent.includes('Sent to staging'));
  await hold(0.5);
  await clickSelector('.send-selection-sheet button.primary', 0.65);
  await padTo(25.2);

  // 25.2–31.4s: open the board and drag both staged items onto its canvas.
  await padTo(25.2);
  await page.goto(`${ORIGIN}/boards/${board.guid}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('.board-staging-card').length === 2);
  await installPointer();
  await setPointer(610, 630);
  const dragStaged = async (selector, destination, remaining) => {
    const origin = await center(selector);
    await drag(origin, destination, 0.9);
    await page.waitForFunction((count) => document.querySelectorAll('.board-staging-card').length === count, {}, remaining);
  };
  await dragStaged('.board-staging-card:has(.board-staging-kind.excerpt)', { x: 380, y: 300 }, 1);
  await dragStaged('.board-staging-card:has(.board-staging-kind.image)', { x: 760, y: 300 }, 0);
  await padTo(31.4);

  // 31.4–40s: follow the placed excerpt's backlink and show its provenance highlight.
  const excerptLink = '.board-canvas-card.excerpt .board-excerpt-source';
  const popupPromise = new Promise((resolve) => page.once('popup', resolve));
  await clickSelector(excerptLink, 1.0);
  const sourcePage = await popupPromise;
  await sourcePage.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  page = sourcePage;
  await page.waitForSelector('.provenance-highlight', { timeout: 30000 });
  await installPointer();
  await setPointer(1070, 650);
  await hold(0.8);
  await moveTo(1080, 650, 0.8);
  await padTo(40.0);

  console.log(JSON.stringify({ frames: frame, seconds: frame / FPS, board: board.guid, clip: createdClipId }));
} finally {
  if (browser) await browser.close();
  if (createdClipId != null) {
    try { await api(`/clips/${createdClipId}`, { method: 'DELETE' }); } catch { /* report through database verification */ }
  }
  await api(`/boards/${board.guid}`, { method: 'DELETE' });
}
