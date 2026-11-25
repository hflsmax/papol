import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { boxBetween, boxEnough, boxPulled } from './termBox.js';

// A definition's box set by hand: over the pages, a layer the reader draws
// a box on, around what defines their term, on whichever page it is
// printed; a box already there (a definition Papol found, to be set right)
// is pulled by its corners or carried whole. The pages scroll under the
// layer as they do without it. A bar says what is asked and keeps or
// leaves it.
//
// `value` is { page, box } or null, the box in fractions of its page.

const GRIPS = ['nw', 'ne', 'sw', 'se'];

const pageUnder = (scroller, x, y) => [...scroller.querySelectorAll('.pdf-page[data-page]')].find((el) => {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
});
const pageOf = (scroller, page) => scroller.querySelector(`.pdf-page[data-page="${page}"]`);

export default function TermBoxer({ scrollerRef, term, value, scale, busy, error, onChange, onSave, onCancel }) {
  const drag = useRef(null);
  // Where the pages' window is, and where the box is in it: read from the
  // pages after they are laid out, and again when they scroll or resize.
  const [place, setPlace] = useState(null);
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    // The scrollbar stays the reader's.
    const frame = { left: r.left, top: r.top, width: scroller.clientWidth, height: scroller.clientHeight };
    const el = value && pageOf(scroller, value.page);
    const p = el?.getBoundingClientRect();
    const box = p ? {
      left: p.left - r.left + value.box.x * p.width, top: p.top - r.top + value.box.y * p.height,
      width: value.box.w * p.width, height: value.box.h * p.height,
    } : null;
    setPlace({ frame, box });
  }, [scrollerRef, value]);
  useLayoutEffect(measure, [measure, scale]);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    scroller.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      scroller.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [scrollerRef, measure]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  // A point of the window as a point of a page, in fractions of it.
  const at = (el, event) => {
    const r = el.getBoundingClientRect();
    return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height };
  };
  const begin = (event, grip) => {
    if (busy || event.button > 0) return;
    const scroller = scrollerRef.current;
    const el = grip === 'draw' ? pageUnder(scroller, event.clientX, event.clientY) : pageOf(scroller, value.page);
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    // The pointer is the box's until it lifts, wherever it wanders.
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* A pointer that is not down holds nothing. */ }
    drag.current = { grip, page: Number(el.dataset.page), from: at(el, event), box: value?.box ?? null, was: value };
  };
  const move = (event) => {
    const held = drag.current;
    if (!held) return;
    const el = pageOf(scrollerRef.current, held.page);
    if (!el) return;
    const now = at(el, event);
    const box = held.grip === 'draw' ? boxBetween(held.from, now) : boxPulled(held.box, held.grip, now.x - held.from.x, now.y - held.from.y);
    onChange({ page: held.page, box });
  };
  const end = () => {
    const held = drag.current;
    drag.current = null;
    // A press with no box drawn leaves what was there.
    if (held?.grip === 'draw' && !boxEnough(value?.page === held.page ? value.box : null)) onChange(held.was);
  };
  const grip = (name) => ({
    onPointerDown: (event) => begin(event, name), onPointerMove: move, onPointerUp: end, onPointerCancel: end,
  });

  const frame = place?.frame;
  return (
    <>
      {frame && (
        <div
          className="term-boxer"
          style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
          onWheel={(event) => scrollerRef.current?.scrollBy({ left: event.deltaX, top: event.deltaY })}
          {...grip('draw')}
        >
          {place.box && (
            <div className="term-box" style={place.box} {...grip('move')}>
              {GRIPS.map((name) => <span key={name} className={`term-box-grip ${name}`} {...grip(name)} />)}
            </div>
          )}
        </div>
      )}
      <div className="term-boxer-bar" role="dialog" aria-label={`Box the definition of ${term}`}>
        <p>
          {value
            ? 'Pull the box’s corners until it holds the definition.'
            : <>Go to where <strong>{term}</strong> is defined and draw a box around the definition.</>}
        </p>
        {error && <p className="feedback-error">{error}</p>}
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="primary" onClick={onSave} disabled={busy || !boxEnough(value?.box)}>Define</button>
      </div>
    </>
  );
}
