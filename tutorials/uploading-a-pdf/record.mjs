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
const PAPER_ID = 1;
const PDF = path.resolve('uploads/7e48c9fd-9707-4880-9e87-7557ab3b599c.pdf');
const token = process.env.PAPOL_TOKEN || execFileSync(
  'sqlite3',
  ['backend/papol.db', 'SELECT token FROM auth_tokens WHERE revoked_at IS NULL AND user_id = 5 ORDER BY created_at DESC LIMIT 1;'],
  { encoding: 'utf8' },
).trim();
const chromiumPath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();

const api = async (route, options = {}) => {
  const response = await fetch(`${ORIGIN}/api${route}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${route}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
};

const before = await api(`/papers/${PAPER_ID}`);
if (before.viewer_has_entry) throw new Error(`Recording account already has paper ${PAPER_ID}; refusing to alter it`);
const tutorialTag = await api('/tags', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'tensor networks' }),
});

fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

let browser;
let saved = false;
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

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url() === `${ORIGIN}/api/papers/extract` && request.method() === 'POST') {
      request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          doi: '10.1145/3808272',
          title: 'CoTenN: Constrained Optimization with Tensor Networks',
          authors: '["Ritvik Sharma","Cheng Peng","Siddharth Dangwal","Sara Achour"]',
          journal: 'Proceedings of the ACM on Programming Languages',
          year: 2026,
          file_path: '7e48c9fd-9707-4880-9e87-7557ab3b599c.pdf',
        }),
      });
    } else request.continue();
  });

  await page.evaluateOnNewDocument((value) => localStorage.setItem('papol_token', value), token);
  await page.goto(ORIGIN, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.dropzone');

  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #tutorial-pointer { position: fixed; left: 0; top: 0; width: 27px; height: 35px; pointer-events: none; z-index: 2147483647; filter: drop-shadow(0 2px 2px rgba(0,0,0,.45)); transform: translate(-2px,-2px); }
      #tutorial-pointer svg { display: block; width: 100%; height: 100%; }
      #tutorial-click { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 3px solid #e25835; border-radius: 50%; opacity: 0; pointer-events: none; z-index: 2147483646; }
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
    await page.screenshot({ path: path.join(FRAMES, `${String(frame++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 88 });
  };
  const setPointer = async (x, y) => {
    pointer = { x, y };
    await page.mouse.move(x, y);
    await page.evaluate(({ x: px, y: py }) => {
      const cursor = document.querySelector('#tutorial-pointer');
      cursor.style.left = `${px}px`; cursor.style.top = `${py}px`;
    }, pointer);
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
  const center = async (selector) => page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const cue = async (x, y) => {
    await page.evaluate(({ x: px, y: py }) => {
      const ring = document.querySelector('#tutorial-click');
      ring.style.left = `${px}px`; ring.style.top = `${py}px`; ring.classList.add('on');
    }, { x, y });
    await hold(0.13);
    await page.evaluate(() => document.querySelector('#tutorial-click').classList.remove('on'));
  };
  const clickSelector = async (selector, seconds = 1) => {
    const point = await center(selector);
    await moveTo(point.x, point.y, seconds); await cue(point.x, point.y); await page.mouse.click(point.x, point.y); await sleep(100); await hold(0.1);
  };
  const scrollToSelector = async (selector, top = 90, seconds = 0.8) => {
    const start = await page.evaluate(() => window.scrollY);
    const end = await page.$eval(selector, (el, offset) => el.getBoundingClientRect().top + window.scrollY - offset, top);
    const count = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= count; i += 1) {
      const t = ease(i / count); await page.evaluate((y) => window.scrollTo(0, y), start + (end - start) * t); await save();
    }
  };

  await setPointer(640, 635);
  await padTo(5.2);

  const dropPoint = await center('.dropzone');
  await moveTo(dropPoint.x, dropPoint.y, 1.1);
  await cue(dropPoint.x, dropPoint.y);
  await page.$eval('input[type="file"]', (input) => input.click());
  const input = await page.$('input[type="file"]');
  await input.uploadFile(PDF);
  await page.waitForSelector('.upload-review-form');
  await padTo(10.0);

  await clickSelector('input[name="title"]', 0.8);
  await page.keyboard.press('End');
  await moveTo(1080, 105, 0.7);
  await padTo(15.0);

  await clickSelector('select[name="shelf_id"]', 0.9);
  await page.select('select[name="shelf_id"]', '10');
  await hold(1.0);
  await page.select('select[name="shelf_id"]', '9');
  await hold(1.1);
  await scrollToSelector('.upload-private-field:not(.upload-shelf-field)', 170, 0.8);
  await padTo(31.2);

  await clickSelector('.tag-input', 0.9);
  await page.type('.tag-input', 'fav', { delay: 80 });
  await clickSelector('.tag-dropdown button', 0.8);
  await clickSelector('.tag-input', 0.55);
  await page.type('.tag-input', 'ten', { delay: 65 });
  await clickSelector('.tag-dropdown button', 0.65);
  await scrollToSelector('.upload-private-summary', 105, 0.8);
  await padTo(35.1);

  await clickSelector('textarea[name="summary"]', 0.75);
  await page.type('textarea[name="summary"]', 'Compiles constrained optimization problems into tensor networks that quantum-inspired solvers can handle.', { delay: 14 });
  await scrollToSelector('.upload-public-thought', 210, 0.7);
  await clickSelector('input[name="thought"]', 0.7);
  await page.type('input[name="thought"]', 'A compelling bridge between constraint programming and tensor-network optimization.', { delay: 15 });
  await scrollToSelector('.rating-inputs', 175, 0.7);
  await clickSelector('.rating-buttons[aria-label="My expertise"] button:nth-child(4)', 0.35);
  await clickSelector('.rating-buttons[aria-label="Reading depth"] button:nth-child(4)', 0.35);
  await clickSelector('.rating-buttons[aria-label="Merit"] button:nth-child(4)', 0.35);
  await padTo(41.7);

  await clickSelector('button[type="submit"]', 0.8);
  await page.waitForFunction((title) => document.body.innerText.includes(title) && !document.querySelector('.upload-review-form'), {}, before.title);
  saved = true;
  const paperLink = '.paper-title-link[href*="3808272"]';
  await scrollToSelector(paperLink, 250, 0.3);
  await clickSelector(paperLink, 0.8);
  await page.waitForSelector('.paper-actions a.btn.primary');
  await clickSelector('.paper-actions a.btn.primary', 0.8);
  await page.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await padTo(48.5);
  const viewerScrollStart = await page.$eval('.pages', (el) => el.scrollTop);
  for (let i = 1; i <= Math.round(1.4 * FPS); i += 1) {
    const t = ease(i / Math.round(1.4 * FPS));
    await page.$eval('.pages', (el, y) => { el.scrollTop = y; }, viewerScrollStart + 280 * t);
    await save();
  }
  await padTo(52.0);

  console.log(JSON.stringify({ frames: frame, seconds: frame / FPS, paper: PAPER_ID }));
} finally {
  if (browser) await browser.close();
  const after = await api(`/papers/${PAPER_ID}`);
  if (saved || (!before.viewer_has_entry && after.viewer_has_entry)) {
    await api(`/papers/${PAPER_ID}`, { method: 'DELETE' });
  }
  await api(`/tags/${tutorialTag.id}`, { method: 'DELETE' });
}
