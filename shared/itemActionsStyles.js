export const itemActionsStyles = `
.item-actions {
  position: relative;
  display: inline-flex;
  width: 0;
  height: 0;
  flex: none;
  font-family: var(--font-ui);
  line-height: 1.35;
  cursor: default;
  pointer-events: auto;
}

.item-actions-surface {
  position: absolute;
  z-index: 50;
  top: var(--space-1);
  right: 0;
  display: flex;
  gap: 2px;
  width: max-content;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--card) 96%, transparent);
  box-shadow: var(--shadow-md);
  color: var(--ink);
  backdrop-filter: blur(8px);
}

.item-actions.place-above-end .item-actions-surface {
  top: auto;
  right: 0;
  bottom: var(--space-1);
}

.item-actions.place-right-start .item-actions-surface {
  top: 0;
  right: auto;
  left: var(--space-1);
}

.item-actions.place-left-start .item-actions-surface {
  top: 0;
  right: var(--space-1);
  left: auto;
}

.item-actions.place-right-end .item-actions-surface {
  top: auto;
  right: auto;
  bottom: 0;
  left: var(--space-1);
}

.item-actions.place-left-end .item-actions-surface {
  top: auto;
  right: var(--space-1);
  bottom: 0;
  left: auto;
}

.item-actions.place-below-start .item-actions-surface {
  right: auto;
  left: 0;
}

.item-actions.place-above-start .item-actions-surface {
  top: auto;
  right: auto;
  bottom: var(--space-1);
  left: 0;
}

.item-action {
  display: grid;
  width: 32px;
  height: 32px;
  min-width: 32px;
  min-height: 32px;
  place-items: center;
  padding: 6px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  box-shadow: none;
  color: var(--ink-soft);
}

.item-action > svg {
  display: block;
  width: 20px;
  height: 20px;
}

.item-action .action-glyph {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.item-action .action-glyph-fill {
  fill: currentColor;
  stroke: none;
}

.item-action.tone-accent {
  color: var(--accent);
}

.item-action[aria-pressed='true'] {
  background: var(--accent-soft);
  color: var(--accent);
}

.item-action:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}

.item-action:focus-visible {
  outline: none;
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 2px var(--focus);
}

.item-action.danger {
  background: transparent;
  color: var(--red);
}

.item-action.danger:hover:not(:disabled),
.item-action.danger:focus-visible {
  background: var(--red-soft);
  color: var(--red);
}

.item-action:disabled {
  opacity: .42;
  cursor: default;
}

@media (pointer: coarse) {
  .item-action {
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    padding: 9px;
  }
}
`;
