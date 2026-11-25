import React, { useEffect, useState } from 'react';
import { updatePaper } from '../../../shared/api/papers.js';

// A pushpin: an outline for a paper that can be pinned, filled for one
// that is.
export function PinGlyph({ filled = false, size = 16 }) {
  return (
    <svg className="pin-glyph" viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.6 2.3h4.8l-.6 4 2.3 2.8H3.9l2.3-2.8z" fill={filled ? 'currentColor' : 'none'} />
      <path d="M8 9.1v4.6" />
    </svg>
  );
}

// Pins the member's copy of a paper to the top of their nook, or lets it
// go: pressed while the paper is pinned. The press shows at once and is
// taken back if it could not be kept; `onChanged` then reads the paper, or
// the list it is in, again.
export default function PinButton({ sha256, pinned, className = '', size = 16, onChanged }) {
  const [pressed, setPressed] = useState(pinned);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPressed(pinned); }, [pinned]);
  const label = pressed ? 'Unpin from the top of my nook' : 'Pin to the top of my nook';
  const press = async (event) => {
    event.stopPropagation();
    if (busy) return;
    const next = !pressed;
    setPressed(next);
    setBusy(true);
    try {
      await updatePaper(sha256, { pinned: next });
      onChanged?.();
    } catch {
      setPressed(!next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={`pin-button${pressed ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={press}
    >
      <PinGlyph filled={pressed} size={size} />
    </button>
  );
}
