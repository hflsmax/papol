import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { PAPER, PROJECT, viewerServer } from './fixtures/projectViewer.mjs';

// Pictures of the viewer with a project on, on the fixture paper, for a
// pull request or a letter: the paper alone, then with the project on;
// another member's note, its dig, their ink picked out, and the switch.
//
//   node scripts/project-shots.mjs <out dir> [name ...]
const settled = "document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 700)))";
const wide = { width: 1440, height: 900 };
const painted = "document.querySelector('.pdf-page[data-page=\"1\"] canvas') && document.querySelector('[data-ink]')";
const on = `/viewer/?pdf=${PAPER}&project=${PROJECT}`;
// A press on the page, as a hand makes it: pointer events on the element.
const press = (selector) => `
  document.querySelector('.pages').scrollTop += 260;
  const el = document.querySelector('${selector}');
  const box = el.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, button: 0, pointerId: 1, isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', at));
  el.dispatchEvent(new PointerEvent('pointerup', at));
  el.dispatchEvent(new MouseEvent('click', at));
  return true;`;
const SHOTS = {
  yours: { path: `/viewer/?pdf=${PAPER}`, ready: painted, size: wide },
  'project-on': { path: on, ready: `${painted} && document.querySelector('.project-pill.on') && document.querySelector('.pin.theirs')`, size: wide },
  'project-note': { path: on, ready: `${painted} && document.querySelector('.pin.theirs')`, then: press('.pin.theirs'), settled: '.note-pop .talk-pin', size: wide },
  'project-dig': { path: on, ready: `${painted} && document.querySelector('.pin.theirs')`, then: `${press('.pin.theirs').replace('return true;', '')} setTimeout(() => document.querySelector('.note-pop .talk-pin').click(), 300); return true;`, settled: '.talk-card.is-placed .talk-post', size: wide },
  'project-ink': { path: on, ready: `${painted} && document.querySelector('[data-ink] .ink-grab')`, then: press(`[data-ink="d1b2c3d4-0000-4000-8000-000000000004"] .ink-grab`), settled: '.ink-who', size: wide },
  // A project's link to Ben's dig on his paint: the paint picked out in the
  // middle of the view with that dig open beside it.
  'project-land': { path: `${on}&annotation=d1b2c3d4-0000-4000-8000-000000000008&dig=e1b2c3d4-0000-4000-8000-000000000051`, ready: `${painted} && document.querySelector('.ink-actions')`, settled: '.dig-margin-line.is-open .talk-post', size: wide },
  // The margin, a line pressed: its dig opens beside the page.
  'project-margin': { path: on, ready: `${painted} && document.querySelector('.dig-margin-line [data-subject], .dig-margin-head')`, then: "document.querySelectorAll('.dig-margin-head')[1].click(); return true;", settled: '.dig-margin-line.is-open .talk-post', size: wide },
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
