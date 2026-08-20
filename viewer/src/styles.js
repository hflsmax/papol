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
  /* Orange is the reader's place: one thing, one hue, used nowhere else. */
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
}

* { box-sizing: border-box; }

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
  z-index: 20;
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
}

.viewer-bar .spacer { flex: 1; }

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
.zoom { display: flex; align-items: center; gap: 6px; }
.zoom-level {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  min-width: 42px;
  text-align: center;
}

/* ---------- Pages ---------- */

.viewer-body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 0;
  height: calc(100vh - 53px);
}

.viewer-body.rail-hidden { grid-template-columns: minmax(0, 1fr); }

.rail-handle {
  position: absolute;
  z-index: 25;
  top: 18px;
  right: 320px;
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
  overflow: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: safe center;
  gap: 20px;
  background: var(--paper-sunken);
}

/* The shape of a page before there is one, so the viewer opens into
   something rather than a sentence. */
.page-skeleton {
  flex: none;
  width: min(100%, 820px);
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

.pin-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; }

.pin {
  position: absolute;
  /* The shape hangs from its ring, so the anchor's point is the top of the
     drawing rather than its middle. */
  transform: translate(-50%, -12%);
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

.pin:hover:not(:disabled) {
  border: none;
  background: none;
  transform: translate(-50%, -12%) scale(1.12);
}

.pin.active { opacity: 1; }
.pin:not(.active) { opacity: 0.9; }

/* An anchor with nothing written on it yet: a mark, not a note. */
.pin.bare { color: var(--accent); }

/* A note placed on another edition of this paper: shown where it was put,
   marked, never moved. */
.pin.drifted { color: var(--ink-soft); }

/* Where the reader is in this paper: one per paper, told apart by colour
   alone — every anchor is the same size. */
.pin.here, .pin.bare.here { color: var(--orange); }

.pin.dragging { cursor: grabbing; opacity: 0.85; }

/* Pointed at from the page: the row lights up, then fades back. */
@keyframes railFlash {
  0%, 55% { box-shadow: 0 0 0 2px var(--accent); }
  100% { box-shadow: 0 0 0 2px transparent; }
}

@keyframes railFlashHere {
  0%, 55% { box-shadow: 0 0 0 2px var(--orange); }
  100% { box-shadow: 0 0 0 2px transparent; }
}

.anchor-row.flash, .note-card.flash { animation: railFlash 2.5s ease-out; }
.anchor-row.here.flash, .note-card.here.flash { animation: railFlashHere 2.5s ease-out; }

/* ---------- Rail ---------- */

.rail {
  overflow: auto;
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
  padding-right: 28px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px 12px;
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

.note-text { margin: 0 0 6px; font-size: var(--fs-md); white-space: pre-wrap; }

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

.anchor-row.here, .note-card.here {
  background: var(--orange-soft);
  border-color: var(--orange-line);
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

.here-tag {
  margin-right: 6px;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--orange);
  color: var(--ink-inverse);
  font-size: var(--fs-2xs);
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
.anchor-row.here .row-glyph, .note-card.here .row-glyph { color: var(--orange); }

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

@media (max-width: 860px) {
  .viewer-body { grid-template-columns: minmax(0, 1fr); height: auto; }
  /* The rail sits under the pages here, so there is no edge to cling to. */
  .rail-handle { display: none; }
  .pages { padding: 12px; }
  .rail { border-left: none; border-top: 1px solid var(--line); }
}
`;
