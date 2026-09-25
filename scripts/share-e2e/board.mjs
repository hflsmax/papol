// Pasting links onto a board on the web, against a real Worker.
//
//     node scripts/share-e2e/board.mjs
//
// A link pasted onto a board becomes a card, and what the card can show
// depends on what the link is and on who fetches its picture: a YouTube
// video's title and thumbnail the Cloudflare Worker reads from its page
// with linkpeek (cloudflare/src/linkPreview.ts); a web page's picture is a
// job the Cloudflare Worker runs in Browser Rendering
// (cloudflare/src/jobs/capture.ts); a Bilibili video's title and cover
// only the Mac app can fetch, so the web makes the card as the link.
// board/scripts/browser-smoke.mjs draws cards from a faked API; this
// pastes, and follows each card to where it ends.
//
// The Cloudflare Worker's own requests cannot be answered from here, so
// YouTube and example.com are the real ones — the checks here that need
// the network.
// `wrangler dev` runs Browser Rendering on a Chrome of its own (downloaded
// on first use); the page whose picture must fail is under `.invalid`, a
// name that never resolves (RFC 2606). What the page itself asks is
// watched: it must ask neither YouTube nor Bilibili.

import { randomBytes } from 'node:crypto';
import { Browser, checker } from './cdp.mjs';
import { account, BASE, call } from './papol.mjs';

const suffix = randomBytes(3).toString('hex');
const browser = new Browser({ headless: process.env.PAPOL_E2E_HEADED !== '1' });
const checks = checker(browser);
const { check } = checks;

const VIDEO_ID = 'dQw4w9WgXcQ';
const YOUTUBE = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
// What YouTube calls it, as its page's og:title says.
const VIDEO_TITLE = /Never Gonna Give You Up/;
const UNREACHABLE = `https://papol-e2e-${suffix}.invalid/`;
const REACHABLE = 'https://example.com/';
const BILIBILI = 'https://www.bilibili.com/video/BV1xx411c7mD';

// What reached YouTube's hosts and Bilibili's, as the page asked.
const asked = { youtube: [], bilibili: [] };

// A paste as the board hears it: on the window, from outside any field,
// with the link as the clipboard's text (BoardPage.jsx, handlePaste).
const paste = (text) => browser.evaluate(`
  const data = new DataTransfer();
  data.setData('text/plain', ${JSON.stringify(text)});
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  return true;`);

// The board's own answer, for what the canvas does not print.
const items = async (token, boardUuid) => (await call('GET', `/api/boards/${boardUuid}`, { token }))[1]?.items ?? [];
const itemFor = async (token, boardUuid, url) => (await items(token, boardUuid)).find((item) => item.source_url === url);

