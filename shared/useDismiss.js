import { useEffect, useRef } from 'react';

/** Put a transient surface away when the pointer goes down outside it —
    and, unless the app handles its keyboard centrally, on Escape.

    One interaction for every pop, menu, tip and card across the Desk, the
    viewer, and the board, where each had written its own: the pointer
    listener rides the capture phase so nothing that swallows the click can
    keep the surface up, and pointerdown (never click) means the press that
    opened the surface can't also be the press that closes it.

    `inside` is a ref to the surface, or a predicate on the event for
    surfaces with more than one part; returning true keeps the surface up.
    Apps whose Escape lives in a central keyboard handler — the viewer's
    and the board's dismissal ladders — pass `escape: false` and keep
    their ordering. */
export function useDismiss(active, inside, onDismiss, { escape = true } = {}) {
  const latest = useRef();
  latest.current = { inside, onDismiss };

  useEffect(() => {
    if (!active) return undefined;
    const away = (event) => {
      const { inside: keep, onDismiss: dismiss } = latest.current;
      const kept = typeof keep === 'function'
        ? keep(event)
        : keep.current?.contains(event.target);
      if (!kept) dismiss();
    };
    const key = (event) => {
      if (event.key === 'Escape') latest.current.onDismiss();
    };
    document.addEventListener('pointerdown', away, true);
    if (escape) window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      if (escape) window.removeEventListener('keydown', key, true);
    };
  }, [active, escape]);
}
