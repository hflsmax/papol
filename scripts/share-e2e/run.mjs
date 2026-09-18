// Sharing, driven through the interface a user actually uses.
//
//     python3 scripts/share-e2e/seed.py && node scripts/share-e2e/run.mjs
//
// The backend suite already states what a link means. This says that a
// visitor holding one sees it: the attribution, the annotations, the offer of the
// paper — and, for a lean link, none of the annotations. That half had no coverage
// at all, in either surface.

import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Browser } from './cdp.mjs';

const FIXTURE = process.env.PAPOL_E2E_FIXTURE || join(tmpdir(), 'papol-share-e2e.json');
let fx;
try {
  fx = JSON.parse(readFileSync(FIXTURE));
} catch {
  console.error(`No fixture at ${FIXTURE}. Run scripts/share-e2e/seed.py first.`);
  process.exit(2);
}

const NOTE = fx.note.slice(0, 30);
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  [${ok ? 'ok  ' : 'FAIL'}] ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures += 1;
};
const api = (path, token, options = {}) => fetch(`${fx.base}/api${path}`, {
  ...options,
  headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
});

const browser = new Browser({ headless: process.env.PAPOL_E2E_HEADED !== '1' });

// `.viewer-bar` is the chrome and appears before the shared reading has been
// fetched, so waiting on it snapshots a half-built page — and every negative
// assertion below would then pass for the wrong reason. The paper's name
// reaching the document title is what says the reading itself arrived.
const viewerReady = async () => {
  await browser.waitFor(
    `document.title.includes(${JSON.stringify(fx.title.slice(0, 20))})`,
    { timeout: 30_000, what: 'the shared reading to load' });
  await new Promise((r) => setTimeout(r, 1200));
};

const snapshot = () => browser.evaluate(`
  const note = ${JSON.stringify(NOTE)};
  return {
    title: document.title,
    attribution: document.querySelector('.shared-reading')?.textContent?.trim() ?? null,
    annotationsInDom: document.documentElement.innerHTML.includes(note),
    bar: !!document.querySelector('.viewer-bar'),
    tools: !!(document.querySelector('[aria-label="Clipper"]')
      && document.querySelector('[aria-label="Brush"]')),
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean),
    signInWall: /sign in to papol|please sign in/i.test(document.body.innerText),
  };`);

const clickText = (text) => browser.evaluate(`
  const hit = [...document.querySelectorAll('button, a')].find(e => e.textContent.trim() === ${JSON.stringify(text)});
  if (!hit) return false;
  hit.click();
  return true;`);

// The SPA answers any path it does not recognize with the page itself,
// status 200 — so a request built badly (an empty name, a route that moved)
// comes back as HTML and dies later, in a JSON parser, with the URL nowhere
// in the message. Watch the wire instead: nothing under /api/ ever answers
// with HTML, and one that does names the request that was wrong.
const htmlFromApi = [];

