import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { PAPER, viewerServer } from './fixtures/projectViewer.mjs';

// Pictures of the nav bar's marks on a paper that has them (set
// PAPOL_FIXTURE_PDF to it and PAPOL_FIXTURE_TITLE to its title): the bar as
// it opens, with the default kinds; the gear's choices open; and the bar
// with every kind turned on. Each is the bar alone, cut from the window,
// and the window whole. Last, the window after a press on a figure's mark.
//
//   PAPOL_FIXTURE_PDF=paper.pdf node scripts/nav-shots.mjs <out dir> [width]
const settled = "document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 500)))";
const [outDir, widthArg] = process.argv.slice(2);
const wide = { width: Number(widthArg) || 1440, height: 900 };
if (!outDir) {
  console.error('usage: PAPOL_FIXTURE_PDF=paper.pdf node scripts/nav-shots.mjs <out dir> [width]');
  process.exit(2);
}
const gear = "document.querySelector('.navigator-gear')";
const kind = (k) => `document.querySelector('.navigator-kind:nth-child(${k})')`;

const server = await viewerServer();
const browser = new Browser();
try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await mkdir(outDir, { recursive: true });
  await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 2, mobile: false, ...wide });
  await browser.navigate(`${origin}/viewer/?pdf=${PAPER}`);
  // Read, and marked: the reading line gone and the gear there.
  await browser.waitFor(`${gear} && document.querySelector('.navigator-sub') && !document.querySelector('.navigator-loading')`, { timeout: 180_000, what: 'the marks' });
  const shoot = async (name, { bar = true, tall = 0 } = {}) => {
    await browser.evaluate(`return ${settled};`);
    const box = await browser.evaluate("const r = document.querySelector('.viewer-bar').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height };");
    const clip = bar ? { x: box.x, y: box.y, width: box.width, height: box.height + tall, scale: 1 } : undefined;
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    const file = join(resolve(outDir), `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(file);
  };
  await shoot('bar');
  await shoot('window', { bar: false });
  await browser.evaluate(`${gear}.click(); return true;`);
  await shoot('choices', { tall: 290 });
  // Every kind on.
  const off = await browser.evaluate("return [...document.querySelectorAll('.navigator-kind')].map((b, i) => b.getAttribute('aria-pressed') === 'true' ? -1 : i + 1).filter((i) => i > 0);");
  for (const i of off) await browser.evaluate(`${kind(i)}.click(); return true;`);
  await shoot('choices-all', { tall: 290 });
  await browser.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true;");
  await shoot('bar-all');
  // A press on a figure's mark: the figure comes to the middle of the window.
  await browser.evaluate("const f = [...document.querySelectorAll('.navigator-sub[data-kind=figure]')]; f[Math.min(2, f.length - 1)].click(); return true;");
  await browser.evaluate('return new Promise((done) => setTimeout(done, 1500));');
  await shoot('figure-pressed', { bar: false });
} finally {
  await browser.stop();
  await server.close();
}
