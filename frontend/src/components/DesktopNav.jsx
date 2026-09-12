import React from 'react';
import { MAC } from '../../../shared/desktopShell';

// Papol Desktop's Back: a lone chevron at the leading edge of a toolbar,
// before its title, as the App Store and System Settings have it. Only the
// viewer and boards need one — they replace Papol's sidebar, and Back returns
// to it — and nothing ever lies ahead of them, so there is no Forward beside
// it. They are separate pages that each draw their own toolbar, so both use
// this one control (DESIGN.md, "Desktop shell").
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
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
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

// back/library: { onClick, label }. Without onClick a control is disabled.
export default function DesktopNav({ back = {}, library = {} }) {
  const { onClick, label = 'Back', disabled } = back;
  const { onClick: onLibraryClick, label: libraryLabel = 'Open Library', disabled: libraryDisabled } = library;
  return (
    <div className="desktop-nav">
      {Object.keys(back).length > 0 && <button
        type="button"
        className="desktop-nav-button"
        onClick={onClick}
        disabled={disabled || !onClick}
        aria-label={label}
        title={`${label} (${MOD}[)`}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3.25 5.25 8 10 12.75" />
        </svg>
      </button>}
      <button
        type="button"
        className="desktop-nav-button"
        onClick={onLibraryClick}
        disabled={libraryDisabled || !onLibraryClick}
        aria-label={libraryLabel}
        title={libraryLabel}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m2.25 7.25 5.75-4.5 5.75 4.5" />
          <path d="M3.75 6.5v6.75h8.5V6.5M6.5 13.25V9h3v4.25" />
        </svg>
      </button>
    </div>
  );
}
