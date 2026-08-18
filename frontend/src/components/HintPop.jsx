import React, { useEffect } from 'react';

// A small popup bubble anchored to its parent (.hint-anchor).
// Closes on any click elsewhere or after a few seconds.
export default function HintPop({ text, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4500);
    const dismiss = () => onClose();
    document.addEventListener('click', dismiss);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', dismiss);
    };
  }, [onClose]);

  return (
    <span className="hint-pop" onClick={(e) => e.stopPropagation()}>
      {text}
    </span>
  );
}
