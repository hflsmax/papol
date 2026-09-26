import React, { useRef, useState } from 'react';
import { PAGES, SENTENCES } from './HomeSpecimen';

// The landing page's board: a canvas the way a board looks, with a
// booklet, a collection and loose cards of several kinds, and the
// sentences the visitor painted on the specimen above, each able to lead
// back to its place on the page. Every card can be picked up and moved.

function Kind({ children }) {
  return <span className="board-mock-kind">{children}</span>;
}

// Where each card has been dragged to, from where the layout put it.
function useDrag() {
  const [offsets, setOffsets] = useState({});
  const [lifted, setLifted] = useState(null);
  const grab = useRef(null);

  const handlers = (id) => ({
    onPointerDown: (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const start = offsets[id] || { x: 0, y: 0 };
      grab.current = { id, x: e.clientX - start.x, y: e.clientY - start.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      setLifted(id);
    },
    onPointerMove: (e) => {
      if (grab.current?.id !== id) return;
      // Read now: the update runs later, perhaps after the card is let go.
      const to = { x: e.clientX - grab.current.x, y: e.clientY - grab.current.y };
      setOffsets((current) => ({ ...current, [id]: to }));
    },
    onPointerUp: () => { grab.current = null; },
    onPointerCancel: () => { grab.current = null; },
    style: offsets[id] ? { transform: `translate(${offsets[id].x}px, ${offsets[id].y}px)` } : undefined,
    'data-lifted': lifted === id ? '' : undefined,
  });
  return handlers;
}

function Card({ id, drag, className = '', children }) {
  return <div className={`board-mock-card ${className}`} {...drag(id)}>{children}</div>;
}

export default function HomeBoard({ painted, onBack }) {
  const drag = useDrag();
  return (
    <div className="board-mock">
      <div className="board-mock-bar">
        <span className="board-mock-name">Expanding universe</span>
        <span className="board-mock-count">{6 + painted.length} cards</span>
      </div>
      <div className="board-mock-canvas">
        <div className="board-mock-booklet">
          <p className="board-mock-group-title">Before Hubble</p>
          <Card id="file" drag={drag}>
            <Kind>File</Kind>
            <p className="board-mock-file">Lemaître 1927.pdf</p>
          </Card>
          <Card id="image" drag={drag}>
            <Kind>Image</Kind>
            <svg className="board-mock-image cepheid" viewBox="0 0 120 50" preserveAspectRatio="none" aria-hidden="true">
              <path d="M4 40 C 14 40, 16 10, 22 10 S 34 38, 46 40 C 56 40, 58 10, 64 10 S 76 38, 88 40 C 98 40, 100 10, 106 10 S 114 30, 118 34" />
            </svg>
            <p>A Cepheid’s light, rising and falling</p>
          </Card>
        </div>

        <div className="board-mock-loose">
          {painted.map((id) => (
            <Card key={id} id={id} drag={drag} className="excerpt">
              <Kind>Excerpt</Kind>
              <p>{SENTENCES[id]}</p>
              <button type="button" className="specimen-backlink" onClick={() => onBack(id)}>
                ↖ Hubble 1929, p. {PAGES[id]}
              </button>
            </Card>
          ))}
          <Card id="thought" drag={drag} className="thought">
            <Kind>Thought</Kind>
            <p>His K is 500. Today’s is about 70. Why so far off?</p>
          </Card>
          <Card id="video" drag={drag}>
            <Kind>YouTube video</Kind>
            <div className="board-mock-image video" aria-hidden="true"><span>▶</span></div>
            <p>Redshift, explained</p>
          </Card>
        </div>

        <div className="board-mock-collection">
          <p className="board-mock-group-title">People</p>
          <Card id="leavitt" drag={drag}>
            <Kind>Webpage</Kind>
            <div className="board-mock-image page" aria-hidden="true" />
            <p>Henrietta Swan Leavitt</p>
          </Card>
          <Card id="humason" drag={drag}>
            <Kind>Webpage</Kind>
            <div className="board-mock-image page alt" aria-hidden="true" />
            <p>Milton Humason</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
