import React from 'react';
import { setPaperPinned } from '../../../shared/pins.js';

// A pushpin: an outline for a paper that can be pinned, filled for one
// that is.
export function PinGlyph({ filled = false }) {
  return (
    <svg className="pin-glyph" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.6 2.3h4.8l-.6 4 2.3 2.8H3.9l2.3-2.8z" fill={filled ? 'currentColor' : 'none'} />
      <path d="M8 9.1v4.6" />
    </svg>
  );
}

// Pins a paper to the top of the member's nook, or lets it go: pressed
// while the paper is pinned.
export default function PinButton({ sha256, pinned, className = '' }) {
  const label = pinned ? 'Unpin from the top of my nook' : 'Pin to the top of my nook';
  return (
    <button
      type="button"
      className={`pin-button${pinned ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      aria-pressed={pinned}
      aria-label={label}
      title={label}
      onClick={(event) => { event.stopPropagation(); setPaperPinned(sha256, !pinned); }}
    >
      <PinGlyph filled={pinned} />
    </button>
  );
}
