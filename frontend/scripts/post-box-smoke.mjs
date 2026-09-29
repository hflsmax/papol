import assert from 'node:assert/strict';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { P_ERROR, PROJECT, projectServer } from './fixtures/projectPages.mjs';

// A brief's post boxes open only when pressed. An editable box at rest let
// the browser put the caret in it for a press on blank page beside it, so
// a press anywhere on the desk opened the nearest box.
const paper = P_ERROR.slice(0, 32);
const server = await projectServer();
const browser = new Browser();
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const press = async (x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  await pause(150);
};
const active = () => browser.evaluate("return document.activeElement.classList.contains('md-field');");
try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, mobile: false, width: 1440, height: 900 });
  await browser.navigate(`${origin}/project/${PROJECT}`);
  await browser.waitFor("document.querySelector('.project-tabs')", { timeout: 40_000, what: 'the project desk' });
  await browser.evaluate("document.getElementById('project-tab-papers').click(); return true;");
  await browser.waitFor("document.querySelector('.project-paper')", { what: 'the papers tab' });
  await browser.evaluate(`document.querySelector('[data-paper^="${paper}"]').click(); return true;`);
  await browser.waitFor("document.querySelector('.project-papers-panel .talk-compose .md-field')", { what: 'the brief' });
  await pause(500);

  // Blank page level with each box, left of the brief and just above it.
  const boxes = await browser.evaluate(`return [...document.querySelectorAll('.project-papers-panel .md-field')]
    .map((f) => f.getBoundingClientRect()).filter((r) => r.bottom < innerHeight)
    .map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }));`);
  assert.ok(boxes.length >= 2, 'the brief shows its boxes');
  const panelLeft = await browser.evaluate("return document.querySelector('.project-papers-panel').getBoundingClientRect().x;");
  for (const box of boxes) {
    for (const [x, y] of [[panelLeft - 40, box.y + box.h / 2], [box.x + box.w / 2, box.y - 2]]) {
      const blank = await browser.evaluate(`const h = document.elementFromPoint(${x}, ${y}); return Boolean(h) && !h.closest('a, button, [tabindex], .project-paper');`);
      if (!blank) continue;
      await browser.evaluate('document.activeElement.blur(); return true;');
      await press(x, y);
      assert.equal(await active(), false, `a press on blank page at ${Math.round(x)},${Math.round(y)} left the box beside it shut`);
    }
  }

  // The box itself, pressed, takes the caret and what is typed.
  const [first] = boxes;
  await press(first.x + first.w / 2, first.y + first.h / 2);
  assert.equal(await active(), true, 'a press on the box puts the caret in it');
  await browser.send('Input.insertText', { text: 'hello' });
  assert.equal(await browser.evaluate('return document.activeElement.innerText.trim();'), 'hello');
  await browser.evaluate('document.activeElement.blur(); return true;');

  // Reached from the keyboard or from code, it takes typing too.
  await browser.evaluate("document.querySelectorAll('.project-papers-panel .md-field')[1].focus(); return true;");
  await browser.send('Input.insertText', { text: 'typed' });
  assert.equal(await browser.evaluate('return document.activeElement.innerText.trim();'), 'typed');
} finally {
  await browser.stop();
  await server.close();
}
console.log('post box: a press on blank page beside a brief opens no box; a press on the box, or focus from code, takes typing');
