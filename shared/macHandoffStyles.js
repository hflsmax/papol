// The Mac handoff bar, in one place because two stylesheets show it: the
// library and board build from shared/applicationStyles.js, the viewer from
// its own viewer/src/styles.js. The bar lived only in the first of those and
// so arrived in the viewer — the surface it is shown on most — as unstyled
// run-together text.
//
// It is a quiet navy-tinted strip above whatever is being read: tinted
// enough to read as Papol speaking rather than as part of the document,
// plain enough not to compete with the toolbar under it (US-8.1).
export const macHandoffStyles = `
.mac-handoff-bar {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--accent-soft);
  border-bottom: 1px solid var(--accent-line);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  line-height: 1.4;
}

/* The message takes the free width, so the answers sit together at the far
   end and wrap as one group on a narrow window rather than one per line. */
.mac-handoff-message {
  margin-right: auto;
  font-family: var(--font-ui);
}

/* Only this button hands the document over. The bar itself is not a click
   target, because a bar-wide target that means "download" is the whole of
   the deceptive pattern this one is avoiding (US-7.28). */
.mac-handoff-open {
  flex: none;
  min-height: 30px;
  padding: 4px 16px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--ink-inverse);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;
  box-shadow: none;
}

.mac-handoff-open:hover:not(:disabled) {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
  color: var(--ink-inverse);
}

.mac-handoff-open:disabled {
  opacity: 0.65;
  cursor: default;
}

/* Refusing has to be as easy as accepting: a real target, not a hairline
   cross a user has to aim at. Quiet, but the same height and the same kind
   of thing as the button beside it. */
.mac-handoff-dismiss {
  flex: none;
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-faint);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  line-height: 1.4;
  cursor: pointer;
  box-shadow: none;
}

.mac-handoff-dismiss:hover {
  border-color: var(--accent-line);
  background: var(--card);
  color: var(--ink);
}

/* The download is offered in the shape of a button, because by then it is
   the thing to do — but outlined rather than filled, so that the one solid
   navy control in this bar is only ever the one that says "open". */
.mac-handoff-bar a {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 4px 14px;
  border: 1px solid var(--accent-line);
  border-radius: var(--radius);
  color: var(--accent-strong);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  font-weight: 600;
  text-decoration: none;
}

.mac-handoff-bar a:hover {
  border-color: var(--accent);
  background: var(--card);
}

@media (max-width: 560px) {
  .mac-handoff-bar {
    gap: var(--space-1) var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  /* One line for the message, one for the answers. */
  .mac-handoff-message {
    flex: 1 0 100%;
    margin-right: 0;
  }
}
`;
