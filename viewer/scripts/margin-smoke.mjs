import { Browser, checker } from '../../scripts/share-e2e/cdp.mjs';
import { PAPER, PROJECT, viewerServer } from './fixtures/projectViewer.mjs';

// A dig opened from the margin stands on a white card of its own, over the
// page when the window has no room past the faces. The Mac app's WebKit
// once left that card see-through: it hid the sheet with
// :has(.talk-card-body:empty) and never looked again once the words came,
// while the words inside showed. The card now says it is blank itself
// (data-blank), and this reads what the reader would see: a card that is
// shown, opaque white, over the page.
//
//   node scripts/margin-smoke.mjs
const server = await viewerServer();
const browser = new Browser();
const checks = checker(browser);
const { check } = checks;
try {
  await server.listen();
  await browser.start();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  // No room past the margin: the card opens over the page.
  await browser.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, mobile: false, width: 1100, height: 800 });
  await browser.navigate(`${origin}/viewer/?pdf=${PAPER}&project=${PROJECT}`);
  await browser.waitFor(`document.querySelector('.pdf-page[data-page="1"] canvas') && document.querySelectorAll('.dig-margin-face').length > 2`,
    { timeout: 60_000, what: 'the margin faces' });
  await browser.evaluate("document.querySelectorAll('.dig-margin-face')[2].click(); return true;");
  await browser.waitFor("document.querySelector('.dig-margin-card .talk-post')", { what: 'the dig to open' });
  // ResizeObserver placement is deliberately committed on the next animation
  // frame, outside the browser's resize-delivery phase. Wait for that frame's
  // stacking decision before checking what is under the pointer.
  await browser.waitFor(`
    (() => {
      const sheet = document.querySelector('.dig-margin-card .talk-card');
      if (!sheet) return false;
      const box = sheet.getBoundingClientRect();
      return sheet.contains(document.elementFromPoint(
        box.left + box.width / 2, box.top + box.height / 2
      ));
    })()
  `, { what: 'the opened dig to settle over its page' });
  const card = await browser.evaluate(`
    const shell = document.querySelector('.dig-margin-card');
    const sheet = shell.querySelector('.talk-card');
    const box = sheet.getBoundingClientRect();
    const page = shell.closest('.pdf-page').getBoundingClientRect();
    // What stands at the sheet's middle is the sheet, not the page.
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      shown: getComputedStyle(shell).visibility === 'visible' && getComputedStyle(sheet).visibility === 'visible',
      background: getComputedStyle(sheet).backgroundColor,
      blank: sheet.hasAttribute('data-blank'),
      overPage: box.left < page.right,
      onTop: sheet.contains(hit),
    };`);
  check('the opened dig is no longer marked blank', !card.blank);
  check('the card and its sheet are shown', card.shown, JSON.stringify(card));
  check('the sheet is opaque white', card.background === 'rgb(255, 255, 255)', card.background);
  check('the card stands over the page', card.overPage, JSON.stringify(card));
  check('the card is what the reader sees there', card.onTop, JSON.stringify(card));

  // A face pressed shows nothing until its dig is read: the sheet is
  // blank and hidden, and only then shown whole.
  const hidden = await browser.evaluate(`
    const sheet = document.createElement('section');
    sheet.className = 'talk-card is-inline is-conversation';
    sheet.dataset.blank = 'true';
    const shell = document.createElement('div');
    shell.className = 'dig-margin-card';
    shell.append(sheet);
    document.body.append(shell);
    const seen = getComputedStyle(sheet).visibility;
    shell.remove();
    return seen;`);
  check('a blank sheet stays hidden', hidden === 'hidden', hidden);
  // WebKit does not look at :has(… :empty) again when the thing fills, so
  // no rule may hang on it.
  const leaning = await browser.evaluate(`
    return [...document.styleSheets, ...document.adoptedStyleSheets].flatMap((sheet) => [...sheet.cssRules])
      .map((rule) => rule.selectorText || '').filter((s) => /:has\\([^)]*:empty/.test(s));`);
  check('no rule hides or shows by :has(:empty)', leaning.length === 0, leaning.join(' | '));
  await checks.settle();
} finally {
  await browser.stop();
  await server.close();
}
if (checks.failures) process.exit(1);
