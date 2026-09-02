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
const VIEWER_URL = 'http://127.0.0.1:8000/viewer/?pdf=f389e052386e9dbd19e78db426f84f4935045471e7613957fb69dade09cfab21';
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
let createdClipId = null;
let createdBoardItemId = null;

page.on('response', async (response) => {
  const request = response.request();
  if (request.method() !== 'POST' || !response.ok()) return;
  try {
    if (/\/api\/editions\/\d+\/clips$/.test(response.url())) {
      createdClipId = (await response.json()).id;
    } else if (/\/api\/boards\/[^/]+\/staging\/clip$/.test(response.url())) {
      createdBoardItemId = (await response.json()).id;
    }
  } catch {
    // The response is only used to clean up recording-only data.
  }
});

await page.evaluateOnNewDocument((value) => localStorage.setItem('papol_token', value), token);
await page.goto(VIEWER_URL, { waitUntil: 'networkidle0' });
await page.waitForSelector('.pdf-page[data-page="3"] canvas', { timeout: 30000 });

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
const clickAt = async (x, y, seconds = 0.55) => {
  // Spend most of each click beat visibly approaching the control. Keep the
  // pauses compact so slower pointer travel does not throw off narration.
  await moveTo(x, y, Math.max(0.25, seconds * 1.15));
  await page.evaluate(({ x: px, y: py }) => {
    const ring = document.querySelector('#tutorial-click');
    ring.style.left = `${px}px`;
    ring.style.top = `${py}px`;
    ring.classList.add('on');
  }, { x, y });
  // Show the click cue on the actual target before a dialog or layout change
  // can move that coordinate underneath the pointer.
  await hold(0.12);
  await page.evaluate(() => document.querySelector('#tutorial-click').classList.remove('on'));
  await page.mouse.click(x, y);
  await sleep(80);
  await hold(Math.max(0.08, seconds * 0.1));
};
const center = async (selector) => page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const clickSelector = async (selector, seconds = 0.7) => {
  const point = await center(selector);
  console.log(JSON.stringify({ action: 'click', selector, second: frame / FPS, point }));
  await clickAt(point.x, point.y, seconds);
};
const animateScroll = async ({ left, top }, seconds) => {
  const start = await page.$eval('.pages', (el) => ({ left: el.scrollLeft, top: el.scrollTop }));
  const count = Math.max(1, Math.round(seconds * FPS));
  for (let i = 1; i <= count; i += 1) {
    const t = ease(i / count);
    await page.$eval('.pages', (el, value) => el.scrollTo(value), {
      left: start.left + ((left ?? start.left) - start.left) * t,
      top: start.top + ((top ?? start.top) - start.top) * t,
    });
    await save();
  }
};
const animateZoom = async (deltaY, steps = 8) => {
  await page.keyboard.down('Control');
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel({ deltaY: deltaY / steps });
    await sleep(60);
    await save();
  }
  await page.keyboard.up('Control');
};
const animateZoomToWidth = async (targetWidth, maxSteps = 20) => {
  for (let i = 0; i < maxSteps; i += 1) {
    const width = await page.$eval('.pdf-page[data-page="3"]', (el) => el.getBoundingClientRect().width);
    if (Math.abs(width - targetWidth) / targetWidth < 0.035) return;
    await page.keyboard.down('Control');
    await page.mouse.wheel({ deltaY: width < targetWidth ? -12 : 12 });
    await page.keyboard.up('Control');
    await sleep(60);
    await save();
  }
  throw new Error('Could not restore the recorded reading zoom');
};
const drag = async (from, to, seconds, settleMs = 0, showCue = false) => {
  await moveTo(from.x, from.y, 1.0);
  if (showCue) {
    await page.evaluate(({ x, y }) => {
      const ring = document.querySelector('#tutorial-click');
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      ring.classList.add('on');
    }, from);
    await hold(0.18);
    await page.evaluate(() => document.querySelector('#tutorial-click').classList.remove('on'));
  }
  await page.mouse.down();
  const count = Math.max(1, Math.round(seconds * FPS));
  for (let i = 1; i <= count; i += 1) {
    const t = ease(i / count);
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    await setPointer(x, y);
    if (settleMs) await sleep(settleMs);
    await save();
  }
  await page.mouse.up();
};

