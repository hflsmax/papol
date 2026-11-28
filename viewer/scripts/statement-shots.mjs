import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Pictures of a statement's mention in the viewer ("Def. 3.1", "Lemma 7.2"):
// the mention under the pointer, and where a press on it takes the reader.
// The paper is whichever one PAPOL_FIXTURE_PDF names; the mention is the
// first on page `page` whose words begin with `words`.
//
//   PAPOL_FIXTURE_PDF=<paper.pdf> node scripts/statement-shots.mjs <out dir> <page> <words>
//
// PAPOL_SHOTS_PREFIX names the files (default "statement"): "before" for
// the same scenes on a build that links no statements, where the press
// lands on the words and nothing follows.
process.env.PAPOL_FIXTURE_BARE ||= '1';
const { Browser } = await import('../../scripts/share-e2e/cdp.mjs');
const { PAPER, viewerServer } = await import('./fixtures/projectViewer.mjs');

const settled = "document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 900)))";
const wide = { width: 1440, height: 900 };
const [outDir, page = '1', words = 'Def.'] = process.argv.slice(2);
const prefix = process.env.PAPOL_SHOTS_PREFIX || 'statement';
if (!outDir) {
  console.error('usage: node scripts/statement-shots.mjs <out dir> <page> <words>');
  process.exit(2);
}

// The middle of the words as the page prints them, in the window: brought
// to the middle of it first.
const spot = `(() => {
  const spans = [...document.querySelectorAll('.pdf-page[data-page="${page}"] .textLayer span')];
  const span = spans.find((s) => s.firstChild?.nodeType === 3 && s.textContent.includes(${JSON.stringify(words)}));
  if (!span) return null;
  const range = document.createRange();
  const at = span.textContent.indexOf(${JSON.stringify(words)});
  range.setStart(span.firstChild, at);
  range.setEnd(span.firstChild, at + ${words.length});
  const box = range.getBoundingClientRect();
  return { span, x: box.left + box.width / 2, y: box.top + box.height / 2 };
})()`;

const server = await viewerServer();
const browser = new Browser();
try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await mkdir(outDir, { recursive: true });
  await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 2, mobile: false, ...wide });
  const shoot = async (name) => {
    await browser.evaluate(`return ${settled};`);
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
    const file = join(resolve(outDir), `${prefix}-${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(file);
  };
  await browser.navigate(`${origin}/viewer/?pdf=${PAPER}&page=${page}`);
  await browser.waitFor(`document.querySelector('.pdf-page[data-page="${page}"] .textLayer span')`, { timeout: 90_000, what: 'the paper to be ready' });
  await browser.evaluate(`for (const tip of ['papol_learn_link_navigation', 'papol_learn_dark_pages']) localStorage.setItem(tip, 'seen'); return true;`);
  // Opened again with the lessons already seen, so the pictures show the page and nothing else.
  await browser.navigate(`${origin}/viewer/?pdf=${PAPER}&page=${page}`);
  await browser.waitFor(`document.querySelector('.pdf-page[data-page="${page}"] .textLayer span')`, { timeout: 90_000, what: 'the paper to be ready again' });
  // The paper read: its statements found and their mentions linked.
  await browser.evaluate(`return new Promise((done) => setTimeout(done, 4000));`);
  await browser.waitFor(`Boolean(${spot})`, { timeout: 30_000, what: `"${words}" on page ${page}` });
  await browser.evaluate(`${spot}.span.scrollIntoView({ block: 'center' }); return new Promise((done) => setTimeout(() => done(true), 600));`);
  const at = await browser.evaluate(`const s = ${spot}; return { x: s.x, y: s.y };`);
  // The pointer on the mention, as a hand puts it there.
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  console.log('under the pointer:', await browser.evaluate(`const el = document.elementFromPoint(${at.x}, ${at.y}); const link = el?.closest?.('.pdf-link') || el; return [link.className, link.getAttribute('aria-label') || link.title || ''].join(' | ');`));
  await shoot('hover');
  // And pressed.
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await browser.evaluate(`return new Promise((done) => setTimeout(done, 1200));`);
  await shoot('click');
} finally {
  await browser.stop();
  await server.close();
}
