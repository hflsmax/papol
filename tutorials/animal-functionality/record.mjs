import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const FPS = 15;
const WIDTH = 1280;
const HEIGHT = 720;
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const FRAMES = path.join(ROOT, 'frames');
const VIEWER_URL = 'http://127.0.0.1:8000/viewer/?pdf=2d9bd40224ea9ee99616426943e04062d64caeb4bd8d645c99f834f5c54f0205';
const token = process.env.PAPOL_TOKEN || execFileSync(
  'sqlite3',
  ['backend/papol.db', 'SELECT token FROM auth_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1;'],
  { encoding: 'utf8' },
).trim();
const chromiumPath = process.env.CHROMIUM_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();

fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chromiumPath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
let frame = 0;
let pointer = { x: 800, y: 70 };

await page.evaluateOnNewDocument((value) => {
  localStorage.setItem('papol_token', value);
  localStorage.setItem('papol_viewer_tool', 'arrow');
  localStorage.setItem('papol_viewer_animal', 'cow');
  localStorage.setItem('papol_viewer_animal_speed', '1');
  localStorage.setItem('papol_viewer_animal_activity', '1');
  localStorage.setItem('papol_viewer_animal_follow', 'true');
}, token);
await page.goto(VIEWER_URL, { waitUntil: 'networkidle0' });
await page.waitForSelector('.pdf-page[data-page="4"]', { timeout: 30000 });
await page.evaluate(() => document.querySelector('.pdf-page[data-page="4"]').scrollIntoView({ block: 'start' }));
await page.waitForSelector('.pdf-page[data-page="4"] canvas', { timeout: 30000 });

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
  const target = Math.round(seconds * FPS);
  while (frame < target) await save();
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
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const clickAt = async (x, y, seconds = 1) => {
  await moveTo(x, y, Math.max(0.3, seconds * 1.15));
  await page.evaluate(({ x: px, y: py }) => {
    const ring = document.querySelector('#tutorial-click');
    ring.style.left = `${px}px`;
    ring.style.top = `${py}px`;
    ring.classList.add('on');
  }, { x, y });
  await hold(0.12);
  await page.evaluate(() => document.querySelector('#tutorial-click').classList.remove('on'));
  await page.mouse.click(x, y);
  await sleep(80);
  await hold(0.1);
};
const clickSelector = async (selector, seconds = 1) => {
  const point = await center(selector);
  console.log(JSON.stringify({ action: 'click', selector, second: frame / FPS, point }));
  await clickAt(point.x, point.y, seconds);
};
const drag = async (from, to, seconds) => {
  await moveTo(from.x, from.y, 1.0);
  await page.mouse.down();
  const count = Math.max(1, Math.round(seconds * FPS));
  for (let i = 1; i <= count; i += 1) {
    const t = ease(i / count);
    await setPointer(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await save();
  }
  await page.mouse.up();
  await hold(0.12);
};
const rangePoint = async (selector, fraction) => page.$eval(selector, (el, f) => {
  const r = el.getBoundingClientRect();
  return { from: { x: r.left + r.width * 0.5, y: r.top + r.height / 2 }, to: { x: r.left + r.width * f, y: r.top + r.height / 2 } };
}, fraction);

// Keep the paper centered and remove the unrelated anchors rail.
const railPressed = await page.$eval('.rail-handle', (el) => el.getAttribute('aria-pressed') === 'true');
if (railPressed) await page.$eval('.rail-handle', (el) => el.click());
await sleep(350);
await page.evaluate(() => document.querySelector('.pdf-page[data-page="4"]').scrollIntoView({ block: 'start' }));
await sleep(500);
const pagePoint = await page.$eval('.pdf-page[data-page="4"]', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width * 0.48, y: r.top + r.height * 0.47 };
});
await setPointer(pagePoint.x, pagePoint.y);

// 0–7s: establish the centered paper and the idea of temporary company.
await padTo(7.0);

// 7–13.3s: select Animal, then open its menagerie with the second click.
await clickSelector('button[aria-label="Animal"]', 1.2);
await hold(0.45);
await clickSelector('button[aria-label="Animal"]', 1.0);
await page.waitForSelector('.brush-pop[aria-label="The menagerie"]');
await padTo(12.0);

// 13.3–19s: choose a cat and place it on the paper.
await clickSelector('.brush-pop button[aria-label="Cat"]', 1.0);
await hold(0.25);
await clickAt(pagePoint.x, pagePoint.y, 1.2);
await page.waitForSelector('.pdf-page[data-page="4"] .cow');
await padTo(19.0);

// 19–24.5s: open the controls and visibly raise speed and activity.
await clickSelector('button[aria-label="Animal"]', 1.0);
await page.waitForSelector('.brush-pop[aria-label="The menagerie"]');
const speed = await rangePoint('#animal-speed', 0.82);
await drag(speed.from, speed.to, 0.9);
const activity = await rangePoint('#animal-activity', 0.78);
await drag(activity.from, activity.to, 0.9);
await padTo(24.5);

// 24.5–30.5s: return to Read and move the animal by dragging it.
await clickSelector('button[aria-label="Read"]', 1.1);
await page.waitForSelector('.pdf-page[data-page="4"] .cow-grab');
const animalBox = await page.$eval('.pdf-page[data-page="4"] .cow-grab', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await drag(animalBox, { x: animalBox.x + 145, y: animalBox.y - 55 }, 1.4);
await padTo(30.5);

// 30.5–37.65s: reopen the menagerie and add ten mixed animals.
await clickSelector('button[aria-label="Animal"]', 0.95);
await hold(0.25);
await clickSelector('button[aria-label="Animal"]', 0.95);
await page.waitForSelector('.brush-pop[aria-label="The menagerie"]');
await clickSelector('.brush-pop button[aria-label="Magic wand"]', 1.1);
await page.waitForFunction(() => document.querySelectorAll('.cow').length >= 10);
await page.keyboard.press('Escape');
await hold(0.2);
await moveTo(190, 610, 1.0);
await padTo(37.65);

// Let the mixed group move while the sign-off finishes.
await moveTo(110, 640, 0.8);
await padTo(40);

await browser.close();
console.log(JSON.stringify({ frames: frame, seconds: frame / FPS }));