// Collapse the anchors rail, then begin with page 3 fitted so the spatial
// relationship between the reading column and Figure 2 is unmistakable.
await page.$eval('.rail-handle', (el) => el.click());
await sleep(500);
await page.evaluate(() => document.querySelector('.pdf-page[data-page="3"]').scrollIntoView({ block: 'start' }));
await sleep(700);
const overview = await page.$eval('.pdf-page[data-page="3"]', (el) => {
  const r = el.getBoundingClientRect();
  return {
    text: { x: r.left + r.width * 0.29, y: r.top + r.height * 0.58 },
  };
});
await setPointer(overview.text.x, overview.text.y);

// 0–2.8s: keep the pointer still on the reading column so the page layout is clear.
await padTo(2.8);

// 2.8–9.4s: zoom once, center the lower-left column precisely, then choose Clipper.
await animateZoom(-220, 18);
await sleep(250);
const readingPageWidth = await page.$eval('.pdf-page[data-page="3"]', (el) => el.getBoundingClientRect().width);
const readingPosition = await page.$eval('.pdf-page[data-page="3"]', (page3) => {
  const scroller = document.querySelector('.pages');
  const pageRect = page3.getBoundingClientRect();
  const scrollRect = scroller.getBoundingClientRect();
  return {
    left: scroller.scrollLeft + pageRect.left + pageRect.width * 0.29
      - scrollRect.left - scroller.clientWidth / 2,
    top: scroller.scrollTop + pageRect.top + pageRect.height * 0.58
      - scrollRect.top - scroller.clientHeight / 2,
  };
});
await animateScroll(readingPosition, 0.8);
await padTo(7.1);
await clickSelector('button[aria-label="Clipper"]', 1.2);
// Ease back enough for the full crop and its controls to fit, staying far from Feedback.
await moveTo(640, 360, 0.9);
await animateZoom(24, 2);
const maxLeft = await page.$eval('.pages', (el) => el.scrollWidth - el.clientWidth);
const figureTop = await page.$eval('.pages', (scroller) => {
  const page3 = document.querySelector('.pdf-page[data-page="3"]');
  return scroller.scrollTop + page3.getBoundingClientRect().top - 54;
});
await animateScroll({ left: maxLeft, top: figureTop }, 1.3);

// 9.4–14.8s: drag around the graphics only—not the caption.
const figure = await page.$eval('.pdf-page[data-page="3"]', (el) => {
  const r = el.getBoundingClientRect();
  return {
    from: { x: r.left + r.width * 0.515, y: Math.max(62, r.top + r.height * 0.050) },
    to: { x: r.left + r.width * 0.945, y: Math.min(704, r.top + r.height * 0.315) },
  };
});
const clipsBefore = await page.$$eval('.paper-clip', (all) => all.length);
await drag(figure.from, figure.to, 1.3);
await page.waitForFunction((count) => document.querySelectorAll('.paper-clip').length > count, { timeout: 10000 }, clipsBefore);
await padTo(14.8);
await page.$$eval('.paper-clip', (all) => all[all.length - 1].click());
await page.waitForSelector('.paper-clip.selected .clip-resize', { timeout: 5000 });

