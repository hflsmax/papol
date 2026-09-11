import React from 'react';
import { MAC } from '../../../shared/desktopShell';

// Papol Desktop's back and forward: the chevron pair at the leading edge of a
// toolbar, before its title, as Finder and Safari have it. Papol, the viewer
// and boards are separate pages that each draw their own toolbar, so all
// three use this one control (DESIGN.md, "Desktop shell").
//
// It keeps no React state, so the viewer and boards can import it from here
// even though they bundle their own copy of React.

const MOD = MAC ? '⌘' : 'Ctrl+';
const STYLE_ID = 'papol-desktop-nav-style';

// The styles travel with the control because the viewer does not load
// Papol's stylesheet; the fallbacks are Papol's own token values.
const STYLE = `
.desktop-nav {
  display: inline-flex;
  flex: none;
  gap: 2px;
}
.desktop-nav .desktop-nav-button,
.desktop-nav .desktop-nav-button:hover:not(:disabled),
.desktop-nav .desktop-nav-button:disabled {
  display: grid;
  place-items: center;
  width: 32px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  box-shadow: none;
  color: var(--ink-soft, #4d5561);
  cursor: default;
  opacity: 1;
  transform: none;
  transition: none;
}
.desktop-nav .desktop-nav-button:hover:not(:disabled) {
  background: rgba(29, 33, 41, 0.07);
  color: var(--ink, #1d2129);
}
.desktop-nav .desktop-nav-button:active:not(:disabled) {
  background: rgba(29, 33, 41, 0.13);
}
.desktop-nav .desktop-nav-button:disabled {
  opacity: 0.3;
}
.desktop-nav .desktop-nav-button:focus-visible {
  outline: 2px solid var(--accent, #2b4a6f);
  outline-offset: -2px;
}
.desktop-nav-button svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}
`;

if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function NavButton({ direction, label, onClick, disabled }) {
  const name = label || (direction === 'back' ? 'Back' : 'Forward');
  return (
    <button
      type="button"
      className="desktop-nav-button"
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-label={name}
      title={`${name} (${MOD}${direction === 'back' ? '[' : ']'})`}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={direction === 'back' ? 'M10 3.25 5.25 8 10 12.75' : 'M6 3.25 10.75 8 6 12.75'} />
      </svg>
    </button>
  );
}

// back / forward: { onClick, disabled, label }. A side without onClick is
// shown disabled, so the pair keeps its shape where only one way exists.
export default function DesktopNav({ back = {}, forward = {} }) {
  return (
    <div className="desktop-nav" role="group" aria-label="Navigation">
      <NavButton direction="back" {...back} />
      <NavButton direction="forward" {...forward} />
    </div>
  );
}