async function settledItem(token, boardUuid, url, { timeout = 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const item = await itemFor(token, boardUuid, url);
    if (item || Date.now() > deadline) return item ?? null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

// The card on the canvas for a board item, by its uuid.
const cardSelector = (uuid) => `article.board-canvas-card[data-item-uuid="${uuid}"]`;

try {
  const me = await account(`paster-${suffix}@papol.test`, 'Pat Paster');
  const [status, board] = await call('POST', '/api/boards', { token: me.token, body: { name: `Pasted links ${suffix}` } });
  if (status !== 200) throw new Error(`could not make a board: ${JSON.stringify(board)}`);

  await browser.start();
  await browser.signIn({ token: me.token, accountUuid: me.uuid, origin: BASE });

  const open = { 'access-control-allow-origin': '*' };
  await browser.intercept([
    {
      // The Cloudflare Worker reads YouTube; were the page to ask it, it
      // is refused here rather than sent.
      pattern: '*youtube*',
      match: (url) => /(^|\.)(youtube\.com|ytimg\.com|youtu\.be)$/.test(new URL(url).hostname),
      answer: (request) => {
        asked.youtube.push(request.url);
        return { status: 503, headers: open, body: '' };
      },
    },
    {
      // Nothing on the web may ask Bilibili; were it to, it is refused
      // here rather than sent.
      pattern: '*bilibili.com*',
      match: (url) => /bilibili\.com|b23\.tv|hdslb\.com/.test(new URL(url).hostname),
      answer: (request) => {
        asked.bilibili.push(request.url);
        return { status: 503, headers: open, body: '' };
      },
    },
  ]);

  await browser.navigate(`${BASE}/boards/${board.uuid}`);
  await browser.waitFor(`document.title.includes(${JSON.stringify(board.name)}) && document.querySelector('.board-viewport')`,
    { timeout: 30_000, what: 'the board to open' });
  // The paste listener is attached in an effect after the board renders.
  await browser.evaluate('return new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(true), 0)));');

  console.log('\n== A YouTube link ==');
  await paste(YOUTUBE);
  const videoLoading = await browser.waitFor(
    "[...document.querySelectorAll('.board-youtube-loading')].some((el) => el.textContent.includes('Loading video frame'))",
    { timeout: 5_000, what: 'the video placeholder' }).catch(() => false);
  check('a placeholder stands where the card will be', videoLoading);
  const video = await settledItem(me.token, board.uuid, YOUTUBE);
  check('the card is made', !!video);
  if (video) {
    check('as a YouTube card with the title and a thumbnail', video.kind === 'youtube' && VIDEO_TITLE.test(video.content) && !!video.sha256,
      JSON.stringify({ kind: video.kind, content: video.content, sha256: video.sha256 }));
    const shown = await browser.waitFor(
      `(() => { const el = document.querySelector(${JSON.stringify(cardSelector(video.uuid))});
        const img = el?.querySelector('img');
        return el && el.textContent.includes(${JSON.stringify(video.content)}) && img && img.complete && img.naturalWidth > 0; })()`,
      { timeout: 20_000, what: 'the video card drawn' }).catch(() => false);
    check('the canvas shows its title and its picture', shown);
  }
  check('and the page never asked YouTube', asked.youtube.length === 0, JSON.stringify(asked.youtube));

  console.log('\n== A page that cannot be reached ==');
  await paste(UNREACHABLE);
  const capturing = await browser.waitFor(
    "[...document.querySelectorAll('.board-youtube-loading')].some((el) => el.textContent.includes('Capturing webpage'))",
    { timeout: 5_000, what: 'the capture placeholder' }).catch(() => false);
  check('"Capturing webpage…" stands in for it at once', capturing);
  // The card is written with the request, before the capture is tried.
  const early = await settledItem(me.token, board.uuid, UNREACHABLE, { timeout: 5_000 });
  check('the card is on the board as soon as the paste is answered', !!early);
  const failed = await browser.waitFor(
    "document.querySelector('.board-canvas-error')?.textContent.includes('Could not capture the webpage')",
    { timeout: 90_000, what: 'the capture to fail' }).catch(() => false);
  check('the capture fails, and the board says why', failed,
    String(await browser.evaluate("return document.querySelector('.board-canvas-error')?.textContent ?? null;")));
  const link = await itemFor(me.token, board.uuid, UNREACHABLE);
  check('the card stays, as the link, with no picture', link?.kind === 'webpage' && !link.sha256 && link.content === new URL(UNREACHABLE).hostname,
    JSON.stringify(link && { kind: link.kind, content: link.content, sha256: link.sha256 }));
  if (link) {
    const drawn = await browser.waitFor(
      `document.querySelector(${JSON.stringify(cardSelector(link.uuid))})?.querySelector('.board-link-placeholder')`,
      { timeout: 10_000, what: 'the link card drawn' }).catch(() => false);
    check('and the canvas draws it as a link', drawn);
    // Nothing was offline: the web's capture failed, and the card says only
    // that it has no picture (the Mac's wording is for a page kept offline).
    const label = await browser.evaluate(
      `return document.querySelector(${JSON.stringify(cardSelector(link.uuid))})?.querySelector('.board-link-placeholder')?.textContent ?? null;`);
    check('saying it has no picture, not that it was saved offline',
      /No picture of this page/.test(label || '') && !/offline/i.test(label || ''), String(label));
  }

  console.log('\n== A page that can be ==');
  await paste(REACHABLE);
  const page = await browser.waitFor(
    `![...document.querySelectorAll('.board-youtube-loading')].some((el) => el.textContent.includes('Capturing webpage'))
      && [...document.querySelectorAll('article.board-canvas-card.webpage img')].some((img) => img.complete && img.naturalWidth > 0)`,
    { timeout: 90_000, what: 'the page picture' }).catch(() => false);
  const captured = await itemFor(me.token, board.uuid, REACHABLE);
  check('its picture is taken and put on the card', page && !!captured?.sha256,
    JSON.stringify(captured && { sha256: captured.sha256, mime: captured.mime_type }));

  console.log('\n== A Bilibili link ==');
  await paste(BILIBILI);
  const bili = await settledItem(me.token, board.uuid, BILIBILI);
  check('the card is made at once, as the link', bili?.kind === 'bilibili' && !bili.sha256 && bili.content === BILIBILI,
    JSON.stringify(bili && { kind: bili.kind, content: bili.content, sha256: bili.sha256 }));
  if (bili) {
    const drawn = await browser.waitFor(
      `document.querySelector(${JSON.stringify(cardSelector(bili.uuid))})?.querySelector('.board-link-placeholder')?.textContent.includes('Bilibili video')`,
      { timeout: 10_000, what: 'the Bilibili card drawn' }).catch(() => false);
    check('the canvas draws it as a Bilibili video, with no picture', drawn);
  }
  check('and the web never asked Bilibili', asked.bilibili.length === 0, JSON.stringify(asked.bilibili));
} catch (error) {
  console.log('\nHARNESS ERROR:', error.message);
  check('the run itself', false, error.message);
} finally {
  await checks.settle();
  await browser.stop();
}

const { failures } = checks;
console.log(`\n${'='.repeat(56)}`);
console.log(failures ? `${failures} FAILED` : 'All board checks passed.');
process.exit(failures ? 1 : 0);
