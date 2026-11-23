import { writeFile } from 'node:fs/promises';
import { Browser, checker } from '../../scripts/share-e2e/cdp.mjs';
import { PAPER, viewerServer } from './fixtures/projectViewer.mjs';

// A double-click with the arrow on bare paper drops an anchor there, the
// same one the anchor tool drops; a double-click on words still selects a
// word and drops nothing. Driven with real mouse events, so what is
// checked is what the browser hands the page: its own word selection, its
// own dblclick.
//
//   node scripts/anchor-dblclick-smoke.mjs
//   PAPOL_SHOTS=dir node scripts/anchor-dblclick-smoke.mjs   (keeps screenshots)
const shots = process.env.PAPOL_SHOTS;
const server = await viewerServer();
const browser = new Browser();
const checks = checker(browser);
const { check } = checks;

const mouse = async (x, y, clickCount, pointerType = 'mouse') => {
  for (let n = 1; n <= clickCount; n += 1) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n, pointerType });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n, pointerType });
  }
};
// A screenshot, with a ring where the pointer was double-clicked.
const shoot = async (name, ring = null) => {
  if (!shots) return;
  if (ring) {
    await browser.evaluate(`const r = document.createElement('i'); r.id = 'smoke-ring';
      r.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;width:28px;height:28px;border:2px dashed #d33;border-radius:50%;left:${ring.x - 16}px;top:${ring.y - 16}px';
      document.body.append(r); return true;`);
  }
  const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
  await browser.evaluate("document.getElementById('smoke-ring')?.remove(); return true;");
  await writeFile(`${shots}/${name}.png`, Buffer.from(data, 'base64'));
};
const pins = () => browser.evaluate("return document.querySelectorAll('.pdf-page[data-page=\"1\"] .pin').length;");

try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, mobile: false, width: 1280, height: 860 });
  await browser.navigate(`${origin}/viewer/?pdf=${PAPER}`);
  await browser.waitFor(`document.querySelector('.pdf-page[data-page="1"] canvas') && document.querySelector('.pdf-page[data-page="1"] .textLayer span')`,
    { timeout: 60_000, what: 'page 1 and its text' });
  await new Promise((r) => setTimeout(r, 800));
  const before = await pins();

  // A word on the page, and a bare spot between two blocks of text: below
  // the last author and above the Abstract heading, to the left of both.
  await browser.evaluate(`document.querySelector('.pdf-page[data-page="1"]').scrollIntoView({ block: 'start' }); return true;`);
  await new Promise((r) => setTimeout(r, 400));
  const at = await browser.evaluate(`
    const page = document.querySelector('.pdf-page[data-page="1"]');
    const box = page.getBoundingClientRect();
    const spans = [...page.querySelectorAll('.textLayer span')];
    const find = (text) => spans.find((s) => s.textContent.includes(text)).getBoundingClientRect();
    const word = find('dominant');
    const next = find('convolutional');
    const above = find('illia');
    const below = find('Abstract');
    return { word: { x: word.left + word.width * 0.15, y: word.top + word.height / 2 },
             gap: { x: word.left + 80, y: (word.bottom + next.top) / 2 },
             bare: { x: box.left + box.width * 0.3, y: (above.bottom + below.top) / 2 } };`);
  await shoot('before-double-click');
  await mouse(at.word.x, at.word.y, 2);
  await new Promise((r) => setTimeout(r, 300));
  // The viewer takes the browser's word into its own highlight, with the
  // actions beside it: that is what a reader sees as a selected word.
  const word = await browser.evaluate("return !!document.querySelector('.selection-actions');");
  check('a double-click on a word selects it', word);
  check('and drops no anchor', (await pins()) === before);
  await shoot('double-click-word', at.word);

  // Between two lines of a paragraph is a reader a pixel off a word.
  await mouse(at.gap.x, at.gap.y, 2);
  await new Promise((r) => setTimeout(r, 300));
  check('a double-click between two lines drops no anchor', (await pins()) === before);

  // What the browser had selected as the double-click arrived: nothing. A
  // second press on bare paper is kept from the browser, which would
  // otherwise select a line break (Chrome) or the whole page (WebKit).
  await browser.evaluate(`window.__selected = null; document.addEventListener('dblclick', () => { window.__selected = String(getSelection()); }, { capture: true, once: true }); return true;`);
  await mouse(at.bare.x, at.bare.y, 1);
  await mouse(at.bare.x, at.bare.y, 2);
  const selected = await browser.evaluate('return window.__selected;');
  check('a double-click on bare paper selects nothing', selected === '', JSON.stringify(selected));
  await browser.waitFor(`document.querySelectorAll('.pdf-page[data-page="1"] .pin').length > ${before}`, { timeout: 4000, what: 'an anchor' }).catch(() => {});
  const placed = await browser.evaluate(`
    const pins = [...document.querySelectorAll('.pdf-page[data-page="1"] .pin')];
    const pin = pins[pins.length - 1]?.getBoundingClientRect();
    return { count: pins.length, pin: pin && { x: pin.left + pin.width / 2, bottom: pin.bottom } };`);
  check('a double-click on bare paper drops an anchor', placed.count === before + 1, JSON.stringify(placed));
  check('where it was double-clicked', placed.pin && Math.abs(placed.pin.x - at.bare.x) < 30, JSON.stringify({ placed, at: at.bare }));
  await new Promise((r) => setTimeout(r, 1200));
  await shoot('double-click-bare', at.bare);

  // Twice on the new pin: it is a control, not paper.
  if (placed.pin) {
    await mouse(placed.pin.x, placed.pin.bottom - 8, 2);
    await new Promise((r) => setTimeout(r, 300));
    check('a double-click on an anchor drops no second one', (await pins()) === before + 1);
  }
  await checks.settle();
} finally {
  await browser.stop();
  await server.close();
}
if (checks.failures) process.exit(1);
