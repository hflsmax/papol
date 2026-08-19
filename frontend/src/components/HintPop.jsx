import React, { useEffect } from 'react';

// A small popup bubble anchored to its parent (.hint-anchor).
// Closes on any click elsewhere or after a few seconds.
export default function HintPop({ text, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4500);
    const dismiss = () => onClose();
    // Attach on the next task: the click that opened this popup may still
    // be bubbling toward document and must not immediately dismiss it.
    const attach = setTimeout(() => document.addEventListener('click', dismiss), 0);
    return () => {
      clearTimeout(timer);
      clearTimeout(attach);
      document.removeEventListener('click', dismiss);
    };
  }, [onClose]);

  return (
    <span className="hint-pop" onClick={(e) => e.stopPropagation()}>
      {text}
    </span>
  );
}
