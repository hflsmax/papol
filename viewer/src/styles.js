import { designTokens } from '../../shared/designTokens.js';
import { itemActionsStyles } from '../../shared/itemActionsStyles.js';

export const styles = `
:root {
  ${designTokens}

  /* Viewer-only annotation colors. These identify tools and marks rather
     than product state, so they intentionally stay outside the core set. */
  --orange: #d2691e;
  --orange-soft: #fbeee2;
  --orange-line: #efd2b6;

  /* The rail's width, in one place: the handle clings to its edge and the
     pages take what is left, so all three have to agree. */
  --rail-w: 344px;
}

${itemActionsStyles}

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

::selection {
  background: var(--accent-line);
  color: var(--ink);
}

:where(a[href], button, input, textarea, select, summary, [role='button'], [tabindex]):focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

:where(input, textarea)::placeholder {
  color: var(--ink-faint);
  opacity: 1;
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
  transition: color var(--motion-fast) var(--ease-out),
    background-color var(--motion-fast) var(--ease-out),
    border-color var(--motion-fast) var(--ease-out),
    box-shadow var(--motion-fast) var(--ease-out);
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

/* In Papol macOS the bar is the window's title bar: the same height as
   the app's toolbar, draggable, and clear of the macOS traffic lights. */
[data-shell='desktop'] .viewer-bar {
  min-height: 52px;
  padding-block: 6px;
  user-select: none;
  -webkit-user-select: none;
}

[data-shell='desktop'][data-platform='mac'] .viewer-bar {
  padding-left: 88px;
}

/* Every control in the bar keeps its size; only the spacer gives way. */
[data-shell='desktop'] .viewer-bar > :not(.spacer) {
  flex-shrink: 0;
}

/* Only the bar's own controls keep to one line. Its wrappers also hold
   pop-ups (the paper's info, search, the brush), whose text must wrap. */
[data-shell='desktop'] .viewer-bar > :is(button, a),
[data-shell='desktop'] .viewer-bar > * > :is(button, a) {
  white-space: nowrap;
}

/* Feedback lives in the app's sidebar. */
[data-shell='desktop'] .feedback-fab {
  display: none;
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

.learn-papol {
  position: absolute;
  z-index: 42;
  top: calc(100% + 14px);
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: min(290px, calc(100vw - 24px));
  padding: 14px 16px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: var(--card);
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(29, 33, 41, 0.2);
}

.learn-papol::before {
  content: '';
  position: absolute;
  left: 22px;
  top: -7px;
  width: 12px;
  height: 12px;
  border-top: 1px solid var(--accent);
  border-left: 1px solid var(--accent);
  background: var(--card);
  transform: rotate(45deg);
}

.learn-papol strong { color: var(--ink); font-size: var(--fs-md); }
.learn-papol-kicker {
  color: var(--accent);
  font-size: var(--fs-2xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.learn-papol kbd {
  display: inline-block;
  min-width: 20px;
  padding: 0 4px;
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 3px;
  background: var(--paper);
  color: var(--ink);
  font: 600 var(--fs-xs) var(--font-ui);
  text-align: center;
}
.learn-papol .learn-papol-close {
  align-self: flex-end;
  margin-top: 2px;
  padding: 4px 9px;
  border-color: var(--accent);
  background: var(--accent);
  color: var(--ink-inverse);
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

.search-wrap-sign {
  position: fixed;
  z-index: 50;
  left: 50%;
  top: 50%;
  display: grid;
  place-items: center;
  width: 112px;
  height: 112px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 50%;
  background: rgba(30, 55, 82, 0.88);
  color: var(--ink-inverse);
  font: 74px/1 var(--font-ui);
  box-shadow: 0 8px 30px rgba(25, 35, 50, 0.3);
  pointer-events: none;
  animation: search-wrap-fade 1.15s ease-out forwards;
}

@keyframes search-wrap-fade {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.78); }
  14% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  58% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.06); }
}

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
.paper-menu { position: relative; display: flex; align-items: center; gap: 6px; }
.viewer-bar button.bar-link { cursor: pointer; background: var(--card); }
.viewer-bar button.bar-link:disabled { cursor: default; opacity: 0.6; }
.viewer-bar .nook-add-button { border-color: var(--accent); color: var(--accent); }
.nook-ask { display: flex; flex-direction: column; gap: 8px; width: min(300px, calc(100vw - 24px)); }
.nook-ask strong { font-size: var(--fs-md); }
.nook-ask p { color: var(--ink-soft); font-size: var(--fs-sm); line-height: 1.45; }
.nook-ask-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.learn-papol.pdf-viewer-tip { left: auto; right: 0; }
.learn-papol.pdf-viewer-tip::before { left: auto; right: 22px; }
.pdf-viewer-tip-actions { display: flex; align-self: flex-end; align-items: center; gap: 6px; margin-top: 2px; }
.pdf-viewer-tip-actions button { padding: 4px 9px; }
.learn-papol .pdf-viewer-tip-actions .learn-papol-close { margin-top: 0; }
.local-notes-hide { display: flex; align-items: center; gap: 6px; color: var(--ink-soft); font-size: var(--fs-sm); cursor: pointer; }
.local-notes-hide input { margin: 0; accent-color: var(--accent); }
.paper-info-button { cursor: pointer; background: var(--card); }
.info-glyph {
  display: inline-grid;
  place-items: center;
  width: 15px;
  height: 15px;
  margin-right: 3px;
  border: 1px solid currentColor;
  border-radius: 50%;
  font: 600 10px/1 var(--font-ui);
}
.paper-info-pop {
  position: absolute;
  z-index: 30;
  top: calc(100% + 9px);
  right: 0;
  width: min(400px, calc(100vw - 24px));
  padding: 14px 16px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  box-shadow: 0 8px 28px rgba(29, 33, 41, 0.18);
  text-align: left;
  font-family: var(--font-ui);
  -webkit-user-select: text;
  user-select: text;
}
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
  --rail-w: clamp(220px, var(--rail-user-w, 344px), min(520px, 45vw));
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

/* ---------- Return pill ---------- */

/* Where a followed link ("see Section 3") left the reader: a pill over the
   pages naming the page to go back to, the document's own history. It is
   kept apart from the bar, whose navigation only leaves for Papol, and it
   exists only while there is somewhere to return to. Centred over the pages,
   not the window. */
.link-return {
  position: absolute;
  z-index: 36;
  bottom: 20px;
  left: calc((100% - var(--rail-w)) / 2);
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--card);
  box-shadow: 0 6px 20px rgba(29, 33, 41, 0.16), 0 1px 3px rgba(29, 33, 41, 0.1);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  white-space: nowrap;
}

.viewer-body.rail-hidden .link-return { left: 50%; }

.link-return .link-return-button,
.link-return .link-return-button:hover:not(:disabled) {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  box-shadow: none;
  color: var(--ink);
  font: inherit;
  line-height: 1.3;
  cursor: pointer;
}

.link-return .link-return-button:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}

.link-return-button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.link-return kbd {
  min-width: 16px;
  padding: 0 4px;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 3px;
  background: var(--paper);
  color: var(--ink-faint);
  font: 600 var(--fs-xs) var(--font-ui);
  line-height: 1.35;
  text-align: center;
}

.link-return-divider {
  align-self: stretch;
  width: 1px;
  margin: 5px 1px;
  background: var(--line);
}

/* The pill's own way out: quiet until pointed at, like a tab's close box. */
.link-return .link-return-hide,
.link-return .link-return-hide:hover:not(:disabled) {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: 1px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  box-shadow: none;
  color: var(--ink-faint);
  cursor: pointer;
}

.link-return .link-return-hide:hover:not(:disabled) {
  background: var(--paper);
  color: var(--ink);
}

.link-return-hide svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

/* Where the pill stood, the Learn Papol card that explains hiding it: the
   same card as the pill's own lesson, drawn in place rather than hung off an
   anchor, since the pill it would point at is gone. */
.link-return-notice {
  position: absolute;
  z-index: 42;
  bottom: 20px;
  left: calc((100% - var(--rail-w)) / 2);
  transform: translateX(-50%);
}

.viewer-body.rail-hidden .link-return-notice { left: 50%; }

.link-return-notice .learn-papol {
  position: static;
  transform: none;
}

.link-return-notice .learn-papol::before { display: none; }

.learn-papol-actions {
  display: flex;
  align-self: stretch;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

.learn-papol .learn-papol-actions .learn-papol-close { margin-top: 0; }

.learn-papol .learn-papol-undo {
  padding: 4px 9px;
  border-color: var(--line-strong);
  background: var(--card);
  color: var(--ink);
}

/* The card's buttons keep their own colours under the pointer. The viewer's
   general button hover turns text accent, which on Got it's accent fill made
   the label vanish. */
.learn-papol .learn-papol-close:hover:not(:disabled) {
  border-color: var(--accent-strong);
  background: var(--accent-strong);
  color: var(--ink-inverse);
}

.learn-papol .learn-papol-undo:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--card);
  color: var(--accent);
}

/* The lesson on getting back opens above the pill it is about. */
.link-return .learn-papol {
  top: auto;
  bottom: calc(100% + 14px);
  left: 50%;
  transform: translateX(-50%);
  white-space: normal;
}

.link-return .learn-papol::before {
  top: auto;
  bottom: -7px;
  left: calc(50% - 6px);
  border: 0;
  border-right: 1px solid var(--accent);
  border-bottom: 1px solid var(--accent);
}

.rail-handle {
  position: absolute;
  z-index: 35;
  top: 18px;
  right: var(--rail-w);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 18px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--line);
  border-right: none;
  border-radius: var(--radius) 0 0 var(--radius);
  background: var(--card);
  color: var(--ink-faint);
  font-size: var(--fs-lg);
  line-height: 1;
  box-shadow: -2px 0 6px rgba(25, 35, 50, 0.08);
}

.rail-handle:hover:not(:disabled) {
  background: var(--paper);
  color: var(--accent);
  border-color: var(--line);
}

.rail-hidden .rail-handle { right: 0; }

.rail-hidden .rail-handle {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 6px 0 0 6px;
  color: var(--accent);
  box-shadow: -2px 2px 10px rgba(25, 35, 50, 0.12);
}

/* WebKit's macOS scroll indicator floats over the right edge of its scroll
   view. Keep the rail controls out of that lane: when the rail is closed
   the page's indicator remains on top at the window edge, and when it is
   open its handle sits just inside the rail instead of covering the page's
   indicator. */
[data-platform='mac'] .rail-hidden .rail-handle { right: 14px; }
[data-platform='mac'] .viewer-body:not(.rail-hidden) .rail-handle {
  right: calc(var(--rail-w) - 18px);
  border-right: 1px solid var(--line);
  border-left: none;
  border-radius: 0 var(--radius) var(--radius) 0;
  box-shadow: 2px 0 6px rgba(25, 35, 50, 0.08);
}

.rail-handle-icon,
.rail-handle-icon svg { display: block; width: 15px; height: 15px; }

.rail-resizer {
  position: absolute;
  z-index: 34;
  top: 0;
  right: calc(var(--rail-w) - 5px);
  bottom: 0;
  width: 10px;
  cursor: col-resize;
  touch-action: none;
}

.rail-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 2px;
  background: transparent;
  transition: background 120ms ease;
}

.rail-resizer:hover::after,
.rail-resizer:focus-visible::after,
.resizing-rail .rail-resizer::after { background: var(--accent); }
.rail-resizer:focus-visible { outline: none; }
.resizing-rail { cursor: col-resize; user-select: none; }

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
  animation: pdfLoadingArrive 160ms ease-out both;
}

@keyframes pdfLoadingArrive {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
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
/* The drawing fills the page whatever scale it was made at, so between a
   zoom and the sharp redraw the last one stretches rather than jumps. */
.page-canvas { position: absolute; inset: 0; }
.page-canvas canvas { width: 100%; height: 100%; }
/* Over a limited drawing, the part on screen at full sharpness; placed in
   fractions of the page by PdfPage. */
.page-canvas .page-detail { position: absolute; }

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
/* Where PdfPage puts the text layer, above the drawing: laid out at one zoom
   and scaled to the zoom shown. */
.text-host { position: absolute; inset: 0; z-index: 2; }
.text-scale { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
/* While a pinch is under way. The spans are invisible anyway, but WebKit
   still paints them, and resizing pages under a dense paper's text layers
   cost about 10ms a frame; hidden, pinching out went from about 22 to 54
   frames a second. Every page's text, not only the text on screen: hiding
   just that measured slower, because text beside the view still repaints.
   Selection and search highlights come back once the view is still. */
.pages.zooming .text-host { visibility: hidden; }
.textLayer ::selection { background: rgba(43, 74, 111, 0.3); }
.provenance-box {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  border: 3px solid #f0b822;
  background: rgba(246, 203, 65, .12);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .9) inset;
  animation: provenanceBoxFade 3.2s ease-out forwards;
}

@keyframes provenanceBoxFade {
  0%, 42% { opacity: 1; }
  100% { opacity: 0; }
}
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

.selection-actions {
  position: absolute;
  z-index: 30;
  display: inline-flex;
  transform: translate3d(-50%, 0, 0);
  will-change: transform;
}

/* WebKit occasionally leaves a newly mounted backdrop-filter surface waiting
   for a later pointer-driven composite. Selection actions must appear in the
   same frame as mouseup, so give this transient toolbar an opaque, dedicated
   compositing surface instead of sharing the generic blurred menu treatment. */
.selection-actions .item-actions-surface {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background: var(--card);
  transform: translateZ(0);
}

.provenance-highlight {
  pointer-events: none;
  animation: provenance-highlight-fade 6s 0.8s ease-out forwards;
}

.text-selection-highlight {
  pointer-events: none;
}

@keyframes provenance-highlight-fade {
  0%, 18% { opacity: 1; }
  100% { opacity: 0; }
}

.send-selection-sheet { width: min(520px, 100%); }
.send-selection-field {
  display: grid;
  gap: 5px;
  margin-bottom: 14px;
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.send-selection-field textarea,
.send-selection-field select {
  width: 100%;
  padding: 8px 32px 8px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  appearance: none;
  background-color: var(--card);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='%234d5561' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-position: right 10px center;
  background-repeat: no-repeat;
  cursor: pointer;
  color: var(--ink);
  font: var(--fs-sm) var(--font-ui);
}
.send-selection-field textarea { resize: vertical; line-height: 1.5; }
.send-selection-field small { color: var(--ink-faint); font-size: inherit; font-weight: 400; }
.send-selection-field textarea:focus,
.send-selection-field select:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.send-selection-source {
  margin: 0 0 14px;
  color: var(--ink-faint);
  font: var(--fs-xs) var(--font-ui);
}

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
  position: absolute;
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

.ref-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 24px;
  margin: -2px 24px 8px 0;
}
.ref-experimental { margin: 0; }
.ref-range-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
  margin: 0;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
}
.ref-range-nav button {
  width: 28px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink);
}
.ref-range-nav button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ref-range-nav button:disabled { opacity: .35; cursor: default; }
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
  overscroll-behavior: contain;
}

.help-sheet {
  width: min(440px, 100%);
  max-height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 20px 22px;
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow-overlay);
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

.feedback-fab::after {
  content: '×';
  display: inline-block;
  width: 0;
  margin-left: 0;
  opacity: 0;
  overflow: hidden;
  transform: translateX(4px);
  transition: width 0.15s ease, margin-left 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

.feedback-fab:hover {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 4px 16px rgba(29, 33, 41, 0.22);
}

.feedback-fab:hover::after {
  width: 0.7em;
  margin-left: 6px;
  opacity: 1;
  transform: translateX(0);
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

.feedback-diagnostics {
  margin: 0 0 14px;
  color: var(--ink-soft);
  font: var(--fs-sm)/1.4 var(--font-ui);
}

.feedback-diagnostics > label { display: flex; align-items: center; gap: 7px; }
.feedback-diagnostics input { width: auto; margin: 0; }
.feedback-diagnostics details { margin-top: 8px; }
.feedback-diagnostics summary { cursor: pointer; }
.feedback-diagnostics pre {
  max-height: 180px;
  overflow: auto;
  margin: 8px 0 0;
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-sunken);
  color: var(--ink-soft);
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
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
.ink-surface.tool-clipper { cursor: crosshair; }

.clipper-overlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: rgba(40, 45, 52, .48);
  pointer-events: none;
}
.clipper-overlay.selecting { background: transparent; }
.clip-window {
  position: absolute;
  display: none;
  border: 2px solid var(--accent);
  background: transparent;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8) inset;
}
.clipper-overlay.selecting .clip-window {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.8) inset,
    0 0 0 9999px rgba(40, 45, 52, .48);
}
.clip-guide {
  position: absolute;
  z-index: 1;
  background: rgba(255, 255, 255, .9);
  box-shadow: 0 0 0 1px rgba(43, 74, 111, .48);
}
.clip-guide.vertical { top: 0; bottom: 0; width: 1px; display: none; }
.clip-guide.horizontal { left: 0; right: 0; height: 1px; display: none; }
.clip-window,
.clip-guide { pointer-events: none; }

.paper-clip {
  position: absolute;
  z-index: 12;
  min-width: 54px;
  min-height: 48px;
  display: flex;
  flex-direction: column;
  overflow: visible;
  background: var(--card);
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  box-shadow: 0 5px 18px rgba(25, 35, 50, 0.28);
  touch-action: none;
  cursor: grab;
  user-select: none;
}

.paper-clip:active { cursor: grabbing; }
.paper-clip.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(43, 74, 111, .2), 0 5px 18px rgba(25, 35, 50, 0.28);
}
.clip-actions {
  position: absolute;
  z-index: 2;
  right: -1px;
  top: 0;
  display: inline-flex;
  cursor: default;
}
.clip-canvas {
  display: block;
  width: 100%;
  min-height: 0;
  flex: 1;
  border-radius: 4px;
}
.clip-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 52%, rgba(43, 74, 111, .65) 54%, rgba(43, 74, 111, .65) 62%, transparent 64%, transparent 72%, rgba(43, 74, 111, .65) 74%, rgba(43, 74, 111, .65) 82%, transparent 84%);
}

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
  padding: 0 18px 24px;
  background: var(--card);
  border-left: 1px solid var(--line);
  scrollbar-gutter: stable;
}

.rail-header {
  position: sticky;
  z-index: 3;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 -18px;
  padding: 18px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(10px);
}

.rail-heading { min-width: 0; }

.rail-kicker {
  display: block;
  margin-bottom: 1px;
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.08em;
  line-height: 1.3;
  text-transform: uppercase;
}

.rail-title-row { display: flex; align-items: center; gap: 8px; }

.rail h2 {
  margin: 0;
  font-size: 1.16rem;
  font-weight: 600;
  line-height: 1.25;
}

.rail-count {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 20px;
  padding: 0 7px;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent);
  font: 650 var(--fs-2xs)/1 var(--font-ui);
}

.rail-header-actions { display: flex; align-items: center; gap: 6px; }

.rail-close,
.rail-help {
  float: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-faint);
  font: 500 var(--fs-base)/1 var(--font-ui);
}

.rail-close { display: none; font-size: 1.25rem; }

.rail-close:hover:not(:disabled),
.rail-help:hover:not(:disabled) {
  border-color: var(--line);
  background: var(--paper);
  color: var(--accent);
}

.rail-intro {
  margin: 14px 0 12px;
  color: var(--ink-faint);
  font: var(--fs-xs)/1.45 var(--font-ui);
}

.rail-list { padding-top: 14px; }
.rail-intro + .rail-list { padding-top: 0; }

.rail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 48px;
  padding: 24px 18px;
  text-align: center;
}

.rail-empty-glyph {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 14px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
}

.rail-empty-glyph svg { width: 22px; height: 22px; }
.rail-empty h3 { margin: 0 0 6px; font-size: var(--fs-base); }
.rail-empty p { max-width: 245px; margin: 0 0 12px; color: var(--ink-soft); font-size: var(--fs-sm); line-height: 1.55; }
.rail-empty .link { font-size: var(--fs-xs); }

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
  border-radius: 7px;
  padding: 11px 12px;
  /* Room for the × in the corner. After the shorthand, or the shorthand
     puts it back. */
  padding-right: 28px;
  margin-bottom: 10px;
  background: linear-gradient(145deg, #f7f9fc, var(--accent-soft));
  cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
}

.note-card:hover,
.note-card:focus-within {
  border-color: var(--line-strong);
  box-shadow: 0 3px 12px rgba(29, 33, 41, 0.08);
  outline: none;
  transform: translateY(-1px);
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
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
}

.note-card:hover > .card-x,
.note-card:focus-within > .card-x,
.anchor-row:hover > .card-x,
.anchor-row:focus-within > .card-x { opacity: 1; }

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
  min-height: 38px;
  padding: 6px 6px 6px 10px;
  margin-bottom: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--accent-soft);
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}

.anchor-row:hover,
.anchor-row:focus-visible {
  border-color: var(--line-strong);
  background: #f2f6fb;
  box-shadow: 0 2px 8px rgba(29, 33, 41, 0.06);
  outline: none;
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

.anchor-jump {
  flex: none;
  width: 22px;
  height: 22px;
  font-size: var(--fs-base);
  text-decoration: none;
  opacity: 0.62;
}

.anchor-jump:hover:not(:disabled),
.anchor-jump:focus-visible { opacity: 1; }

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
  /* The rail lies over the pages here, so the pill centres on the window. */
  .viewer-body .link-return,
  .viewer-body .link-return-notice { left: 50%; }
  .viewer-body {
    --rail-w: min(344px, 88vw);
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

  .rail-scrim {
    position: absolute;
    z-index: 29;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: rgba(29, 33, 41, 0.24);
    cursor: default;
  }

  .rail-close { display: grid; }
  .rail-resizer { display: none; }

  .pages { padding: 12px; }
  .search-pop { position: fixed; left: 12px; right: 12px; top: 58px; width: auto; }
  .search-pop input { flex: 1; width: auto; }
  .pdf-search .search-button { font-size: 0; padding-inline: 7px; }
  .pdf-search .search-button span { font-size: 1rem; }
}

@media (min-width: 861px) {
  .rail-scrim { display: none; }
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
  .card-x { opacity: 1; }
  .anchor-row .card-x { width: 22px; height: 22px; }
  .note-card { padding-right: 32px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