// 14.8–20.8s: return to the lower-left text and place the copy on its right.
await page.$$eval('.paper-clip', (all) => all[all.length - 1].click());
await page.waitForSelector('.paper-clip.selected .clip-resize', { timeout: 5000 });
const resizeFrom = await center('.paper-clip.selected .clip-resize');
await drag(resizeFrom, { x: resizeFrom.x - 80, y: resizeFrom.y - 60 }, 1.1, 45, true);
const destination = await page.$eval('.pdf-page[data-page="3"]', (page3) => {
  const r = page3.getBoundingClientRect();
  return {
    clip: { x: r.left + r.width * 0.69, y: r.top + r.height * 0.56 },
    text: { x: r.left + r.width * 0.29, y: r.top + r.height * 0.58 },
  };
});
const clipRect = await page.$$eval('.paper-clip', (all) => {
  const el = all[all.length - 1];
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
});
const visibleGrab = {
  x: clipRect.x + clipRect.width * 0.5,
  y: clipRect.y + clipRect.height * 0.35,
};
await drag(visibleGrab, destination.clip, 1.0);
await moveTo(destination.text.x, destination.text.y, 0.7);
await animateZoomToWidth(readingPageWidth);
const lowerLeftPosition = await page.$eval('.pdf-page[data-page="3"]', (page3) => {
  const scroller = document.querySelector('.pages');
  const pageRect = page3.getBoundingClientRect();
  const scrollRect = scroller.getBoundingClientRect();
  return {
    left: scroller.scrollLeft + pageRect.left + pageRect.width * 0.29
      - scrollRect.left - scroller.clientWidth / 2,
    top: scroller.scrollTop + pageRect.top + pageRect.height * 0.58
      - scrollRect.top - scroller.clientHeight / 2,
  };
});
await animateScroll(lowerLeftPosition, 0.6);
await hold(0.25);
await padTo(21.15);

// 20.8–25.7s: leave both board states onscreen long enough to read.
await page.$$eval('.paper-clip', (all) => all[all.length - 1].click());
await page.waitForSelector('.paper-clip.selected .clip-send', { timeout: 5000 });
await clickSelector('.clip-send', 0.8);
await page.waitForSelector('.send-selection-sheet', { timeout: 10000 });
await hold(1.1);
await page.select('.send-selection-sheet select', await page.$eval('.send-selection-sheet select', (el) => el.options[0]?.value || el.value));
await hold(0.35);
await clickSelector('.send-selection-sheet button.primary', 0.8);
await page.waitForFunction(() => document.querySelector('.send-selection-sheet h3')?.textContent.includes('Sent to staging'), { timeout: 15000 });
await hold(0.5);
await clickSelector('.send-selection-sheet button.primary', 0.6);
await padTo(25.7);

// 25.7–31s: show the pinned clip moving with the paper during its narration.
const pinnedTop = await page.$eval('.pages', (el) => el.scrollTop);
await moveTo(920, 270, 0.6);
await animateScroll({ top: pinnedTop + 75 }, 1.4);
await hold(0.25);
await animateScroll({ top: pinnedTop }, 1.2);
await padTo(31.0);

// 31–40s: switch to Free float as it is named, then scroll behind the clip.
await page.$$eval('.paper-clip', (all) => all[all.length - 1].click());
await page.waitForSelector('.clip-float[title="Free float"]', { timeout: 5000 });
await clickSelector('.clip-float[title="Free float"]', 0.9);
await moveTo(170, 560, 1.6);
await hold(0.3);
const floatTop = await page.$eval('.pages', (el) => el.scrollTop);
await animateScroll({ top: floatTop + 150 }, 3.7);
await padTo(40);

// Clean up only the recording-created objects, leaving existing data untouched.
await page.evaluate(async ({ clipId, boardItemId }) => {
  const auth = localStorage.getItem('papol_token');
  const headers = { Authorization: `Bearer ${auth}` };
  if (boardItemId) await fetch(`../api/board-items/${boardItemId}`, { method: 'DELETE', headers });
  if (clipId) await fetch(`../api/clips/${clipId}`, { method: 'DELETE', headers });
}, { clipId: createdClipId, boardItemId: createdBoardItemId });

await browser.close();
console.log(JSON.stringify({ frames: frame, seconds: frame / FPS, createdClipId, createdBoardItemId }));
