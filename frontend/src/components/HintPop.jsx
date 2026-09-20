import React, { useEffect, useRef } from 'react';
import { useDismiss } from '../../../shared/useDismiss.js';

// A small popup bubble anchored to its parent (.hint-anchor).
// Closes on any press elsewhere, Escape, or after a few seconds.
export default function HintPop({ text, onClose }) {
  const popRef = useRef(null);
  useDismiss(true, popRef, onClose);
  useEffect(() => {
    const timer = setTimeout(onClose, 4500);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <span ref={popRef} className="hint-pop">
      {text}
    </span>
  );
}
