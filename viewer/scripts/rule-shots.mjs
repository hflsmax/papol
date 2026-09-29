import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { PAPER, viewerServer } from './fixtures/projectViewer.mjs';

// Pictures of a named rule in the viewer, on a paper that has them (set
// PAPOL_FIXTURE_PDF to it and PAPOL_FIXTURE_TITLE to its title): the name
// under the pointer on the page it is cited from, the rule brought into
// view by a press on it, and the rule brought to the name as a clip by a
// Cmd-press.
//
//   PAPOL_FIXTURE_PDF=paper.pdf node scripts/rule-shots.mjs <out dir> <page> [name ...]
const settled = "document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 700)))";
const wide = { width: 1440, height: 900 };
const [outDir, pageArg, ...asked] = process.argv.slice(2);
const page = Number(pageArg) || 1;
const painted = `document.querySelector('.pdf-page[data-page="${page}"] canvas')`;
const link = `[...document.querySelectorAll('.pdf-page[data-page="${page}"] .pdf-link')].find((l) => /Go to Rule/.test(l.getAttribute('aria-label')))`;
const path = `/viewer/?pdf=${PAPER}&page=${page}`;
// The pointer over the name, as a hand puts it there.
const hover = `const el = ${link}; const box = el.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, pointerId: 1, isPrimary: true };
  document.elementFromPoint(at.clientX, at.clientY).dispatchEvent(new PointerEvent('pointermove', at));
  return true;`;
const SHOTS = {
  mention: { then: hover },
  jump: { then: `${link}.click(); return true;`, wait: 900 },
  clip: { then: `${link}.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); return true;`, settled: '.paper-clip.peek canvas' },
};
if (!outDir) {
  console.error(`usage: PAPOL_FIXTURE_PDF=paper.pdf node scripts/rule-shots.mjs <out dir> <page> [${Object.keys(SHOTS).join(' | ')} ...]`);
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
    await browser.navigate(origin + path);
    await browser.waitFor(`${painted} && ${link}`, { timeout: 90_000, what: `${name} to be ready` });
    // The name in the middle of the window, and the lesson about the way
    // back already seen, so the pictures show the rule and nothing else.
    await browser.evaluate(`localStorage.setItem('papol_learn_link_navigation', 'seen'); ${link}.scrollIntoView({ block: 'center' }); return true;`);
    await browser.evaluate(`return ${settled};`);
    await browser.evaluate(shot.then);
    await new Promise((done) => setTimeout(done, shot.wait ?? 400));
    if (shot.settled) await browser.waitFor(`document.querySelector('${shot.settled}')`, { what: `${name} to settle` });
    await browser.evaluate(`return ${settled};`);
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
    const file = join(resolve(outDir), `rule-${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(file);
  }
} finally {
  await browser.stop();
  await server.close();
}
