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
      document.body.append(r);
      ${ring.label ? `const t = document.createElement('b'); t.id = 'smoke-label'; t.textContent = ${JSON.stringify(ring.label ?? '')};
        t.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font:600 13px system-ui;color:#fff;background:#d33;padding:2px 6px;border-radius:4px;left:${ring.x + 18}px;top:${ring.y + 12}px';
        document.body.append(t);` : ''}
      return true;`);
  }
  const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
  await browser.evaluate("document.getElementById('smoke-ring')?.remove(); document.getElementById('smoke-label')?.remove(); return true;");
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

  await mouse(at.bare.x, at.bare.y, 1);
  await mouse(at.bare.x, at.bare.y, 2);
  // Whatever the browser selected on the way (the whole page, in WebKit)
  // is put away, highlight and actions with it.
  await new Promise((r) => setTimeout(r, 300));
  const left = await browser.evaluate("return { text: String(getSelection()), actions: !!document.querySelector('.selection-actions') };");
  check('a double-click on bare paper leaves nothing selected', !left.text.trim() && !left.actions, JSON.stringify(left));
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

  // A citation over words shows the hand, as a link does; the words
  // beside it keep their I-beam.
  const cite = await browser.evaluate(`
    const cite = [...document.querySelectorAll('.pdf-page .cite')].find((c) => c.getBoundingClientRect().width > 4);
    if (!cite) return null;
    cite.scrollIntoView({ block: 'center' });
    return true;`);
  if (cite) {
    await new Promise((r) => setTimeout(r, 600));
    const spot = await browser.evaluate(`
      const box = [...document.querySelectorAll('.pdf-page .cite')].find((c) => c.getBoundingClientRect().width > 4).getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, left: box.left - 40 };`);
    const cursorAt = async (x, y) => {
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 2, y });
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await new Promise((r) => setTimeout(r, 200));
      return browser.evaluate(`const el = document.elementFromPoint(${x}, ${y}); return el ? getComputedStyle(el).cursor : null;`);
    };
    const onCite = await cursorAt(spot.x, spot.y);
    await shoot('cursor-on-citation', { x: spot.x, y: spot.y, label: `cursor: ${onCite}` });
    check('the pointer over a citation is a hand', onCite === 'pointer', onCite);
    const beside = await cursorAt(spot.left, spot.y);
    check('the pointer over words beside it is an I-beam', beside === 'text', beside);
  } else {
    check('the fixture has a citation to point at', false);
  }
  // WebKit (Safari, the Mac app) selects the whole text layer on the second
  // press over bare ground, and the viewer takes that into its highlight as
  // the press lifts. Played here by selecting the layer as the second press
  // lifts: the anchor still drops, and the page is left with nothing
  // selected.
  {
    await browser.evaluate(`document.querySelector('.pdf-page[data-page="1"]').scrollIntoView({ block: 'start' }); return true;`);
    await new Promise((r) => setTimeout(r, 500));
    const spot = await browser.evaluate(`
      const page = document.querySelector('.pdf-page[data-page="1"]');
      const box = page.getBoundingClientRect();
      const spans = [...page.querySelectorAll('.textLayer span')];
      const find = (text) => spans.find((s) => s.textContent.includes(text)).getBoundingClientRect();
      return { x: box.left + box.width * 0.7, y: (find('illia').bottom + find('Abstract').top) / 2 };`);
    await browser.evaluate(`
      window.addEventListener('mouseup', (e) => {
        if (e.detail < 2) return;
        getSelection().selectAllChildren(document.querySelector('.pdf-page[data-page="1"] .textLayer'));
      }, { capture: true, once: false });
      return true;`);
    const count = await pins();
    await mouse(spot.x, spot.y, 1);
    await mouse(spot.x, spot.y, 2);
    await new Promise((r) => setTimeout(r, 400));
    const left = await browser.evaluate("return { text: String(getSelection()).length, actions: !!document.querySelector('.selection-actions') };");
    check('with the whole page selected on the way (WebKit), the anchor still drops', (await pins()) === count + 1);
    check('and the page is left with nothing selected', !left.text && !left.actions, JSON.stringify(left));
  }

  await checks.settle();
} finally {
  await browser.stop();
  await server.close();
}
if (checks.failures) process.exit(1);
