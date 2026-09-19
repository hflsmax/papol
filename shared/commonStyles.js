// Rules Papol and its viewer state identically: the text and focus
// treatment every page owes its user, the experimental sign, the sheet a
// dialog stands on, and the feedback dialog's whole costume. Each app keeps
// its own voice for the rest — buttons, type scale on the page, chrome —
// which is why this module is these rules and no more.
export const commonStyles = `
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

.experimental-badge { display: inline-flex; align-items: center; gap: 4px; width: max-content; padding: 2px 7px; border: 1px solid var(--gold-line); border-radius: var(--radius-pill); background: var(--gold-soft); color: var(--gold-ink); font: 600 var(--fs-2xs) var(--font-ui); letter-spacing: .03em; text-transform: uppercase; vertical-align: middle; white-space: nowrap; }
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

/* The same corner of every surface, so leaving a note about one of them is
   not a different habit from leaving one about another. */
.feedback-fab {
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

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
