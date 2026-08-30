// The viewer is a separate app, so it carries its own copy of Papol's
// tokens rather than importing across the boundary. Values must match
// frontend/DESIGN.md — a reader crossing from a paper page into the viewer
// should not feel they have left.
export const styles = `
:root {
  --font-serif: Georgia, 'Times New Roman', serif;
  --font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  --ink: #1d2129;
  --ink-soft: #4d5561;
  --ink-faint: #7e8794;
  --paper: #f5f6f8;
  --paper-sunken: #f1f3f6;
  --card: #ffffff;
  --line: #dde2e8;
  --line-strong: #b4becb;
  --ink-inverse: #ffffff;
  --accent: #2b4a6f;
  --accent-strong: #1e3752;
  --accent-soft: #eaeff5;
  --gold-ink: #7a5b1e;
  --gold: #b3923d;
  --orange: #d2691e;
  --orange-soft: #fbeee2;
  --orange-line: #efd2b6;
  --gold-soft: #faf3e3;
  --gold-line: #e8d9b5;
  --red: #8c2f22;
  --red-soft: #f9ecea;
  --red-line: #e5c4bd;

  --fs-2xs: 0.7rem;
  --fs-xs: 0.78rem;
  --fs-sm: 0.85rem;
  --fs-md: 0.92rem;
  --fs-base: 0.95rem;
  --fs-lg: 1.05rem;
  --radius: 3px;
  --radius-pill: 999px;

  /* The rail's width, in one place: the handle clings to its edge and the
     pages take what is left, so all three have to agree. */
  --rail-w: 320px;
}

* { box-sizing: border-box; }

/* The viewer is one screenful: the bar on top, the pages and the rail
   filling the rest and scrolling inside themselves. dvh rather than vh so
   a phone's retracting address bar does not leave a strip of nothing at
   the bottom. */
#root {
  display: flex;
  flex-direction: column;
  /* height, not min-height, and the difference is not cosmetic. The pages
     below need a definite height to scroll inside. Given only a minimum,
     the flex item under it has no free space to divide, so it grows to the
     length of the whole document, .pages stops being a scroller, and
     nothing in the viewer scrolls at all. */
  height: 100vh;
  height: 100dvh;
}

body {
  margin: 0;
  font-family: var(--font-serif);
  background: var(--paper);
  color: var(--ink);
  line-height: 1.65;
}

button {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
  line-height: 1.5;
}

button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--ink-inverse); }
button.primary:hover:not(:disabled) { background: var(--accent-strong); color: var(--ink-inverse); }

button.link {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

button.link.danger { color: var(--red); }

.shell { max-width: 640px; margin: 80px auto; padding: 0 20px; }
.loading, .hint { color: var(--ink-faint); }
/* Something failed while reading: said plainly, without taking the page
   away. */
.error-bar {
  position: fixed;
  z-index: 40;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 90vw;
  padding: 8px 14px;
  border: 1px solid var(--red-line);
  border-radius: var(--radius);
  background: var(--red-soft);
  color: var(--red);
  font-size: var(--fs-sm);
  box-shadow: 0 4px 16px rgba(25, 35, 50, 0.25);
}

.error-bar .link { color: var(--red); }

.error {
  padding: 12px 14px;
  border: 1px solid var(--red-line);
  border-radius: var(--radius);
  background: var(--red-soft);
  color: var(--red);
}

/* ---------- Bar ---------- */

.viewer-bar {
  position: sticky;
  top: 0;
  /* Above the rail's handle (35). The bar makes a stacking context, so a
     sheet hanging off a button in it can never rise past this number,
     whatever the sheet's own z-index says — which is how the brush's
     colours came to be painted under the handle. Still under the error bar
     and the help sheet, which are the two things that should cover it. */
  z-index: 38;
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}

.viewer-bar .back {
  color: var(--accent);
  text-decoration: none;
  font-size: var(--fs-base);
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.link-navigation {
  flex: none;
  display: flex;
  gap: 2px;
}

.history-arrow {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}

.history-arrow-glyph {
  display: block;
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.history-key {
  position: absolute;
  left: 3px;
  bottom: 1px;
  color: var(--ink-faint);
  font-family: var(--font-ui);
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
}

.history-arrow:not(:disabled) { border-color: var(--accent-line); }
.history-arrow:hover:not(:disabled),
.history-arrow:focus-visible:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--ink-inverse);
  outline: none;
}
.history-arrow:hover:not(:disabled) .history-key,
.history-arrow:focus-visible:not(:disabled) .history-key { color: var(--ink-inverse); }
.history-arrow:focus-visible:not(:disabled) { box-shadow: 0 0 0 2px var(--accent-soft); }
.history-arrow:active:not(:disabled) { transform: translateY(1px); }
.history-arrow:disabled {
  border-color: var(--line);
  background: var(--paper);
  color: var(--muted);
  opacity: 0.38;
  cursor: default;
}

.viewer-bar .spacer { flex: 1; }

.pdf-search { position: relative; flex: none; font-family: var(--font-ui); }
.search-pop {
  position: absolute;
  z-index: 30;
  top: calc(100% + 9px);
  right: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  width: max-content;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 6px 18px rgba(29, 33, 41, 0.18);
}
.pdf-search input {
  width: 190px;
  min-width: 90px;
  padding: 4px 7px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  font: inherit;
  color: var(--ink);
  background: var(--card);
}
.pdf-search input:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.search-pop button { min-width: 28px; height: 28px; padding: 2px 7px; }
.pdf-search .search-button { height: auto; padding: 5px 9px; }
.search-count { min-width: 58px; color: var(--ink-faint); font-size: var(--fs-2xs); text-align: center; white-space: nowrap; }

/* A bar action that navigates rather than acts on the page. */
.viewer-bar .bar-link {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink);
  text-decoration: none;
  line-height: 1.5;
}

.viewer-bar .bar-link:hover { border-color: var(--accent); color: var(--accent); }
/* What the reader is holding. Icon buttons rather than a menu: the choice
   changes often enough while marking a paper up that it should cost one
   click and no reading. */
.tools { flex: none; display: flex; align-items: center; gap: 2px; }
.tool-slot { position: relative; display: flex; }

/* Hung under the brush, pointing at it.
 *
 * Every control is one cell of the same size, so the four rows line up
 * down the sheet however different the samples inside them are — a swatch,
 * a patch of ink, a nib and a weight are all different shapes, and only
 * the cells they sit in can make them a grid. */
.brush-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: -6px;
  z-index: 30;
  /* A column of names beside a column of rows, so each row says what it is
     without a legend to look up. */
  display: grid;
  grid-template-columns: max-content 1fr;
  align-items: center;
  gap: 10px 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 10px 26px rgba(29, 33, 41, 0.2);
}

.swatches, .weights { display: flex; align-items: center; gap: 6px; }

.brush-pop .swatch,
.brush-pop .shade,
.brush-pop .shape,
.brush-pop .weight {
  display: grid;
  place-items: center;
  width: 32px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius);
  background: none;
  cursor: pointer;
}

/* Chosen, said with a soft ground rather than a hard edge. A black rule
   drawn round a sample competes with the sample — and in a sheet whose
   whole job is to show what the mark will look like, nothing should be
   drawn on top of the mark. */
.brush-pop .swatch.on,
.brush-pop .shade.on,
.brush-pop .shape.on,
.brush-pop .weight.on { background: var(--accent-soft); }

/* The colour itself, round, and rimmed so a pale one still has an edge. */
.brush-pop .swatch::after {
  content: '';
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--swatch);
  box-shadow: inset 0 0 0 1px rgba(29, 33, 41, 0.16);
}

/* The menagerie. Each animal shown as the drawing that will land
   on the page rather than as the button's glyph — the sheet has room for
   the animal, and the animal is what is being chosen between. Three
   across, which is one row and the whole choice at once. */
.beasts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.brush-pop .beast {
  display: grid;
  justify-items: center;
  gap: 1px;
  padding: 5px 4px 4px;
  border: none;
  border-radius: var(--radius);
  background: none;
  cursor: pointer;
}

.brush-pop .beast.on { background: var(--accent-soft); }

.brush-pop .beast svg {
  width: 46px;
  height: 32px;
  display: block;
}

.beast-name {
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  line-height: 1;
}

.brush-pop .beast.on .beast-name { color: var(--ink); }

.animal-control {
  display: flex;
  align-items: center;
  min-width: 180px;
}

.animal-control input[type='range'] {
  width: 100%;
  margin: 0;
  accent-color: var(--accent);
}

.brush-pop .magic-wand-beast { color: var(--ink); }
.brush-pop .magic-wand-beast:hover {
  background: linear-gradient(145deg, var(--accent-soft), var(--paper));
}

.animal-follow-control {
  gap: 8px;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
}

.animal-follow-control input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--accent);
}

/* One colour at three strengths, on the white the ink will be on. Anything
   put underneath to show what survives — a rule of type, a half-black
   patch — reads as a second colour being offered, in a row whose whole
   point is that the colour is already settled. */
.brush-pop .shade-sample {
  position: relative;
  display: block;
  width: 24px;
  height: 16px;
  border-radius: 3px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px rgba(29, 33, 41, 0.18);
}

.brush-pop .shade-ink { position: absolute; inset: 0; display: block; }

/* The nib's shape, at a size of its own: what is chosen here is which nib,
   and the row below already says how big it is. */
.brush-pop .nib { display: block; border-radius: 1px; }
.brush-pop .nib-flat { width: 8px; height: 24px; }
.brush-pop .nib-round { width: 24px; height: 24px; border-radius: 50%; }

.brush-pop .weight-strip { border-radius: 1px; display: block; }

/* How long a trail stays, in seconds, because that is what it is. */
.brush-pop .trail-time {
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1;
}
.brush-pop .weight-strip.round { border-radius: 50%; }

.brush-pop .brush-label {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  text-align: right;
  white-space: nowrap;
}

.brush-pop .brush-tip {
  grid-column: 1 / -1;
  margin: 0;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  white-space: nowrap;
}

.viewer-bar .tool {
  position: relative;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-soft);
  cursor: pointer;
}

.viewer-bar .tool svg { width: 18px; height: 18px; display: block; }

/* Tucked into the corner the glyph leaves empty, and small enough to be
   read as a label on the button rather than as part of the drawing. */
.viewer-bar .tool-key {
  position: absolute;
  left: 3px;
  bottom: 1px;
  font-family: var(--font-ui);
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
  opacity: 0.65;
  pointer-events: none;
}

.viewer-bar .tool.on .tool-key { opacity: 0.85; }

/* Two characters need the room a single one did not, and taking it from
   the left keeps the badge off the glyph above it. */
.viewer-bar .tool-key[data-wide] { left: 0; letter-spacing: -0.02em; }
.viewer-bar .tool:hover { border-color: var(--line-strong); color: var(--ink); }


/* The held tool, said with fill rather than only with a border: at this
   size a border alone is easy to miss, and which tool is in your hand is
   the thing the page's behaviour depends on. */
/* Held. Lighter than the hover below it, so that hovering a tool already
   in hand still visibly answers the pointer — the brush opens its colours
   on a second click, and a button that does not respond looks spent. */
.viewer-bar .tool.on {
  --glyph-cutout: var(--accent);
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
  opacity: 0.82;
}

.viewer-bar .tool.on:hover {
  --glyph-cutout: var(--accent-strong);
  background: var(--accent-strong);
  border-color: var(--accent-strong);
  color: #ffffff;
  opacity: 1;
}

/* The gold one keeps being gold when it is held, so it darkens instead. */
.viewer-bar .tool[aria-label='Here'].on,
.viewer-bar .tool[aria-label='Here'].on:hover { color: #ffffff; }


/* ---------- Pages ---------- */

.viewer-body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--rail-w);
  gap: 0;
  /* Whatever the bar leaves — measured rather than assumed, so the bar can
     change height without the pages hanging off the bottom of the window. */
  flex: 1;
  min-height: 0;
}

.viewer-body.rail-hidden { grid-template-columns: minmax(0, 1fr); }

.rail-handle {
  position: absolute;
  z-index: 35;
  top: 18px;
  right: var(--rail-w);
  width: 15px;
  height: 52px;
  padding: 0;
  border: 1px solid var(--line);
  border-right: none;
  border-radius: var(--radius) 0 0 var(--radius);
  background: var(--card);
  color: var(--ink-faint);
  font-size: var(--fs-md);
  line-height: 1;
  box-shadow: -2px 0 6px rgba(25, 35, 50, 0.08);
}

.rail-handle:hover:not(:disabled) {
  background: var(--paper);
  color: var(--accent);
  border-color: var(--line);
}

.rail-hidden .rail-handle { right: 0; }

.pages {
  position: relative;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: safe center;
  gap: 0;
  background: var(--paper-sunken);
}

.animal-gutter {
  position: relative;
  z-index: 4;
  width: 100%;
  height: 20px;
  flex: 0 0 20px;
  background: transparent;
}

/* Over the page skeletons, saying what they alone do not: whether the
   file is actually moving, and how much of it is left. */
.pdf-loading {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.pdf-loading-card {
  width: min(260px, 80vw);
  padding: 16px 20px;
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 6px 20px rgba(29, 33, 41, 0.18);
  text-align: center;
}

.pdf-loading-card p {
  margin: 0 0 10px;
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}

.pdf-progress-track {
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--paper-sunken);
  overflow: hidden;
}

.pdf-progress-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--accent);
  transition: width 0.2s ease;
}

/* No total to measure against yet: a segment sweeps the track rather than
   sitting at a width that would claim to know how far along this is. */
.pdf-progress-track.indeterminate .pdf-progress-fill {
  width: 40% !important;
  animation: pdfProgressSweep 1.2s ease-in-out infinite;
}

@keyframes pdfProgressSweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}

.pdf-progress-pct {
  display: block;
  margin-top: 8px;
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
}

/* The shape of a page before there is one, so the viewer opens into
   something rather than a sentence. */
.page-skeleton {
  flex: none;
  width: min(100%, 1100px);
  aspect-ratio: 1 / 1.294;
  border-radius: 2px;
  background: linear-gradient(100deg, var(--card) 30%, var(--paper) 50%, var(--card) 70%);
  background-size: 300% 100%;
  animation: skeletonSweep 1.4s ease-in-out infinite;
  box-shadow: 0 1px 6px rgba(25, 35, 50, 0.12);
}

@keyframes skeletonSweep {
  from { background-position: 150% 0; }
  to { background-position: -50% 0; }
}

.pdf-page {
  position: relative;
  background: var(--card);
  box-shadow: 0 1px 6px rgba(25, 35, 50, 0.18);
  flex: none;
}

.page-inner {
  position: relative;
  transform-origin: 0 0;
}

.pdf-page canvas { display: block; }
.pdf-page-blank { width: 100%; height: 100%; background: var(--card); }

.page-number {
  position: absolute;
  bottom: -18px;
  right: 0;
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
}

/* Papol's own touches on pdf.js's text layer; the layout rules come from
   the library's stylesheet. */
.textLayer { z-index: 2; }
.textLayer ::selection { background: rgba(43, 74, 111, 0.3); }
.textLayer .search-highlight {
  position: absolute;
  z-index: -1;
  margin: 0;
  padding: 0;
  border-radius: 1px;
  background: rgba(246, 203, 65, 0.52);
  pointer-events: none;
}
.textLayer .search-highlight-active {
  background: rgba(255, 145, 32, 0.72);
  /* Keep a small reading margin when search navigation has to follow it. */
  scroll-margin: 72px 28px;
}

.selection-brush {
  position: fixed;
  z-index: 30;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 6px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  color: var(--loaded);
  background: var(--card);
  box-shadow: 0 3px 12px rgba(29, 33, 41, 0.2);
  cursor: pointer;
  transform: translateX(-50%);
}

.selection-brush:hover { background: var(--accent-soft); }
.selection-brush:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.selection-brush svg { width: 100%; height: 100%; }

/* The PDF's own links. Invisible until pointed at, like the citations:
   a paper is not improved by underlining every cross-reference in it. */
.link-layer { position: absolute; inset: 0; pointer-events: none; z-index: 2; }

.pdf-link {
  position: absolute;
  display: block;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}

.pdf-link:hover,
.pdf-link:focus-visible {
  background: rgba(43, 74, 111, 0.14);
  box-shadow: 0 0 0 2px rgba(43, 74, 111, 0.14);
  outline: none;
}

/* A citation marker in the text. Nothing is drawn over the page until the
   reader is near it: the PDF already shows "[12]", and a box around every
   one of them would be a rash across the paper. */
.cite-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; }

.cite {
  position: absolute;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  box-shadow: none;
  /* Pointer clicks are delegated from the page by coordinates so this box
     never breaks a text selection dragged across a citation. It remains a
     real button for keyboard focus and activation. */
  pointer-events: none;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}

/* The highlight has to be translucent, not merely pale: this layer is
   drawn over the page, so an opaque wash — however light — would hide the
   very "[12]" the reader is pointing at. */
.cite.hovered,
.cite:focus-visible {
  background: rgba(43, 74, 111, 0.14);
  box-shadow: 0 0 0 2px rgba(43, 74, 111, 0.14);
  outline: none;
}

.cite.open {
  background: rgba(43, 74, 111, 0.16);
  box-shadow: 0 0 0 2px rgba(43, 74, 111, 0.16), inset 0 -2px 0 var(--accent);
}

/* Matched by counting rather than by the analyzer, so it is marked as the
   guess it is — a dotted underline instead of a solid one. */
.cite.guessed.open {
  box-shadow: 0 0 0 2px var(--accent-soft);
  border-bottom: 1px dotted var(--accent);
}

.ref-card {
  position: fixed;
  z-index: 20;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 8px 28px rgba(29, 33, 41, 0.18);
  padding: 14px 16px 12px;
  /* A starting cap, for the pass that measures the card. ReferenceCard
     then sets the real one from the room beside the marker. */
  max-height: 62vh;
  max-width: calc(100vw - 24px);
  overflow-y: auto;
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
}

.ref-experimental { margin: 0 0 8px; }
.experimental-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border: 1px solid var(--gold-line); border-radius: var(--radius-pill); background: var(--gold-soft); color: var(--gold-ink); font-size: var(--fs-2xs); font-weight: 600; letter-spacing: .03em; line-height: 1.5; text-transform: uppercase; white-space: nowrap; }
.experimental-badge svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }

.ref-looking { margin: 2px 0; color: var(--ink-faint); font-style: italic; }

.ref-title {
  overflow-wrap: anywhere;
  font-family: var(--font-serif);
  font-size: var(--fs-lg);
  line-height: 1.35;
  margin: 0 22px 6px 0;
}

.ref-title a { color: var(--accent); text-decoration: none; }
.ref-title a:hover { text-decoration: underline; }

.ref-authors { margin: 0 0 2px; color: var(--ink-soft); font-size: var(--fs-xs); }

.ref-where {
  margin: 0 0 8px;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
}

.ref-cited {
  color: var(--gold-ink);
  background: var(--gold-soft);
  border: 1px solid var(--gold-line);
  border-radius: var(--radius-pill);
  padding: 0 8px;
  white-space: nowrap;
}

.ref-abstract {
  margin: 0;
  font-family: var(--font-serif);
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--ink-soft);
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ref-abstract.full { display: block; overflow: visible; }

.ref-more { margin: 2px 0 0; padding: 0; }

.ref-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--line);
}

.ref-link {
  font-size: var(--fs-xs);
  color: var(--accent);
  text-decoration: none;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 2px 9px;
}

.ref-link:hover { background: var(--accent-soft); }

/* A paper Papol already holds is the one link worth leading with. */
.ref-link.here {
  color: var(--ink-inverse);
  background: var(--accent);
  border-color: var(--accent);
}

.ref-link.here:hover { background: var(--accent-strong); }

.ref-unmatched { margin: 0 22px 6px 0; color: var(--ink-soft); }

.ref-raw {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-serif);
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink);
  background: var(--paper-sunken);
  border-left: 2px solid var(--line-strong);
  padding: 7px 10px;
}

.pin-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; }

/* A question mark where the count was. The count said how many anchors
   there are, which the list underneath already says. */
.rail-help {
  float: right;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  background: none;
  color: var(--ink-faint);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.rail-help:hover { border-color: var(--accent); color: var(--accent); }

.help-back {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(29, 33, 41, 0.42);
}

.help-sheet {
  width: min(440px, 100%);
  max-height: 100%;
  overflow: auto;
  padding: 20px 22px;
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 18px 48px rgba(29, 33, 41, 0.28);
}

.help-sheet h3 { margin: 0 0 14px; font-size: var(--fs-lg); }
/* Key, glyph, name, mnemonic — then the sentence under them, starting at
   the name. Columns rather than a row of flexed items, so a wide badge
   cannot shunt its row out of line with the rest. */
.help-sheet dl {
  margin: 0;
  display: grid;
  grid-template-columns: 34px 22px max-content 1fr;
  column-gap: 10px;
  align-items: center;
}

.help-sheet dt {
  display: contents;
}

.help-sheet .help-name {
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  font-weight: 600;
}

/* One gap between entries rather than four that have to agree: everything
   on the row lifts together. */
.help-sheet dt > * { margin-top: 13px; }

.help-sheet dd {
  grid-column: 3 / -1;
  margin: 3px 0 0;
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}

.help-sheet kbd {
  justify-self: stretch;
  padding: 2px 0;
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: var(--font-ui);
  font-size: 11px;
  text-align: center;
  color: var(--ink-soft);
}

.help-glyph { display: grid; place-items: center; width: 22px; color: var(--ink-soft); }
.help-glyph svg { width: 21px; height: 21px; }

/* How to remember the key, beside the name it belongs to. Quieter than
   both, because it is a nudge rather than a fact about the viewer. */
.help-sheet .mnemonic {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  font-weight: 400;
  font-style: italic;
  color: var(--ink-faint);
}

/* The letter the key is. Darker and heavier than the rest of the word, so
   the eye lands on it first and carries the key with it. */
.help-sheet .mnemonic b {
  font-weight: 700;
  font-style: normal;
  color: var(--ink-soft);
}

.help-foot {
  margin: 18px 0 0;
  font-size: var(--fs-sm);
  color: var(--ink-faint);
}

.help-done {
  margin-top: 16px;
  padding: 7px 16px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: none;
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink);
  cursor: pointer;
}

.help-done:hover { border-color: var(--accent); color: var(--accent); }

/* Same corner Papol itself puts it in, so leaving a note about the viewer
   is not a different habit from leaving one anywhere else. */
.feedback-fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 60;
  padding: 9px 16px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--card);
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  cursor: pointer;
  box-shadow: 0 3px 12px rgba(29, 33, 41, 0.16);
}

.feedback-fab:hover {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 4px 16px rgba(29, 33, 41, 0.22);
}

.feedback-sheet { width: min(420px, 100%); }

.feedback-sheet h3 { margin: 0 0 14px; font-size: var(--fs-lg); }

.feedback-field { margin-bottom: 12px; }

.feedback-field label {
  display: block;
  margin-bottom: 6px;
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}

.feedback-field textarea,
.feedback-field input {
  width: 100%;
  font-family: var(--font-serif);
  font-size: var(--fs-md);
  padding: 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  resize: vertical;
}

.feedback-note {
  margin: 0 0 14px;
  font-size: var(--fs-sm);
  color: var(--ink-faint);
}

.feedback-error {
  margin: 0 0 12px;
  font-size: var(--fs-sm);
  color: var(--red);
}

.feedback-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

/* Under the eraser. The same lift a pointer gives it, and nothing else:
   an anchor about to be rubbed out is still that anchor, and recolouring
   it says something about it that is not true. */
.pin.going {
  transform: translate(-50%, -50%) scale(1.12);
}

/* ---------- Ink ---------- */

/* Over the page and under the pins: a mark belongs to the paper, a pin is
   a control sitting on top of it. Never in the way of a pointer — the
   surface below is what listens. */
.ink-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* The layer itself lets everything through; only .ink-grab inside it
     listens, and only while the arrow is in hand. */
  pointer-events: none;
  z-index: 3;
  /* Animals may stand in the gray gutter between sheets. Ink paths remain
     page-normalized and never use coordinates outside the viewBox. */
  overflow: visible;
}

/* A cow is taken hold of anywhere on it. */
.cow-grab { pointer-events: bounding-box; cursor: grab; }
.ink-layer .cow.going { opacity: 0.55; }

/* The handle on a stroke. pointer-events: stroke means only the line
   itself listens, so the page around it still selects as text. */
.ink-grab {
  pointer-events: stroke;
  cursor: grab;
}

.ink-layer g.carrying { cursor: grabbing; opacity: 0.85; }
.ink-layer g.carrying .ink-grab { cursor: grabbing; }

/* With a tool in hand, this covers the page above the text layer, so a
   drag lays ink instead of selecting words. It does not exist while the
   reader is holding the arrow, and reading is then exactly as it was. */
.ink-surface {
  position: absolute;
  inset: 0;
  z-index: 5;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

/* The brush has no cursor image: its mark is drawn on the page itself, at
   the ink's own size, which a cursor cannot be past about 128px. */
.ink-surface.tool-brush { cursor: none; }

/* The other cursors are drawn rather than named, so the pointer is the
   tool: each has its hotspot at the end that touches the page. The brush's is not here —
   it is the width and colour of the ink it will lay down, which depends on
   the zoom, so PdfPage draws it. */

.ink-surface.tool-eraser {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect x='4' y='11' width='15' height='9' rx='2' transform='rotate(-40 4 11)' fill='%23f5f6f8' stroke='%232b4a6f' stroke-width='1.6'/%3E%3C/svg%3E") 5 19, cell;
}

/* Holding an anchor: the pointer is the mark it will leave, with its point
   at the hotspot so it lands where it looks like it will. */
.ink-surface.tool-anchor,
.ink-surface.tool-here {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26'%3E%3Cg stroke='%23ffffff' stroke-width='3.4' fill='none'%3E%3Ccircle cx='13' cy='5.6' r='2.6'/%3E%3Cpath d='M13 8.4v13M8 12.4h10M6.6 16.4a7 7 0 0 0 12.8 0'/%3E%3C/g%3E%3Cg stroke='%232b4a6f' stroke-width='1.9' fill='none' stroke-linecap='round'%3E%3Ccircle cx='13' cy='5.6' r='2.6'/%3E%3Cpath d='M13 8.4v13M8 12.4h10M6.6 16.4a7 7 0 0 0 12.8 0'/%3E%3C/g%3E%3C/svg%3E") 13 4, copy;
}

/* The laser's own mark is the trail it leaves, so the cursor stays out of
   the way: a small ring, not a shape with a body. */
.ink-surface.tool-laser {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ccircle cx='12' cy='12' r='5' fill='none' stroke='%23ffffff' stroke-width='3'/%3E%3Ccircle cx='12' cy='12' r='5' fill='none' stroke='%23d0342c' stroke-width='1.6'/%3E%3Ccircle cx='12' cy='12' r='1.6' fill='%23d0342c'/%3E%3C/svg%3E") 12 12, crosshair;
}

.pin {
  position: absolute;
  /* Centred on the spot it marks. It used to hang from its ring, which put
     the drawing below the point and the point above the drawing — fine
     while a pin was only ever read, and wrong the moment one is aimed,
     dragged and rubbed out. */
  transform: translate(-50%, -50%);
  pointer-events: auto;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  background: none;
  box-shadow: none;
  color: var(--accent-strong);
  cursor: grab;
  touch-action: none;
}

.pin svg { display: block; width: 100%; height: 100%; }

/* No lift on hover. The anchor in your hand is drawn at the size the pin
   will be, and the pin lands under the pointer — so growing it by a tenth
   the moment it arrived made the mark disagree with the cursor that had
   just promised it. The pointer already turns to a grab over a pin, which
   says the same thing without resizing the mark. */
.pin:hover:not(:disabled) {
  border: none;
  background: none;
}

/* Never a box. An anchor is a mark on a page, not a control on a form, and
   a focus ring drawn around one reads as a selection the reader did not
   make — which is exactly what it looked like after clicking one and then
   picking up another tool. Keyboard focus still shows, as the same lift a
   pointer gives it, so it is findable without being boxed. */
.pin:focus { outline: none; }

.pin:focus-visible {
  outline: none;
  transform: translate(-50%, -50%) scale(1.12);
}

.pin.active { opacity: 1; }
.pin:not(.active) { opacity: 0.9; }

/* An anchor with nothing written on it yet: a mark, not a note. */
.pin.bare { color: var(--accent); }

/* A note placed on another edition of this paper: shown where it was put,
   marked, never moved. */
.pin.drifted { color: var(--ink-soft); }

.pin.dragging { cursor: grabbing; opacity: 0.85; }

/* Pointed at from the page: the row lights up, then fades back. */
@keyframes railFlash {
  0%, 55% { box-shadow: 0 0 0 2px var(--accent); }
  100% { box-shadow: 0 0 0 2px transparent; }
}

/* Five seconds: long enough to find the row without hunting, and to still
   be lit when the eye comes back from the page. App.jsx drops the class a
   moment after this ends — the two are meant to stay in step. */
/* The same anchor, seen in the rail while it is being carried on the page.
   Steady rather than animated: it lasts exactly as long as the hand does. */
.anchor-row.carrying, .note-card.carrying {
  box-shadow: 0 0 0 2px var(--accent);
}

.anchor-row.flash, .note-card.flash { animation: railFlash 5s ease-out; }

/* ---------- Rail ---------- */

.rail {
  overflow: auto;
  overscroll-behavior: contain;
  padding: 18px;
  background: var(--card);
  border-left: 1px solid var(--line);
}

.rail h2 {
  margin: 0 0 12px;
  font-size: var(--fs-lg);
  font-weight: 600;
}

.rail .count {
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
  vertical-align: middle;
}

.empty { color: var(--ink-faint); font-size: var(--fs-md); }

.manual {
  color: var(--ink-soft);
  font-size: var(--fs-md);
}

.manual p { margin: 0 0 10px; }
.manual b { color: var(--ink); font-weight: 600; }

.note-card {
  position: relative;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px 12px;
  /* Room for the × in the corner. After the shorthand, or the shorthand
     puts it back. */
  padding-right: 28px;
  margin-bottom: 10px;
  background: var(--accent-soft);
  cursor: pointer;
}

.card-x {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: none;
  color: var(--ink-faint);
  font-size: var(--fs-lg);
  line-height: 1;
}

.card-x:hover:not(:disabled) {
  border: none;
  background: var(--red-soft);
  color: var(--red);
}

.note-card.draft { background: var(--card); border-color: var(--accent); cursor: default; }

.note-where {
  margin: 0 0 4px;
  flex-wrap: wrap;
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
  display: flex;
  align-items: center;
  gap: 6px;
}

.drift {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--gold-soft);
  border: 1px solid var(--gold-line);
  color: var(--gold-ink);
}

.note-text {
  margin: 0 0 6px;
  font-size: var(--fs-md);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* A bare anchor: a mark in a list of notes, deliberately not a card. */
.anchor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 10px;
  margin-bottom: 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--accent-soft);
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
  cursor: pointer;
}

/* The anchor's label: its name, or the page until it has one. It says it
   can be edited by looking like a field on hover, not by adding an icon. */
.name {
  padding: 0 2px;
  border: none;
  background: none;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  border-bottom: 1px dotted transparent;
  cursor: text;
  text-align: left;
}

.name:hover:not(:disabled) {
  border: none;
  border-bottom: 1px dotted var(--ink-faint);
  background: var(--card);
  color: var(--ink);
}

.name-input {
  width: 9rem;
  padding: 1px 4px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  font-family: inherit;
  font-size: inherit;
  color: var(--ink);
}

/* The rail's bullet is the same mark the page carries. */
.row-glyph {
  flex: none;
  display: inline-block;
  width: 13px;
  height: 13px;
  color: var(--accent-strong);
}

.row-glyph svg { display: block; width: 100%; height: 100%; }

.anchor-row .row-glyph { color: var(--accent); }

.anchor-where { flex: 1; }

.anchor-row .anchor-write { font-size: var(--fs-2xs); opacity: 0; }
.anchor-row:hover .anchor-write { opacity: 1; }

.anchor-row .card-x { position: static; width: 16px; height: 16px; font-size: var(--fs-md); }
.note-actions { display: flex; gap: 10px; align-items: center; }

.rail textarea {
  width: 100%;
  font-family: var(--font-serif);
  font-size: var(--fs-md);
  padding: 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  margin-bottom: 8px;
  resize: vertical;
}

/* ---------- Narrower windows ---------- */

/* Below two comfortable columns the rail stops taking one of its own and
   slides over the pages instead. It does not go under them: every jump in
   the viewer scrolls the .pages element, so a layout where the window
   scrolled instead would quietly break going to an anchor. */
@media (max-width: 860px) {
  .viewer-body {
    --rail-w: min(320px, 86vw);
    grid-template-columns: minmax(0, 1fr);
  }

  .rail {
    position: absolute;
    z-index: 30;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--rail-w);
    box-shadow: -8px 0 24px rgba(25, 35, 50, 0.16);
  }

  .pages { padding: 12px; }
  .search-pop { position: fixed; left: 12px; right: 12px; top: 58px; width: auto; }
  .search-pop input { flex: 1; width: auto; }
  .pdf-search .search-button { font-size: 0; padding-inline: 7px; }
  .pdf-search .search-button span { font-size: 1rem; }
}

/* A phone. The bar has to hold a way back, the file and the zoom in about
   320 points, so the words give way and the paddings tighten. */
@media (max-width: 560px) {
  .viewer-bar { gap: 8px; padding: 8px 12px; }
  .viewer-bar .back-word { display: none; }
  .viewer-bar .bar-link { padding: 6px 9px; }
  .search-pop { left: 8px; right: 8px; }
}

/* A touch screen has no hover, so anything that was only revealed by one
   is simply there, and the small marks are given a finger's worth of
   room. */
@media (hover: none) {
  .anchor-row .anchor-write { opacity: 1; }
  /* The name looks like a field on hover; with no hover to give, it just
     looks like one. */
  .name { border-bottom: 1px dotted var(--ink-faint); }
  .card-x { width: 26px; height: 26px; }
  .anchor-row .card-x { width: 22px; height: 22px; }
  .note-card { padding-right: 32px; }
}
`;
