import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pictures of defined terms in the viewer, on fixtures/definitions.pdf, a
// short paper that states three definitions and goes on using their terms:
// the Define button over selected words, the paper's definitions to choose
// from, the definition shown where the term is read while the pointer is on
// it, the definition gone to by a press, and the terms listed under the gear.
//
//   node scripts/term-shots.mjs <out dir> [select | choose | hover | jump | gear ...]
//
// PAPOL_SHOTS_PREFIX names the files (default "term"): "before" for the
// same scenes on a build that has no Define, where the later ones are
// skipped.
process.env.PAPOL_FIXTURE_PDF ||= fileURLToPath(new URL('./fixtures/definitions.pdf', import.meta.url));
process.env.PAPOL_FIXTURE_BARE ||= '1';
process.env.PAPOL_FIXTURE_TITLE ||= 'Small Steps: A Reduction Semantics in Three Definitions';
const { Browser } = await import('../../scripts/share-e2e/cdp.mjs');
const { PAPER, viewerServer } = await import('./fixtures/projectViewer.mjs');

const settled = "document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 700)))";
const wide = { width: 1440, height: 900 };
const [outDir, ...asked] = process.argv.slice(2);
const prefix = process.env.PAPOL_SHOTS_PREFIX || 'term';
if (!outDir) {
  console.error('usage: node scripts/term-shots.mjs <out dir> [select | choose | hover | jump | gear ...]');
  process.exit(2);
}

// The words, as a hand selects them: the first place page `page` prints
// `words`, in the middle of the window.
const select = (page, words) => `
  const spans = [...document.querySelectorAll('.pdf-page[data-page="${page}"] .textLayer span')];
  const span = spans.find((s) => s.firstChild?.nodeType === 3 && s.textContent.includes(${JSON.stringify(words)}));
  if (!span) return false;
  span.scrollIntoView({ block: 'center' });
  const range = document.createRange();
  const at = span.textContent.indexOf(${JSON.stringify(words)});
  range.setStart(span.firstChild, at);
  range.setEnd(span.firstChild, at + ${words.length});
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;`;
const defineButton = `document.querySelector('.selection-actions button[aria-label="Define selected text"]:not([disabled])')`;
// A term's link on a page, and the pointer over it, as a hand puts it there.
const termLink = (page) => `[...document.querySelectorAll('.pdf-page[data-page="${page}"] .pdf-link')].find((l) => /where you defined/.test(l.getAttribute('aria-label')))`;
const hover = (page) => `const el = ${termLink(page)}; el.scrollIntoView({ block: 'center' });
  return new Promise((done) => setTimeout(() => {
    const box = el.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, pointerId: 1, isPrimary: true };
    document.elementFromPoint(at.clientX, at.clientY).dispatchEvent(new PointerEvent('pointermove', at));
    done(true);
  }, 300));`;
// Define `words` (first printed on `page`) as the definition labelled `label`.
const define = (page, words, label) => [
  select(page, words),
  { waitFor: defineButton },
  `${defineButton}.click(); return true;`,
  { waitFor: `document.querySelector('.define-choice')` },
  `[...document.querySelectorAll('.define-choice')].find((b) => b.textContent.includes(${JSON.stringify(label)})).click(); return true;`,
  { waitFor: `!document.querySelector('.define-sheet')` },
];

const SCENES = {
  select: { steps: [select(1, 'evaluation context'), { waitFor: `document.querySelector('.selection-actions button')` }] },
  choose: { needs: true, steps: [select(1, 'evaluation context'), { waitFor: defineButton }, `${defineButton}.click(); return true;`, { waitFor: `document.querySelector('.define-choice')` }] },
  hover: { needs: true, steps: [...define(1, 'evaluation context', 'Definition 2'), `document.querySelector('.pdf-page[data-page="3"]').scrollIntoView({ block: 'center' }); return true;`, { waitFor: termLink(3) }, hover(3), { waitFor: `document.querySelector('.paper-clip.telescope canvas')` }] },
  jump: { needs: true, steps: [...define(1, 'evaluation context', 'Definition 2'), `document.querySelector('.pdf-page[data-page="3"]').scrollIntoView({ block: 'center' }); return true;`, { waitFor: termLink(3) }, `const el = ${termLink(3)}; el.scrollIntoView({ block: 'center' }); el.click(); return true;`, { wait: 900 }] },
  gear: { steps: [
    { needs: true, steps: [...define(1, 'evaluation context', 'Definition 2'), ...define(1, 'redex', 'Definition 1'), ...define(1, 'normal form', 'Definition 3')] },
    `document.querySelector('.navigator-gear').click(); return true;`,
    { waitFor: `document.querySelector('.navigator-choices')` },
  ] },
};
const names = asked.length ? asked : Object.keys(SCENES);

const server = await viewerServer();
const browser = new Browser();
try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await mkdir(outDir, { recursive: true });
  await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 2, mobile: false, ...wide });
  await browser.navigate(`${origin}/viewer/?pdf=${PAPER}&page=1`);
  await browser.waitFor(`document.querySelector('.pdf-page[data-page="1"] .textLayer span')`, { timeout: 90_000, what: 'the paper to be ready' });
  await browser.evaluate(`for (const tip of ['papol_learn_link_navigation', 'papol_learn_dark_pages']) localStorage.setItem(tip, 'seen'); return true;`);
  const hasDefine = await browser.evaluate(`${select(1, 'evaluation context')}`)
    && await browser.evaluate(`return new Promise((done) => setTimeout(() => done(Boolean(${defineButton})), 600));`);
  const run = async (steps) => {
    for (const step of steps) {
      if (typeof step === 'string') await browser.evaluate(step);
      else if (step.steps) { if (!step.needs || hasDefine) await run(step.steps); }
      else if (step.waitFor) await browser.waitFor(step.waitFor, { timeout: 30_000, what: step.waitFor });
      else await new Promise((done) => setTimeout(done, step.wait));
    }
  };
  for (const name of names) {
    const scene = SCENES[name];
    if (scene.needs && !hasDefine) continue;
    await browser.navigate(`${origin}/viewer/?pdf=${PAPER}&page=1`);
    // The paper read, so its definitions are there to choose from, and the
    // lessons already seen, so the pictures show the terms and nothing else.
    await browser.waitFor(`document.querySelector('.pdf-page[data-page="1"] .textLayer span')`, { timeout: 90_000, what: `${name} to be ready` });
    await browser.evaluate(`for (const tip of ['papol_learn_link_navigation', 'papol_learn_dark_pages']) localStorage.setItem(tip, 'seen'); return true;`);
    await browser.evaluate(`return new Promise((done) => setTimeout(done, 2500));`);
    await run(scene.steps);
    await browser.evaluate(`return ${settled};`);
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
    const file = join(resolve(outDir), `${prefix}-${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(file);
  }
} finally {
  await browser.stop();
  await server.close();
}
