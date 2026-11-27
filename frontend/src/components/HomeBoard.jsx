import React, { useEffect, useRef, useState } from 'react';
import { SENTENCES, SOURCE } from './HomeSpecimen';

// The landing page's board: a canvas the way a board looks, with a
// booklet, a collection and loose cards of several kinds, and the
// sentences the visitor painted on the specimen above, each able to lead
// back to its place on the page. Every card can be picked up and moved,
// by mouse, finger or arrow keys; one in a booklet or a collection springs
// back to its place there when let go, as a grouped card keeps its place
// in its group.

function Kind({ children }) {
  return <span className="board-mock-kind">{children}</span>;
}

// Where each card has been dragged to, from where the layout put it. A
// card that snaps back loses its offset when let go, and glides home.
// Mouse and pen drag through pointer events; a finger lifts a card only
// after holding it still (see Card), so a swipe over the board still
// scrolls the page; the arrow keys move a focused card.
function useDrag(onMoved) {
  const [offsets, setOffsets] = useState({});
  const [lifted, setLifted] = useState(null);
  const [returning, setReturning] = useState(null);
  const offsetsNow = useRef(offsets);
  offsetsNow.current = offsets;
  const grab = useRef(null);

  const start = (id, x, y) => {
    const from = offsetsNow.current[id] || { x: 0, y: 0 };
    grab.current = { id, x: x - from.x, y: y - from.y };
    setLifted(id);
    setReturning(null);
  };
  const move = (id, x, y) => {
    if (grab.current?.id !== id) return;
    // Read now: the update runs later, perhaps after the card is let go.
    const to = { x: x - grab.current.x, y: y - grab.current.y };
    setOffsets((current) => ({ ...current, [id]: to }));
    onMoved();
  };
  const home = (id) => {
    setReturning(id);
    setOffsets(({ [id]: _, ...rest }) => rest);
  };
  const end = (id, snapBack) => {
    if (grab.current?.id !== id) return;
    grab.current = null;
    if (snapBack) home(id);
  };
  const nudge = (id, dx, dy) => {
    setLifted(id);
    setReturning(null);
    setOffsets((current) => {
      const from = current[id] || { x: 0, y: 0 };
      return { ...current, [id]: { x: from.x + dx, y: from.y + dy } };
    });
    onMoved();
  };
  const touch = useRef(null);
  touch.current = { start, move, end };

  const props = (id, snapBack) => ({
    tabIndex: 0,
    onPointerDown: (e) => {
      if (e.pointerType === 'touch' || e.button !== 0 || e.target.closest('button')) return;
      start(id, e.clientX, e.clientY);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => { if (e.pointerType !== 'touch') move(id, e.clientX, e.clientY); },
    onPointerUp: (e) => { if (e.pointerType !== 'touch') end(id, snapBack); },
    onPointerCancel: (e) => { if (e.pointerType !== 'touch') end(id, snapBack); },
    onKeyDown: (e) => {
      const by = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
      if (!by || e.target !== e.currentTarget) return;
      e.preventDefault();
      nudge(id, ...by);
    },
    onKeyUp: (e) => { if (snapBack && e.key.startsWith('Arrow') && e.target === e.currentTarget) home(id); },
    onTransitionEnd: () => { if (returning === id) setReturning(null); },
    style: offsets[id] ? { transform: `translate(${offsets[id].x}px, ${offsets[id].y}px)` } : undefined,
    'data-lifted': lifted === id ? '' : undefined,
    'data-returning': returning === id ? '' : undefined,
  });
  return { props, touch };
}

// A sketch of nested lifetimes: each bar a lifetime, the ones under it
// begun later and ended sooner.
const LIFETIMES = [[4, 60], [14, 50], [22, 34], [40, 48]];
function Lifetimes() {
  return (
    <svg className="board-mock-image lifetimes" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {LIFETIMES.map(([from, to], i) => (
        <rect key={from} x={from} y={10 + i * 12} width={to - from} height="7" rx="2" opacity={1 - i * 0.2} />
      ))}
    </svg>
  );
}

const HOLD_MS = 250;

// A card. A finger that rests on it for a moment picks it up, and from then
// on the page does not scroll under it; one that moves first is scrolling.
function Card({ id, drag, grouped = false, beckon = false, className = '', children }) {
  const ref = useRef(null);
  useEffect(() => {
    const card = ref.current;
    let timer = null;
    let held = false;
    let from = null;
    const onStart = (e) => {
      if (e.touches.length !== 1 || e.target.closest('button')) return;
      from = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      held = false;
      timer = setTimeout(() => { held = true; drag.touch.current.start(id, from.x, from.y); }, HOLD_MS);
    };
    const onMove = (e) => {
      const at = e.touches[0];
      if (held) {
        e.preventDefault();
        drag.touch.current.move(id, at.clientX, at.clientY);
      } else if (timer && Math.hypot(at.clientX - from.x, at.clientY - from.y) > 8) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onEnd = () => {
      clearTimeout(timer);
      timer = null;
      if (held) { held = false; drag.touch.current.end(id, grouped); }
    };
    card.addEventListener('touchstart', onStart, { passive: true });
    card.addEventListener('touchmove', onMove, { passive: false });
    card.addEventListener('touchend', onEnd);
    card.addEventListener('touchcancel', onEnd);
    return () => {
      clearTimeout(timer);
      card.removeEventListener('touchstart', onStart);
      card.removeEventListener('touchmove', onMove);
      card.removeEventListener('touchend', onEnd);
      card.removeEventListener('touchcancel', onEnd);
    };
  }, [id, grouped, drag.touch]);
  return (
    <div
      ref={ref}
      className={`board-mock-card ${className}${beckon ? ' beckon' : ''}`}
      data-hint={beckon ? 'Drag' : undefined}
      {...drag.props(id, grouped)}
    >
      {children}
    </div>
  );
}

// A web page's thumbnail, in grey: its header, a title and lines of text.
function PageThumb({ variant }) {
  return (
    <svg className="board-mock-image thumb" viewBox="0 0 120 50" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect className="thumb-bar" x="0" y="0" width="120" height="8" />
      <rect className="thumb-title" x="8" y="14" width={variant ? 58 : 72} height="5" />
      {(variant ? [24, 30, 36] : [24, 30, 36, 42]).map((y, i) => (
        <rect key={y} className="thumb-line" x="8" y={y} width={[96, 88, 92, 60][i]} height="2.5" />
      ))}
      {variant && <rect className="thumb-picture" x="76" y="13" width="36" height="26" />}
    </svg>
  );
}

export default function HomeBoard({ painted, onBack, beckoning, onTried }) {
  const drag = useDrag(() => onTried('drag'));
  return (
    <div className="board-mock">
      <div className="board-mock-bar">
        <span className="board-mock-name">Rust, proved safe</span>
        <span className="board-mock-bar-end">
          <span className="board-mock-tidy" aria-hidden="true">Tidy</span>
          <span className="board-mock-count">{6 + painted.length} cards</span>
        </span>
      </div>
      <div className="board-mock-canvas">
        <div className="board-mock-booklet">
          <p className="board-mock-group-title">Before RustBelt</p>
          <Card id="file" drag={drag} grouped>
            <Kind>File</Kind>
            <p className="board-mock-file">Iris (Jung 2015).pdf</p>
          </Card>
          <Card id="image" drag={drag} grouped>
            <Kind>Image</Kind>
            <Lifetimes />
            <p>Lifetimes, nested</p>
          </Card>
        </div>

        <div className="board-mock-loose">
          {painted.map((id) => (
            <Card key={id} id={id} drag={drag} className="excerpt">
              <Kind>Excerpt</Kind>
              <p>{SENTENCES[id]}</p>
              <button type="button" className="specimen-backlink" onClick={() => onBack(id)}>
                ↖ {SOURCE}
              </button>
            </Card>
          ))}
          <Card id="thought" drag={drag} className="thought" beckon={beckoning === 'drag'}>
            <Kind>Thought</Kind>
            <p>The first machine-checked safety proof for a realistic subset of Rust, unsafe libraries included.</p>
          </Card>
          <Card id="video" drag={drag}>
            <Kind>YouTube video</Kind>
            <div className="board-mock-image video" aria-hidden="true"><span>▶</span></div>
            <p>Ownership and borrowing in Rust</p>
          </Card>
        </div>

        <div className="board-mock-collection">
          <p className="board-mock-group-title">Code</p>
          <Card id="casp" drag={drag} grouped>
            <Kind>Webpage</Kind>
            <PageThumb />
            <p>RustBelt’s Coq development</p>
          </Card>
          <Card id="solved" drag={drag} grouped>
            <Kind>Webpage</Kind>
            <PageThumb variant />
            <p>The Rustonomicon</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
