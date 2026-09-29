import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Browser } from '../../scripts/share-e2e/cdp.mjs';
import { ME, P_ERROR, P_SURVEY, PROJECT, held, projectServer } from './fixtures/projectPages.mjs';

// Pictures of the pages inside a project, on the fixture project, for a
// pull request or a letter: the desk's three tabs, a paper's brief in the
// Papers tab and a dig in the Digs tab, on the web and in the Mac shell, wide and on a phone; and the member's
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
// A PDF dropped on the window, as the browser hands one over.
const DROP = "return fetch('/scripts/fixtures/attention.pdf').then((r) => r.blob()).then((bytes) => { const data = new DataTransfer(); data.items.add(new File([bytes], 'attention.pdf', { type: 'application/pdf' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, cancelable: true })); return true; });";
const SHOTS = {
  'desk-papers': { ...desk('papers', '.project-paper'), size: wide },
  // A keeper writing what the project is about, under its name.
  'desk-description': { ...desk('papers', '.project-description-input:focus', "document.querySelector('.project-description-input').focus(); return true;"), size: wide },
  'desk-boards': { ...desk('boards', '.project-board'), size: wide },
  'desk-digs': { ...desk('digs', '.project-talk-item'), size: wide },
  // The Digs tab with its buried band unfolded.
  'desk-digs-buried': { ...desk('digs', '.project-talk-band.is-buried .project-talk-item', "const go = () => { const b = document.querySelector('.project-talk-band.is-buried .project-talk-band-head'); if (b) b.click(); else setTimeout(go, 100); }; go(); return true;"), size: wide },
  // The open dig's phase, pressed.
  'desk-digs-phase': { ...desk('digs', '.project-talk-panel .dig-phase-menu', "const go = () => { const w = document.querySelector('.project-talk-panel .dig-phase-word'); if (w) w.click(); else setTimeout(go, 100); }; go(); return true;"), size: wide },
  'desk-invite': { ...desk('papers', '#project-people .project-invite', "document.querySelector('.project-invite-open').click(); return true;"), size: wide },
  // A keeper finding someone already in Papol to add.
  'desk-invite-find': { ...desk('papers', '#project-people .project-add-found .project-person', "document.querySelector('.project-invite-open').click(); const go = () => { const f = document.querySelector('.project-add-field'); if (!f) { setTimeout(go, 100); return; } Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, 'mar'); f.dispatchEvent(new Event('input', { bubbles: true })); }; go(); return true;"), size: wide },
  'mac-desk-invite-find': { ...desk('papers', '#project-people .project-add-found .project-person', "document.querySelector('.project-invite-open').click(); const go = () => { const f = document.querySelector('.project-add-field'); if (!f) { setTimeout(go, 100); return; } Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, 'mar'); f.dispatchEvent(new Event('input', { bubbles: true })); }; go(); return true;", '?shell=desktop'), size: wide },
  'phone-desk-invite-find': { ...desk('papers', '#project-people .project-add-found .project-person', "document.querySelector('.project-invite-open').click(); const go = () => { const f = document.querySelector('.project-add-field'); if (!f) { setTimeout(go, 100); return; } Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, 'mar'); f.dispatchEvent(new Event('input', { bubbles: true })); }; go(); return true;", '?shell=web'), size: phone },
  'desk-people': { ...desk('papers', '#project-people', "document.querySelector('.project-seat-more').click(); return true;"), size: wide },
  // A face on the tabs row, and where it leads: that member's nook.
  'seat-nook': { ...desk('papers', '.project-paper', "document.querySelector('.project-seat[href$=\"0002\"]').click(); return true;"), settled: "document.body.innerText.includes('Ana Reyes') && !document.querySelector('.project-page')", size: wide },
  // A paper picked in the Papers tab: its brief beside the list.
  'desk-paper': { ...desk('papers', '.project-papers-panel .talk-post', `document.querySelector('[data-paper^="${paper}"]').click(); return true;`), size: wide },
  // The digs made inside a paper, in its brief: each led by its place.
  'desk-paper-inside': { ...desk('papers', '.project-papers-panel .paper-brief-inside .talk-post', `document.querySelector('[data-paper^="${paper}"]').click(); const go = () => { const f = document.querySelector('.project-papers-panel .paper-brief-inside'); if (f) f.scrollIntoView({ block: 'center' }); else setTimeout(go, 100); }; go(); return true;`), size: wide },
  'phone-paper-inside': { ...desk('papers', '.project-paper-open .paper-brief-inside .talk-post', `document.querySelector('[data-paper^="${paper}"]').click(); const go = () => { const f = document.querySelector('.project-paper-open .paper-brief-inside'); if (f) f.scrollIntoView({ block: 'start' }); else setTimeout(go, 100); }; go(); return true;`, '?shell=web'), size: phone },
  // A dig's phase in a brief, pressed: the four phases drop down under it.
  'desk-paper-phase': { ...desk('papers', '.project-papers-panel .dig-phase-menu', `document.querySelector('[data-paper^="${paper}"]').click(); const go = () => { const w = document.querySelector('.project-papers-panel .dig-phase-word'); if (w) w.click(); else setTimeout(go, 100); }; go(); return true;`), size: wide },
  // A buried dig in a brief, folded to its owner's line.
  'desk-paper-buried': { ...desk('papers', '.project-papers-panel .paper-brief-dig-folded', `document.querySelector('[data-paper^="${paper}"]').click(); const go = () => { const f = document.querySelector('.project-papers-panel .paper-brief-dig-folded'); if (f) f.scrollIntoView({ block: 'center' }); else setTimeout(go, 100); }; go(); return true;`), size: wide },
  // A brief's dig with its folded post box opened.
  'desk-paper-post': { ...desk('papers', '.project-papers-panel .talk-compose .md-field', `document.querySelector('[data-paper^="${paper}"]').click(); const go = () => { const b = document.querySelector('.project-papers-panel .talk-compose .md-field'); if (b) b.focus(); else setTimeout(go, 100); }; go(); return true;`), size: wide },
  // Your own post in a brief's dig, its options shown.
  'desk-post-actions': { ...desk('papers', '.project-papers-panel .talk-post.is-mine .item-actions button', `document.querySelector('[data-paper^="${paper}"]').click(); return true;`), size: wide },
  // A member's face in a paper's dig, and where it leads: their nook.
  'face-nook': { ...desk('papers', '.project-paper', `document.querySelector('[data-paper^="${paper}"]').click(); const go = () => { const f = document.querySelector('.project-papers-panel .talk-post .face-link[href$="0002"]'); if (f) f.click(); else setTimeout(go, 100); }; go(); return true;`), settled: "document.body.innerText.includes('Ana Reyes') && !document.querySelector('.project-page')", size: wide },
  'mac-face-nook': { ...desk('papers', '.project-paper', `document.querySelector('[data-paper^="${paper}"]').click(); const go = () => { const f = document.querySelector('.project-papers-panel .talk-post .face-link[href$="0002"]'); if (f) f.click(); else setTimeout(go, 100); }; go(); return true;`, '?shell=desktop'), settled: "document.body.innerText.includes('Ana Reyes') && !document.querySelector('.project-page')", size: wide },
  'mac-desk-papers': { ...desk('papers', '.project-paper', null, '?shell=desktop'), size: wide },
  'mac-desk-digs': { ...desk('digs', '.project-talk-item', null, '?shell=desktop'), size: wide },
  'mac-desk-paper': { ...desk('papers', '.project-papers-panel .talk-post', `document.querySelector('[data-paper^="${paper}"]').click(); return true;`, '?shell=desktop'), size: wide },
  'phone-desk': { ...desk('papers', '.project-paper', null, '?shell=web'), size: phone },
  // A dig opened under its row on a phone.
  'phone-digs': { ...desk('digs', '.project-talk-panel .talk-post', "const go = () => { const d = document.querySelector('.project-talk-item'); if (d) d.click(); else setTimeout(go, 100); }; go(); return true;", '?shell=web'), size: phone },
  nook: { path: '/?shell=web', ready: "document.querySelector('.nook .desk-title')", size: wide },
  // Someone else's nook, as a visitor sees it.
  'their-nook': { path: '/u/a1b2c3d4-0000-4000-8000-000000000002?shell=web', ready: "document.body.innerText.includes('Ana Reyes')", size: wide },
  'phone-their-nook': { path: '/u/a1b2c3d4-0000-4000-8000-000000000002?shell=web', ready: "document.body.innerText.includes('Ana Reyes')", size: phone },
  'mac-their-nook': { path: '/u/a1b2c3d4-0000-4000-8000-000000000002?shell=desktop', ready: "document.body.innerText.includes('Ana Reyes')", size: wide },
  'nook-add': { path: '/?shell=web', ready: "document.querySelector('.nook .desk-title')", then: "document.querySelector('.upload-section.is-trigger > button').click(); return true;", settled: "document.querySelector('.upload-menu')", size: wide },
  'nook-scrolled': { path: '/?shell=web', ready: "document.querySelector('.nook .desk-title')", then: "const body = document.querySelector('.desk-table tbody'); const rows = [...body.children]; for (let i = 0; i < 4; i += 1) rows.forEach((row) => body.append(row.cloneNode(true))); window.scrollTo(0, 700); return true;", size: { width: 1440, height: 560 } },
  // A paper's Effort in the nook, pressed: the time spent on it.
  'nook-effort': { path: '/?shell=web', ready: "document.querySelector('.desk-col-effort .nook-effort')", then: "document.querySelector('.desk-col-effort .nook-effort').click(); return true;", settled: "document.querySelector('.effort-pop-total')", size: wide },
  'nook-tag': { path: '/?shell=web', ready: "document.querySelector('.nook .desk-tag')", then: "[...document.querySelectorAll('.desk-tag')].find((b) => b.textContent === '#control').click(); return true;", settled: "document.querySelector('.desk-tag.is-on')", size: wide },
  'mac-nook': { path: '/?shell=desktop', ready: "document.querySelector('.desktop-row-title')", size: wide },
  'nook-board': { path: '/board/ad000000-0000-4000-8000-000000000001?shell=web', ready: "document.querySelector('.desk-board .board-jacket') && document.querySelector('.board-jacket-heading')", size: wide },
  'nook-project': { path: `/project/${PROJECT}?shell=web`, ready: "document.querySelector('.desk-project-view .project-tabs')", then: "document.getElementById('project-tab-papers').click(); return true;", settled: "document.querySelector('.desk-project-view .project-paper')", size: wide },
  'nook-project-rail': { path: `/project/${PROJECT}?shell=web`, ready: "document.querySelector('.desk-project-view .project-tabs')", then: "document.getElementById('project-tab-papers').click(); return true;", settled: "document.querySelector('.desk-project-view .project-paper')", pointer: [['move', '.desk-strip-mark']], size: wide },
  // A project picked from the opened rail, then the pointer gone: the rail
  // folds back.
  'nook-project-picked': { path: `/project/${PROJECT}?shell=web`, ready: "document.querySelector('.desk-project-view .project-tabs')", pointer: [['move', '.desk-strip-mark'], ['click', '.desk-project.is-on'], ['move', { x: 1000, y: 600 }]], settled: "document.querySelector('.desk-project-view .project-tabs')", size: wide },
  'nook-paper': { path: '/shelf/ab000000-0000-4000-8000-000000000001?shell=web', ready: "document.querySelector('.nook .desk-title')", then: "document.querySelector('.desk-title').click(); return true;", settled: "document.querySelector('.desk-paper-view .paper-jacket') && document.querySelector('.detail-title-row h2, .paper-way-head h2')", size: wide },
  'nook-board-paper': { path: '/board/ad000000-0000-4000-8000-000000000002?shell=web', ready: "document.querySelector('.board-jacket-papers a')", then: "document.querySelector('.board-jacket-papers a').click(); return true;", settled: "document.querySelector('.desk-paper-view .paper-jacket') && document.querySelector('.detail-title-row h2, .paper-way-head h2')", size: wide },
  // Everyone's projects in the Bazaar, one the member is not in.
  'bazaar-projects': { path: '/projects?shell=web', ready: "document.querySelector('.projects-row.closed')", size: wide },
  library: { path: '/bazaar?shell=web', ready: "document.body.innerText.includes('Pyramid wavefront')", size: wide },
  paper: { path: `/paper/${paper}?shell=web`, ready: "document.querySelector('.paper-jacket') && document.querySelector('.detail-title-row h2, .paper-way-head h2')", size: wide },
  // A paper's jacket down to the reader's own dig on it: written on the
  // survey, still to be written on the other.
  'paper-dig': { path: `/paper/${P_SURVEY.slice(0, 32)}?shell=web`, ready: "document.querySelector('.paper-dig .talk-post')", then: "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Got it')?.click(); document.querySelector('.paper-dig').scrollIntoView({ block: 'center' }); return true;", size: wide },
  'paper-dig-empty': { path: `/paper/${paper}?shell=web`, ready: "document.querySelector('.paper-dig .talk-unfold')", then: "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Got it')?.click(); document.querySelector('.paper-dig').scrollIntoView({ block: 'center' }); return true;", size: wide },
  'paper-dig-writing': { path: `/paper/${paper}?shell=web`, ready: "document.querySelector('.paper-dig .talk-unfold')", then: "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Got it')?.click(); document.querySelector('.paper-dig .talk-unfold').click(); document.querySelector('.paper-dig').scrollIntoView({ block: 'center' }); return true;", settled: "document.querySelector('.paper-dig .md-field')", size: wide },
  'phone-paper-dig': { path: `/paper/${P_SURVEY.slice(0, 32)}?shell=web`, ready: "document.querySelector('.paper-dig .talk-post')", then: "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Got it')?.click(); document.querySelector('.paper-dig').scrollIntoView({ block: 'center' }); return true;", size: phone },
  you: { path: '/profile?shell=web', ready: "document.querySelector('.you-page .activity-block')", size: wide },
  'you-inbox': { path: '/inbox?shell=web', ready: "document.querySelector('.you-page .notification-item')", size: wide },
  'you-account': { path: '/profile?shell=web', ready: "document.querySelector('.you-page .activity-block')", then: "document.getElementById('you-tab-account').click(); return true;", settled: "document.querySelector('.profile-page')", size: wide },
  'phone-you': { path: '/profile?shell=web', ready: "document.querySelector('.you-page .activity-block')", size: phone },
  // One notification opened in the inbox.
  'you-open': { path: '/inbox?shell=web', ready: "document.querySelector('.you-page .notification-item')", then: "return new Promise((done) => setTimeout(() => { const all = document.querySelectorAll('.notification-toggle'); all[all.length - 1].click(); done(true); }, 800));", settled: "document.querySelector('.notification-toggle[aria-expanded=true]')", size: wide },
  'mac-inbox': { path: '/inbox?shell=desktop', ready: "document.querySelector('.notification-item')", size: wide },
  // The nook while it waits: for the sign-in to be checked, then for its
  // papers.
  // A project opened before shows at once on coming back, while it is
  // asked for again; one never opened waits for it.
  'project-loading': { path: `/project/${PROJECT}?shell=web`, hold: [`/projects/${PROJECT}`], ready: "document.querySelector('.desk-project-view .loading, .desk-project-view .project-tabs')", size: wide },
  'project-return': { path: `/project/${PROJECT}?shell=web`, ready: "document.querySelector('.desk-project-view .project-tabs')", holdThen: [`/projects/${PROJECT}`], then: "setTimeout(() => location.reload(), 0); return true;", settled: "document.querySelector('.desk-project-view .project-paper')", size: wide },
  'nook-signing-in': { path: '/?shell=web', hold: ['/auth/me'], ready: "document.getElementById('root').childElementCount > 0", size: wide },
  // Back to the nook from elsewhere in the app: shown as it was left while
  // it is fetched again.
  'nook-return': { path: '/?shell=web', ready: "document.querySelector('.nook .desk-title')", holdThen: [`/users/${ME}/nook`], then: "document.querySelector('.way-aside a').click(); return new Promise((done) => setTimeout(() => { document.querySelector('.way-mark').click(); done(true); }, 1000));", settled: "document.querySelector('.nook .desk-title')", size: wide },
  'nook-loading': { path: '/?shell=web', hold: [`/users/${ME}/nook`], ready: "document.querySelector('.nook, .loading')", size: wide },
  // A PDF dropped on the window from inside a project: the nook's upload
  // takes it, its bar while it goes up, then the form.
  'drop-uploading': { path: `/project/${PROJECT}?shell=web`, ready: "document.querySelector('.desk-project-view .project-tabs')", holdThen: ['/files/upload-address'], then: DROP, settled: "document.querySelector('.nook-desk.is-reviewing .upload-going-up')", size: wide },
  'drop-form': { path: `/project/${PROJECT}?shell=web`, ready: "document.querySelector('.desk-project-view .project-tabs')", then: DROP, settled: "document.querySelector('.nook-desk.is-reviewing #upload-paper-title')?.value === 'Attention Is All You Need'", size: wide },
  // A PDF dropped in the viewer, arriving in the nook's upload after the
  // page load that brings the reader here.
  'drop-from-viewer': { path: '/?shell=web', ready: "document.querySelector('.nook .desk-title')", then: "return fetch('/scripts/fixtures/attention.pdf').then((r) => r.blob()).then((bytes) => import('/@fs' + " + JSON.stringify(new URL('../../shared/droppedPapers.js', import.meta.url).pathname) + ").then((kept) => kept.handOverDroppedPdfs([new File([bytes], 'attention.pdf', { type: 'application/pdf' })]))).then(() => { location.reload(); return true; });", settled: "document.querySelector('.nook-desk.is-reviewing #upload-paper-title')?.value === 'Attention Is All You Need'", size: wide },
  'phone-nook': { path: '/?shell=web', ready: "document.querySelector('.nook .desk-title')", size: phone },
  'phone-paper': { path: `/paper/${paper}?shell=web`, ready: "document.querySelector('.paper-jacket') && document.querySelector('.detail-title-row h2, .paper-way-head h2')", size: phone },
  // On a phone the brief opens under its row.
  'phone-paper': { ...desk('papers', '.project-paper-open .talk-post', `if (!document.querySelector('.project-paper-open')) document.querySelector('[data-paper^="${paper}"]').click(); return true;`, '?shell=web'), size: phone },
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
    held.clear();
    for (const path of shot.hold ?? []) held.add(path);
    await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 2, mobile: false, ...shot.size });
    // The Mac shell is remembered per tab, so a web shot says so.
    await browser.navigate(origin + shot.path);
    await browser.waitFor(shot.ready, { timeout: 40_000, what: `${name} to be ready` });
    for (const path of shot.holdThen ?? []) held.add(path);
    if (shot.then) { await browser.evaluate(shot.then); await new Promise((done) => setTimeout(done, 300)); }
    if (shot.settled) await browser.waitFor(shot.settled, { what: `${name} to settle` });
    // A real pointer: it moves to (or clicks) the middle of each selector in
    // turn, or moves to a point, waiting a little after each step.
    for (const [act, at] of shot.pointer ?? []) {
      const { x, y } = typeof at === 'string'
        ? await browser.evaluate(`const box = document.querySelector('${at}').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };`)
        : at;
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      if (act === 'click') {
        await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      }
      await new Promise((done) => setTimeout(done, 400));
    }
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
