import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { DIG_PAPER, P_ERROR, PROJECT, projectServer } from './fixtures/projectPages.mjs';

// Pictures of the pages inside a project, on the fixture project, for a
// pull request or a letter: the desk's three tabs, a brief and a dig, on
// the web and in the Mac shell, wide and on a phone; and the member's
// places around it (their nook, the Library, a paper) with the bar over
// every page.
//
//   node scripts/project-shots.mjs <out dir> [name ...]
const paper = P_ERROR.slice(0, 32);
const settled = "document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))))";
const wide = { width: 1440, height: 900 };
const phone = { width: 390, height: 844, mobile: true };
// The desk on one of its tabs; the tab is kept per visit, so it is chosen
// each time.
const desk = (tab, settled, then = null, search = '') => ({
  path: `/project/${PROJECT}${search}`,
  ready: "document.querySelector('.project-tabs')",
  then: `document.getElementById('project-tab-${tab}').click(); ${then ?? 'return true;'}`,
  settled: `document.querySelector('${settled}')`,
});
const SHOTS = {
  'desk-papers': { ...desk('papers', '.project-paper'), size: wide },
  'desk-boards': { ...desk('boards', '.project-board'), size: wide },
  'desk-digs': { ...desk('digs', '.project-talk-item'), size: wide },
  'desk-people': { ...desk('papers', '#project-people', "document.querySelector('.project-seat-row').click(); return true;"), size: wide },
  brief: { path: `/project/${PROJECT}/paper/${paper}`, ready: "document.querySelector('.brief-page .talk-post')", size: wide },
  dig: { path: `/discussion/${DIG_PAPER}`, ready: "document.querySelector('.discussion-post')", size: wide },
  'mac-desk-papers': { ...desk('papers', '.project-paper', null, '?shell=desktop'), size: wide },
  'mac-desk-digs': { ...desk('digs', '.project-talk-item', null, '?shell=desktop'), size: wide },
  'mac-brief': { path: `/project/${PROJECT}/paper/${paper}?shell=desktop`, ready: "document.querySelector('.brief-page .talk-post')", size: wide },
  'mac-dig': { path: `/discussion/${DIG_PAPER}?shell=desktop`, ready: "document.querySelector('.discussion-post')", size: wide },
  'phone-desk': { ...desk('papers', '.project-paper', null, '?shell=web'), size: phone },
  nook: { path: '/?shell=web', ready: "document.querySelector('.nook .desk-title')", size: wide },
  'nook-add': { path: '/?shell=web', ready: "document.querySelector('.nook .desk-title')", then: "document.querySelector('.upload-section.is-trigger > button').click(); return true;", settled: "document.querySelector('.upload-menu')", size: wide },
  'nook-tag': { path: '/?shell=web', ready: "document.querySelector('.nook .desk-tag')", then: "[...document.querySelectorAll('.desk-tag')].find((b) => b.textContent === '#control').click(); return true;", settled: "document.querySelector('.desk-tag.is-on')", size: wide },
  'nook-board': { path: '/board/ad000000-0000-4000-8000-000000000001?shell=web', ready: "document.querySelector('.desk-board .board-jacket-heading')", size: wide },
  'nook-project': { path: `/project/${PROJECT}?shell=web`, ready: "document.querySelector('.desk-project-view .project-tabs')", then: "document.getElementById('project-tab-papers').click(); return true;", settled: "document.querySelector('.desk-project-view .project-paper')", size: wide },
  'nook-paper': { path: '/shelf/ab000000-0000-4000-8000-000000000001?shell=web', ready: "document.querySelector('.nook .desk-title')", then: "document.querySelector('.desk-title').click(); return true;", settled: "document.querySelector('.desk-paper-view .paper-jacket h2')", size: wide },
  'nook-board-paper': { path: '/board/ad000000-0000-4000-8000-000000000002?shell=web', ready: "document.querySelector('.board-jacket-papers a')", then: "document.querySelector('.board-jacket-papers a').click(); return true;", settled: "document.querySelector('.desk-paper-view .paper-jacket h2')", size: wide },
  library: { path: '/bazaar?shell=web', ready: "document.body.innerText.includes('Pyramid wavefront')", size: wide },
  paper: { path: `/paper/${paper}?shell=web`, ready: "document.querySelector('.paper-jacket h2')", size: wide },
  you: { path: '/profile?shell=web', ready: "document.querySelector('.you-page .notification-item')", size: wide },
  'you-account': { path: '/profile?shell=web', ready: "document.querySelector('.you-page .notification-item')", then: "document.getElementById('you-tab-account').click(); return true;", settled: "document.querySelector('.profile-page')", size: wide },
  'phone-you': { path: '/profile?shell=web', ready: "document.querySelector('.you-page .notification-item')", size: phone },
  'phone-nook': { path: '/?shell=web', ready: "document.querySelector('.nook .desk-title')", size: phone },
  'phone-paper': { path: `/paper/${paper}?shell=web`, ready: "document.querySelector('.paper-jacket h2')", size: phone },
  'phone-brief': { path: `/project/${PROJECT}/paper/${paper}?shell=web`, ready: "document.querySelector('.brief-page .talk-post')", size: phone },
};

const [outDir, ...asked] = process.argv.slice(2);
if (!outDir) {
  console.error(`usage: node scripts/project-shots.mjs <out dir> [${Object.keys(SHOTS).join(' | ')} ...]`);
  process.exit(2);
}
const names = asked.length ? asked : Object.keys(SHOTS);
const unknown = names.filter((name) => !SHOTS[name]);
if (unknown.length) throw new Error(`No such shot: ${unknown.join(', ')}`);

const server = await projectServer();
const browser = new Browser();
try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await mkdir(outDir, { recursive: true });
  for (const name of names) {
    const shot = SHOTS[name];
    await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 2, mobile: false, ...shot.size });
    // The Mac shell is remembered per tab, so a web shot says so.
    await browser.navigate(origin + shot.path);
    await browser.waitFor(shot.ready, { timeout: 40_000, what: `${name} to be ready` });
    if (shot.then) { await browser.evaluate(shot.then); await new Promise((done) => setTimeout(done, 300)); }
    if (shot.settled) await browser.waitFor(shot.settled, { what: `${name} to settle` });
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
