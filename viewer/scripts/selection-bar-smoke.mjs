import { writeFile } from 'node:fs/promises';
import { Browser, checker } from '../../scripts/share-e2e/cdp.mjs';
import { PAPER, viewerServer } from './fixtures/projectViewer.mjs';

// The selected-text bar keeps out of the way while words are being
// selected, and stands at the selection the moment the pointer lets go.
// Driven with real mouse events: a press on one word, a drag along the line
// and down to the next, and a release.
//
//   node scripts/selection-bar-smoke.mjs
//   PAPOL_SHOTS=dir node scripts/selection-bar-smoke.mjs   (keeps screenshots)
const shots = process.env.PAPOL_SHOTS;
const server = await viewerServer();
const browser = new Browser();
const checks = checker(browser);
const { check } = checks;

const mouse = (type, { x, y }, buttons = 1) => browser.send('Input.dispatchMouseEvent', {
  type, x, y, button: buttons || type !== 'mouseMoved' ? 'left' : 'none', buttons, clickCount: 1, pointerType: 'mouse',
});
// A screenshot, with a ring where the pointer is and what it is doing.
const shoot = async (name, at, label) => {
  if (!shots) return;
  await browser.evaluate(`const r = document.createElement('i'); r.id = 'smoke-ring';
    r.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;width:28px;height:28px;border:2px dashed #d33;border-radius:50%;left:${at.x - 16}px;top:${at.y - 16}px';
    const t = document.createElement('b'); t.id = 'smoke-label'; t.textContent = ${JSON.stringify(label)};
    t.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font:600 13px system-ui;color:#fff;background:#d33;padding:2px 6px;border-radius:4px;left:${at.x + 18}px;top:${at.y + 12}px';
    document.body.append(r, t);
    return true;`);
  const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
  await browser.evaluate("document.getElementById('smoke-ring')?.remove(); document.getElementById('smoke-label')?.remove(); return true;");
  await writeFile(`${shots}/${name}.png`, Buffer.from(data, 'base64'));
};
// What a reader sees of the bar, and of the selection it belongs to.
const seen = () => browser.evaluate(`
  const bar = document.querySelector('.selection-actions');
  const box = bar?.querySelector('button')?.getBoundingClientRect();
  return {
    bar: !!bar && getComputedStyle(bar).visibility === 'visible' && !!box && box.width > 0,
    pressable: !!bar && getComputedStyle(bar).pointerEvents !== 'none',
    selected: !getSelection().isCollapsed,
  };`);

try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, mobile: false, width: 1280, height: 860 });
  await browser.navigate(`${origin}/viewer/?pdf=${PAPER}`);
  await browser.waitFor(`document.querySelector('.pdf-page[data-page="1"] canvas') && document.querySelector('.pdf-page[data-page="1"] .textLayer span')`,
    { timeout: 60_000, what: 'page 1 and its text' });
  await new Promise((r) => setTimeout(r, 800));
  await browser.evaluate(`document.querySelector('.pdf-page[data-page="1"]').scrollIntoView({ block: 'start' }); return true;`);
  await new Promise((r) => setTimeout(r, 400));

  // From a word in the abstract, along its line, and down to the next line.
  const at = await browser.evaluate(`
    const spans = [...document.querySelectorAll('.pdf-page[data-page="1"] .textLayer span')];
    const find = (text) => spans.find((s) => s.textContent.includes(text)).getBoundingClientRect();
    const from = find('dominant');
    const to = find('convolutional');
    const start = { x: from.left + from.width * 0.15, y: from.top + from.height / 2 };
    return { start,
             along: { x: start.x + 180, y: start.y },
             end: { x: to.left + to.width * 0.6, y: to.top + to.height / 2 } };`);

  await mouse('mouseMoved', at.start, 0);
  await mouse('mousePressed', at.start);
  for (let step = 1; step <= 6; step += 1) {
    await mouse('mouseMoved', { x: at.start.x + (at.along.x - at.start.x) * (step / 6), y: at.start.y });
  }
  await new Promise((r) => setTimeout(r, 250));
  let now = await seen();
  check('words are selected while the pointer drags', now.selected, JSON.stringify(now));
  check('and the bar is not shown yet', !now.bar, JSON.stringify(now));
  for (let step = 1; step <= 6; step += 1) {
    await mouse('mouseMoved', {
      x: at.along.x + (at.end.x - at.along.x) * (step / 6),
      y: at.along.y + (at.end.y - at.along.y) * (step / 6),
    });
  }
  await new Promise((r) => setTimeout(r, 250));
  now = await seen();
  check('nor further into the drag', !now.bar, JSON.stringify(now));
  await shoot('selecting', at.end, 'still dragging');

  // No wait between the release and the look: the bar is there at once.
  await mouse('mouseReleased', at.end, 0);
  now = await seen();
  check('the bar shows the moment the pointer lets go', now.bar && now.pressable, JSON.stringify(now));
  await new Promise((r) => setTimeout(r, 300));
  await shoot('selected', at.end, 'released');

  // A second selection starts with the bar put away again.
  await mouse('mousePressed', at.start);
  for (let step = 1; step <= 6; step += 1) {
    await mouse('mouseMoved', { x: at.start.x + (at.along.x - at.start.x) * (step / 6), y: at.start.y });
  }
  await new Promise((r) => setTimeout(r, 250));
  now = await seen();
  check('a new drag puts the bar away until it ends', !now.bar, JSON.stringify(now));
  await mouse('mouseReleased', at.along, 0);
  now = await seen();
  check('and brings it back on release', now.bar, JSON.stringify(now));

  await checks.settle();
} finally {
  await browser.stop();
  await server.close();
}
if (checks.failures) process.exit(1);
