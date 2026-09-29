import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { PAPER, PROJECT, viewerServer } from './fixtures/projectViewer.mjs';

// Pictures of the viewer on the fixture paper, for a pull request or a
// letter: the paper alone with the reader's own digs in the margin, an
// anchor dropped there, and each thing picked out with its dig; then with
// the project on: another member's anchor, its dig, their ink picked out,
// and the switch.
//
//   node scripts/project-shots.mjs <out dir> [name ...]
const settled = "document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 700)))";
const wide = { width: 1440, height: 900 };
const painted = "document.querySelector('.pdf-page[data-page=\"1\"] canvas') && document.querySelector('[data-ink]')";
const on = `/viewer/?pdf=${PAPER}&project=${PROJECT}`;
const alone = `/viewer/?pdf=${PAPER}`;
// Pressing the anchor tool and then the page, at a fraction of page 1.
const drop = (x, y) => `document.querySelector('.pages').scrollTop = 0;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
      setTimeout(() => {
        const page = document.querySelector('.pdf-page[data-page="1"]');
        const box = page.getBoundingClientRect();
        const at = { clientX: box.left + box.width * ${x}, clientY: box.top + box.height * ${y}, bubbles: true, button: 0, pointerId: 1, isPrimary: true };
        const target = document.elementFromPoint(at.clientX, at.clientY);
        target.dispatchEvent(new PointerEvent('pointerdown', at));
        target.dispatchEvent(new PointerEvent('pointerup', at));
        target.dispatchEvent(new MouseEvent('click', at));
      }, 300);
      return true;`;
// A press on the page, as a hand makes it — pointer events on the
// element — once the thing is brought to the middle of the view.
const pick = (selector) => `
  const el = document.querySelector('${selector}');
  el.scrollIntoView({ block: 'center' });
  return new Promise((done) => setTimeout(() => {
    const box = el.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, button: 0, pointerId: 1, isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    el.dispatchEvent(new PointerEvent('pointerup', at));
    el.dispatchEvent(new MouseEvent('click', at));
    done(true);
  }, 300));`;
const SHOTS = {
  // No project on: the reader's own digs in the margin beside the page.
  yours: { path: alone, ready: `${painted} && document.querySelector('.dig-margin-face')`, size: wide },
  // No project on: a face pressed opens that dig beside it.
  'yours-open': {
    path: alone, ready: `${painted} && document.querySelector('.dig-margin-face')`,
    then: "document.querySelectorAll('.dig-margin-face')[1].click(); return true;",
    settled: '.dig-margin-card .talk-post', size: wide,
  },
  // No project on: an anchor dropped opens the reader's dig in the margin,
  // level with it, to be written.
  'yours-place': { path: alone, ready: `${painted} && document.querySelector('.dig-margin-face')`, then: drop(0.62, 0.2), settled: '.dig-margin-card .talk-dig-new .md-field', size: wide },
  'project-on': { path: on, ready: `${painted} && document.querySelector('.project-pill.on') && document.querySelector('.pin.theirs')`, size: wide },
  // No project on: each thing picked out, with the way to dig it.
  'yours-anchor': { path: alone, ready: `${painted} && document.querySelector('.pin')`, then: pick('.pin'), settled: '.thing-bar', size: wide },
  'yours-ink': { path: alone, ready: `${painted} && document.querySelector('[data-ink] .ink-grab')`, then: pick(`[data-ink="d1b2c3d4-0000-4000-8000-000000000002"] .ink-grab`), settled: '.ink-actions', size: wide },
  'yours-clip': { path: alone, ready: `${painted} && document.querySelector('.paper-clip canvas')`, then: pick('.paper-clip'), settled: '.clip-bar', size: wide },
  // Pressing another member's anchor opens its options: their face.
  'project-anchor': { path: on, ready: `${painted} && document.querySelector('.pin.theirs')`, then: pick('.pin.theirs'), settled: '.thing-bar .thing-face', size: wide },
  // Their face in the margin opens their dig, and only that.
  'project-dig': { path: on, ready: `${painted} && document.querySelector('.dig-margin-face')`, then: "document.querySelectorAll('.dig-margin-face')[2].click(); return true;", settled: '.dig-margin-card .talk-post', size: wide },
  'project-ink': { path: on, ready: `${painted} && document.querySelector('[data-ink] .ink-grab')`, then: pick(`[data-ink="d1b2c3d4-0000-4000-8000-000000000004"] .ink-grab`), settled: '.ink-actions .thing-face', size: wide },
  // A project's link to Ben's dig on his paint: the paint picked out in the
  // middle of the view with that dig open beside it.
  'project-land': { path: `${on}&annotation=d1b2c3d4-0000-4000-8000-000000000008&dig=e1b2c3d4-0000-4000-8000-000000000051`, ready: `${painted} && document.querySelector('.ink-actions')`, settled: '.dig-margin-card .talk-post', size: wide },
  // The margin, a face pressed: that dig opens beside it.
  'project-margin': { path: on, ready: `${painted} && document.querySelector('.dig-margin-face')`, then: "document.querySelectorAll('.dig-margin-face')[1].click(); return true;", settled: '.dig-margin-card .talk-post', size: wide },
  // An anchor dropped with the project on: the reader's dig there opens in
  // the margin, level with it, to be written.
  'project-place': {
    path: on, ready: `${painted} && document.querySelector('.dig-margin-face')`,
    then: drop(0.62, 0.2),
    settled: '.dig-margin-card .talk-dig-new .md-field', size: wide,
  },
  // A narrower window: the page keeps its width and the faces stay beside
  // it while there is room for one.
  'project-narrow': { path: on, ready: `${painted} && document.querySelector('.pin')`, size: { width: 1180, height: 820 } },
  // A PDF held over the page while reading: it will go to the nook's upload.
  'drop-pdf': { path: alone, ready: painted, then: "const data = new DataTransfer(); data.items.add(new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' })); window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, cancelable: true })); return true;", settled: '.desk-file-drop-overlay', size: wide },
  'project-switch': { path: on, ready: `${painted} && document.querySelector('.project-pill.on')`, then: "document.querySelector('.project-pill').click(); return true;", settled: '.project-menu', size: wide },
};

const [outDir, ...asked] = process.argv.slice(2);
if (!outDir) {
  console.error(`usage: node scripts/project-shots.mjs <out dir> [${Object.keys(SHOTS).join(' | ')} ...]`);
  process.exit(2);
}
const names = asked.length ? asked : Object.keys(SHOTS);
const unknown = names.filter((name) => !SHOTS[name]);
if (unknown.length) throw new Error(`No such shot: ${unknown.join(', ')}`);

const server = await viewerServer();
const browser = new Browser();
try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await mkdir(outDir, { recursive: true });
  for (const name of names) {
    const shot = SHOTS[name];
    await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 2, mobile: false, ...shot.size });
    await browser.navigate(origin + shot.path);
    await browser.waitFor(shot.ready, { timeout: 60_000, what: `${name} to be ready` });
    await browser.evaluate(`return ${settled};`);
    if (shot.then) { await browser.evaluate(shot.then); await new Promise((done) => setTimeout(done, 400)); }
    if (shot.settled) await browser.waitFor(`document.querySelector('${shot.settled}')`, { what: `${name} to settle` });
    await browser.evaluate(`return ${settled};`);
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
    const file = join(resolve(outDir), `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(file);
  }
} finally {
  await browser.stop();
  await server.close();
}