try {
  await browser.start();
  await browser.send('Network.enable');
  browser.listeners.push((message) => {
    if (message.method !== 'Network.responseReceived') return;
    const { url, mimeType } = message.params.response;
    if (url.includes('/api/') && mimeType === 'text/html') htmlFromApi.push(url);
  });

  console.log('\n== A visitor with no account follows a rich link ==');
  await browser.navigate(fx.rich_url);
  await viewerReady();
  let s = await snapshot();
  check('the viewer opens with no sign-in wall', !s.signInWall);
  check('the paper is named', s.title.includes(fx.title.slice(0, 20)), s.title);
  check('it says whose reading this is', (s.attribution || '').includes(fx.sharer.name),
    String(s.attribution));
  check("the sharer's annotations came across", s.annotationsInDom);
  check('the whole tool bar is there', s.bar && s.tools);
  check('the paper is offered', s.buttons.includes('Add to nook'),
    JSON.stringify(s.buttons.slice(0, 12)));

  console.log('\n== The same visitor follows a lean link ==');
  await browser.navigate(fx.lean_url);
  await viewerReady();
  s = await snapshot();
  check('it opens just the same', s.bar);
  check('it names nobody', s.attribution === null, String(s.attribution));
  check('and carries none of the annotations', !s.annotationsInDom, 'a lean link leaked the note');
  check('the paper is still offered', s.buttons.includes('Add to nook'));

  console.log('\n== A signed-in user takes the shared paper ==');
  const before = await (await api(`/shared/${fx.rich}/nook`, fx.user.token)).json();
  check('the user has not got it yet', before === null, JSON.stringify(before));
  await browser.signIn({ token: fx.user.token, accountUuid: fx.user.uuid, origin: fx.base });
  await browser.navigate(fx.rich_url);
  await viewerReady();
  check('"Add to nook" is pressed', await clickText('Add to nook'));
  let added = null;
  for (let i = 0; i < 40 && !added; i += 1) {
    added = await (await api(`/shared/${fx.rich}/nook`, fx.user.token)).json();
    if (!added) await new Promise((r) => setTimeout(r, 500));
  }
  check('the paper lands in their nook', !!added, 'no copy within 20s');
  if (added) {
    check('it is the same paper', added.sha256 === fx.paper_sha256);
    const annotations = await (await api(`/papers/${fx.paper_name}/annotations`, fx.user.token)).json();
    check("their copy carries none of the sharer's annotations",
      Array.isArray(annotations) && annotations.length === 0, `${annotations?.length} came across`);
    await browser.navigate(fx.rich_url);
    await viewerReady();
    s = await snapshot();
    check('the link stops offering what they now have', !s.buttons.includes('Add to nook'),
      JSON.stringify(s.buttons.slice(0, 12)));
  }

  console.log("\n== The sharer reads their own paper ==");
  await browser.signIn({ token: fx.sharer.token, accountUuid: fx.sharer.uuid, origin: fx.base });
  await browser.navigate(fx.nook_url);
  await viewerReady();
  const nook = await browser.evaluate(`return {
    errorBar: document.querySelector('.error-bar, .error')?.textContent?.trim() ?? null,
    clip: !!document.querySelector('.paper-clip'),
  };`);
  check('nothing is wrong on the page', nook.errorBar === null, String(nook.errorBar));
  check('the clip on it is drawn', nook.clip);

  console.log("\n== The sharer's own Share menu ==");
  await browser.signIn({ token: fx.sharer.token, accountUuid: fx.sharer.uuid, origin: fx.base });
  await browser.navigate(`${fx.base}/paper/${fx.paper_name}`);
  await browser.waitFor("document.body.innerText.includes('Share')",
    { timeout: 25_000, what: 'the paper page' });
  const opened = await browser.evaluate(`
    const hit = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Share'));
    if (!hit) return false;
    hit.click();
    return true;`);
  check('the Share menu opens', opened);
  if (opened) {
    await new Promise((r) => setTimeout(r, 800));
    const menu = await browser.evaluate(`
      const field = document.querySelector('#menu-share-url');
      return {
        link: field ? field.value : null,
        copy: [...document.querySelectorAll('.share-menu button')].map(b => b.textContent.trim()),
      };`);
    check('it shows the live link', (menu.link || '').includes(fx.rich), String(menu.link));
    check('with a way to copy it', menu.copy.some((b) => /copy/i.test(b)), JSON.stringify(menu.copy));
  }

  console.log('\n== The wire ==');
  check('no /api request was answered with HTML', htmlFromApi.length === 0,
    htmlFromApi.slice(0, 3).join('  '));
} catch (error) {
  console.log('\nHARNESS ERROR:', error.message);
  failures += 1;
} finally {
  await browser.stop();
}

console.log(`\n${'='.repeat(56)}`);
console.log(failures ? `${failures} FAILED` : 'All browser checks passed.');
process.exit(failures ? 1 : 0);
