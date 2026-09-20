// Rules Papol and its viewer state identically: the text and focus
// treatment every page owes its user, the experimental sign, the sheet a
// dialog stands on, and the feedback dialog's whole costume. Each app keeps
// its own voice for the rest — buttons, type scale on the page, chrome —
// which is why this module is these rules and no more.
export const commonStyles = `
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

/* One dependable keyboard treatment for ordinary controls. More specific
   component rules may adapt the shape (for example, annotations placed on a PDF),
   but focus must never rely on hover styling alone. */
:where(a[href], button, input, textarea, select, summary, [role='button'], [tabindex]):focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

:where(input, textarea)::placeholder {
  color: var(--ink-faint);
  opacity: 1;
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.3;
}

/* Links take their colour from the app, never from the browser's
   blue/purple/red link states — a chip flashing red on click is the
   browser's :active default leaking through. Anything that should look
   like a link says so with its own colour. */
:where(a, a:visited, a:active) {
  color: inherit;
}

/* No grey flash box when tapping a control on a touch screen. */
a,
button,
label,
input[type='checkbox'] {
  -webkit-tap-highlight-color: transparent;
}

/* Every control inherits its context's type rather than falling back to
   a browser default — a bare <textarea> would otherwise render in
   monospace. Inheriting means a field picks up prose serif in a panel,
   mono inside an admin data table, and UI sans in the announce form. */
input,
textarea,
select {
  font-family: inherit;
  font-size: var(--fs-base);
  color: var(--ink);
}

select {
  min-height: 36px;
  padding: 8px 34px 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  appearance: none;
  background-color: var(--card);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='%234d5561' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-position: right 10px center;
  background-repeat: no-repeat;
  cursor: pointer;
}

select:hover:not(:disabled) { border-color: var(--line-strong); background-color: var(--paper); }
select:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
select:disabled { cursor: default; opacity: .65; }

/* One button across the Desk, the board, and the viewer: the same dress,
   the same hover, the same meanings of primary, danger and disabled. Only
   the density is the surface's business — the viewer sets a smaller size
   for its chrome, and nothing else. */
button {
  padding: 8px 18px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--fs-md);
  line-height: 1.5;
  box-shadow: 0 1px 0 rgba(29, 33, 41, 0.12);
  transition: color var(--motion-fast) var(--ease-out),
    background-color var(--motion-fast) var(--ease-out),
    border-color var(--motion-fast) var(--ease-out),
    box-shadow var(--motion-fast) var(--ease-out),
    transform var(--motion-fast) var(--ease-out);
}

button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

button.danger {
  background: var(--red-soft);
  border-color: var(--red-line);
  color: var(--red);
}

button.danger:hover:not(:disabled) {
  background: var(--red-soft);
  border-color: var(--red);
  color: var(--red);
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-inverse);
}

button.primary:hover:not(:disabled) {
  background: var(--accent-strong);
  color: var(--ink-inverse);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* An action written as prose: a control dressed as an inline dotted-underline
   link, whatever element it is. Dotted at rest, solid under the pointer. */
.link-button {
  border: none;
  background: none;
  box-shadow: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
  font-size: inherit;
  cursor: pointer;
}

.link-button:hover {
  border: none;
  background: none;
  text-decoration-style: solid;
}

.link-button.danger { color: var(--red); }

/* One turning ring for every wait, sized by the line it sits in. */
.spinner {
  display: inline-block;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.error {
  background: var(--red-soft);
  color: var(--red);
  border: 1px solid var(--red-line);
  padding: 10px 14px;
  border-radius: var(--radius);
  margin-bottom: 16px;
  font-size: var(--fs-md);
}

.warning {
  background: var(--gold-soft);
  color: var(--gold-ink);
  border: 1px solid var(--gold-line);
  padding: 10px 14px;
  border-radius: var(--radius);
  margin-bottom: 16px;
  font-size: var(--fs-md);
}

/* The way out, drawn as the same house in the board toolbar and the
   viewer bar so the two shells read the same. It is an anchor where it can
   be, so a middle click or Command-click still opens Papol in a new tab. */
.board-toolbar .board-home,
.viewer-bar .home {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--accent);
  text-decoration: none;
}

.board-toolbar .board-home:hover,
.viewer-bar .home:hover {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}

.board-toolbar .board-home:active,
.viewer-bar .home:active {
  background: color-mix(in srgb, var(--ink) 13%, transparent);
}

.board-toolbar .board-home svg,
.viewer-bar .home svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* The bar over a document, in the board and the viewer alike. It sits
   above everything that lies over the pages and makes a stacking context,
   so nothing hanging off a button in it can rise past this number. Each
   app states only how its bar rides the page: the viewer's sticks, the
   board's is pinned. */
.app-bar, .viewer-bar, .board-toolbar {
  z-index: 38;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--card);
  font-family: var(--font-ui);
}

/* A desktop window's bar is chrome, so its text is furniture, not copy —
   and on a Mac the traffic lights come first. */
[data-shell='desktop'] .board-toolbar,
[data-shell='desktop'] .viewer-bar {
  min-height: 52px;
  padding-block: 6px;
  user-select: none;
  -webkit-user-select: none;
}

[data-shell='desktop'][data-platform='mac'] .board-toolbar,
[data-shell='desktop'][data-platform='mac'] .viewer-bar {
  padding-left: 88px;
}

.experimental-badge { border-color: var(--gold-line); background: var(--gold-soft); color: var(--gold-ink); }
.experimental-badge svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }

/* A sheet over a dimmed page: the feedback form everywhere, and the
   viewer's send-to-board box. The backdrop centres the sheet and swallows
   scrolling; the sheet is the one card allowed to scroll if it must. */
.sheet-back {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(29, 33, 41, 0.42);
  overscroll-behavior: contain;
}

.sheet {
  width: min(440px, 100%);
  max-height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 20px 22px;
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow-overlay);
}

.sheet h3 { margin: 0 0 14px; font-size: var(--fs-lg); }

/* The one costume a floating card wears, whichever app it floats over. A
   new pop joins this list — or wears .pop-surface outright — instead of
   restating the costume; a member states only its own deviation (an accent
   border, a pill radius) beside its geometry. */
.card-surface, .panel, .auth-card, .seminar-card, .announce-card,
.discussion-card, .stage-card, .learn-lesson, .board-staging-card,
.pop-surface,
.chip-pop, .share-menu, .tag-dropdown, .shelf-palette,
.board-actions-popover, .board-selection-menu, .board-new-hint,
.search-pop, .paper-info-pop, .brush-pop, .ref-card, .note-pop,
.learn-papol, .link-return {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

/* Floating adds the lift; everything else about the surface is above. */
.pop-surface,
.chip-pop, .share-menu, .tag-dropdown, .shelf-palette,
.board-actions-popover, .board-selection-menu, .board-new-hint,
.search-pop, .paper-info-pop, .brush-pop, .ref-card, .note-pop,
.learn-papol, .link-return {
  box-shadow: var(--shadow-md);
}

/* A chip: something small enough to sit in a line, rounded to a pill so
   it reads as an object, not a word of the sentence around it. */
.chip, .nook-chip, .participant-chip, .tag-chip, .join-chip,
.user-filter, .style-tag, .author-tag {
  display: inline-flex;
  box-shadow: none;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--card);
  color: var(--ink);
  text-decoration: none;
}

/* The identity disc. Sizes come from the place it sits. */
.avatar-initial,
.avatar-img {
  flex: none;
  border-radius: 50%;
}

.avatar-initial {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: var(--ink-inverse);
}

/* A meta line: when or by whom, quiet under the thing it describes. */
.meta, .comment-date, .notification-date, .room-message-time,
.seminar-card-date {
  color: var(--ink-faint);
  font-size: var(--fs-xs);
}

/* A hint: an aside the page can afford to whisper. */
.hint, .loading {
  color: var(--ink-faint);
}

/* A badge: one word in a small pill, uppercase so it reads as a stamp
   rather than a sentence. Each badge states only its palette. */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: max-content;
  padding: 2px 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  font: 600 var(--fs-2xs) var(--font-ui);
  letter-spacing: .03em;
  text-transform: uppercase;
  vertical-align: middle;
  white-space: nowrap;
}

/* A kicker: the quiet small-caps line that names what sits under it. */
.kicker {
  font-size: var(--fs-sm);
  font-variant: small-caps;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  margin-bottom: 8px;
}

/* Bare: a control with no costume of its own — what it looks like is its
   content. The word the switch and the pin already used, now the word for
   every stripped control; hover repainting stays each member's business. */
.bare,
.switch-toggle, .paper-browser-toggle, .tag-input, .rating-clear,
.back-button, .icon-button, .collapse-button, .chip-x,
.notification-toggle, .delete-comment-button, .board-booklet-spine,
.shelf-name-input, .demo-banner-link, .admin-sort,
.tag-dropdown button, .shelf-palette button,
.share-menu > button, .share-menu > a,
.board-actions-popover button, .board-new-hint button,
.board-staging-card button, .board-inline-format button,
.manage-tag-row .tag-chip,
.navigator-sub, .navigator-anchor, .swatch, .shade, .shape, .weight,
.beast, .link-return-button, .link-return-hide, .pdf-link, .cite, .pin,
.note-pop-delete,
.desktop-sidebar-label-action, .desktop-sidebar-item,
.desktop-sync-button, .desktop-toolbar-button {
  border: 0;
  background: none;
  box-shadow: none;
}

/* The small way out of a transient surface: an unadorned ×, centered,
   quiet until pointed at. Each × states its own place and size. */
.dismiss-button {
  display: grid;
  place-items: center;
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
  color: var(--ink-faint);
  line-height: 1;
  cursor: pointer;
}

/* The same corner of every surface, so leaving a note about one of them is
   not a different habit from leaving one about another. */
.feedback-button {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 90;
  /* A flex row, not a line of text. The × that slides in on hover is an
     inline-block with its overflow hidden, and such a box takes its
     baseline from its bottom edge — which swelled the line and set the
     word five pixels low in a chip taller than its own padding. Flex
     items have no baseline to argue about. */
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 14px;
  line-height: 1;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--card);
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  cursor: pointer;
  box-shadow: 0 3px 12px rgba(29, 33, 41, 0.16);
}

.feedback-button::after {
  content: '×';
  display: inline-block;
  width: 0;
  margin-left: 0;
  opacity: 0;
  overflow: hidden;
  transform: translateX(4px);
  transition: width 0.15s ease, margin-left 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

.feedback-button:hover {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 4px 16px rgba(29, 33, 41, 0.22);
}

.feedback-button:hover::after {
  width: 0.7em;
  margin-left: 6px;
  opacity: 1;
  transform: translateX(0);
}

.feedback-sheet { width: min(420px, 100%); }

.feedback-field { margin-bottom: 12px; }

.feedback-field label {
  display: block;
  margin-bottom: 6px;
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}

/* One writing field, wherever writing happens: a Desk form, the feedback
   sheet, the send-to-board box. */
.form-group input, .form-group textarea, .room-textarea,
.feedback-field input, .feedback-field textarea,
.send-selection-field textarea {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  font-size: var(--fs-base);
  font-family: inherit;
}

.form-group input:focus, .form-group textarea:focus, .room-textarea:focus,
.feedback-field input:focus, .feedback-field textarea:focus,
.send-selection-field textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--focus-soft);
}

.form-group textarea, .room-textarea,
.feedback-field textarea, .send-selection-field textarea {
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

/* The row of ways out at the foot of a form or a sheet. */
.form-actions, .feedback-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.feedback-actions { margin-top: 4px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
