import assert from 'node:assert/strict';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { P_LEARN, PROJECT, projectServer } from './fixtures/projectPages.mjs';

// A dig written in the viewer shows in the project's Digs tab. On the Mac the
// viewer is a window of its own, so the project page never saw the dig
// arrive and kept its old list until it was opened again. It fetches the
// project again when its window comes back.
const server = await projectServer();
const browser = new Browser();
const rows = () => browser.evaluate('return document.querySelectorAll(".project-desk [data-dig]").length;');
try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, mobile: false, width: 1440, height: 900 });
  await browser.navigate(`${origin}/project/${PROJECT}?shell=desktop`);
  await browser.waitFor("document.querySelector('.project-tabs')", { timeout: 40_000, what: 'the project desk' });
  await browser.evaluate("document.getElementById('project-tab-digs').click(); return true;");
  await browser.waitFor("document.querySelector('.project-desk [data-dig]')", { what: 'the digs tab' });
  const before = await rows();

  // Written elsewhere, as the viewer's window does, straight to the service.
  const text = 'Written in the viewer window.';
  await browser.evaluate(`return fetch('/api/projects/${PROJECT}/digs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject: 'paper:${P_LEARN}', text: ${JSON.stringify(text)} }),
  }).then((r) => r.ok);`);
  assert.equal(await rows(), before, 'the page does not know of the dig while its window is behind');

  await browser.evaluate("window.dispatchEvent(new Event('focus')); return true;");
  await browser.waitFor(`document.querySelectorAll('.project-desk [data-dig]').length === ${before + 1}`, { what: 'the new dig in the Digs tab' });
} finally {
  await browser.stop();
  await server.close();
}
console.log('digs refresh: a dig written in another window shows in the Digs tab when the project window comes back');
