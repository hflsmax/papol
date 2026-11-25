import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { PAPER, PROJECT, viewerServer } from './fixtures/projectViewer.mjs';

// Pictures of the fixture paper with dark pages off and on, for a pull
// request: the gear's menu that holds the switch, the reader's own marks, a thing picked out, a project's inks, a
// figure, and each under the dark theme too.
//
//   node scripts/dark-pages-shots.mjs <out dir> [name ...]
const settled = "document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 900)))";
const wide = { width: 1440, height: 900 };
const painted = "document.querySelector('.pdf-page[data-page=\"1\"] canvas') && document.querySelector('[data-ink]')";
// A page drawn, wherever the reading was left.
const drawn = "document.querySelector('.pdf-page canvas')";
const alone = `/viewer/?pdf=${PAPER}`;
const on = `${alone}&project=${PROJECT}`;
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
const toPage = (n) => `document.querySelector('.pdf-page[data-page="${n}"]').scrollIntoView({ block: 'start' }); return new Promise((done) => setTimeout(() => done(true), 2500));`;
const SHOTS = {
  printed: { path: alone, ready: painted },
  // The tip under the gear, before the reader has been told.
  hint: { path: alone, ready: painted, hint: true, settled: '.dark-pages-tip' },
  'dark-theme-hint': { path: alone, ready: painted, hint: true, theme: 'dark', settled: '.dark-pages-tip' },
  dark: { path: alone, ready: painted, dark: true },
  'dark-theme-printed': { path: alone, ready: painted, theme: 'dark' },
  'dark-theme-dark': { path: alone, ready: painted, dark: true, theme: 'dark' },
  // The gear pressed: the marks, and the switch under them.
  'printed-menu': { path: alone, ready: painted, then: "document.querySelector('.navigator-gear').click(); return true;", settled: '.navigator-pages' },
  'dark-menu': { path: alone, ready: painted, dark: true, then: "document.querySelector('.navigator-gear').click(); return true;", settled: '.navigator-pages' },
  'printed-ink': { path: alone, ready: painted, then: pick('[data-ink="d1b2c3d4-0000-4000-8000-000000000002"] .ink-grab'), settled: '.ink-actions' },
  'dark-ink': { path: alone, ready: painted, dark: true, then: pick('[data-ink="d1b2c3d4-0000-4000-8000-000000000002"] .ink-grab'), settled: '.ink-actions' },
  'printed-clip': { path: alone, ready: `${painted} && document.querySelector('.paper-clip canvas')`, then: pick('.paper-clip'), settled: '.clip-bar' },
  'dark-clip': { path: alone, ready: `${painted} && document.querySelector('.paper-clip canvas')`, dark: true, then: pick('.paper-clip'), settled: '.clip-bar' },
  'printed-project': { path: on, ready: `${painted} && document.querySelector('.project-pill.on')` },
  'dark-project': { path: on, ready: `${painted} && document.querySelector('.project-pill.on')`, dark: true },
  'printed-figure': { path: alone, ready: drawn, then: toPage(Number(process.env.FIGURE_PAGE || 3)) },
  'dark-figure': { path: alone, ready: drawn, dark: true, then: toPage(Number(process.env.FIGURE_PAGE || 3)) },
};

const [outDir, ...asked] = process.argv.slice(2);
if (!outDir) {
  console.error(`usage: node scripts/dark-pages-shots.mjs <out dir> [${Object.keys(SHOTS).join(' | ')} ...]`);
  process.exit(2);
}
const names = asked.length ? asked : Object.keys(SHOTS);
const server = await viewerServer();
const browser = new Browser();
try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await mkdir(outDir, { recursive: true });
  for (const name of names) {
    const shot = SHOTS[name];
    await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 2, mobile: false, ...wide });
    await browser.navigate(origin + shot.path);
    await browser.evaluate(`
      ${shot.dark ? "localStorage.setItem('papol_pdf_pages', 'dark')" : "localStorage.removeItem('papol_pdf_pages')"};
      ${shot.hint ? "localStorage.removeItem('papol_learn_dark_pages')" : "localStorage.setItem('papol_learn_dark_pages', 'seen')"};
      ${shot.theme ? `localStorage.setItem('papol_theme', '${shot.theme}')` : "localStorage.removeItem('papol_theme')"};
      return true;`);
    await browser.navigate(origin + shot.path);
    await browser.waitFor(shot.ready, { timeout: 60_000, what: `${name} to be ready` });
    await browser.evaluate(`return ${settled};`);
    if (shot.then) { await browser.evaluate(shot.then); await new Promise((done) => setTimeout(done, 400)); }
    if (shot.settled) await browser.waitFor(`document.querySelector('${shot.settled}')`, { what: `${name} to settle` });
    await browser.evaluate(`return ${settled};`);
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(resolve(outDir), `${name}.png`), Buffer.from(data, 'base64'));
    console.log(name);
  }
} finally {
  await browser.stop?.();
  await server.close();
}
