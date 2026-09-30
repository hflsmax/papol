// The scenes record.mjs can play: a page to open, what to get ready before
// recording, and what the reader does on camera. Papers on papol.io open
// by their digest with no account (a lean link), so a scene about reading
// needs nothing but the paper's hash.

const viewer = (sha256) => `https://papol.io/viewer/?pdf=${sha256}`;

// Kinergy (UIST '22): two columns, figures across both.
const KINERGY = 'c53ab052ac8c441103ab98f6ec377e4cd03655f0bb5a2da0d57d4d202c52060b';

// Scroll the viewer until the element sits at `at` of the window's height.
const bringTo = (find, at) => `
  const el = (() => { ${find} })();
  const pages = document.querySelector('.pages');
  if (!el || !pages) return false;
  const view = pages.getBoundingClientRect();
  pages.scrollTop += el.getBoundingClientRect().top - view.top - pages.clientHeight * ${at};
  return true;`;

const pageLink = (page, label) => `return [...document.querySelectorAll('.pdf-page[data-page="${page}"] button.pdf-link')]
  .find((link) => link.getAttribute('aria-label') === ${JSON.stringify(label)});`;

const marker = (page, label) => `return [...document.querySelectorAll('.pdf-page[data-page="${page}"] .cite')]
  .find((cite) => cite.getAttribute('aria-label') === ${JSON.stringify(`Open reference ${label}`)});`;

// The pill a jump leaves at the bottom of the window.
const BACK = `return [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Back to page'));`;

// A visitor is offered signing in a moment after the paper opens; the
// offer keeps nothing, so it is closed here.
async function closeSignInOffer(stage) {
  await stage.waitFor('[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Not now")', { timeout: 8000 }).catch(() => {});
  await stage.evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Not now').forEach((b) => b.click()); return true;`);
  await stage.wait(400);
}

// A page of the frontend with a pretend server, from a smoke's fixture
// (frontend/scripts/fixtures/): started for the scene, closed after it.
async function folderPage() {
  const { folderServer } = await import('../../frontend/scripts/fixtures/folderPage.mjs');
  const server = await folderServer();
  await server.listen();
  return { origin: `http://127.0.0.1:${server.httpServer.address().port}`, close: () => server.close() };
}

async function activityPage() {
  const { activityServer } = await import('../../frontend/scripts/fixtures/activityPage.mjs');
  const server = await activityServer();
  await server.listen();
  return { origin: `http://127.0.0.1:${server.httpServer.address().port}`, close: () => server.close() };
}

const button = (text) => `return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)});`;

// The viewer over a pretend server (viewer/scripts/fixtures/projectViewer.mjs)
// showing a paper from disk: PAPOL_FIXTURE_PDF names it. Papers with named
// rules are PL papers kept outside the repository, so a rule scene reads its
// paper from there rather than from papol.io.
async function viewerPage() {
  if (!process.env.PAPOL_FIXTURE_PDF) throw new Error('Set PAPOL_FIXTURE_PDF to the paper to show');
  const { PAPER, viewerServer } = await import('../../viewer/scripts/fixtures/projectViewer.mjs');
  const server = await viewerServer();
  await server.listen();
  return { origin: `http://127.0.0.1:${server.httpServer.address().port}`, paper: PAPER, close: () => server.close() };
}

// The nth link to a named rule on a page, counted from the top.
const ruleLink = (page, rule, nth = 0) => `return [...document.querySelectorAll('.pdf-page[data-page="${page}"] .pdf-link')]
  .filter((link) => link.getAttribute('aria-label') === ${JSON.stringify(`Go to Rule ${rule}`)})[${nth}];`;

// What the telescoping scenes share: the paper at page 8, the name of
// T-Var near the top, the viewer's bar cropped away so rules read at the
// letter's width.
const telescoping = {
  viewport: { width: 1180, height: 760 },
  crop: { x: 130, y: 56, width: 940, height: 704 },
  seconds: 8,
  setup: viewerPage,
  url: ({ origin, paper }) => `${origin}/viewer/?pdf=${paper}&page=8`,
  async prepare(stage) {
    await stage.waitFor(`(() => { ${ruleLink(8, 'T-Var')} })()`, { timeout: 90_000 });
    await stage.evaluate(bringTo(ruleLink(8, 'T-Var'), 0.3));
    await stage.waitFor('document.fonts.ready.then(() => true)');
    await stage.wait(2500);
  },
};

