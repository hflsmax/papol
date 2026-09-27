// The release checklist's viewer step, automated: open a shared reading of
// a real PDF, click a citation marker, and fail unless the reference card
// fills with the resolved work; then click a link to a figure, and fail
// unless the viewer zoomed until the figure fills the window, in its middle. The unit tests state what the source layer
// answers; nothing else watches a user actually click "[1]" and get an
// answer, and that is the click Papol exists for.
//
// The API is served by this script from the shapes the backend declares, so
// the check is hermetic: no backend, no network. The PDFs are read by the
// analyzer's rules in the viewer itself, as every paper is, so what it
// proves is the viewer's whole reading — markers found on the page, a click
// turned into a lookup, the answer rendered — which is what a release can
// break silently.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { distFile, runSmoke } from '../../scripts/smoke-harness.mjs';

const dist = resolve(process.env.PAPOL_SMOKE_DIST || 'dist');

// Letter-sized pages, one content stream each, built here: the check must
// run from a bare checkout, on CI as on a laptop, and a fixture nobody can
// read is a fixture nobody maintains. The offsets are computed, not
// guessed, because pdf.js follows the xref table to every object.
function smokePdf(contents) {
  const pageNumbers = contents.map((_, index) => 3 + index);
  const streams = contents.map((_, index) => 4 + contents.length + index);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${contents.length} >>`,
    ...contents.map((_, index) => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + `/Resources << /Font << /F1 ${3 + contents.length} 0 R >> >> /Contents ${streams[index]} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...contents.map((content) => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// What the rules need to believe a page is a paper's: prose to learn its
// text from, three entries under a References heading, and three markers
// at least of the one way the paper cites (analyzer/src/rules).
const PROSE = [
  'Smoke rises from every fire that burns in the open air, and it carries',
  'with it the fine particles that the flame could not consume. It drifts',
  'with the wind, settles in low places, and thins as it climbs above the',
  'ground. Those who study it measure how far it travels and how long it',
  'lingers, and they compare what they find with what others have seen.',
];
const prose = (count) => Array.from({ length: count }, (_, i) => PROSE[i % PROSE.length]);
// Lines down a page from `from`, 11pt on a 14pt leading; a [text, size]
// is set larger, with room around it, as a heading is.
function page(lines, from = 720) {
  let y = from;
  return lines.map((line) => {
    const [text, size] = Array.isArray(line) ? line : [line, 11];
    if (size > 11) y -= 8;
    const op = `BT /F1 ${size} Tf 72 ${y} Td (${text}) Tj ET`;
    y -= size + 3 + (size > 11 ? 6 : 0);
    return op;
  }).join('\n');
}
const REFERENCES = [
  ['References', 12],
  '[1] A. Author. The Cited Work. Journal of Smoke, 2020.',
  '[2] B. Author. Another Work on Smoke. Journal of Smoke, 2021.',
  '[3] C. Author. A Third Work on Smoke. Journal of Smoke, 2022.',
];

const pdfBytes = smokePdf([page([
  ['A paper worth citing', 16], ...prose(5),
  'What is known of smoke begins with the work of others [1], who first', ...prose(10),
  'measured it in the open, and with those who followed them [2, 3] since.', ...prose(6),
  'The latest of them [3] asks where it goes once the fire is out.', ...prose(6),
  ...REFERENCES,
])]);
const PDF_SHA256 = createHash('sha256').update(pdfBytes).digest('hex');

const SHARE = 'Aa11Bb22Cc';
const REFERENCE = '11112222-3333-4444-8555-666677778888';
const reference = {
  uuid: REFERENCE,
  key: 'b0',
  index: 0,
  raw: 'A. Author. The Cited Work. Journal of Smoke, 2020.',
  title: 'The Cited Work',
  year: 2020,
  page: 1,
  y: 0.8,
};
const shared = {
  uuid: SHARE,
  kind: 'rich',
  user: { uuid: '99998888-7777-4666-8555-444433332222', display_name: 'Smoke Sharer' },
  paper: {
    title: 'The Smoke Paper',
    authors: '["Ada Lovelace"]',
    journal: 'Journal of Smoke',
    year: 2026,
    doi: null,
    file_path: 'smoke.pdf',
    sha256: PDF_SHA256,
  },
  annotations: [],
  created_at: '2026-01-02T03:04:05',
};
const resolved = {
  ...reference,
  resolved_status: 'ok',
  resolution: {
    title: 'The Cited Work',
    authors: ['A. Author'],
    year: 2020,
    venue: 'Journal of Smoke',
    abstract: 'What the citation turned out to be.',
    citations: 12,
    url: 'https://example.org/cited-work',
  },
};

// A second paper: page 1 mentions Figure 2, a figure in the text of page 2
// — a box drawn, and its caption under it. The float is the two together,
// as the rules find it: FIGURE is where the viewer should bring it.
const DRAWN = { x: 0.15, y: 0.55, w: 0.5, h: 0.15 };
const FIGURE = { x: 0.147, y: 0.547, w: 0.507, h: 0.175 };
const figurePdf = smokePdf([
  page(['As Figure 2 shows, the latch holds against the pressure of the smoke,', ...prose(40)]),
  page(prose(16))
    + `\n0.2 G 2 w ${612 * DRAWN.x} ${792 * (1 - DRAWN.y - DRAWN.h)} ${612 * DRAWN.w} ${792 * DRAWN.h} re S `
    + `BT /F1 9 Tf ${612 * DRAWN.x} ${792 * (1 - DRAWN.y - DRAWN.h) - 14} Td (Figure 2: A latch.) Tj ET\n`
    + page(prose(12), 792 * (1 - DRAWN.y - DRAWN.h) - 40),
]);
const FIGURE_SHA256 = createHash('sha256').update(figurePdf).digest('hex');
const FIGURE_SHARE = 'Dd33Ee44Ff';
const figureShared = {
  ...shared,
  uuid: FIGURE_SHARE,
  paper: { ...shared.paper, title: 'The Figure Paper', file_path: 'figure.pdf', sha256: FIGURE_SHA256 },
};
// A third: four pages citing the one work on pages 1, 3 and 4, for stepping
// through the places it is cited from its card.
const citedPdf = smokePdf([1, 2, 3, 4].map((n) => page([
  ...prose(n === 2 ? 4 : 3),
  ...(n === 2 ? [] : [`Page ${n} of the citing paper returns to the one work it cites [1], and`]),
  ...prose(6),
  ...(n === 4 ? REFERENCES : []),
])));
const CITED_SHA256 = createHash('sha256').update(citedPdf).digest('hex');
const CITED_SHARE = 'Gg55Hh66Jj';
const citedShared = {
  ...shared,
  uuid: CITED_SHARE,
  paper: { ...shared.paper, title: 'The Citing Paper', file_path: 'cited.pdf', sha256: CITED_SHA256 },
};
// A link its sharer took back: the Worker's 404, which the viewer must say
// in place of a PDF. Every hook the viewer calls has to stand above the
// return that says it, or React throws and the boundary's panel stands
// there instead — which is how a revoked link once read as a crash.
const REVOKED_SHARE = 'Kk77Mm88Nn';

const json = (body) => ({ type: 'application/json', body: JSON.stringify(body) });

// Wait for a citation marker, click it, and wait for the card to show the
// resolved title. A boundary panel standing where the viewer should be is
// its own answer. Inside a layout iframe (smoke=inner) the probe stays
// quiet: the app runs untouched while the harness page measures it.
const probe = `<script>
  (() => {
    if (new URLSearchParams(location.search).get('smoke') === 'inner') return;
    if (new URLSearchParams(location.search).get('share') === '${FIGURE_SHARE}') return followFigure();
    if (new URLSearchParams(location.search).get('share') === '${CITED_SHARE}') return explorePlaces();
    if (new URLSearchParams(location.search).get('share') === '${REVOKED_SHARE}') return sayTakenBack();
    let clicked = false;
    const ready = () => {
      if (document.querySelector('.render-error')) {
        fetch('/__papol_smoke_ready?page=render-error', { method: 'POST' });
        return;
      }
      const marker = document.querySelector('.cite');
      if (marker && !clicked) {
        clicked = true;
        marker.click();
      }
      const title = document.querySelector('.ref-card .ref-title');
      if (title && title.textContent.includes('The Cited Work')) {
        search();
        return;
      }
      setTimeout(ready, 25);
    };
    // Then search, as a reader does: ⌘F, a phrase, and a highlight on the
    // page. Search runs on pdf.js's find controller, loaded on first use,
    // so this is what proves that module loads and its matches land on the
    // words.
    let typed = false;
    const search = () => {
      const input = document.querySelector('.search-pop input');
      if (!input) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, ctrlKey: true, bubbles: true }));
      } else if (!typed) {
        typed = true;
        // React owns the field's value: set it the way typing would.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'worth citing');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const count = document.querySelector('.search-count');
      if (document.querySelector('.search-highlight') && count && count.textContent.includes('1 / 1')) {
        fetch('/__papol_smoke_ready?page=viewer-citation', { method: 'POST' });
        return;
      }
      setTimeout(search, 25);
    };
    ready();

    // Click the link to Figure 2, and hold the viewer to what it promises:
    // the whole figure in the window, filling it in one direction, its
    // middle at the window's middle across and down — or, where the figure
    // sits nearer a page's edge than half the window, the page scrolled as
    // far as it goes that way. This figure is: its right edge is a tenth of
    // the page from the page's.
    // Step through the places the paper cites the work, from its card.
    // Each step is a stage that waits for what it expects; the first one to
    // time out names itself, so a failure says where it broke.
    function explorePlaces() {
      const $ = (selector) => document.querySelector(selector);
      const pages = () => $('.pages');
      const text = (selector) => $(selector)?.textContent || '';
      const press = (key, code = key) => document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key, code, bubbles: true }),
      );
      const step = (direction) => $('.ref-places-nav button[aria-label="' + (direction > 0 ? 'Next' : 'Previous') + ' place it is cited"]').click();
      const openFirst = () => $('.pdf-page[data-page="1"] .cite')?.click();
      const near = (a, b) => Math.abs(a - b) < 3;
      const pill = () => text('.link-return');
      // A step's card is shown once its marker is drawn; the next step waits for it.
      const shown = () => $('.ref-card') && $('.ref-card').style.visibility !== 'hidden';
      let start = null;
      let card = null;
      let stayed = null;
      const stages = [
        ['open', openFirst, () => text('.ref-places-what') === 'Cited 3 times in this paper'],
        // Round and back to where it began went nowhere: no way back offered.
        ['round', () => { start = pages().scrollTop; step(1); }, () => text('.ref-places-what').includes('2 of 3') && shown()],
        ['round-back', () => step(-1), () => text('.ref-places-what').includes('1 of 3 · page 1') && near(pages().scrollTop, start) && shown()],
        ['round-close', () => press('Escape'), () => !$('.ref-card') && !$('.viewer-body.exploring') && !pill()],
        // Down: the next marker comes to the card, and the card stays put.
        ['reopen', openFirst, () => $('.ref-card') && text('.ref-places-what').startsWith('Cited')],
        ['down', () => {
          start = pages().scrollTop;
          const r = $('.ref-card').getBoundingClientRect();
          card = { top: r.top, left: r.left };
          step(1);
        }, () => {
          const r = $('.ref-card')?.getBoundingClientRect();
          return text('.ref-places-what') === 'Exploring 2 of 3 · page 3'
            && $('.pdf-page[data-page="3"] .cite-occurrence')
            && $('.ref-card').style.visibility !== 'hidden'
            && near(r.top, card.top) && near(r.left, card.left)
            && $('.viewer-body.exploring')
            && pill().includes('Back to page 1')
            // The strip teaches [; no lesson may sit over the step buttons.
            && !$('.learn-papol');
        }],
        ['down-again', () => step(1), () => text('.ref-places-what') === 'Exploring 3 of 3 · page 4' && shown()],
        ['wrap', () => step(1), () => text('.ref-places-what') === 'Exploring 1 of 3 · page 1' && shown()],
        ['to-page-3', () => step(1), () => text('.ref-places-what') === 'Exploring 2 of 3 · page 3' && shown()],
        // While exploring, ↓ and ↑ step as the buttons do.
        ['arrow-down', () => press('ArrowDown'), () => text('.ref-places-what') === 'Exploring 3 of 3 · page 4' && shown()],
        ['arrow-up', () => press('ArrowUp'), () => text('.ref-places-what') === 'Exploring 2 of 3 · page 3' && shown()],
        // Esc stays where the exploration got to; [ goes back, ] returns.
        ['escape', () => { stayed = pages().scrollTop; press('Escape'); },
          () => !$('.ref-card') && !$('.viewer-body.exploring') && near(pages().scrollTop, stayed) && pill().includes('page 1')],
        ['back', () => press('[', 'BracketLeft'), () => near(pages().scrollTop, start)],
        ['forward', () => press(']', 'BracketRight'), () => near(pages().scrollTop, stayed)],
        ['home', () => press('[', 'BracketLeft'), () => near(pages().scrollTop, start)],
        // Up from the first comes round to the last; a press on the page
        // puts the card away and stays there too.
        ['up', () => { openFirst(); setTimeout(() => step(-1), 100); }, () => text('.ref-places-what') === 'Exploring 3 of 3 · page 4' && shown()],
        ['click-away', () => {
          stayed = pages().scrollTop;
          $('.pdf-page[data-page="4"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        }, () => !$('.ref-card') && !$('.viewer-body.exploring') && near(pages().scrollTop, stayed) && pill().includes('page 1')],
        ['back-again', () => press('[', 'BracketLeft'), () => near(pages().scrollTop, start)],
        // The card's own Back does what [ does: to where it began, card away.
        ['explore-again', () => { openFirst(); setTimeout(() => step(1), 100); },
          () => text('.ref-places-what') === 'Exploring 2 of 3 · page 3' && shown() && $('.ref-places-home')],
        ['card-back', () => $('.ref-places-home').click(),
          () => !$('.ref-card') && !$('.viewer-body.exploring') && near(pages().scrollTop, start)],
      ];
      let stage = 0;
      let acted = false;
      let since = Date.now();
      const run = () => {
        const [name, act, done] = stages[stage];
        // A stage that clicks the marker waits for page 1 to draw it.
        if (!acted && (!['open', 'reopen', 'up', 'explore-again'].includes(name) || $('.pdf-page[data-page="1"] .cite'))) {
          act();
          acted = true;
        }
        if (acted && done()) {
          stage += 1;
          acted = false;
          since = Date.now();
          if (stage === stages.length) {
            fetch('/__papol_smoke_ready?page=viewer-places', { method: 'POST' });
            return;
          }
        } else if (Date.now() - since > 8000) {
          fetch('/__papol_smoke_ready?page=places-stuck-at-' + name, { method: 'POST' });
          return;
        }
        setTimeout(run, 50);
      };
      run();
    }

    function sayTakenBack() {
      const started = Date.now();
      const check = () => {
        const notice = document.querySelector('.viewer-notice h1');
        if (notice && notice.textContent.includes('no longer shared')) {
          fetch('/__papol_smoke_ready?page=viewer-taken-back', { method: 'POST' });
          return;
        }
        if (document.querySelector('.render-error') || Date.now() - started > 15000) {
          fetch('/__papol_smoke_ready?page=' + (document.querySelector('.render-error') ? 'taken-back-crashed' : 'taken-back-silent'), { method: 'POST' });
          return;
        }
        setTimeout(check, 50);
      };
      check();
    }

    function followFigure() {
      let clicked = false;
      let last = 'no-link';
      const started = Date.now();
      const check = () => {
        const link = document.querySelector('.pdf-page[data-page="1"] .pdf-link');
        const page = document.querySelector('.pdf-page[data-page="2"]');
        const pages = document.querySelector('.pages');
        if (link && !clicked) {
          clicked = true;
          link.click();
        }
        if (clicked && page && pages) {
          const p = page.getBoundingClientRect();
          const view = pages.getBoundingClientRect();
          const f = {
            left: p.left + ${FIGURE.x} * p.width, top: p.top + ${FIGURE.y} * p.height,
            width: ${FIGURE.w} * p.width, height: ${FIGURE.h} * p.height,
          };
          const room = { width: pages.clientWidth - 48, height: pages.clientHeight - 48 };
          const inside = f.left >= view.left && f.left + f.width <= view.left + pages.clientWidth
            && f.top >= view.top && f.top + f.height <= view.top + pages.clientHeight;
          const fills = f.width >= room.width * 0.85 || f.height >= room.height * 0.8;
          const across = Math.abs(f.left + f.width / 2 - (view.left + pages.clientWidth / 2));
          const down = Math.abs(f.top + f.height / 2 - (view.top + pages.clientHeight / 2));
          const most = { x: pages.scrollWidth - pages.clientWidth, y: pages.scrollHeight - pages.clientHeight };
          const held = (at, limit) => at <= 1 || at >= limit - 1;
          const centred = (across < 4 || held(pages.scrollLeft, most.x)) && (down < 4 || held(pages.scrollTop, most.y));
          last = 'float.' + [inside ? 'in' : 'out', fills ? 'fills' : 'small', 'x' + Math.round(across), 'y' + Math.round(down)].join('.');
          if (inside && fills && centred) {
            fetch('/__papol_smoke_ready?page=viewer-float', { method: 'POST' });
            return;
          }
        }
        if (Date.now() - started > 15000) {
          fetch('/__papol_smoke_ready?page=' + last, { method: 'POST' });
          return;
        }
        setTimeout(check, 50);
      };
      check();
    }
  })();
</script>`;

// The layout page: the real viewer, rendered inside iframes at the exact
// widths the stylesheet answers differently — the narrowest phone, the
// 560px phone rule, both sides of the 860px rail breakpoint, and a wide
// desktop — and measured from inside. Headless Chromium will not open a
// window narrower than about 500px, and a hand-mirrored fixture DOM
// drifts with every restyle; an iframe is a viewport of any width around
// the viewer as it ships. What a stylesheet change can silently break at
// a width nobody was looking at: the window must not be the scroller
// (.pages is — every jump in the viewer scrolls it, so a scrolling
// document turns anchors into no-ops), nothing may overflow sideways,
// and the bar has to hold its contents.
const layoutPage = (share) => `<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>viewer layout sweep</title></head><body>
<script>
  (async () => {
    const sizes = [[320, 568], [560, 700], [860, 900], [861, 900], [1920, 1080]];
    const broken = [];
    for (const [width, height] of sizes) {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'display:block;border:0;width:' + width + 'px;height:' + height + 'px';
      frame.src = '/papol/viewer/?share=${share}&smoke=inner';
      document.body.append(frame);
      await new Promise((done) => {
        const settled = () => frame.contentDocument?.querySelector('.pdf-page canvas')
          ? done() : setTimeout(settled, 25);
        settled();
      });
      const doc = frame.contentDocument;
      const de = doc.documentElement;
      const pages = doc.querySelector('.pages');
      const bar = doc.querySelector('.viewer-bar');
      for (const [what, bad] of [
        ['document-scrolls', de.scrollHeight > de.clientHeight],
        ['document-scrolls-sideways', de.scrollWidth > de.clientWidth],
        ['pages-not-the-scroller',
          !['auto', 'scroll'].includes(getComputedStyle(pages).overflowY)],
        ['bar-overflows', bar.scrollWidth > bar.clientWidth],
      ]) if (bad) broken.push(width + 'px-' + what);
      frame.remove();
    }
    fetch('/__papol_smoke_ready?page=' + (broken.length
      ? 'layout-broken.' + broken.join('.')
      : 'viewer-layout'), { method: 'POST' });
  })();
</script></body></html>`;

await runSmoke(
  [
    { path: `/papol/viewer/?share=${SHARE}`, page: 'viewer-citation' },
    { path: `/papol/viewer/?share=${FIGURE_SHARE}`, page: 'viewer-float' },
    { path: `/papol/viewer/?share=${CITED_SHARE}`, page: 'viewer-places' },
    { path: `/papol/viewer/?share=${REVOKED_SHARE}`, page: 'viewer-taken-back' },
    { path: '/papol/viewer/__layout', page: 'viewer-layout' },
  ],
  async (url) => {
    const { pathname } = url;
    if (pathname === '/papol/viewer/__layout') {
      return { type: 'text/html; charset=utf-8', body: layoutPage(SHARE) };
    }
    if (pathname === `/papol/api/shared/${SHARE}`) return json(shared);
    if (pathname === `/papol/api/shared/${FIGURE_SHARE}`) return json(figureShared);
    if (pathname === `/papol/api/shared/${CITED_SHARE}`) return json(citedShared);
    if (pathname === `/papol/api/shared/${REVOKED_SHARE}`) {
      return { status: 404, ...json({ detail: 'This reading is no longer shared' }) };
    }
    if (pathname === '/papol/uploads/cited.pdf') return { type: 'application/pdf', body: citedPdf };
    if (pathname === '/papol/uploads/figure.pdf') return { type: 'application/pdf', body: figurePdf };
    // A reference the viewer read off the page, looked up (for any of the papers).
    if (/^\/papol\/api\/viewer-references\/[0-9a-f]{64}\/resolve$/.test(pathname)) return json(resolved);
    if (pathname === '/papol/uploads/smoke.pdf') return { type: 'application/pdf', body: pdfBytes };
    if (pathname.startsWith('/papol/api/')) {
      // Everything else the viewer asks for is an extra a shared reading
      // works without; a JSON 404 keeps it from parsing HTML as an answer.
      return { status: 404, ...json({ detail: 'Not part of the viewer smoke' }) };
    }
    const relative = pathname.replace(/^\/papol\/viewer\/?/, '') || 'index.html';
    const file = await distFile(dist, relative);
    if (file && relative === 'index.html') {
      return { type: file.type, body: file.body.toString('utf8').replace('</body>', `${probe}</body>`) };
    }
    return file;
  },
);

console.log(
  'Viewer browser smoke: a citation marker opened its reference card, search '
  + 'found and highlighted a phrase, a figure link zoomed the figure to fill '
  + 'the window in its middle, a card stepped through the places its work '
  + 'is cited and every way out stayed with [ to go back, a link taken back '
  + 'said so, and '
  + 'the layout held from 320px to 1920px.',
);
