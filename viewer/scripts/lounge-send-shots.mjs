import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';

// Pictures of sending a selection to the Lounge from the viewer: the
// selected-text bar, the send sheet set to the Lounge with the reader's
// words written, and what it says once sent.
//
//   node scripts/lounge-send-shots.mjs <out dir> [select | sheet | sent ...]
//
// PAPOL_SHOTS_PREFIX names the files (default "lounge-send"): "before" for
// the same scenes on a build whose sheet has only boards, where the sheet
// is left as it opens and `sent` is skipped.
process.env.PAPOL_FIXTURE_BARE ||= '1';
const { PAPER, viewerServer } = await import('./fixtures/projectViewer.mjs');

const wide = { width: 1440, height: 900 };
const [outDir, ...asked] = process.argv.slice(2);
const prefix = process.env.PAPOL_SHOTS_PREFIX || 'lounge-send';
if (!outDir) {
  console.error('usage: node scripts/lounge-send-shots.mjs <out dir> [select | sheet | sent ...]');
  process.exit(2);
}

// A sentence of the abstract, as a hand selects it.
const WORDS = 'dispensing with recurrence and convolutions';
const select = `
  const spans = [...document.querySelectorAll('.pdf-page[data-page="1"] .textLayer span')];
  const span = spans.find((s) => s.firstChild?.nodeType === 3 && s.textContent.includes(${JSON.stringify(WORDS)}));
  if (!span) return false;
  span.scrollIntoView({ block: 'center' });
  const range = document.createRange();
  range.selectNodeContents(span);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;`;
const sendButton = `document.querySelector('.selection-actions button[aria-label^="Send selected text"]:not([disabled])')`;
// A field set as typing sets it, so React hears it.
const set = (field, proto, value) => `{ const f = ${field}; Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set.call(f, ${JSON.stringify(value)}); f.dispatchEvent(new Event(${proto === 'HTMLSelectElement' ? "'change'" : "'input'"}, { bubbles: true })); }`;
const hasLounge = `!!document.querySelector('.send-selection-sheet select option[value="lounge"]')`;
const sheet = [
  select, { waitFor: sendButton }, `${sendButton}.click(); return true;`,
  { waitFor: `document.querySelector('.send-selection-sheet select option:not([value=""])')` },
  `if (${hasLounge}) { ${set(`document.querySelector('.send-selection-sheet select')`, 'HTMLSelectElement', 'lounge')} ${set(`document.querySelectorAll('.send-selection-sheet textarea')[1]`, 'HTMLTextAreaElement', 'Is this still true once the sequences get long? I half remember a result that recurrence wins there.')} } return true;`,
  { wait: 300 },
];
const SCENES = {
  select: { steps: [select, { waitFor: sendButton }, `${sendButton}.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); ${sendButton}.focus(); return true;`, { wait: 700 }] },
  sheet: { steps: sheet },
  sent: { needs: true, steps: [...sheet, `document.querySelector('.send-selection-sheet button.primary').click(); return true;`, { waitFor: `document.querySelector('.send-selection-sheet h3')?.textContent === 'Sent to the Lounge'` }] },
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
  for (const name of names) {
    const scene = SCENES[name];
    await browser.navigate(`${origin}/viewer/?pdf=${PAPER}&page=1`);
    await browser.waitFor(`document.querySelector('.pdf-page[data-page="1"] .textLayer span')`, { timeout: 90_000, what: `${name} to be ready` });
    await browser.evaluate(`for (const tip of ['papol_learn_link_navigation', 'papol_learn_dark_pages']) localStorage.setItem(tip, 'seen'); return true;`);
    await browser.evaluate(`return new Promise((done) => setTimeout(done, 2000));`);
    let skipped = false;
    for (const step of scene.steps) {
      if (typeof step === 'string') await browser.evaluate(step);
      else if (step.waitFor) await browser.waitFor(step.waitFor, { timeout: 30_000, what: step.waitFor });
      else await new Promise((done) => setTimeout(done, step.wait));
      if (scene.needs && step === sheet.at(-1) && !(await browser.evaluate(`return ${hasLounge};`))) { skipped = true; break; }
    }
    if (skipped) continue;
    await browser.evaluate(`return document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 500)));`);
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png' });
    const file = join(resolve(outDir), `${prefix}-${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(file);
  }
} finally {
  await browser.stop();
  await server.close();
}
