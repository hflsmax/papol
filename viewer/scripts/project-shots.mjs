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
  yours: { path: alone, ready: `${painted} && document.querySelector('.dig-margin-head')`, size: wide },
  // No project on, the margin folded to its faces, and a face pressed:
  // its line opens over the page's edge.
  'yours-folded': { path: alone, ready: `${painted} && document.querySelector('.dig-margin-fold')`, then: "document.querySelector('.dig-margin-fold').click(); return true;", settled: '.dig-margin.is-folded .dig-margin-face', size: wide },
  'yours-folded-open': {
    path: alone, ready: `${painted} && document.querySelector('.dig-margin-fold')`,
    then: "document.querySelector('.dig-margin-fold').click(); return new Promise((done) => setTimeout(() => { document.querySelectorAll('.dig-margin-face')[2].click(); done(true); }, 300));",
    settled: '.dig-margin.is-folded .dig-margin-line.is-open .talk-post', size: wide,
  },
  // No project on: an anchor dropped opens the reader's dig in the margin,
  // level with it, to be written.
  'yours-place': { path: alone, ready: `${painted} && document.querySelector('.dig-margin-head')`, then: drop(0.62, 0.2), settled: '.dig-margin-line.is-open .talk-dig-new textarea', size: wide },
  'project-on': { path: on, ready: `${painted} && document.querySelector('.project-pill.on') && document.querySelector('.pin.theirs')`, size: wide },
  // No project on: each thing picked out, with the way to dig it.
  'yours-anchor': { path: alone, ready: `${painted} && document.querySelector('.pin')`, then: pick('.pin'), settled: '.dig-margin-line.is-open', size: wide },
  'yours-ink': { path: alone, ready: `${painted} && document.querySelector('[data-ink] .ink-grab')`, then: pick(`[data-ink="d1b2c3d4-0000-4000-8000-000000000002"] .ink-grab`), settled: '.ink-actions', size: wide },
  'yours-clip': { path: alone, ready: `${painted} && document.querySelector('.paper-clip canvas')`, then: pick('.paper-clip'), settled: '.clip-bar', size: wide },
  'project-anchor': { path: on, ready: `${painted} && document.querySelector('.pin.theirs')`, then: pick('.pin.theirs'), settled: '.dig-margin-line.is-open .talk-post', size: wide },
  'project-dig': { path: on, ready: `${painted} && document.querySelector('.pin.theirs')`, then: pick('.pin.theirs'), settled: '.dig-margin-line.is-open .talk-card-body > *', size: wide },
  'project-ink': { path: on, ready: `${painted} && document.querySelector('[data-ink] .ink-grab')`, then: pick(`[data-ink="d1b2c3d4-0000-4000-8000-000000000004"] .ink-grab`), settled: '.ink-actions .thing-face', size: wide },
  // A project's link to Ben's dig on his paint: the paint picked out in the
  // middle of the view with that dig open beside it.
  'project-land': { path: `${on}&annotation=d1b2c3d4-0000-4000-8000-000000000008&dig=e1b2c3d4-0000-4000-8000-000000000051`, ready: `${painted} && document.querySelector('.ink-actions')`, settled: '.dig-margin-line.is-open .talk-post', size: wide },
  // The margin, a line pressed: its dig opens beside the page.
  'project-margin': { path: on, ready: `${painted} && document.querySelector('.dig-margin-line [data-subject], .dig-margin-head')`, then: "document.querySelectorAll('.dig-margin-head')[1].click(); return true;", settled: '.dig-margin-line.is-open .talk-post', size: wide },
  // An anchor dropped with the project on: the reader's dig there opens in
  // the margin, level with it, to be written.
  'project-place': {
    path: on, ready: `${painted} && document.querySelector('.dig-margin-head')`,
    then: drop(0.62, 0.2),
    settled: '.dig-margin-line.is-open .talk-dig-new textarea', size: wide,
  },
  // A window with no room beside the page: the page keeps its width, the
  // margin folds away and the pins stay.
  'project-margin-narrow': { path: on, ready: `${painted} && document.querySelector('.pin') && !document.querySelector('.dig-margin-head')`, size: { width: 1180, height: 820 } },
  // A window with too little room beside the page for the lines: the
  // margin is its column of faces.
  'project-margin-least': { path: on, ready: `${painted} && document.querySelector('.dig-margin.is-folded .dig-margin-face')`, size: { width: 1390, height: 820 } },
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