export const SCENES = {
  // My activity: the week, then the month, by paper, then one day.
  'reading-log': {
    viewport: { width: 860, height: 760 },
    setup: activityPage,
    url: ({ origin }) => `${origin}/__activity_test`,
    async prepare(stage) {
      await stage.evaluate("localStorage.setItem('papol.activity.view', 'week'); localStorage.setItem('papol.activity.split', 'total'); return true;");
      await stage.waitFor("document.body.innerText.includes('My activity') && /reading \\d+ paper/.test(document.body.innerText)", { timeout: 60_000 });
      await stage.wait(1000);
    },
    async play(stage) {
      await stage.move({ x: 700, y: 700 }, { ms: 10 });
      await stage.wait(1400);
      await stage.click(button('Month'), { ms: 900 });
      await stage.wait(1800);
      await stage.click(button('By paper'), { ms: 800 });
      await stage.wait(2000);
      await stage.click(button('Week'), { ms: 800 });
      await stage.wait(1800);
      await stage.click(button('Day'), { ms: 700 });
      await stage.wait(2000);
    },
  },

  // An agent's folder dropped on the upload box: the review lists it in
  // the agent's order, with its notes, and one click adds the batch.
  'folder-drop': {
    viewport: { width: 1000, height: 720 },
    setup: folderPage,
    url: ({ origin }) => `${origin}/__folder_test?styled&flow&letter`,
    async prepare(stage) {
      await stage.waitFor("document.body.innerText.includes('Drop PDFs or a folder')", { timeout: 60_000 });
      await stage.wait(800);
    },
    async play(stage) {
      await stage.move({ x: 900, y: 600 }, { ms: 10 });
      await stage.wait(700);
      await stage.carry('Transformers review');
      await stage.move('.library-page', { ms: 1400 });
      await stage.wait(400);
      await stage.drop();
      await stage.evaluate('window.dropFolder(); return true;');
      await stage.move({ x: 960, y: 690 }, { ms: 600 });
      await stage.waitFor("document.body.innerText.includes('Already in your nook')", { timeout: 20_000 });
      await stage.wait(1400);
      await stage.evaluate('window.readingDone = true; return true;');
      await stage.waitFor("!/Reading(…|\\.\\.\\.)/.test(document.querySelector('.folder-import')?.innerText || 'Reading')", { timeout: 20_000 });
      await stage.wait(1800);
      await stage.click('.form-actions button.primary', { ms: 1100 });
      await stage.waitFor("document.body.innerText.includes('1 added')", { timeout: 20_000 });
      await stage.wait(2200);
    },
  },

  // A link to a figure in a two-column paper: the figure comes to the
  // middle of the window, zoomed to fill it, and Back returns.
  'link-navigation': {
    url: viewer(KINERGY),
    async prepare(stage) {
      await stage.waitFor('document.querySelectorAll(".pdf-page").length > 5', { timeout: 30_000 });
      await stage.wait(1500);
      await closeSignInOffer(stage);
      await stage.evaluate('document.querySelector(\'.pdf-page[data-page="7"]\').scrollIntoView(); return true;');
      await stage.waitFor(`(() => { ${pageLink(7, 'Go to Figure 7')} })()`, { timeout: 20_000 });
      await stage.evaluate(bringTo(pageLink(7, 'Go to Figure 7'), 0.55));
      await stage.wait(2500);
    },
    async play(stage) {
      await stage.wait(900);
      await stage.click(pageLink(7, 'Go to Figure 7'), { ms: 1100 });
      await stage.move({ x: 1180, y: 300 }, { ms: 900 });
      await stage.wait(2200);
      await stage.click(BACK, { ms: 1000 });
      await stage.move({ x: 1180, y: 520 }, { ms: 700 });
      await stage.wait(1800);
    },
  },

  // A work the paper cites seven times, on pages 2, 3 and 8: its card says so, and ↓ steps to
  // each place, across pages, while the card stays; [ returns.
  'reverse-citation': {
    url: viewer(KINERGY),
    async prepare(stage) {
      await stage.waitFor('document.querySelectorAll(".pdf-page").length > 5', { timeout: 30_000 });
      await stage.wait(1500);
      await closeSignInOffer(stage);
      await stage.evaluate('document.querySelector(\'.pdf-page[data-page="3"]\').scrollIntoView(); return true;');
      await stage.waitFor(`(() => { ${marker(3, '[47]')} })()`, { timeout: 20_000 });
      await stage.evaluate(bringTo(marker(3, '[47]'), 0.3));
      await stage.wait(2500);
    },
    async play(stage) {
      await stage.wait(800);
      await stage.click(marker(3, '[47]'), { ms: 1000 });
      await stage.waitFor('document.querySelector(".ref-card .ref-title")', { timeout: 15_000 });
      await stage.wait(1600);
      await stage.click('button[aria-label="Next place it is cited"]', { ms: 900 });
      await stage.wait(1500);
      await stage.key('ArrowDown');
      await stage.wait(1500);
      await stage.wait(1000);
      await stage.key('Escape');
      await stage.wait(900);
      await stage.key('[');
      await stage.wait(2000);
    },
  },

  // Telescoping, one scene per way in, on Internalizing Indistinguishability
  // with Dependent Types (POPL '24): page 8 cites the typing rules set on
  // page 7. Hover shows a rule under the line while the pointer rests on
  // its name.
  'telescoping-hover': {
    ...telescoping,
    async play(stage) {
      await stage.move({ x: 880, y: 640 }, { ms: 10 });
      await stage.wait(300);
      for (const rule of ['T-Var', 'T-Abs', 'T-App']) {
        await stage.move(ruleLink(8, rule, 1), { ms: 600 });
        await stage.waitFor('document.querySelector(".paper-clip.telescope canvas")', { timeout: 10_000 });
        await stage.wait(1500);
      }
      await stage.move({ x: 960, y: 640 }, { ms: 500 });
      await stage.wait(500);
    },
  },

  // A click goes to the rule's definition, [ comes back, ] goes there
  // again, and [ returns for good.
  'telescoping-click': {
    ...telescoping,
    async play(stage) {
      await stage.move({ x: 880, y: 640 }, { ms: 10 });
      await stage.wait(300);
      await stage.click(ruleLink(8, 'T-App'), { ms: 700 });
      await stage.wait(1700);
      await stage.key('[', { code: 'BracketLeft' });
      await stage.wait(1500);
      await stage.key(']', { code: 'BracketRight' });
      await stage.wait(1500);
      await stage.key('[', { code: 'BracketLeft' });
      await stage.wait(1600);
    },
  },

  // Cmd-click keeps a clip of each rule beside its name: T-Var, T-Abs and
  // T-App, cited together on one line. Each kept clip is dragged to its own
  // place under the line, left to right, so the three sit side by side.
  'telescoping-clip': {
    ...telescoping,
    async play(stage) {
      await stage.move({ x: 880, y: 640 }, { ms: 10 });
      await stage.wait(200);
      const places = [{ x: 330, y: 530 }, { x: 590, y: 530 }, { x: 850, y: 530 }];
      for (const [i, rule] of ['T-Var', 'T-Abs', 'T-App'].entries()) {
        await stage.click(ruleLink(8, rule, 1), { ms: 450, modifiers: 4 });
        await stage.waitFor(`document.querySelectorAll('.paper-clip:not(.telescope)').length === ${i + 1}`, { timeout: 10_000 });
        // The rule shown on hover sits over the kept clip while the pointer
        // is on the name: a nudge past the end of the name lets it go, and
        // the pointer goes from there down to the clip.
        await stage.move({ x: stage.at.x + 34, y: stage.at.y + 4 }, { ms: 150 });
        await stage.waitFor('!document.querySelector(".paper-clip.telescope")', { timeout: 10_000 });
        await stage.drag(`return [...document.querySelectorAll('.paper-clip:not(.telescope)')].at(-1);`, places[i], { ms: 450 });
      }
      await stage.move({ x: 960, y: 660 }, { ms: 400 });
      await stage.wait(1400);
    },
  },
};
