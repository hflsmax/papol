import React from 'react';

// The one control Papol macOS's document windows share: the house that
// leads to the Library. The viewer and boards each draw their own toolbar,
// so both use this (DESIGN.md, "Desktop shell").
//
// It keeps no React state, so the viewer and boards can import it from here
// even though they bundle their own copy of React.

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
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLE);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

// library: { onClick, label }. Without onClick the control is disabled.
export default function DesktopNav({ library = {} }) {
  const { onClick, label = 'Open Library', disabled } = library;
  return (
    <div className="desktop-nav">
      <button
        type="button"
        className="desktop-nav-button"
        onClick={onClick}
        disabled={disabled || !onClick}
        aria-label={label}
        title={label}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m2.25 7.25 5.75-4.5 5.75 4.5" />
          <path d="M3.75 6.5v6.75h8.5V6.5M6.5 13.25V9h3v4.25" />
        </svg>
      </button>
    </div>
  );
}
