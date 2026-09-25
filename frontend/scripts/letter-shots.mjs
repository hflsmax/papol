import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { folderServer } from './fixtures/folderPage.mjs';

// Pictures of the frontend for a letter to users (.claude/skills/
// feature-letter): the real components on a smoke's fixture page, with the
// application's styles and a pretend server, so no account or stack is
// needed. Each shot is a name, the fixture page it opens, what to wait
// for, and the element to crop to; add one beside the smoke whose page it
// borrows.
//
//   npm run shots:letter -- <out dir> [name ...]
const SHOTS = {
  'upload-box': {
    page: '/__folder_test?styled&box',
    ready: "document.body.innerText.includes('Drop PDFs or a folder')",
    crop: '.library-page',
  },
  'folder-review': {
    page: '/__folder_test?styled',
    ready: "document.body.innerText.includes('Already in your nook')",
    // The reading comes in, so the first row shows the paper's own title.
    then: 'window.readingDone = true; return true;',
    settled: 'document.querySelector(".folder-row-title").value === "Attention Is All You Need"',
    crop: '.library-page',
  },
};

const [outDir, ...asked] = process.argv.slice(2);
if (!outDir) {
  console.error(`usage: npm run shots:letter -- <out dir> [${Object.keys(SHOTS).join(' | ')} ...]`);
  process.exit(2);
}
const names = asked.length ? asked : Object.keys(SHOTS);
const unknown = names.filter((name) => !SHOTS[name]);
if (unknown.length) throw new Error(`No such shot: ${unknown.join(', ')}`);

const server = await folderServer();
const browser = new Browser();
try {
  await server.listen();
  await browser.start();
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1400, deviceScaleFactor: 2, mobile: false });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await mkdir(outDir, { recursive: true });
  for (const name of names) {
    const shot = SHOTS[name];
    await browser.navigate(origin + shot.page);
    await browser.waitFor(shot.ready, { what: `${name} to be ready` });
    if (shot.then) await browser.evaluate(shot.then);
    if (shot.settled) await browser.waitFor(shot.settled, { what: `${name} to settle` });
    // The fonts, and a frame drawn with them.
    await browser.evaluate('return document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => done(true))));');
    const clip = await browser.evaluate(`const box = document.querySelector(${JSON.stringify(shot.crop)}).getBoundingClientRect();
      return {x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: box.width + 32, height: box.height + 32, scale: 1};`);
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
    const file = join(resolve(outDir), `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(file);
  }
} finally {
  await browser.stop();
  await server.close();
}
