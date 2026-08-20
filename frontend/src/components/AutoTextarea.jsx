import React, { useLayoutEffect, useRef } from 'react';

// A textarea that grows with what is typed, so a note is never written
// through a four-line window with the top of it scrolled away. `rows`
// keeps its meaning: the height the box opens at and never shrinks below.
export default function AutoTextarea({ value, className, ...rest }) {
  const ref = useRef(null);
  const floor = useRef(null);

  // Measured before paint: a box opened on existing text is already the
  // right height, rather than snapping to it a frame later.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (floor.current == null) floor.current = el.offsetHeight;
    el.style.height = 'auto';
    // scrollHeight covers content and padding but not the border, and the
    // box sizes border-box, so the border is added back by hand.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.max(el.scrollHeight + border, floor.current)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      className={className ? `${className} auto-grow` : 'auto-grow'}
      {...rest}
    />
  );
}
