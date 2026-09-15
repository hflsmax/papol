import React, { useLayoutEffect, useRef, useState } from 'react';

const enabledButtons = (surface) => surface
  ? [...surface.querySelectorAll('button:not([disabled])')]
  : [];

export default function ItemActions({
  actions,
  label = 'Item actions',
  placement = 'below-end',
  className = '',
  preserveFocus = false,
}) {
  const anchorRef = useRef(null);
  const surfaceRef = useRef(null);
  const [resolvedPlacement, setResolvedPlacement] = useState(placement);

  useLayoutEffect(() => {
    if (!anchorRef.current || !surfaceRef.current) return undefined;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const surface = surfaceRef.current?.getBoundingClientRect();
      if (!anchor || !surface) return;
      const gap = 4;
      let next = placement;
      if (placement.startsWith('right-') && anchor.right + gap + surface.width > window.innerWidth) {
        next = placement.replace('right-', 'left-');
      } else if (placement.startsWith('left-') && anchor.left - gap - surface.width < 0) {
        next = placement.replace('left-', 'right-');
      } else if (placement.startsWith('above-') && anchor.top - gap - surface.height < 0) {
        next = placement.replace('above-', 'below-');
      } else if (placement.startsWith('below-') && anchor.bottom + gap + surface.height > window.innerHeight) {
        next = placement.replace('below-', 'above-');
      }
      if (next.endsWith('-start') && anchor.top + surface.height > window.innerHeight) {
        next = next.replace('-start', '-end');
      }
      setResolvedPlacement(next);
    };
    const frame = window.requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
    };
  }, [placement, actions.length]);

  const onKeyDown = (event) => {
    const buttons = enabledButtons(surfaceRef.current);
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = buttons[(current + 1) % buttons.length];
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = buttons[(current - 1 + buttons.length) % buttons.length];
    if (event.key === 'Home') next = buttons[0];
    if (event.key === 'End') next = buttons.at(-1);
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <span
      ref={anchorRef}
      className={`item-actions place-${resolvedPlacement}${className ? ` ${className}` : ''}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span ref={surfaceRef} className="item-actions-surface" role="toolbar" aria-label={label} onKeyDown={onKeyDown}>
        {actions.map((action) => (
          <button
            key={action.key || action.label}
            type="button"
            className={[
              'item-action',
              action.tone ? `tone-${action.tone}` : '',
              action.danger ? 'danger' : '',
              action.className || '',
            ].filter(Boolean).join(' ')}
            disabled={action.disabled}
            aria-label={action.label}
            aria-pressed={action.pressed}
            title={action.title || action.label}
            style={action.style}
            onPointerDown={(event) => {
              if (preserveFocus) event.preventDefault();
            }}
            onClick={action.onSelect}
          >
            {action.icon}
          </button>
        ))}
      </span>
    </span>
  );
}
